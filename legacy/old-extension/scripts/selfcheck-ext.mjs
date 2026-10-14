// Offline check of extension.js races (code reviews 3 and 4: D1 to D3, F1) with a stubbed vscode and stubbed t3 calls.
// No T3, no network, invented credentials only.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const Module = require('module');
const t3 = require('../t3.js');
const page = require('../panel.js');
const pass = (name) => console.log('PASS ' + name);
const W = String.raw; // Windows paths as written
const OLD = 'oldbearer0123456789abcdefgh';
const FRESH = 'freshbearer0123456789abcdefgh';
const ORIGIN = 'http://127.0.0.1:3773';
const DAY = 24 * 60 * 60 * 1000;
const at = (days) => new Date(Date.now() + days * DAY).toISOString();
const flush = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); };
const deferred = () => { let resolve; const p = new Promise((r) => { resolve = r; }); return Object.assign(p, { resolve }); };
const down = () => { throw Object.assign(new Error('T3 down'), { code: 'no-runtime-file' }); };
const skip = (ms = 10000) => { const n = Date.now; Date.now = () => n() + ms; }; // R2: the clock moves past the 10 s toast window (for good)

let env;
const vscode = {
  window: {
    createOutputChannel: () => ({ appendLine: (l) => env.logs.push(l), show: (keep) => env.shown.push(keep), dispose() {} }),
    createStatusBarItem: () => (env.status = { show() {}, dispose() {} }),
    registerWebviewViewProvider: (id, p) => { env.panel = p; return { dispose() {} }; },
    showWarningMessage: (m, ...b) => { env.warnings.push(m); env.buttons.push([m, ...b]); return env.answer; },
    showErrorMessage: (m) => { env.order.push('error'); env.errors.push(m); },
    showInformationMessage: async (m, ...b) => { env.infos.push(m); env.buttons.push([m, ...b]); return env.answer; },
    showQuickPick: async (items, o) => { env.picks = [items, o]; return env.pick ? env.pick(items) : undefined; }, // R13
    get state() { return { focused: env.focused !== false }; },
    get activeTextEditor() { return env.editor; },
    get activeTerminal() { return env.terminal; },
    createTerminal: (o) => { const t = { name: o.name, creationOptions: o, sent: [], show(p) { t.sent.push(['show', p]); }, sendText(x, n) { t.sent.push([x, n]); } }; (env.terminals ||= []).push([o, t]); return t; },
    // R4: shell integration and close events, fired by hand.
    onDidStartTerminalShellExecution: (fn) => { env.termStart = fn; return { dispose() {} }; },
    onDidEndTerminalShellExecution: (fn) => { env.termEnd = fn; return { dispose() {} }; },
    onDidCloseTerminal: (fn) => { env.termClose = fn; return { dispose() {} }; },
    showTextDocument: async (u, o) => { env.opened.push({ path: u.fsPath, range: o.selection.args, preview: o.preview }); },
    get activeColorTheme() { return { kind: env.themeKind || 2 }; },
    onDidChangeActiveColorTheme: (fn) => { env.themeListeners.push(fn); return { dispose() {} }; },
    onDidChangeWindowState: (fn) => { env.windowState = fn; return { dispose() {} }; },
    registerUriHandler: (h) => { env.uriHandler = h; return { dispose() {} }; },
    tabGroups: { activeTabGroup: { get activeTab() { return env.tab; } } },
    // B32: an editor tab with the side view's webview shape.
    createWebviewPanel: (...created) => {
      const webview = { posted: [], renders: 0, onDidReceiveMessage(fn) { webview.onMsg = fn; }, postMessage(m) { webview.posted.push(m); } };
      Object.defineProperty(webview, 'html', { set() { webview.renders++; } });
      const tab = { webview, created, reveals: 0, visible: true, reveal() { tab.reveals++; }, onDidDispose(fn) { tab.dispose = fn; }, onDidChangeViewState(fn) { tab.viewState = fn; } };
      (env.tabs ||= []).push(tab);
      return tab;
    },
  },
  languages: {
    registerCodeActionsProvider: (selector, provider, meta) => { env.actions = { selector, provider, meta }; return { dispose() {} }; },
    registerCodeLensProvider: (selector, provider) => { env.lenses = { selector, provider }; return { dispose() {} }; },
  },
  CodeAction: class { constructor(title, kind) { this.title = title; this.kind = kind; } },
  CodeLens: class { constructor(range, command) { this.range = range; this.command = command; } },
  EventEmitter: class { constructor() { this.fired = 0; this.event = Object.assign(() => ({ dispose() {} }), { emitter: this }); } fire() { this.fired++; } dispose() {} },
  CodeActionKind: { QuickFix: 'quickfix' },
  ColorThemeKind: { Light: 1, Dark: 2, HighContrast: 3, HighContrastLight: 4 },
  ThemeColor: class { constructor(id) { this.id = id; } },
  MarkdownString: class { constructor() { this.value = ''; } appendText(t) { this.value += t; return this; } }, // VS Code's also escapes markdown
  workspace: {
    fs: { stat: async (u) => ({ type: env.stat(u.fsPath), size: env.size ? env.size(u.fsPath) : 0 }), readFile: async (u) => env.bytes(u.fsPath) },
    get workspaceFolders() { return env.folders; },
    getWorkspaceFolder: (u) => (env.outside && env.outside(u.fsPath) ? undefined : { uri: {} }),
    onDidChangeWorkspaceFolders: (fn) => { env.folderListeners.push(fn); return { dispose() {} }; },
    getConfiguration: (section) => ({ get: (k) => env.config[section + '.' + k] }),
    onDidChangeConfiguration: (fn) => { env.configChanged = fn; return { dispose() {} }; },
    get textDocuments() { return env.docs || []; },
    saveAll: async (untitled) => { env.saved.push(untitled); return true; },
  },
  // parse like VS Code's: a scheme or it throws; file uris get a Windows fsPath.
  Uri: { file: (p) => ({ scheme: 'file', fsPath: p }), parse: (s) => { const u = new URL(s); const scheme = u.protocol.slice(0, -1); return { scheme, fsPath: scheme === 'file' ? fileURLToPath(u, { windows: true }) : u.pathname, path: u.pathname, str: s }; } },
  env: { uriScheme: 'vscode', clipboard: { writeText: async (t) => { env.clip.push(t); env.clipText = t; }, readText: async () => env.clipText || '' }, openExternal: async (u) => { env.external.push(u.str); return env.externalOk !== false; } },
  FileType: { File: 1, Directory: 2 },
  extensions: { getExtension: (id) => env.ext && env.ext[id] }, // R28: the git extension
  Range: class { constructor(...args) { this.args = args; } },
  commands: {
    registerCommand: (id, fn) => { env.cmds[id] = fn; return { dispose() {} }; },
    executeCommand: async (id, ...a) => {
      if (id === 'setContext') return void (env.ctx[a[0]] = a[1]);
      if (id === 'workbench.action.openWalkthrough' || id === 'vscode.changes') return void env.exec.push([id, ...a]); // R9, R28
      if (id === 'workbench.action.terminal.copySelection' && env.termSel) env.clipText = env.termSel; // copies only a selection, like VS Code's
      if (id === 'git.openChange') { env.exec.push([id, a[0].fsPath]); return env.git(a[0]); } // B20: env.git opens a diff tab, does nothing or throws
      if (['revealInExplorer', 'vscode.open', 'workbench.view.explorer', 'list.expand', 't3vscode.panel.focus', 't3vscode.focusComposer', 'workbench.action.focusActiveEditorGroup', 'workbench.action.showCommands',
        'workbench.action.quickOpen', 'workbench.action.togglePanel', 'workbench.action.terminal.toggleTerminal', 'workbench.action.terminal.copySelection'].includes(id)) env.exec.push(a[0] ? [id, a[0].fsPath] : [id]);
      return env.cmds[id] && env.cmds[id](...a);
    },
  },
  StatusBarAlignment: { Right: 2 },
  ViewColumn: { Beside: -2 },
  // R21: the task provider and the task objects it builds.
  tasks: { registerTaskProvider: (type, p) => { env.taskProvider = [type, p]; return { dispose() {} }; } },
  Task: class { constructor(definition, scope, name, source, execution, matchers) { Object.assign(this, { definition, scope, name, source, execution, matchers }); } },
  ShellExecution: class { constructor(commandLine, options) { Object.assign(this, { commandLine, options }); } },
};
const load = Module._load;
Module._load = function (req, ...rest) {
  if (req === 'vscode') return vscode;
  if (req === './context') return { activate: () => ({ dispose() {} }) }; // Piece 2 is not under test here
  return load.call(this, req, ...rest);
};
// Intervals are captured, not run: each test drives the poll by hand.
globalThis.setInterval = (fn, ms) => { const id = { fn, ms }; env.intervals.push(id); return id; };
globalThis.clearInterval = (id) => { if (id) id.cleared = true; };

// Every state handed to render() is recorded, to prove the bearer never reaches the page.
const states = [];
const htmls = [];
const render = page.render;
page.render = (st) => { states.push(structuredClone(st)); const h = render(st); htmls.push(h); return h; };

const real = { ...t3 };
function start(stored, stubs = {}, folders, config = {}) {
  env = { logs: [], warnings: [], errors: [], order: [], cmds: {}, intervals: [], panel: null, fwds: [], onGet: null, store: stored && JSON.stringify(stored), listeners: [], global: new Map(), workspace: new Map(), opened: [], exec: [], stat: null, folders, folderListeners: [], infos: [], clip: [], external: [], editor: null, themeListeners: [], config, ctx: {}, shown: [], saved: [], buttons: [] };
  Object.assign(t3, real, {
    discover: () => ({ origin: ORIGIN }),
    session: async () => ({ authenticated: true }),
    renew: async () => null,
    threadsFor: async () => ({ items: [], environmentId: null }), // never the running T3
    pendingRequest: async () => ({ note: 'stub' }), // never the running T3 (B14)
    respond: async () => ({ outcome: 'failed', reason: 'stub' }),
    ensureProject: async () => ({ path: '/', title: 'x', fresh: false, note: 'stub' }), // never the running T3 (B7 binds on activation)
    startForwarder: async (o) => { const f = { url: 'http://127.0.0.1:51234', closed: false, close() { f.closed = true; }, setToken(t) { f.token = t; }, ...o }; env.fwds.push(f); return f; },
  }, stubs);
  return activate(context());
}
// The secret store is shared by every window; a change fires in all of them.
const changed = () => setImmediate(() => env.listeners.forEach((fn) => fn({ key: 't3vscode.bearer' })));
const context = () => ({
  secrets: {
    get: () => (env.onGet && env.onGet()) || Promise.resolve(env.store),
    store: async (k, v) => { env.store = v; changed(); },
    delete: async () => { env.store = undefined; changed(); },
    onDidChange: (fn) => { env.listeners.push(fn); return { dispose() {} }; },
  },
  globalState: { get: (k) => env.global.get(k), update: async (k, v) => { env.global.set(k, v); } }, // shared by every window, like VS Code's
  workspaceState: { get: (k) => env.workspace.get(k), update: async (k, v) => { env.workspace.set(k, v); } },
  subscriptions: [],
});
function activate(context) { // a fresh module instance: one VS Code window
  delete require.cache[require.resolve('../extension.js')];
  require('../extension.js').activate(context);
  return context;
}
function openView() {
  const webview = { posted: [], renders: 0, onDidReceiveMessage(fn) { webview.onMsg = fn; }, postMessage(m) { webview.posted.push(m); } };
  Object.defineProperty(webview, 'html', { set() { webview.renders++; env.order.push('render'); } });
  env.panel.resolveWebviewView({ webview, onDidDispose(fn) { webview.dispose = fn; }, onDidChangeVisibility(fn) { webview.visibility = fn; }, get visible() { return env.visible !== false; } });
  return webview;
}
const stored = () => env.store && JSON.parse(env.store).bearer;

try {
  { // D1: a renewal that lands after Forget writes nothing; without Forget it is stored.
    const renewal = deferred();
    start({ bearer: OLD, expiresAt: at(2), scopes: ['access:write'] }, { renew: () => renewal });
    await flush();
    await env.cmds['t3vscode.forget']();
    renewal.resolve({ bearer: FRESH, expiresAt: at(30), scopes: ['access:write'] });
    await flush();
    assert.equal(env.store, undefined, 'late renewal restored a forgotten session');
    start({ bearer: OLD, expiresAt: at(2), scopes: ['access:write'] }, { renew: async () => ({ bearer: FRESH, expiresAt: at(30), scopes: ['access:write'] }) });
    await flush();
    assert.equal(stored(), FRESH, 'renewal without Forget is stored');
    const legacy = deferred();
    start({ bearer: OLD }, { session: () => legacy });
    await flush();
    await env.cmds['t3vscode.forget']();
    legacy.resolve({ authenticated: true, expiresAt: at(20), permissions: ['access:write'] });
    await flush();
    assert.equal(env.store, undefined, 'late legacy fill-in restored a forgotten session');
    pass('D1: late renewal or legacy fill-in after Forget writes nothing');
  }

  { // D1: a revoked-session re-read that resolves after a fresh pairing deletes nothing.
    start({ bearer: OLD, expiresAt: at(20), scopes: [] }, {
      session: async (o, b) => ({ authenticated: b === FRESH }),
      exchange: async () => ({ bearer: FRESH, expiresAt: at(30), scopes: [] }),
    });
    await flush();
    const reread = deferred();
    let n = 0;
    env.onGet = () => (++n === 2 ? reread : null);
    openView();
    await flush(); // the refresh now waits on its re-read
    await env.panel.pair('freshpairingcode123');
    await flush();
    assert.equal(stored(), FRESH, 'pairing stored');
    reread.resolve(JSON.stringify({ bearer: OLD }));
    await flush();
    assert.equal(stored(), FRESH, 'stale revoked re-read deleted a fresh pairing');
    assert.equal(states.at(-1).kind, 'paired');
    assert.ok(!env.fwds.at(-1).closed, 'fresh forwarder survives');
    pass('D1: stale revoked re-read after a fresh pairing deletes nothing');
  }

  { // F1: a Pair that completes after Forget stores nothing and changes no UI.
    const ex = deferred();
    start(undefined, { exchange: () => ex });
    const webview = openView();
    await flush();
    const p = env.panel.pair('latepairingcode123');
    await flush();
    await env.cmds['t3vscode.forget']();
    await flush();
    const renders = webview.renders;
    ex.resolve({ bearer: FRESH, expiresAt: at(30), scopes: [] });
    await p;
    await flush();
    assert.equal(env.store, undefined, 'late Pair restored a forgotten session');
    assert.equal(states.at(-1).kind, 'unpaired');
    assert.equal(webview.renders, renders, 'late Pair re-rendered');
    assert.ok(!env.logs.some((l) => l.startsWith('Paired with')), 'late Pair logged success');
    pass('F1: a Pair completing after Forget stores nothing');
  }

  { // F1: of two concurrent Pairs the later one wins, even when the earlier exchange answers last.
    const slow = deferred();
    start(undefined, { exchange: async (o, token) => (token === 'slowcode' ? slow : { bearer: FRESH, expiresAt: at(30), scopes: [] }) });
    const webview = openView();
    await flush();
    const a = env.panel.pair('slowcode');
    await env.panel.pair('fastcode');
    await flush();
    const renders = webview.renders;
    slow.resolve({ bearer: 'slowbearer0123456789abcdefgh', expiresAt: at(30), scopes: [] });
    await a;
    await flush();
    assert.equal(stored(), FRESH, 'older Pair stored last');
    assert.equal(env.logs.filter((l) => l.startsWith('Paired with')).length, 1, 'stale Pair logged success');
    assert.equal(webview.renders, renders, 'stale Pair re-rendered');
    pass('F1: two concurrent Pairs keep the later grant');
  }

  { // F1: a revoked-session re-read that captured the old bearer does not delete a renewal stored meanwhile.
    const renewal = deferred();
    start({ bearer: OLD, expiresAt: at(2), scopes: ['access:write'] }, { renew: () => renewal, session: async (o, b) => ({ authenticated: b === FRESH }) });
    await flush();
    const reread = deferred();
    let n = 0;
    env.onGet = () => (++n === 2 ? reread : null);
    openView();
    await flush(); // the refresh now waits on its re-read
    renewal.resolve({ bearer: FRESH, expiresAt: at(30), scopes: ['access:write'] });
    await flush();
    assert.equal(stored(), FRESH, 'renewal stored');
    reread.resolve(JSON.stringify({ bearer: OLD, expiresAt: at(2), scopes: ['access:write'] }));
    await flush();
    assert.equal(stored(), FRESH, 'stale revoked re-read deleted a renewal');
    assert.equal(states.at(-1).kind, 'paired');
    pass('F1: stale revoked re-read after a renewal deletes nothing');
  }

  { // G1: window A forgets while window B's renewal is in flight; B stores nothing and its panel follows the shared store.
    const renewal = deferred();
    start({ bearer: OLD, expiresAt: at(2), scopes: ['access:write'] }, { renew: () => renewal });
    const B = env.panel;
    openView();
    await flush();
    assert.equal(states.at(-1).kind, 'paired');
    activate(context()); // window A, same store
    assert.notEqual(env.panel, B);
    await env.cmds['t3vscode.forget']();
    await flush();
    assert.equal(stored(), undefined);
    assert.equal(states.at(-1).kind, 'unpaired', 'B did not follow the shared store');
    renewal.resolve({ bearer: FRESH, expiresAt: at(30), scopes: ['access:write'] });
    await flush();
    assert.equal(stored(), undefined, 'B restored a forgotten session');
    pass('G1: another window forgets; a pending renewal here stores nothing and the panel follows');
  }

  { // D3: a probe still in flight when its poll stops does not refresh; a live poll's probe does.
    start(undefined, { discover: down });
    openView();
    await flush();
    assert.equal(states.at(-1).kind, 'down');
    const poll = env.intervals.find((i) => i.ms === 10000 && !i.cleared);
    const probe = deferred();
    Object.assign(t3, { discover: () => ({ origin: ORIGIN }), session: () => probe });
    let refreshes = 0;
    const refresh = env.panel.refresh;
    env.panel.refresh = function () { refreshes++; return refresh.call(this); };
    poll.fn();
    env.panel.stopPoll();
    probe.resolve({ authenticated: false });
    await flush();
    assert.equal(refreshes, 0, 'stopped poll refreshed');
    t3.session = async () => ({ authenticated: false });
    env.panel.startPoll();
    env.intervals.at(-1).fn();
    await flush();
    assert.equal(refreshes, 1, 'live poll did not refresh');
    pass("D3: a stopped poll's late probe does not refresh");
  }

  { // D2: one revalidation per 401 burst, none for a 403; still valid keeps the frame, ended clears and says so.
    let calls = 0;
    let ok = true;
    start({ bearer: OLD, expiresAt: at(20), scopes: [] }, { session: async () => { calls++; return { authenticated: ok }; } });
    const webview = openView();
    await flush();
    assert.equal(states.at(-1).kind, 'paired');
    const fwd = env.fwds.at(-1);
    const before = calls;
    const renders = webview.renders;
    fwd.onRequest({ kind: 'http', method: 'GET', path: '/api/x', status: 403, own: false });
    await flush();
    assert.equal(calls, before, '403 revalidated');
    fwd.onRequest({ kind: 'http', method: 'GET', path: '/api/x', status: 401, own: false });
    fwd.onRequest({ kind: 'http', method: 'GET', path: '/api/y', status: 401, own: false });
    fwd.onUpgradeFailure({ status: 401, kind: 'auth', body: '' });
    await flush();
    assert.equal(calls, before + 1, 'not exactly one revalidation');
    assert.equal(webview.renders, renders, 'still-valid session rebuilt the frame');
    assert.equal(env.warnings.length, 1, 'auth refusal with a valid session keeps the warning');
    assert.equal(stored(), OLD);
    env.panel.checked = 0; // past the 30 s window
    fwd.warned = false; // so a wrong warning would show
    ok = false;
    fwd.onRequest({ kind: 'upgrade', method: 'GET', path: '/ws', status: 401, own: false }); // t3.js reports an upgrade 401 both ways
    fwd.onUpgradeFailure({ status: 401, kind: 'auth', body: '' });
    await flush();
    assert.equal(calls, before + 3, 'upgrade 401 not revalidated exactly once'); // one revalidation, then the refresh's own check
    assert.equal(env.warnings.length, 1, 'ended session also warned of a nightly auth change');
    assert.equal(env.store, undefined, 'ended session not cleared');
    assert.ok(states.at(-1).kind === 'unpaired' && states.at(-1).ended, 'session ended state');
    assert.ok(fwd.closed, 'forwarder closed');
    pass('D2: a 401 revalidates once, a 403 does not; an ended session is cleared');
  }

  { // Panel items 1 and 3: plain words for a refused code; Start T3 re-renders before the error.
    const refused = Object.assign(new Error(`T3 refused the pairing token (status 401): raw ${OLD}`), { code: 'exchange-failed', status: 401 });
    start(undefined, { exchange: async () => { throw refused; } });
    const webview = openView();
    await flush();
    await env.panel.pair('somecode123');
    assert.ok(webview.posted.at(-1).text.startsWith('T3 did not accept that code.'), 'plain words');
    assert.ok(!webview.posted.at(-1).text.includes('status 401') && env.logs.some((l) => l.includes('status 401')), 'raw text only in the log');
    t3.exchange = async () => { throw Object.assign(new Error('T3 did not answer'), { code: 'no-answer' }); };
    await env.panel.pair('somecode123');
    assert.equal(webview.posted.at(-1).text, 'T3 did not answer', 'other errors keep their message');
    start(undefined, { discover: down, t3ExePath: () => null });
    openView();
    await flush();
    env.order.length = 0;
    env.cmds['t3vscode.startT3']();
    assert.ok(env.order.includes('render') && env.order.indexOf('render') < env.order.indexOf('error'), 'Start T3 re-renders before the error');
    assert.ok(states.at(-1).kind === 'down' && !states.at(-1).busy, 'Start T3 enabled again');
    pass('pair error in plain words; Start T3 comes back when the exe is missing');
  }

  { // localFilePath: local absolute drive paths only (INJECT.md lead decision 2).
    const { localFilePath } = require('../extension.js');
    for (const p of [W`\\srv\share\f`, W`\\.\COM1`, W`\\?\C:\x`, W`C:\x\NUL`, W`C:\x\nul.txt`, W`C:x\y`, W`C:\a:b\c`, 'C:/x/a' + String.fromCharCode(0) + 'b', 'src/a.ts', '/home/u/a.ts', 42,
      ...[0xb9, 0xb2, 0xb3].flatMap((d) => ['C:/x/COM' + String.fromCharCode(d) + '.txt', 'C:/x/lpt' + String.fromCharCode(d)]), W`C:\x\CONIN$`, W`C:\x\conout$.txt`]) {
      assert.equal(localFilePath(p), null, String(p));
    }
    assert.equal(localFilePath(W`D:\GIT\t3-vscode\t3.js`), W`D:\GIT\t3-vscode\t3.js`);
    assert.equal(localFilePath('d:/git/x/y.js'), W`d:\git\x\y.js`);
    pass('localFilePath: rejects UNC, device namespaces, reserved names (also COM/LPT with superscript digits, CONIN$, CONOUT$), drive-relative, extra colons, control characters, relative and POSIX paths');
  }

  { // openFile: a bad or missing path warns and opens nothing; a file opens at its line and is revealed; a folder is only revealed.
    start({ bearer: OLD, expiresAt: at(20), scopes: [] });
    const webview = openView();
    await flush();
    const realNow = Date.now;
    let clock = realNow();
    Date.now = () => (clock += 1000); // openFile drops a request within 300 ms of the last one
    env.stat = (p) => (p.endsWith('dir') ? 2 : 1);
    webview.onMsg({ cmd: 'openFile', path: W`\\srv\share\f`, line: 3 });
    await flush();
    assert.ok(env.warnings.length === 1 && env.warnings[0].includes('srv'), 'bad path warned');
    assert.deepEqual([env.opened, env.exec], [[], []], 'bad path touched VS Code');
    webview.onMsg({ cmd: 'openFile', path: W`D:\x\a.ts`, line: 12, column: 3 });
    await flush(); // one at a time: stat is async
    webview.onMsg({ cmd: 'openFile', path: 'D:/x/dir', line: 5 });
    await flush();
    webview.onMsg({ cmd: 'openFile', path: 'D:/x/b.ts', line: 0, column: 2e6 });
    await flush();
    assert.deepEqual(env.opened, [{ path: W`D:\x\a.ts`, range: [11, 2, 11, 2], preview: false }, { path: W`D:\x\b.ts`, range: [0, 0, 0, 0], preview: false }]);
    assert.deepEqual(env.exec, [['revealInExplorer', W`D:\x\a.ts`], ['workbench.view.explorer'], ['revealInExplorer', W`D:\x\dir`], ['list.expand'], ['revealInExplorer', W`D:\x\b.ts`]]);
    env.stat = () => { throw new Error('ENOENT'); };
    webview.onMsg({ cmd: 'openFile', path: 'D:/x/gone.ts' });
    await flush();
    assert.equal(env.warnings.length, 2, 'missing file not warned');
    pass('openFile: bad or missing path warns only; file opens at line and column (out of range -> 1) and reveals; a folder shows the Explorer, is revealed and expanded, nothing opened');
    env.stat = () => 1;
    env.exec.length = 0;
    webview.onMsg({ cmd: 'openFile', path: 'D:/x/pic.PNG', line: 4 });
    await flush();
    env.outside = (p) => p.startsWith('E:');
    webview.onMsg({ cmd: 'openFile', path: 'E:/elsewhere/n.ts', line: 2 });
    await flush();
    env.outside = null;
    assert.deepEqual(env.exec, [['vscode.open', W`D:\x\pic.PNG`], ['revealInExplorer', W`D:\x\pic.PNG`]]);
    assert.deepEqual(env.opened.slice(2).map((o) => o.path), [W`E:\elsewhere\n.ts`], 'media went to showTextDocument or the outside file not opened');
    assert.ok(env.logs.some((l) => l.includes('E:/elsewhere/n.ts is outside every workspace folder')), 'outside file not logged');
    pass("openFile: an image opens in VS Code's own viewer (vscode.open) and is revealed; a file outside every workspace folder opens, is not revealed, the log says why");
    env.stat = () => 1;
    const show = vscode.window.showTextDocument;
    vscode.window.showTextDocument = async () => { throw new Error('binary file'); };
    const reveals = env.exec.length;
    webview.onMsg({ cmd: 'openFile', path: 'D:/x/c.bin' });
    await flush();
    vscode.window.showTextDocument = show;
    Date.now = realNow;
    assert.deepEqual(env.warnings.slice(2), ['T3 Code could not open D:/x/c.bin'], 'failed open not warned');
    assert.ok(env.exec.length === reveals && env.logs.some((l) => l.includes('binary file')), 'failed open revealed or not logged');
    pass('openFile: a text open that throws is logged and warned once, nothing revealed');
  }

  { // R14: each window takes the first free of 47730 to 47739, remembered in its workspaceState; random only when all ten are taken.
    const asked = [];
    const taken = new Set([47730]);
    const forwarder = async (o) => {
      asked.push(o.port);
      const port = [o.port, ...o.spare].find((p) => !taken.has(p)) || 50001;
      const f = { ...o, port, usedRequested: port === o.port, url: 'http://127.0.0.1:1', close() {} };
      env.fwds.push(f);
      return f;
    };
    const PORTS = Array.from({ length: 10 }, (_, i) => 47730 + i);
    const own = new Map(); // window B's workspace
    const windowB = () => { activate({ ...context(), workspaceState: { get: (k) => own.get(k), update: async (k, v) => { own.set(k, v); } } }); openView(); return flush(); };
    start({ bearer: OLD, expiresAt: at(20), scopes: [] }, { startForwarder: forwarder });
    await windowB(); // 47730 held by another window
    assert.deepEqual([asked, env.fwds.at(-1).spare, own.get('t3vscode.forwarderPort')], [[47730], PORTS.slice(1), 47731]);
    taken.clear();
    await windowB(); // a restart of B with 47730 free: B keeps its origin
    assert.deepEqual([asked.at(-1), env.fwds.at(-1).port, env.fwds.at(-1).spare, own.get('t3vscode.forwarderPort')], [47731, 47731, PORTS.filter((p) => p !== 47731), 47731]);
    PORTS.forEach((p) => taken.add(p));
    own.clear();
    await windowB(); // all ten taken
    env.panel.closeForwarder();
    env.panel.refresh(); // recreation: the same random port first, still not stored
    await flush();
    assert.deepEqual([asked.slice(-2), env.fwds.at(-1).port, own.has('t3vscode.forwarderPort'), env.global.has('t3vscode.forwarderPort')], [[47730, 50001], 50001, false, false]);
    pass('R14 stable port: 47730 taken -> 47731, stored in that window\'s workspaceState; a restart asks the stored one first; all ten taken -> random, reused on recreation, never stored');
  }

  { // Row 1 of docs/SYNC.md: the panel binds to the window's first local folder, follows a change of it, and asks for a first thread once.
    const calls = [];
    let answer = { path: '/env%201/t-1', title: 'proj', root: W`D:\GIT\proj`, fresh: false, note: null };
    const folder = (scheme, fsPath) => ({ uri: { scheme, fsPath } });
    const scopes = ['orchestration:read', 'orchestration:operate'];
    const listed = []; // the folders each threadsFor got
    start({ bearer: OLD, expiresAt: at(20), scopes }, { ensureProject: async (o) => { calls.push(o); return answer; },
      threadsFor: async (o) => { listed.push(o.folders.slice()); return { items: [], environmentId: null }; } }, [folder('file', W`D:\GIT\proj`)]);
    const webview = openView();
    await flush();
    assert.deepEqual(calls, [{ origin: ORIGIN, bearer: OLD, folder: W`D:\GIT\proj`, scopes: ['orchestration:read'], preferThread: undefined }]); // the startup bind (B7) found the project read-only; the first refresh took it over
    assert.deepEqual([states.at(-1).path, states.at(-1).folderName, states.at(-1).note, states.at(-1).newThread], ['/env%201/t-1', 'proj', null, null]);
    assert.ok(htmls.at(-1).includes('<iframe src="http://127.0.0.1:51234/env%201/t-1"'), 'path not rendered');
    pass('refresh with a folder: ensureProject gets the first folder, the bearer and the stored scopes; its path is rendered');
    env.folders.push(folder('file', W`D:\other`));
    env.folderListeners.forEach((fn) => fn());
    await flush();
    assert.equal(calls.length, 1, 'a second folder re-bound the panel');
    assert.deepEqual([env.panel.bind.folders, listed.at(-1)], [[W`D:\GIT\proj`, W`D:\other`], [W`D:\GIT\proj`, W`D:\other`]]);
    env.folders.splice(1, 1); // review 2026-10-13: removing the second folder must drop it from the bind and the next fetch
    env.folderListeners.forEach((fn) => fn());
    await flush();
    assert.deepEqual([calls.length, env.panel.bind.folders, listed.at(-1)], [1, [W`D:\GIT\proj`], [W`D:\GIT\proj`]]);
    pass('adding or removing a second folder updates the bound folder list and fetches the threads at once, no new bind');
    env.folders[0] = folder('file', W`D:\GIT\next`);
    env.folderListeners.forEach((fn) => fn());
    await flush();
    assert.deepEqual([calls.length, calls.at(-1).folder], [2, W`D:\GIT\next`]);
    pass('a change of the first folder refreshes the panel; adding another folder does not');
    answer = { path: '/', title: 'proj', root: W`D:\GIT\proj`, fresh: true, note: null };
    webview.onMsg({ cmd: 'reload' });
    await flush();
    webview.posted.length = 0;
    webview.onMsg({ cmd: 'frameLoaded' });
    webview.onMsg({ cmd: 'frameLoaded' });
    const DARK = { type: 't3vscode:theme', kind: 'dark' };
    const RUNS = { type: 't3vscode:settings', runInTerminal: 'vscode' }; // B9: with every frameLoaded too
    assert.deepEqual(webview.posted.splice(0), [DARK, RUNS, { type: 't3vscode:new-thread', root: W`D:\GIT\proj`, title: 'proj' }, DARK, RUNS]);
    assert.deepEqual(states.at(-1).newThread, { root: W`D:\GIT\proj`, title: 'proj' });
    answer = { ...answer, fresh: false, note: 'T3 is not on proj: x. Reload to retry.' };
    webview.onMsg({ cmd: 'reload' });
    await flush();
    webview.onMsg({ cmd: 'frameLoaded' });
    assert.deepEqual(webview.posted.splice(0), [DARK, RUNS], 'a project that is not fresh asked for a first thread');
    assert.equal(states.at(-1).note, answer.note);
    pass('frameLoaded posts the theme and the runInTerminal setting every time; after a fresh project also one new-thread message with its root per render; a project that is not fresh posts none');
    env.logs.length = 0;
    webview.onMsg({ cmd: 'newThreadFailed' });
    assert.deepEqual([env.logs, webview.posted.length], [["Project: T3 did not open the first thread; the card asks to pick it in T3's search box"], 0]);
    pass('newThreadFailed from the page logs one line and nothing else');
    env.logs.length = 0;
    webview.onMsg({ cmd: 'log', text: 'switch fell back to a reload' });
    webview.onMsg({ cmd: 'log', text: 'x'.repeat(500) });
    assert.deepEqual([env.logs, webview.posted.length], [['Panel: switch fell back to a reload', 'Panel: ' + 'x'.repeat(200)], 0]);
    pass('log from the page writes one line to the output, capped at 200 characters, and nothing else');
    answer = { path: '/', title: 'D', root: 'D:\\', fresh: false, note: null };
    env.folders[0] = folder('file', 'D:\\');
    env.folderListeners.forEach((fn) => fn());
    await flush();
    assert.deepEqual([calls.at(-1).folder, states.at(-1).folderName], ['D:\\', 'D']);
    assert.ok(htmls.at(-1).includes('<p>T3 is on D.</p>'), 'drive root card line');
    pass('the card names the title ensureProject returned: a drive root shows "T3 is on D"');
    const n = calls.length;
    start({ bearer: OLD, expiresAt: at(20), scopes }, { ensureProject: async (o) => { calls.push(o); return answer; } }, [folder('vscode-remote', '/r'), folder('file', W`D:\GIT\proj`)]);
    openView();
    await flush();
    assert.deepEqual([calls.length, states.at(-1).path, states.at(-1).note, states.at(-1).folderName], [n, '/', null, null]);
    assert.ok(env.logs.includes('Project: no local first folder -> /'), 'no log line');
    pass('a remote first folder with a local second one: no ensureProject, the panel loads / unbound, one log line');
  }

  { // NAV.md section 1: the thread bar's messages.
    const folder = (scheme, fsPath) => ({ uri: { scheme, fsPath } });
    const ensures = [];
    const lists = [];
    const items = [{ id: 't-1', title: 'one', projectId: 'p1', projectTitle: 'proj', mine: true }, { id: 't-3', title: 'three', projectId: 'p2', projectTitle: 'nested', mine: false }];
    let answer = { path: '/env%201/t-1', title: 'proj', root: W`D:\GIT\proj`, fresh: false, note: null };
    start({ bearer: OLD, expiresAt: at(20), scopes: ['orchestration:read', 'orchestration:operate'] }, {
      ensureProject: async (o) => { ensures.push(o); return answer; },
      threadsFor: async (o) => { lists.push({ ...o }); return { items, environmentId: 'env 1' }; },
    }, [folder('file', W`D:\GIT\proj`), folder('vscode-remote', '/r'), folder('file', W`D:\multi`)]);
    const webview = openView();
    await flush();
    assert.deepEqual([lists[0].origin, lists[0].bearer, lists[0].folders, lists[0].project], [ORIGIN, OLD, [W`D:\GIT\proj`, W`D:\multi`], W`D:\GIT\proj`]);
    assert.deepEqual([states.at(-1).threads, states.at(-1).current, ensures[0].preferThread], [items, 't-1', undefined]);
    pass('refresh: threadsFor gets every local folder and the bound root; render gets the threads and the current thread');
    webview.posted.length = 0;
    webview.onMsg({ cmd: 'newThread' });
    assert.deepEqual(webview.posted, [{ type: 't3vscode:new-thread', root: W`D:\GIT\proj`, title: 'proj' }]);
    webview.posted.length = 0;
    webview.onMsg({ cmd: 'threads' });
    await flush();
    assert.deepEqual(webview.posted, [{ type: 'threads', items, current: 't-1' }]);
    pass('newThread posts the new-thread message for the bound project; threads answers with a fresh list and the current thread');
    const KEY = 't3vscode.thread.' + t3.normalizeRoot(W`D:\GIT\proj`);
    webview.posted.length = 0;
    for (const id of ['a/b', '../x', 7, 'x'.repeat(81), '']) webview.onMsg({ cmd: 'openThread', id });
    assert.deepEqual([webview.posted, env.workspace.get(KEY)], [[], undefined], 'a bad id navigated or was stored');
    webview.onMsg({ cmd: 'openThread', id: 't-2' });
    await flush();
    assert.deepEqual([webview.posted, env.workspace.get(KEY)], [[{ type: 'navigate', path: '/env%201/t-2' }], 't-2']);
    pass('openThread: a valid id posts navigate to /<env>/<id> and is stored for the root; anything else does nothing');
    for (const pathname of ['/settings/general', '/other/t-4', '/env%201/t-5/x', '/env%201/a b', 7]) webview.onMsg({ cmd: 'location', pathname });
    await flush();
    assert.equal(env.workspace.get(KEY), 't-2', 'a foreign location was stored');
    webview.onMsg({ cmd: 'location', pathname: '/env%201/t-3' });
    await flush();
    assert.equal(env.workspace.get(KEY), 't-3');
    webview.posted.length = 0;
    webview.onMsg({ cmd: 'threads' });
    await flush();
    assert.equal(webview.posted[0].current, 't-3');
    webview.onMsg({ cmd: 'reload' });
    await flush();
    assert.equal(ensures.at(-1).preferThread, 't-3');
    assert.deepEqual([states.at(-1).path, states.at(-1).current], ['/env%201/t-3', 't-3']);
    pass('location: only /<this env>/<thread> is stored for the root; the next refresh passes it to ensureProject as preferThread');
    webview.onMsg({ cmd: 'openDesktop' });
    await flush();
    assert.deepEqual(env.external.splice(0), ['t3code://threads/env%201/t-3']);
    pass('openDesktop: the current thread as a t3code://threads/<env>/<thread> link through openExternal (QOL item 6)');
    answer = { ...answer, path: '/', fresh: true };
    webview.onMsg({ cmd: 'reload' });
    await flush();
    assert.deepEqual([states.at(-1).path, states.at(-1).current], ['/', null]);
    pass("a remembered thread of a nested project is the landing when latestThread dropped it (QOL item 3); not on a fresh project (its first-thread flow needs the bound one)");
    answer = { path: '/', title: 'proj', fresh: false, note: 'T3 is not on proj: x. Reload to retry.' };
    const n = lists.length;
    webview.onMsg({ cmd: 'reload' });
    await flush();
    webview.posted.length = 0;
    for (const m of [{ cmd: 'newThread' }, { cmd: 'threads' }, { cmd: 'openThread', id: 't-1' }]) webview.onMsg(m);
    await flush();
    assert.deepEqual([lists.length, states.at(-1).threads, webview.posted], [n, null, []]);
    pass('no bound project (ensureProject failed): no threadsFor, no bar, the bar messages do nothing');
    webview.onMsg({ cmd: 'openDesktop' });
    await flush();
    assert.deepEqual(env.external.splice(0), ['t3code://new']);
    pass('openDesktop without a thread: t3code://new');
  }

  { // docs/QOL.md items 1, 4 and 7: Add to prompt, Add selection, the mention result, Ctrl+Alt+C back to the editor.
    let answer = { path: '/env/t-1', title: 'proj', root: W`D:\GIT\proj`, fresh: false, note: null };
    start({ bearer: OLD, expiresAt: at(20), scopes: [] }, { ensureProject: async () => answer, threadsFor: async () => ({ items: [], environmentId: 'env' }) },
      [{ uri: { scheme: 'file', fsPath: W`D:\GIT\proj` } }]);
    const webview = openView();
    await flush();
    webview.onMsg({ cmd: 'frameLoaded' }); // item 4 below: before this a mention is queued
    const file = (fsPath) => ({ scheme: 'file', fsPath });
    const sent = async (run) => { webview.posted.length = 0; env.exec.length = 0; await run(); await flush(); return webview.posted.splice(0); };
    const M = (text) => [{ type: 't3vscode:mention', text }];
    const add = (uri) => sent(() => env.cmds['t3vscode.addToPrompt'](uri));
    assert.deepEqual(await add(file(W`D:\GIT\proj\src\a (1)#?.ts`)), M('[a (1)#?.ts](src/a%20%281%29%23%3F.ts)'), 'inside the root: relative with /');
    assert.deepEqual(await add(file(W`D:\GIT\proj\src\[slug].tsx`)), M(W`[\[slug\].tsx](src/%5Bslug%5D.tsx)`), 'label escapes [ ]');
    assert.deepEqual(await add(file(W`d:\git\PROJ\lib`)), M('[lib](lib)'), 'a folder, case-insensitive root');
    assert.deepEqual(await add(file(W`D:\other\b.ts`)), M('[b.ts](D:%5Cother%5Cb.ts)'), 'outside: absolute');
    assert.deepEqual(await add(file(W`D:\GIT\proj-old\c.ts`)), M('[c.ts](D:%5CGIT%5Cproj-old%5Cc.ts)'), 'a sibling with the root as prefix: absolute');
    assert.deepEqual(await add(file(W`D:\GIT\proj`)), M('[proj](D:%5CGIT%5Cproj)'), 'the root itself: absolute');
    const logs = env.logs.length;
    assert.deepEqual(await add({ scheme: 'vscode-remote', fsPath: W`D:\GIT\proj\a.ts` }), [], 'a remote uri was sent');
    assert.deepEqual([env.logs.slice(logs), env.exec, env.clip, env.infos], [[W`Add to prompt: not a local file: D:\GIT\proj\a.ts`], [], [], []]);
    env.editor = { document: { uri: file(W`D:\GIT\proj\src\e.ts`) }, selection: { isEmpty: true, start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } };
    assert.deepEqual(await add(undefined), M('[e.ts](src/e.ts)'), 'palette: the active file');
    assert.deepEqual(await sent(() => env.cmds['t3vscode.addToPrompt'](file(W`D:\GIT\proj\a.ts`), [file(W`D:\GIT\proj\a.ts`), file(W`D:\other\b.ts`), { scheme: 'vscode-remote', fsPath: 'x' }])),
      M('[a.ts](a.ts) [b.ts](D:%5Cother%5Cb.ts)'), 'R7: every selected Explorer file, one mention, a non-local one left out');
    assert.deepEqual(await sent(() => env.cmds['t3vscode.addToPrompt'](file(W`D:\GIT\proj\a.ts`), { groupId: 1 })), M('[a.ts](a.ts)'), 'R7: a tab menu passes an object second, not uris');
    pass('addToPrompt: T3\'s file link, relative with / inside the bound root (directory boundary), absolute outside or for the root; ( ) # ? \\ [ ] escaped; a non-local uri: one log line, nothing else; R7: several Explorer files go as one mention');
    const sel = (start, end) => { env.editor.selection = { isEmpty: start[0] === end[0] && start[1] === end[1], start: { line: start[0], character: start[1] }, end: { line: end[0], character: end[1] } }; return sent(() => env.cmds['t3vscode.addSelection']()); };
    assert.deepEqual(await sel([11, 2], [29, 5]), M('[e.ts](src/e.ts) lines 12-30'));
    assert.deepEqual(await sel([11, 2], [11, 9]), M('[e.ts](src/e.ts) line 12'));
    assert.deepEqual(await sel([11, 0], [30, 0]), M('[e.ts](src/e.ts) lines 12-30'), 'whole lines end at column 0 of the next');
    assert.deepEqual(await sel([4, 3], [4, 3]), M('[e.ts](src/e.ts)'), 'empty selection: the file alone');
    env.editor = null;
    assert.deepEqual(await sent(() => env.cmds['t3vscode.addSelection']()), [], 'no editor');
    const infos = env.infos.length;
    assert.deepEqual([await add(undefined), env.infos.splice(infos)], [[], ['Open a file first.']], 'R17: Add to prompt without a file says so');
    pass('addSelection: the file mention plus "lines a-b" or "line a" (1-based), the file alone for an empty selection');
    webview.onMsg({ cmd: 'mentionResult', ok: false });
    await flush();
    assert.deepEqual([env.clip, env.infos], [['[e.ts](src/e.ts)'], ["T3 did not take the reference. It is on the clipboard: press Ctrl+V in T3's composer."]]);
    webview.onMsg({ cmd: 'mentionResult', ok: false });
    await flush();
    assert.equal(env.clip.length, 1, 'a result with nothing pending wrote the clipboard');
    await add(file(W`D:\GIT\proj\a.ts`));
    assert.deepEqual(await sent(() => webview.onMsg({ cmd: 'mentionResult', ok: true })), [{ type: 't3vscode:focus-composer' }]);
    assert.deepEqual([env.exec, env.clip.length], [[['t3vscode.focusComposer'], ['t3vscode.panel.focus']], 1]);
    pass('mentionResult: ok:false puts the pending text on the clipboard with one message; ok:true runs focusComposer (panel focus, then focus-composer to the page); one result per mention');
    assert.deepEqual(await sent(() => env.cmds['t3vscode.focusComposer']()), [{ type: 't3vscode:focus-composer' }]);
    assert.deepEqual(env.exec, [['t3vscode.panel.focus']]);
    await sent(() => { webview.onMsg({ cmd: 'key', key: 'save' }); webview.onMsg({ cmd: 'key', key: ['blur'] }); });
    assert.deepEqual(env.exec, [], 'another key ran a command');
    await sent(() => webview.onMsg({ cmd: 'key', key: 'blur' }));
    assert.deepEqual(env.exec, [['workbench.action.focusActiveEditorGroup']]);
    pass('focusComposer: the panel, then focus-composer to the page; key blur (only) focuses the active editor group');
    const drop = (uris) => sent(() => webview.onMsg({ cmd: 'dropped', uris }));
    const before = env.logs.length;
    assert.deepEqual(await drop(['file:///d%3A/GIT/proj/src/a.ts', W`D:\GIT\proj\lib`, 'https://example.com/x.ts', 'not a uri', 7, 'file:///d%3A/other/b.ts']),
      M('[a.ts](src/a.ts) [lib](lib) [b.ts](d:%5Cother%5Cb.ts)'), 'one mention with every local file, space separated');
    assert.deepEqual(env.logs.slice(before), ['Add to prompt: not a local file: /x.ts'], 'the web uri');
    webview.onMsg({ cmd: 'mentionResult', ok: false });
    await flush();
    assert.equal(env.clip.at(-1), '[a.ts](src/a.ts) [lib](lib) [b.ts](d:%5Cother%5Cb.ts)', 'the joined text is the pending one');
    for (const uris of [['::', 'https://example.com/'], [], 'file:///d%3A/GIT/proj/a.ts', undefined]) assert.deepEqual(await drop(uris), [], `${JSON.stringify(uris)} sent a mention`);
    pass('dropped: file uris (and Windows paths from text/plain) become one mention, links joined by a space, relative inside the root; non-file, malformed or non-string uris skipped; nothing usable: nothing sent');
    // docs/QOL.md item 1: a local gif, jpeg, png or webp goes in as a T3 attachment (base64 of its bytes, no mention); too large or no thread on the page: the mention and one log line.
    // A paste of Windows paths reaches the extension as this same dropped message (t3.js), so these cover it too.
    env.stat = () => 1;
    env.size = (p) => (p.includes('big') ? 10 * 1024 * 1024 + 1 : 6);
    env.bytes = () => new Uint8Array([137, 80, 78, 71, 0, 255]);
    const A64 = Buffer.from([137, 80, 78, 71, 0, 255]).toString('base64');
    const IMG = (name, type) => ({ type: 't3vscode:attach', files: [{ name, type, data: A64 }] });
    const before2 = env.logs.length;
    assert.deepEqual(await drop([W`D:\GIT\proj\shot.PNG`, 'file:///d%3A/GIT/proj/src/a.ts']), [IMG('shot.PNG', 'image/png'), ...M('[a.ts](src/a.ts)')], 'an image attached, the other file a mention');
    assert.deepEqual(await sent(() => env.cmds['t3vscode.addToPrompt'](file(W`D:\GIT\proj\b.jpeg`))), [IMG('b.jpeg', 'image/jpeg')], 'Add to prompt on an image: attached, no mention');
    assert.deepEqual(await drop([W`D:\GIT\proj\big.webp`]), M('[big.webp](big.webp)'), 'larger than 10 MiB');
    assert.deepEqual(await drop(['file:///d%3A/GIT/proj/src/a.ts']), M('[a.ts](src/a.ts)'), 'a non-image as before');
    webview.onMsg({ cmd: 'location', pathname: '/draft/abc' }); // T3's new-thread page: no thread until the first message
    await flush();
    assert.deepEqual(await drop([W`D:\GIT\proj\c.gif`]), M('[c.gif](c.gif)'), 'no thread on the page');
    webview.onMsg({ cmd: 'attachResult', ok: true });
    webview.onMsg({ cmd: 'attachResult', ok: false });
    assert.deepEqual(env.logs.slice(before2), ['image big.webp: larger than 10 MiB, added as a link', 'image c.gif: no thread yet, added as a link; send a first message, then drop it again',
      'Attach: T3 has no drop target on this page; the image did not go in']);
    const infos2 = env.infos.length;
    webview.onMsg({ cmd: 'hint' });
    assert.deepEqual([env.infos.splice(infos2), env.logs.at(-1)], [['Hold Shift while dragging files into T3 Code.'], 'Drag: the drag left the panel at once (no Shift held?); hint shown']);
    pass('images (dropped, pasted or Add to prompt): one attach with name, mime type and base64 bytes, no mention; over 10 MiB or a page with no thread: the mention plus one log line; ' +
      'non-images as before; attachResult ok:false logs one line; hint shows the Shift message and logs it');
    answer = { path: '/', title: 'proj', fresh: false, note: 'T3 is not on proj: x. Reload to retry.' };
    webview.onMsg({ cmd: 'reload' });
    await flush();
    assert.deepEqual(await add(file(W`D:\GIT\proj\a.ts`)), [], 'sent without a bound project');
    assert.deepEqual([env.exec, env.clip.at(-1), env.infos.length], [[['t3vscode.panel.focus']], '[a.ts](D:%5CGIT%5Cproj%5Ca.ts)', 3]); // one message each: the selection, the drop, this one
    pass('no bound project: the panel is opened, then the mention (absolute) goes to the clipboard with the message');
  }

  { // docs/QOL.md item 5: thread activity in the status bar, the view badge and the needs-you and failed notifications.
    const T = (id, title, x = {}) => ({ id, title, projectId: 'p1', projectTitle: 'proj', mine: true, at: '', status: 'idle', active: false, needsYou: false, requestId: '', ...x });
    let items = [T('t-1', 'one', { needsYou: true, requestId: 'old' })]; // already pending when VS Code starts
    let fetches = 0;
    let gate = null;
    let broken = false;
    start({ bearer: OLD, expiresAt: at(20), scopes: [] }, {
      ensureProject: async () => ({ path: '/env%201/t-1', title: 'proj', root: W`D:\GIT\proj`, fresh: false, note: null }),
      threadsFor: async () => { fetches++; if (gate) await gate; return broken ? { items: [], environmentId: null, note: 'T3 threads: down' } : { items: structuredClone(items), environmentId: 'env 1' }; },
    }, [{ uri: { scheme: 'file', fsPath: W`D:\GIT\proj` } }]);
    env.visible = false;
    env.focused = false;
    const webview = openView();
    await flush();
    webview.onMsg({ cmd: 'frameLoaded' }); // R1: Show navigates once the frame is there
    const timers = () => env.intervals.filter((i) => (i.ms === 4000 || i.ms === 30000) && !i.cleared).map((i) => i.ms);
    const tick = async () => { skip(); env.intervals.find((i) => (i.ms === 4000 || i.ms === 30000) && !i.cleared).fn(); await flush(); };
    const lines = () => (assert.ok(env.status.tooltip instanceof vscode.MarkdownString, 'tooltip is not a MarkdownString'), env.status.tooltip.value.split('\n'));
    const WARN = new vscode.ThemeColor('statusBarItem.warningBackground');
    assert.deepEqual([env.infos, env.status.text, env.panel.view.badge, timers(), env.status.backgroundColor], [[], '$(warning) T3: needs you', { value: 1, tooltip: '1 thread needs you' }, [4000], WARN]);
    assert.match(lines().join('\n'), /^Open T3 Code \(session ends .+\)\none: waits for you$/);
    pass('the first list after a bind is the baseline: a request already pending is not announced; needs you on the warning background, badge 1, tooltip (markdown text, one line each) keeps the session line, 4 s');

    items = [T('t-1', 'one'), T('t-2', 'two')];
    webview.posted.length = 0;
    await tick();
    // Tests 11 and 17: a poll with a new or renamed thread posts the list once, so the header follows without the picker.
    const lists = () => webview.posted.splice(0).filter((m) => m.type === 'threads').map((m) => [m.items.map((t) => `${t.id} ${t.title}`), m.current]);
    assert.deepEqual(lists(), [[['t-1 one', 't-2 two'], 't-1']], 'a new thread from the poll did not reach the panel');
    await tick();
    assert.deepEqual(lists(), [], 'an unchanged list was posted again');
    assert.deepEqual([env.status.text, lines().length, env.panel.view.badge, timers(), env.status.backgroundColor], ['T3', 1, undefined, [30000], undefined]);
    items = [T('t-1', 'one'), T('t-2', 'x'.repeat(80), { status: 'running', active: true })];
    await tick();
    assert.deepEqual(lists(), [[['t-1 one', 't-2 ' + 'x'.repeat(80)], 't-1']], 'a renamed thread did not reach the panel');
    pass('tests 11 and 17: a poll whose ids or titles changed posts threads (items, current) once; an unchanged list or a status-only change posts nothing');
    assert.deepEqual([env.status.text, lines().slice(1), env.panel.view.badge, timers(), env.infos, env.status.backgroundColor], ['$(sync~spin) T3: running', ['x'.repeat(60) + ': running'], undefined, [4000], [], undefined]);
    pass('idle: T3, no lines, no badge, no background, 30 s; running: spinner text, one line per running thread (title capped at 60), no background, 4 s; one interval at a time');

    env.visible = true;
    env.focused = true;
    items = [T('t-1', 'one', { needsYou: true, requestId: 'r1' }), T('t-2', 'x'.repeat(80), { status: 'running', active: true })];
    await tick();
    assert.deepEqual([env.infos, env.status.text, lines().slice(1)], [[], '$(warning) T3: needs you', ['one: waits for you', 'x'.repeat(60) + ': running']]);
    env.visible = false;
    await tick();
    assert.deepEqual(env.infos, [], 'a request seen while the owner looked was announced later');
    pass('a new request while the panel is visible in a focused window: no notification, needs you wins over running; the same request later stays quiet');

    env.answer = 'Show';
    webview.posted.length = 0;
    env.exec.length = 0;
    items = [T('t-1', 'one', { needsYou: true, requestId: 'r1' }), T('t-2', 'x'.repeat(80), { status: 'waiting', active: true, needsYou: true, requestId: 'r2' })];
    await tick();
    const KEY = 't3vscode.thread.' + t3.normalizeRoot(W`D:\GIT\proj`);
    assert.deepEqual([env.infos, env.exec, webview.posted, env.workspace.get(KEY)], [[`T3: ${'x'.repeat(60)} waits for you`], [['t3vscode.panel.focus']], [{ type: 'navigate', path: '/env%201/t-2' }], 't-2']);
    assert.deepEqual(env.panel.view.badge, { value: 2, tooltip: '2 threads need you' });
    await tick();
    assert.equal(env.infos.length, 1, 'the same request was announced twice');
    pass('a new request with the panel hidden: one notification; Show focuses the panel, navigates to /<env>/<thread> and remembers it; badge 2');

    env.answer = undefined;
    env.visible = true;
    env.focused = false;
    items = [T('t-1', 'one', { needsYou: true, requestId: 'r3' }), T('t-2', 'x'.repeat(80), { status: 'waiting', active: true, needsYou: true, requestId: 'r2' })];
    webview.posted.length = 0;
    await tick();
    assert.deepEqual([env.infos.at(-1), env.infos.length, webview.posted], ['T3: one waits for you', 2, []]);
    pass('a new request id on the same thread in an unfocused window: one notification; no answer, no navigation');

    items = [T('t-1', 'one', { status: 'failed' }), T('t-2', 'x'.repeat(80), { status: 'failed', active: true })]; // another run still holds activeRunId
    await tick();
    await tick();
    assert.deepEqual([env.warnings, env.status.text, timers()], [[`T3: ${'x'.repeat(60)} failed`], '$(sync~spin) T3: running', [4000]]);
    items = [T('t-1', 'one', { status: 'failed' }), T('t-2', 'x'.repeat(80), { status: 'failed' })];
    await tick();
    assert.deepEqual([env.warnings.length, env.status.text, timers()], [1, 'T3', [30000]]);
    pass('active to failed warns once, also while an activeRunId stays; a thread that was not active does not');

    items = [T('t-1', 'one', { status: 'running', active: true, needsYou: true, requestId: 'r4' })];
    env.focused = true;
    await tick();
    env.focused = false;
    broken = true;
    await tick();
    assert.deepEqual([env.infos.length, env.status.text, timers()], [2, '$(warning) T3: needs you', [4000]]);
    broken = false;
    await tick();
    assert.deepEqual([env.infos.length, env.status.text, timers()], [2, '$(warning) T3: needs you', [4000]]);
    pass('a failed fetch changes nothing (no prune, no repaint, the interval stays); the next good list is compared with the last good one');

    gate = deferred();
    const n = fetches;
    env.intervals.find((i) => i.ms === 4000 && !i.cleared).fn();
    env.intervals.find((i) => i.ms === 4000 && !i.cleared).fn();
    webview.onMsg({ cmd: 'location', pathname: '/env%201/t-1' });
    assert.equal(fetches, n + 1, 'two fetches at once');
    gate.resolve();
    gate = null;
    await flush();
    webview.onMsg({ cmd: 'location', pathname: '/env%201/t-1' });
    await flush();
    assert.equal(fetches, n + 2);
    webview.onMsg({ cmd: 'location', pathname: '/env%201/t-1' });
    await flush();
    assert.equal(fetches, n + 2, 'a location within 2 s of the last location fetch fetched again');
    pass('never two fetches at once (ticks and a location skip while one is in flight); a location message fetches right away, at most once per 2 s');

    webview.dispose();
    assert.deepEqual([timers(), env.status.text, lines().length, env.status.backgroundColor], [[], 'T3', 1, undefined]);
    pass('the activity poll stops when the view is disposed and the status bar goes back to T3 without a background');
  }

  { // docs/QOL.md item 8: theme, Ctrl+Shift+P, T3: New thread, mentions that wait for the frame, open on startup.
    const timeouts = [];
    const realTimeout = [globalThis.setTimeout, globalThis.clearTimeout];
    globalThis.setTimeout = (fn, ms) => { const id = { fn, ms }; timeouts.push(id); return id; }; // driven by hand, like the intervals
    globalThis.clearTimeout = (id) => { if (id) id.cleared = true; };
    try {
      start({ bearer: OLD, expiresAt: at(20), scopes: [] }, { ensureProject: async () => ({ path: '/env/t-1', title: 'proj', root: W`D:\GIT\proj`, fresh: false, note: null }), threadsFor: async () => ({ items: [], environmentId: 'env' }) },
        [{ uri: { scheme: 'file', fsPath: W`D:\GIT\proj` } }]);
      assert.deepEqual(env.exec, [], 'openOnStartup unset focused the panel');
      const webview = openView();
      await flush();
      const sent = async (run) => { webview.posted.length = 0; env.exec.length = 0; await run(); await flush(); return webview.posted.splice(0); };
      const M = (text) => ({ type: 't3vscode:mention', text });
      assert.deepEqual(await sent(() => env.cmds['t3vscode.addToPrompt']({ scheme: 'file', fsPath: W`D:\GIT\proj\a.ts` })), [], 'sent before the frame loaded');
      assert.deepEqual(await sent(() => env.cmds['t3vscode.addToPrompt']({ scheme: 'file', fsPath: W`D:\GIT\proj\b.ts` })), [], 'sent before the frame loaded');
      assert.deepEqual(timeouts.filter((t) => !t.cleared).map((t) => t.ms), [10000], 'one live 10 s fallback');
      const RUNS = { type: 't3vscode:settings', runInTerminal: 'vscode' };
      assert.deepEqual(await sent(() => webview.onMsg({ cmd: 'frameLoaded' })), [{ type: 't3vscode:theme', kind: 'dark' }, RUNS, M('[b.ts](b.ts)')]);
      assert.deepEqual([timeouts.every((t) => t.cleared), env.clip], [true, []]);
      webview.onMsg({ cmd: 'mentionResult', ok: false });
      await flush();
      assert.deepEqual(env.clip, ['[b.ts](b.ts)'], 'the sent mention is the pending one');
      assert.deepEqual(await sent(() => env.cmds['t3vscode.addToPrompt']({ scheme: 'file', fsPath: W`D:\GIT\proj\c.ts` })), [M('[c.ts](c.ts)')], 'after frameLoaded: sent right away');
      webview.onMsg({ cmd: 'reload' });
      await flush();
      assert.deepEqual(await sent(() => env.cmds['t3vscode.addToPrompt']({ scheme: 'file', fsPath: W`D:\GIT\proj\d.ts` })), [], 'a new render must wait for its frame again');
      timeouts.at(-1).fn();
      await flush();
      assert.deepEqual([env.clip.at(-1), env.infos.length], ['[d.ts](d.ts)', 2]);
      assert.deepEqual(await sent(() => webview.onMsg({ cmd: 'frameLoaded' })), [{ type: 't3vscode:theme', kind: 'dark' }, RUNS], 'a clipped mention was sent too');
      pass('a mention before frameLoaded waits in one slot (the newest wins) and goes out on frameLoaded; after it, right away; a new render waits again; no frame within 10 s: the clipboard with the message');
      for (const [kind, want] of [[1, 'light'], [4, 'light'], [3, 'dark'], [2, 'dark']]) {
        env.themeKind = kind;
        assert.deepEqual(await sent(() => env.themeListeners.forEach((fn) => fn())), [{ type: 't3vscode:theme', kind: want }], `kind ${kind}`);
      }
      pass('theme: posted on every frameLoaded and on every VS Code theme change; Light and HighContrastLight are light, Dark and HighContrast dark');
      env.config['t3vscode.followTheme'] = false;
      assert.deepEqual(await sent(() => webview.onMsg({ cmd: 'frameLoaded' })), [RUNS], 'followTheme false posted a theme on load');
      assert.deepEqual(await sent(() => env.themeListeners.forEach((fn) => fn())), [], 'followTheme false posted a theme change');
      assert.deepEqual(await sent(() => env.configChanged({ affectsConfiguration: (k) => k === 't3vscode.followTheme' })), []);
      env.config['t3vscode.followTheme'] = true;
      assert.deepEqual(await sent(() => env.configChanged({ affectsConfiguration: (k) => k === 't3vscode.followTheme' })), [{ type: 't3vscode:theme', kind: 'dark' }]);
      assert.deepEqual(await sent(() => env.configChanged({ affectsConfiguration: (k) => k === 't3vscode.todoLens' })), [], 'another setting posted a theme');
      delete env.config['t3vscode.followTheme'];
      pass('R16 followTheme false: no theme message on load, on a theme change or on the setting change; turned on: one theme message at once');
      assert.deepEqual(await sent(() => webview.onMsg({ cmd: 'key', key: 'palette' })), []);
      assert.deepEqual(env.exec, [['workbench.action.showCommands']]);
      pass('key palette runs workbench.action.showCommands');
      assert.deepEqual(await sent(() => env.cmds['t3vscode.newThread']()), [{ type: 't3vscode:new-thread', root: W`D:\GIT\proj`, title: 'proj' }]);
      assert.deepEqual(env.exec, [['t3vscode.panel.focus']]);
      webview.dispose();
      assert.deepEqual(await sent(() => env.cmds['t3vscode.newThread']()), []);
      assert.deepEqual(env.exec, [['t3vscode.panel.focus']]);
      pass('T3: New thread focuses the panel, then posts the toolbar\'s new-thread message for the bound project; no bound panel: only the focus');
      { // R13: New thread in a folder, and T3's own palette.
        const ensures = [];
        const answers = { [W`d:\GIT\two`]: { path: '/', title: 'Two "q"', root: W`D:\GIT\two`, fresh: true, note: null }, [W`D:\GIT\gone`]: { path: '/', title: 'gone', fresh: false, note: 'T3 is not on gone: no. Reload to retry.' } };
        start({ bearer: OLD, expiresAt: at(20), scopes: ['orchestration:read'] }, {
          ensureProject: async (o) => { if (o.folder !== W`D:\GIT\proj`) ensures.push(o); return answers[o.folder] || { path: '/env/t-1', title: 'proj', root: W`D:\GIT\proj`, fresh: false, note: null }; },
          threadsFor: async () => ({ items: [], environmentId: 'env' }) },
        [{ uri: { scheme: 'file', fsPath: W`D:\GIT\proj` } }]);
        const w2 = openView();
        await flush();
        w2.onMsg({ cmd: 'frameLoaded' });
        const sent2 = async (run) => { w2.posted.length = 0; env.exec.length = 0; await run(); await flush(); return w2.posted.splice(0); };
        const NT = (root, title) => [{ type: 't3vscode:new-thread', root, title }];
        assert.deepEqual([await sent2(() => env.cmds['t3vscode.newThreadIn']()), env.exec, env.picks], [NT(W`D:\GIT\proj`, 'proj'), [['t3vscode.panel.focus']], undefined], 'one folder: New thread, no pick');
        env.folders.push({ uri: { scheme: 'vscode-remote', fsPath: '/r' } }, { uri: { scheme: 'file', fsPath: W`d:\GIT\two` } }, { uri: { scheme: 'file', fsPath: W`D:\GIT\gone` } });
        assert.deepEqual([await sent2(() => env.cmds['t3vscode.newThreadIn']()), env.exec, ensures], [[], [], []], 'a dismissed pick did something');
        assert.deepEqual(env.picks[0].map((i) => [i.label, i.description]), [['proj', W`D:\GIT\proj`], ['two', W`d:\GIT\two`], ['gone', W`D:\GIT\gone`]], 'the pick lists the local folders only');
        env.pick = (items) => items[1];
        assert.deepEqual([await sent2(() => env.cmds['t3vscode.newThreadIn']()), env.exec], [NT(W`D:\GIT\two`, 'Two "q"'), [['t3vscode.panel.focus']]], 'T3\'s root and title, not the folder spelling');
        assert.deepEqual(ensures.map((o) => [o.origin, o.bearer, o.folder, o.scopes]), [[ORIGIN, OLD, W`d:\GIT\two`, ['orchestration:read']]]);
        env.pick = (items) => items[2];
        env.warnings.length = 0;
        assert.deepEqual([await sent2(() => env.cmds['t3vscode.newThreadIn']()), env.warnings, env.logs.at(-1)], [[], ['T3 is not on gone: no. Reload to retry.'], 'New thread in: T3 is not on gone: no. Reload to retry.']);
        env.pick = null;
        pass('R13 New thread in a folder: one local folder runs New thread; several: a quick pick of the local folders (remote ones left out), then ensureProject with the bound session and the new-thread message with T3\'s root and title; no project: a warning and a log line; dismissed: nothing');
        assert.deepEqual([await sent2(() => env.cmds['t3vscode.t3Palette']()), env.exec], [[{ type: 't3vscode:palette' }], [['t3vscode.panel.focus']]]);
        pass('R13 T3 palette: focuses the panel, then posts t3vscode:palette');
      }
      start(null, {}, undefined, { 't3vscode.openOnStartup': true });
      assert.deepEqual(env.exec, [['t3vscode.panel.focus']]);
      start(null, {}, undefined, { 't3vscode.openOnStartup': false });
      assert.deepEqual(env.exec, []);
      pass('openOnStartup true focuses the panel once on activation; false or unset: nothing');
    } finally {
      [globalThis.setTimeout, globalThis.clearTimeout] = realTimeout;
    }
  }

  { // B14: Approve, Deny and Show on an approvable request; the text has the title, the kind in words and what T3 has for it.
    const T = (x = {}) => ({ id: 't-1', title: 'one', projectId: 'p1', projectTitle: 'proj', mine: true, at: '', status: 'waiting', active: true, needsYou: true, requestId: '', kind: '', ...x });
    const OPERATE = { bearer: OLD, expiresAt: at(20), scopes: ['orchestration:read', 'orchestration:operate'] };
    let items = [T()];
    let req;
    let outcome = { outcome: 'accepted' };
    let fetches = 0;
    const asked = [];
    const answers = [];
    start(OPERATE, {
      ensureProject: async () => ({ path: '/env%201/t-1', title: 'proj', root: W`D:\GIT\proj`, fresh: false, note: null }),
      threadsFor: async () => { fetches++; return { items: structuredClone(items), environmentId: 'env 1' }; },
      pendingRequest: async (o) => { asked.push(o); return structuredClone(req); },
      respond: async (o) => { answers.push(o); return outcome; },
    }, [{ uri: { scheme: 'file', fsPath: W`D:\GIT\proj` } }]);
    env.visible = false;
    const webview = openView();
    await flush();
    webview.onMsg({ cmd: 'frameLoaded' }); // R1: Show navigates once the frame is there
    const tick = async () => { skip(); env.intervals.find((i) => (i.ms === 4000 || i.ms === 30000) && !i.cleared).fn(); await flush(); };
    const ask = async (requestId, kind, r) => { req = { kind, live: true, prompt: '', command: '', decisions: ['cancel', 'decline', 'acceptForSession', 'accept'], warnings: [], app: '', ...r }; items = [T({ requestId, kind })]; await tick(); };
    const ALL3 = ['Approve', 'Deny', 'Show'];

    env.answer = 'Approve';
    let n = fetches;
    await ask('r1', 'command', { prompt: 'needs the network', command: 'git push' });
    assert.deepEqual(env.buttons, [['T3: one needs approval (command): git push', ...ALL3]]);
    assert.deepEqual([asked, answers], [[{ origin: ORIGIN, bearer: OLD, threadId: 't-1', requestId: 'r1' }], [{ origin: ORIGIN, bearer: OLD, threadId: 't-1', requestId: 'r1', decision: 'accept' }]]);
    assert.deepEqual([fetches - n, env.infos.length, env.warnings, webview.posted.filter((m) => m.type === 'navigate')], [2, 1, [], []]); // the tick and the poll right after
    pass('B14: a command request while away: "<title> needs approval (command): <command>" with Approve, Deny, Show; Approve sends accept with the thread and request ids, then polls once; no other message');

    env.answer = 'Deny';
    outcome = { outcome: 'answered', reason: 'Runtime request r2 is resolved.' };
    await ask('r2', 'command', { command: 'rm  x' });
    assert.deepEqual([env.buttons.slice(-2), answers.at(-1).decision, answers.at(-1).requestId], [[['T3: one needs approval (command): rm x', ...ALL3], ['Already answered in T3']], 'decline', 'r2']);
    env.answer = 'Approve';
    outcome = { outcome: 'failed', reason: 'T3 did not answer within 10 s' };
    env.exec.length = 0;
    webview.posted.length = 0;
    const warn = vscode.window.showWarningMessage;
    vscode.window.showWarningMessage = (m, ...b) => { env.warnings.push(m); env.buttons.push([m, ...b]); return 'Show'; };
    try { await ask('r3', 'file-change', { prompt: 'edit  a.ts\n' + 'y'.repeat(300) }); } finally { vscode.window.showWarningMessage = warn; }
    assert.deepEqual(env.buttons.slice(-2), [[`T3: one needs approval (file change): edit a.ts ${'y'.repeat(190)}`, ...ALL3], ['T3 could not answer for one: T3 did not answer within 10 s', 'Retry', 'Show']]);
    assert.deepEqual([env.warnings, env.exec, webview.posted], [['T3 could not answer for one: T3 did not answer within 10 s'], [['t3vscode.panel.focus']], [{ type: 'navigate', path: '/env%201/t-1' }]]);
    pass('B14: Deny sends decline; an answered or unknown request says "Already answered in T3"; any other failure warns with the reason, Retry and Show, and Show focuses the panel on the thread; other kinds show the prompt, whitespace folded, capped at 200');

    env.answer = 'Show';
    env.exec.length = 0;
    webview.posted.length = 0;
    const before = answers.length;
    for (const [kind, words] of [['file-read', 'file read'], ['permission', 'permission'], ['mcp-elicitation', 'MCP question']]) await ask('k-' + kind, kind, { prompt: 'p' });
    assert.deepEqual(env.buttons.slice(-3), [['T3: one needs approval (file read): p', ...ALL3], ['T3: one needs approval (permission): p', ...ALL3], ['T3: one needs approval (MCP question): p', ...ALL3]]);
    assert.deepEqual([answers.length, env.exec.length, webview.posted.at(-1)], [before, 3, { type: 'navigate', path: '/env%201/t-1' }]);
    pass('B14: file-read, permission and mcp-elicitation get the three buttons with their plain words; Show focuses the panel and navigates to the thread, sends no answer');

    const calls = asked.length;
    for (const kind of ['user_input', 'dynamic_tool_call', 'auth_refresh', '']) await ask('u-' + kind, kind);
    assert.deepEqual([env.buttons.slice(-4), asked.length], [Array(4).fill(['T3: one waits for you', 'Show']), calls]);
    await ask('n1', 'command', { note: 'T3 request: T3 answered 500 on /x' });
    assert.deepEqual([env.buttons.at(-1), env.logs.at(-1)], [['T3: one waits for you', 'Show'], 'T3 request: T3 answered 500 on /x']);
    pass('B14: user_input, dynamic_tool_call, auth_refresh and a missing kind keep "waits for you" with Show only and read nothing; a request T3 tells nothing about too, with its note in the log');

    const logged = (why) => env.logs.at(-1) === `Approve from the notification: Show only for one: ${why}`;
    await ask('s1', 'permission', { prompt: 'p', live: false });
    assert.deepEqual(env.buttons.at(-1), ['T3: one needs approval (permission): p', 'Show']);
    assert.ok(logged('T3 cannot pass an answer on right now'), env.logs.at(-1));
    env.store = JSON.stringify({ ...OPERATE, scopes: ['orchestration:read'] });
    await ask('s2', 'permission', { prompt: 'p' });
    assert.deepEqual(env.buttons.at(-1), ['T3: one needs approval (permission): p', 'Show']);
    assert.ok(logged('this pairing lacks orchestration:operate'), env.logs.at(-1));
    env.store = JSON.stringify(OPERATE);
    const ws = globalThis.WebSocket;
    globalThis.WebSocket = undefined;
    try { await ask('s3', 'permission', { prompt: 'p' }); } finally { globalThis.WebSocket = ws; }
    assert.deepEqual(env.buttons.at(-1), ['T3: one needs approval (permission): p', 'Show']);
    assert.ok(logged('this VS Code has no WebSocket client'), env.logs.at(-1));
    await ask('s4', 'permission', {});
    assert.deepEqual(env.buttons.at(-1), ['T3: one needs approval (permission)', 'Show']);
    assert.ok(logged('no request text'), env.logs.at(-1));
    assert.equal(answers.length, before);
    pass('B14: Show only, the text kept and one log line why, for a request that is not live, a pairing without orchestration:operate, no global WebSocket, or no request text');

    // Review 2026-10-13 (High): a command request without its command item, or without accept and decline, offers Show only; warnings in full.
    await ask('c1', 'command', { prompt: 'needs the network' });
    assert.deepEqual(env.buttons.at(-1), ['T3: one needs approval (command): reason: needs the network', 'Show']);
    assert.ok(logged('no command item for this command request'), env.logs.at(-1));
    await ask('c2', 'permission', { prompt: 'p', decisions: ['cancel', 'acceptForSession'] });
    assert.deepEqual(env.buttons.at(-1), ['T3: one needs approval (permission): p', 'Show']);
    assert.ok(logged('the request offers neither accept nor decline'), env.logs.at(-1));
    const warning = 'Approve: the command came from a web page, it may be a prompt injection ' + 'z'.repeat(300);
    await ask('c3', 'mcp-elicitation', { prompt: 'x'.repeat(300), decisions: ['decline'], warnings: [warning], app: 'docs  app' });
    assert.deepEqual(env.buttons.at(-1), [`T3: one needs approval (MCP question from docs app): ${'x'.repeat(200)} Warning: ${warning}`, 'Deny', 'Show']);
    assert.equal(answers.length, before);
    pass('B14 review: a command request without its command item offers Show only (its prompt shown as a reason); a request without accept and decline too; a button only for an offered decision; the request text capped at 200, the provider warning and app name in full');

    outcome = { outcome: 'accepted' };
    const click = deferred();
    env.answer = click;
    await ask('d1', 'command', { command: 'ls' });
    await ask('d2', 'command', { command: 'ls' });
    await ask('d1', 'command', { command: 'ls' }); // the same request again, the first toast still open
    click.resolve('Approve');
    await flush();
    assert.deepEqual(answers.slice(before).map((a) => a.requestId), ['d1', 'd2']);
    assert.equal(env.infos.filter((m) => m === 'An answer to this request is on its way to T3').length, 1, 'the second click on d1 said nothing');
    env.answer = undefined; // dismissed: this toast offers no Approve
    await ask('d2', 'command', { command: 'ls' });
    assert.deepEqual([env.buttons.at(-1), answers.length - before], [['T3: one needs approval (command): ls', 'Show'], 2]);
    assert.ok(logged('already answered from this window'), env.logs.at(-1));
    pass('B14: one answer per request id per window: two open toasts for the same request answer once, the second click while the first is on its way says so; a request answered from here comes back with Show only');

    // Review 2026-10-13: a failed send does not lock the request; Retry reads it anew and may answer again.
    outcome = { outcome: 'failed', reason: 'the T3 socket failed' };
    env.answer = 'Approve';
    const sent = answers.length;
    const reads = asked.length;
    vscode.window.showWarningMessage = (m, ...b) => { env.warnings.push(m); env.buttons.push([m, ...b]); outcome = { outcome: 'accepted' }; return 'Retry'; };
    try { await ask('e1', 'command', { command: 'ls' }); await flush(); } finally { vscode.window.showWarningMessage = warn; }
    assert.deepEqual([answers.slice(sent).map((a) => a.requestId), asked.length - reads], [['e1', 'e1'], 2]);
    assert.deepEqual(env.buttons.slice(-3), [['T3: one needs approval (command): ls', ...ALL3], ['T3 could not answer for one: the T3 socket failed', 'Retry', 'Show'], ['T3: one needs approval (command): ls', ...ALL3]]);
    pass('B14 review: a failed answer leaves the request open: Retry reads the request again, shows Approve and Deny again and the second answer goes out');
  }

  { // docs/BACKLOG.md slice 4: B1, B2 with B26, B4, B8, B13, B15, B25.
    const T = (x = {}) => ({ id: 't-1', title: 'one', projectId: 'p1', projectTitle: 'proj', mine: true, at: '', status: 'idle', active: false, needsYou: false, requestId: '', ...x });
    const RUN = T({ status: 'running', active: true });
    const DONE = T();
    const FAIL = T({ status: 'failed' });
    const ASK = (requestId) => T({ status: 'waiting', active: true, needsYou: true, requestId });
    let items = [RUN];
    let fetches = 0;
    start({ bearer: OLD, expiresAt: at(20), scopes: [] }, {
      ensureProject: async () => ({ path: '/env%201/t-1', title: 'proj', root: W`D:\GIT\proj`, fresh: false, note: null }),
      threadsFor: async () => { fetches++; return { items: structuredClone(items), environmentId: 'env 1' }; },
    }, [{ uri: { scheme: 'file', fsPath: W`D:\GIT\proj` } }]);
    assert.equal(env.ctx['t3vscode.panelVisible'], undefined, 'context key set before the view resolved');
    const webview = openView();
    await flush();
    webview.onMsg({ cmd: 'frameLoaded' }); // R1: openPicker and links wait for the frame
    const ctx = () => env.ctx['t3vscode.panelVisible'];
    assert.equal(ctx(), true);
    env.visible = false;
    webview.visibility();
    assert.equal(ctx(), false);
    env.visible = true;
    webview.visibility();
    assert.equal(ctx(), true);
    pass('B1: t3vscode.panelVisible is true on resolve and follows every visibility change');

    const tick = async () => { skip(); env.intervals.find((i) => (i.ms === 4000 || i.ms === 30000) && !i.cleared).fn(); await flush(); };
    const run = async (...lists) => { for (const l of lists) { items = [l]; await tick(); } };
    env.visible = false;
    await run(DONE);
    assert.deepEqual([env.infos, env.warnings], [['T3: one finished'], []]);
    env.visible = true;
    await run(RUN, DONE);
    assert.equal(env.infos.length, 1, 'a finish the owner saw was announced');
    env.visible = false;
    env.config['t3vscode.notify'] = 'needsYou';
    await run(RUN, DONE, RUN, FAIL, ASK('r1'));
    assert.deepEqual([env.infos, env.warnings], [['T3: one finished', 'T3: one waits for you'], []]);
    env.config['t3vscode.notify'] = 'off';
    await run(RUN, DONE, ASK('r2'), FAIL);
    assert.deepEqual([env.infos.length, env.warnings], [2, []]);
    env.config['t3vscode.notify'] = 'all';
    await run(RUN, FAIL, RUN, DONE);
    assert.deepEqual([env.infos.slice(2), env.warnings], [['T3: one finished'], ['T3: one failed']]);
    pass('B2 and B26: active to not active (not failed) while away says "<title> finished"; not while the owner looks; notify needsYou keeps only waits for you, off shows nothing, all (and unset) all three');

    const RESET = new Date(2026, 9, 13, 14, 5).toISOString(); // 14:05 local, whatever the time zone
    const LIM = T({ status: 'failed', active: true, limitedUntil: RESET, error: 'Limit reached' }); // an activeRunId may stay
    const PLAN = T({ plan: true, needsYou: true });
    const [i0, w0] = [env.infos.length, env.warnings.length];
    await run(RUN, T({ status: 'failed', error: 'boom' }), RUN, T({ said: 'Done: tests pass.' }), RUN, PLAN, RUN, LIM);
    assert.deepEqual([env.infos.slice(i0), env.warnings.slice(w0)], [['T3: one finished: Done: tests pass.', 'T3: one has a plan to review'], ['T3: one failed: boom', 'T3: one hit the usage limit, resets 14:05']]);
    env.config['t3vscode.notify'] = 'needsYou';
    await run(RUN, T({ status: 'failed', error: 'boom' }), RUN, T({ said: 'x' }), RUN, PLAN, RUN, LIM);
    assert.deepEqual([env.infos.slice(i0 + 2), env.warnings.slice(w0 + 2)], [['T3: one has a plan to review'], ['T3: one hit the usage limit, resets 14:05']]);
    env.config['t3vscode.notify'] = 'all';
    pass('R25: the toasts say what happened: "finished: <first line>", "failed: <error>", "hit the usage limit, resets <HH:MM>", "has a plan to review" in place of finished; notify needsYou keeps the limit and the plan');

    items = [T({ id: 't-2', title: 'two', status: 'running', active: true, unread: true }), T({ id: 't-3', title: 'three', status: 'running', active: true }),
      T({ id: 't-4', title: 'four', status: 'failed', limitedUntil: RESET, unread: true }), T({ id: 't-5', title: 'five', unread: true })];
    await tick();
    assert.deepEqual([env.status.text, env.status.tooltip.value.split('\n').slice(1)], ['$(sync~spin) T3: 2 running', ['two: running', 'three: running', 'four: usage limit until 14:05', 'five: done, not read yet']]);
    items = [DONE];
    await tick();
    pass('R25 and R27: the status bar counts more than one running thread; the tooltip adds "usage limit until <HH:MM>" and "done, not read yet" (only for a thread neither running, waiting nor limited)');

    const n = fetches;
    env.windowState({ focused: false });
    await flush();
    assert.equal(fetches, n, 'losing focus fetched');
    env.windowState({ focused: true });
    await flush();
    assert.equal(fetches, n + 1);
    pass('B8: the window getting focus back fetches the thread activity at once; losing it does nothing');

    let atFocus;
    env.cmds['t3vscode.panel.focus'] = () => { atFocus = webview.posted.length; };
    webview.posted.length = 0;
    await env.cmds['t3vscode.switchThread']();
    assert.deepEqual([atFocus, webview.posted], [0, [{ type: 'openPicker' }]]);
    delete env.cmds['t3vscode.panel.focus'];
    pass('B4: T3: Switch thread focuses the panel, then posts openPicker');

    const pkg = JSON.parse(require('fs').readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    const link = (p) => vscode.Uri.parse(`vscode://${pkg.publisher}.${pkg.name}${p}`);
    const KEY = 't3vscode.thread.' + t3.normalizeRoot(W`D:\GIT\proj`);
    const open = async (p) => { webview.posted.length = 0; env.exec.length = 0; env.logs.length = 0; await env.uriHandler.handleUri(link(p)); await flush(); return [webview.posted.splice(0), env.exec.splice(0), env.logs.splice(0)]; };
    assert.deepEqual(await open('/thread/env%201/t-2'), [[{ type: 'navigate', path: '/env%201/t-2' }], [['t3vscode.panel.focus']], []]);
    assert.equal(env.workspace.get(KEY), 't-2');
    for (const p of ['/thread/other/t-3', '/thread/env%201/a%2Fb', '/thread/env%201/' + 'x'.repeat(81)]) {
      const [posted, exec, logs] = await open(p);
      assert.deepEqual([posted, exec, logs.length], [[], [['t3vscode.panel.focus']], 1], p);
      assert.match(logs[0], /^Link: not a thread of this window's project: /, p);
    }
    for (const p of ['/open/env%201/t-3', '/thread/env%201/t-3/x', '/thread/env%201', '/thread/env%ZZ/t-3', '/']) {
      const [posted, exec, logs] = await open(p);
      assert.deepEqual([posted, exec, logs.length], [[], [], 1], p);
      assert.match(logs[0], /^Link: not a thread link: /, p);
    }
    assert.equal(env.workspace.get(KEY), 't-2', 'a refused link was stored');
    pass('B13: vscode://<publisher>.<name>/thread/<env>/<id> focuses the panel and opens the thread of this env; a wrong env or a bad id: focus and one log line; any other path: one log line only');

    assert.deepEqual([env.actions.selector, env.actions.meta], [{ scheme: 'file' }, { providedCodeActionKinds: ['quickfix'] }]);
    const doc = { uri: vscode.Uri.file(W`D:\GIT\proj\src\a.ts`) };
    const D = (message, line, source) => ({ message, range: { start: { line } }, source });
    const diags = [D('x'.repeat(80), 0, 'ts'), D('Unused import', 4), D('c', 1, 'eslint'), D('d', 2, 'eslint')];
    const acts = env.actions.provider.provideCodeActions(doc, null, { diagnostics: diags });
    assert.deepEqual(acts.map((a) => [a.title, a.kind, a.diagnostics[0], a.command.command, a.command.arguments]), [
      [`Fix with T3: ${'x'.repeat(60)}`, 'quickfix', diags[0], 't3vscode.fixWithT3', [doc.uri, 1, 'x'.repeat(80), 'ts']],
      ['Fix with T3: Unused import', 'quickfix', diags[1], 't3vscode.fixWithT3', [doc.uri, 5, 'Unused import', '']],
      ['Fix with T3: c', 'quickfix', diags[2], 't3vscode.fixWithT3', [doc.uri, 2, 'c', 'eslint']],
    ]);
    assert.deepEqual(env.actions.provider.provideCodeActions(doc, null, { diagnostics: [] }), []);
    webview.onMsg({ cmd: 'frameLoaded' });
    webview.posted.length = 0;
    await env.cmds['t3vscode.fixWithT3'](...acts[1].command.arguments);
    await env.cmds['t3vscode.fixWithT3'](...acts[2].command.arguments);
    assert.deepEqual(webview.posted, [{ type: 't3vscode:mention', text: '[a.ts](src/a.ts) line 5: Unused import' }, { type: 't3vscode:mention', text: '[a.ts](src/a.ts) line 2: c (eslint)' }]);
    pass('B15: at most 3 quick fixes per request, titled "Fix with T3: <message capped at 60>"; the command puts the file link, the line and the message (with its source) into the composer');

    await env.cmds['t3vscode.showLogs']();
    assert.deepEqual(env.shown, [true]);
    webview.onMsg({ cmd: 'showLogs' }); // R17: the button on the down and error pages
    await flush();
    assert.deepEqual(env.shown, [true, true]);
    pass("B25: T3: Show logs shows the output channel, focus kept; R17: the page's Show logs button runs it");

    webview.dispose();
    assert.equal(ctx(), false);
    pass('B1: t3vscode.panelVisible is false after the view is disposed');
  }

  { // docs/BACKLOG.md slice 5: B7 bind on activation, B5 relative open, B6 keys, B10 terminal selection, B29 settings.
    const PROJ = W`D:\GIT\proj`;
    const FOLDER = [{ uri: { scheme: 'file', fsPath: PROJ } }];
    const T = (x = {}) => ({ id: 't-1', title: 'one', projectId: 'p1', projectTitle: 'proj', mine: true, at: '', status: 'idle', active: false, needsYou: false, requestId: '', ...x });
    let items = [T({ needsYou: true, requestId: 'r0' })];
    let ensures = 0;
    let gate = null;
    const stubs = {
      ensureProject: async () => { ensures++; if (gate) await gate; return { path: '/env%201/t-1', title: 'proj', root: PROJ, fresh: false, note: null }; },
      threadsFor: async () => ({ items: structuredClone(items), environmentId: 'env 1' }),
    };
    const timers = () => env.intervals.filter((i) => (i.ms === 4000 || i.ms === 30000) && !i.cleared).map((i) => i.ms);
    const renders = states.length;
    start({ bearer: OLD, expiresAt: at(20), scopes: [] }, stubs, FOLDER);
    await flush();
    assert.deepEqual([ensures, env.panel.view, env.panel.bind && env.panel.bind.root, env.status.text, timers(), env.fwds.length, states.length - renders, env.infos],
      [1, null, PROJ, '$(warning) T3: needs you', [4000], 0, 0, []]);
    items = [T({ needsYou: true, requestId: 'r1' })];
    env.intervals.find((i) => i.ms === 4000 && !i.cleared).fn();
    await flush();
    assert.deepEqual(env.infos, ['T3: one waits for you'], 'no notification with the panel never opened');
    pass('B7: a stored session and a local first folder bind on activation: status bar painted and the watch running without a view, a new request announced, no forwarder, no render');
    const webview = openView();
    await flush();
    assert.deepEqual([ensures, states.at(-1).kind, states.at(-1).path, states.at(-1).threads.length, env.status.text], [1, 'paired', '/env%201/t-1', 1, '$(warning) T3: needs you']);
    webview.onMsg({ cmd: 'reload' });
    await flush();
    assert.equal(ensures, 2, 'a reload reused the startup bind');
    pass('B7: the panel opening later reuses that bind once (no second ensureProject) with a fresh thread list; a reload binds again');

    ensures = 0;
    gate = deferred();
    start({ bearer: OLD, expiresAt: at(20), scopes: [] }, stubs, FOLDER);
    openView(); // the refresh starts while the startup bind waits on T3
    await flush();
    gate.resolve();
    gate = null;
    await flush();
    assert.deepEqual([ensures, states.at(-1).kind, states.at(-1).path, env.panel.bind && env.panel.bind.root], [1, 'paired', '/env%201/t-1', PROJ]);
    pass('B7: a panel that opens while the startup bind is in flight takes it over: one ensureProject');
    ensures = 0;
    start({ bearer: OLD, expiresAt: at(20), scopes: [] }, stubs, FOLDER);
    await flush();
    env.folders = [{ uri: { scheme: 'file', fsPath: W`D:\GIT\next` } }]; // no change event: only the key differs
    openView();
    await flush();
    assert.equal(ensures, 2, 'another folder reused the startup bind');
    start({ bearer: OLD, expiresAt: at(20), scopes: [] }, stubs, FOLDER);
    await flush();
    await env.cmds['t3vscode.forget']();
    await flush();
    assert.deepEqual([env.panel.bind, env.status.text, env.status.command, timers(), ensures], [null, 'T3: not paired', 't3vscode.pair', [], 3], 'Forget with the panel closed kept the bind');
    pass('B7: another first folder at panel time binds again; Forget with the panel closed drops the bind and the watch; R8: the status says not paired');
    const UNPAIRED = ['T3: not paired', 't3vscode.pair'];
    const AS_TODAY = ['T3', 't3vscode.open'];
    for (const [why, session, folders, bar] of [['no session', null, FOLDER, UNPAIRED], ['expired', { bearer: OLD, expiresAt: at(-1), scopes: [] }, FOLDER, UNPAIRED],
      ['no folder', { bearer: OLD, expiresAt: at(20), scopes: [] }, undefined, AS_TODAY], ['remote folder', { bearer: OLD, expiresAt: at(20), scopes: [] }, [{ uri: { scheme: 'vscode-remote', fsPath: '/r' } }], AS_TODAY],
      ['no session, no folder', null, undefined, UNPAIRED]]) {
      ensures = 0;
      start(session, stubs, folders);
      await flush();
      assert.deepEqual([ensures, env.panel.bind, [env.status.text, env.status.command], timers()], [0, undefined, bar, []], why);
    }
    for (const session of [{ bearer: OLD, expiresAt: at(20), scopes: [] }, null]) {
      start(session, { ...stubs, discover: down }, FOLDER);
      await flush();
      const polls = env.intervals.filter((i) => i.ms === 10000 && !i.cleared);
      assert.deepEqual([env.panel.bind, env.logs.at(-1), env.status.text, env.status.command, polls.length], [undefined, 'Project (panel closed): no-runtime-file: T3 down', 'T3: not running', 't3vscode.startT3', 1]);
      assert.match(env.status.tooltip.value, /not running/);
      t3.discover = () => ({ origin: ORIGIN }); // T3 came up: the closed-panel poll's probe refreshes, prebind learns the truth and stops the poll
      polls[0].fn();
      await flush();
      assert.deepEqual([env.status.text, polls[0].cleared], [session ? '$(warning) T3: needs you' : 'T3: not paired', true], 'the status kept saying not running');
    }
    // Review 2026-10-13: a stale runtime file (T3 gone, its port dead) with a saved session: the session check finds no answer, so down and the poll.
    let alive = false;
    ensures = 0;
    start({ bearer: OLD, expiresAt: at(20), scopes: [] }, { ...stubs, session: async () => { if (!alive) throw Object.assign(new Error('T3 did not answer'), { code: 'no-answer' }); return { authenticated: true }; } }, FOLDER);
    await flush();
    const stale = env.intervals.filter((i) => i.ms === 10000 && !i.cleared);
    assert.deepEqual([ensures, env.status.text, env.status.command, stale.length], [0, 'T3: not running', 't3vscode.startT3', 1]);
    alive = true;
    stale[0].fn();
    await flush();
    assert.deepEqual([ensures, env.status.text, stale[0].cleared], [1, '$(warning) T3: needs you', true]);
    start({ bearer: OLD, expiresAt: at(20), scopes: [] }, { ...stubs, session: async () => ({ authenticated: false }) }, FOLDER);
    await flush();
    assert.deepEqual([ensures, env.status.text], [1, 'T3: not paired']);
    pass('R8 review: with the panel closed a saved session is checked first: no answer (a stale runtime file) says "T3: not running" and polls until T3 answers; a session T3 refuses says "T3: not paired"; neither binds');
    pass('B7: no bind on activation without a session, with an expired one, without a local first folder; T3 down: one log line; ' +
      'R8 with the panel closed: no or an expired session says "T3: not paired" (click: pair), also without a folder; T3 down says "T3: not running" (click: start T3, down wins over unpaired) and polls until T3 answers');

    // B5: a relative path from a chip resolves against the bound root and must stay inside it.
    start({ bearer: OLD, expiresAt: at(20), scopes: [] }, stubs, FOLDER);
    const view = openView();
    await flush();
    const realNow = Date.now;
    let clock = realNow();
    Date.now = () => (clock += 1000);
    try {
      env.stat = () => 1;
      view.onMsg({ cmd: 'openFile', path: 'src/a.ts', line: 3, column: 2, relative: true });
      await flush();
      view.onMsg({ cmd: 'openFile', path: W`lib\b.ts`, relative: true });
      await flush();
      assert.deepEqual(env.opened.map((o) => [o.path, o.range]), [[W`D:\GIT\proj\src\a.ts`, [2, 1, 2, 1]], [W`D:\GIT\proj\lib\b.ts`, [0, 0, 0, 0]]]);
      for (const p of ['../proj-old/x.ts', W`src\..\..\x.ts`, 'C:/x.ts', '']) {
        view.onMsg({ cmd: 'openFile', path: p, relative: true });
        await flush();
      }
      assert.deepEqual([env.opened.length, env.warnings.length], [2, 4], 'an escape from the root opened or did not warn');
      start({ bearer: OLD, expiresAt: at(20), scopes: [] });
      const unbound = openView();
      await flush();
      unbound.onMsg({ cmd: 'openFile', path: 'src/a.ts', relative: true });
      await flush();
      assert.deepEqual([env.opened, env.warnings, env.logs.slice(-1)], [[], ['T3 Code could not open src/a.ts'], ['Open file: no bound project for the relative path src/a.ts']]);
      unbound.onMsg({ cmd: 'openFile', path: 'src/a.ts', relative: true }); // R17: the same refused path again within 10 s: no second toast
      await flush();
      assert.equal(env.warnings.length, 1, 'a refused path warned twice within 10 s');
    } finally {
      Date.now = realNow;
    }
    pass('B5: openFile with relative true opens <bound root>\\<path> at the line; a path that leaves the root (parent steps, a drive) warns and opens nothing; no bound project: one log line and one warning (R17), once per path within 10 s');

    // R5: the current thread (t-1 from the bind path) sits in a worktree: relative chips and diff titles resolve there, and must stay inside it.
    const WT = W`D:\wt\proj-1`;
    const SUB = W`D:\GIT\proj\sub`;
    items = [T({ root: WT }), T({ id: 't-2' }), T({ id: 't-3', root: SUB })];
    start({ bearer: OLD, expiresAt: at(20), scopes: [] }, stubs, FOLDER);
    const wv = openView();
    await flush();
    clock = realNow();
    Date.now = () => (clock += 1000);
    try {
      env.stat = () => 1;
      env.git = () => {};
      for (const m of [{ cmd: 'openFile', path: 'src/a.ts', relative: true }, { cmd: 'openFile', path: '../proj/x.ts', relative: true }, { cmd: 'openDiff', path: W`lib\b.ts`, relative: true }]) {
        wv.onMsg(m);
        await flush();
      }
      assert.deepEqual([env.opened.map((o) => o.path), env.exec.filter((e) => e[0] === 'git.openChange').map((e) => e[1]), env.warnings.length], [[W`D:\wt\proj-1\src\a.ts`], [W`D:\wt\proj-1\lib\b.ts`], 1]);
      wv.onMsg({ cmd: 'location', pathname: '/env%201/t-2' }); // the owner moves to a thread with no worktree
      await flush();
      env.opened.length = 0;
      wv.onMsg({ cmd: 'openFile', path: 'src/a.ts', relative: true });
      await flush();
      assert.deepEqual(env.opened.map((o) => o.path), [W`D:\GIT\proj\src\a.ts`]);
      // Review 2026-10-13: a nested project's thread resolves against its own root; mentions and Run in terminal follow the thread too.
      wv.onMsg({ cmd: 'location', pathname: '/env%201/t-3' });
      await flush();
      env.opened.length = 0;
      wv.onMsg({ cmd: 'openFile', path: 'src/a.ts', relative: true });
      await flush();
      assert.deepEqual(env.opened.map((o) => o.path), [W`D:\GIT\proj\sub\src\a.ts`]);
      const mentioned = () => wv.posted.filter((m) => m.type === 't3vscode:mention').map((m) => m.text);
      wv.onMsg({ cmd: 'frameLoaded' });
      wv.posted.length = 0;
      await env.cmds['t3vscode.addToPrompt']({ scheme: 'file', fsPath: W`D:\GIT\proj\sub\b.ts` });
      wv.onMsg({ cmd: 'mentionResult', ok: true });
      wv.onMsg({ cmd: 'dropped', uris: [W`D:\GIT\proj\sub\c.ts`] });
      await flush();
      assert.deepEqual(mentioned(), ['[b.ts](b.ts)', '[c.ts](c.ts)'], 'a mention is relative to the thread\'s root');
      env.terminals = [];
      wv.onMsg({ cmd: 'run', text: 'npm test' }); // t-3: a terminal in its project
      wv.onMsg({ cmd: 'location', pathname: '/env%201/t-1' });
      wv.onMsg({ cmd: 'run', text: 'npm test' }); // t-1: not t-3's terminal, a new one in the worktree
      wv.onMsg({ cmd: 'location', pathname: '/env%201/t-3' });
      wv.onMsg({ cmd: 'run', text: 'ls' }); // back on t-3: its terminal again
      await flush();
      assert.deepEqual(env.terminals.map(([o, t]) => [o.name, o.cwd, t.sent.filter((s) => s[0] !== 'show').map((s) => s[0])]), [['T3', SUB, ['npm test', 'ls']], ['T3 2', WT, ['npm test']]]);
    } finally {
      Date.now = realNow;
      items = [T({ needsYou: true, requestId: 'r0' })];
    }
    pass('R5: a relative chip or diff title resolves against the thread\'s root (its worktree, else its own project, nested ones too) and may not leave it; mentions are relative to it; Run in terminal reuses only a terminal started there');

    { // R28: Show this thread's changes with a stubbed git API (Status numbers: 1 index added, 5 modified, 6 deleted, 7 untracked).
      const f = (n) => vscode.Uri.file(`${WT}\\${n}`);
      const ch = (n, status) => ({ uri: f(n), originalUri: f(n), status });
      const opens = [];
      let repo, known = null;
      const api = { getRepository: () => known, openRepository: async (u) => { opens.push(u.fsPath); return repo; }, toGitUri: (u, ref) => ({ git: u.fsPath, ref }) };
      const run = async (git = { 'vscode.git': { activate: async () => ({ getAPI: (v) => (v === 1 ? api : null) }) } }) => {
        env.ext = git;
        env.infos.length = 0;
        env.exec.length = 0;
        await env.cmds['t3vscode.showChanges']();
        return [env.infos.slice(), env.exec.filter((e) => e[0] === 'vscode.changes'), env.logs.filter((l) => l.startsWith('Show changes')).length];
      };
      items = [T({ root: WT })];
      start({ bearer: OLD, expiresAt: at(20), scopes: [] }, stubs, FOLDER);
      openView();
      await flush();
      // x.ts: added in the index, then deleted on disk (review 2026-10-13): no side to show, left out.
      repo = { state: { indexChanges: [ch('a.ts', 1), ch('d.ts', 1), ch('x.ts', 1)], workingTreeChanges: [ch('b.ts', 5), ch('c.ts', 6), ch('d.ts', 5), ch('x.ts', 6)], untrackedChanges: [ch('e.ts', 7)] } };
      const head = (n) => ({ git: f(n).fsPath, ref: 'HEAD' });
      assert.deepEqual(await run(), [[], [['vscode.changes', 'T3: one', [[f('a.ts'), undefined, f('a.ts')], [f('d.ts'), undefined, f('d.ts')], [f('b.ts'), head('b.ts'), f('b.ts')], [f('c.ts'), head('c.ts'), undefined], [f('e.ts'), undefined, f('e.ts')]]]], 1]);
      assert.deepEqual(opens, [WT], 'the worktree, not the bound root');
      known = {};
      repo = { state: { indexChanges: [], workingTreeChanges: [], untrackedChanges: [] } };
      assert.deepEqual(await run(), [[`T3: no changes in ${WT}`], [], 1], 'no changes; a known repo logs nothing');
      repo = { state: { indexChanges: [ch('x.ts', 1)], workingTreeChanges: [ch('x.ts', 6)], untrackedChanges: [] } };
      assert.deepEqual(await run(), [[`T3: no changes to show in ${WT} (files added and deleted again)`], [], 1], 'only a file with no side: an empty diff view');
      repo = null;
      assert.deepEqual(await run(), [[`T3: ${WT} is not a git repository.`], [], 1]);
      assert.deepEqual(await run({}), [['T3: the Git extension is not available.'], [], 1]);
      start({ bearer: OLD, expiresAt: at(20), scopes: [] });
      assert.deepEqual(await run(), [['No T3 project bound.'], [], 0]);
      const pkg = JSON.parse(require('fs').readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
      assert.ok(pkg.contributes.commands.some((c) => c.command === 't3vscode.showChanges' && c.category === 'T3'), 'contributes.commands');
      assert.ok(pkg.contributes.menus['view/title'].some((c) => c.command === 't3vscode.showChanges' && c.when === 'view == t3vscode.panel' && c.group === 't3vscode'), 'view/title overflow');
      items =[T({ needsYou: true, requestId: 'r0' })];
      pass('R28: Show this thread\'s changes opens vscode.changes for the worktree with one triple per file (added: no HEAD side, deleted: no working file, index plus working tree: one triple), logs a newly opened repo once; a file added in the index and deleted on disk is left out (only such files: one message); no changes, no repo, no git, no project: one message each');
    }

    // B6, B10, B29 on the bound panel.
    start({ bearer: OLD, expiresAt: at(20), scopes: [] }, stubs, FOLDER);
    const w = openView();
    await flush();
    w.onMsg({ cmd: 'frameLoaded' });
    const sent = async (run) => { w.posted.length = 0; env.exec.length = 0; await run(); await flush(); return w.posted.splice(0); };
    await sent(() => { for (const key of ['quickOpen', 'panel', 'terminal', 'toString', '__proto__', 7]) w.onMsg({ cmd: 'key', key }); });
    assert.deepEqual(env.exec, [['workbench.action.quickOpen'], ['workbench.action.togglePanel'], ['workbench.action.terminal.toggleTerminal']]);
    pass('B6: key quickOpen, panel and terminal run quick open, toggle panel and toggle terminal; an inherited or unknown name runs nothing');
    assert.deepEqual([await sent(() => w.onMsg({ cmd: 'key', key: 'switch' })), env.exec], [[{ type: 'openPicker' }], [['t3vscode.panel.focus']]]);
    pass('test 12: key switch runs t3vscode.switchThread: the panel, then the thread picker');
    env.termSel = 'npm ERR! x';
    env.clipText = 'mine';
    assert.deepEqual(await sent(() => env.cmds['t3vscode.addTerminalSelection']()), [{ type: 't3vscode:mention', text: '```\nnpm ERR! x\n```' }]);
    assert.deepEqual(env.exec, [['workbench.action.terminal.copySelection']]);
    w.onMsg({ cmd: 'mentionResult', ok: true });
    await flush();
    env.termSel = 'y'.repeat(5000);
    assert.equal((await sent(() => env.cmds['t3vscode.addTerminalSelection']()))[0].text, '```\n' + 'y'.repeat(4000) + '\n```');
    w.onMsg({ cmd: 'mentionResult', ok: true });
    await flush();
    env.termSel = null;
    env.clipText = 'mine';
    env.infos.length = 0;
    assert.deepEqual(await sent(() => env.cmds['t3vscode.addTerminalSelection']()), []);
    assert.deepEqual([env.infos, env.clipText], [['Select text in the terminal first.'], 'mine']);
    pass('B10: the terminal selection goes into the composer as a fenced block (capped at 4000 characters); nothing selected: one message, the clipboard keeps what it had');
    assert.deepEqual(await sent(() => env.cmds['t3vscode._mention']('```\n$ ls\nx\n```')), [{ type: 't3vscode:mention', text: '```\n$ ls\nx\n```' }]);
    w.onMsg({ cmd: 'mentionResult', ok: true });
    await flush();
    for (const bad of [5, '', undefined]) assert.deepEqual(await sent(() => env.cmds['t3vscode._mention'](bad)), [], String(bad));
    pass('R20: the internal t3vscode._mention puts context.js\'s text into the composer; anything but a non-empty string does nothing');
    assert.deepEqual(await sent(() => env.cmds['t3vscode.openSettings']()), [{ type: 'navigate', path: '/settings/general' }]);
    assert.deepEqual(env.exec, [['t3vscode.panel.focus']]);
    pass('B29: T3: Open T3 settings focuses the panel, then navigates to /settings/general');
  }

  { // docs/BACKLOG.md slice 6: B18 save on send, B19 TODO lens, B20 diff, B21 review changes, the internal _open and _diff commands.
    const PROJ = W`D:\GIT\proj`;
    const A = W`D:\GIT\proj\src\a.ts`;
    const stubs = {
      ensureProject: async () => ({ path: '/env%201/t-1', title: 'proj', root: PROJ, fresh: false, note: null }),
      threadsFor: async () => ({ items: [], environmentId: 'env 1' }),
    };
    start({ bearer: OLD, expiresAt: at(20), scopes: [] }, stubs, [{ uri: { scheme: 'file', fsPath: PROJ } }]);
    const w = openView();
    await flush();
    w.onMsg({ cmd: 'frameLoaded' });

    env.docs = [{ isDirty: true }, { isDirty: true, isUntitled: true }, { isDirty: false }, { isDirty: true }];
    w.onMsg({ cmd: 'sent' });
    await flush();
    assert.deepEqual([env.saved, env.logs.at(-1)], [[false], 'Saved 2 files before T3 sent the prompt']);
    const logs = env.logs.length;
    env.docs = [{ isDirty: false }, { isDirty: true, isUntitled: true }];
    w.onMsg({ cmd: 'sent' });
    await flush();
    env.docs = [{ isDirty: true }];
    env.config['t3vscode.saveOnSend'] = false;
    w.onMsg({ cmd: 'sent' });
    await flush();
    assert.deepEqual([env.saved, env.logs.length], [[false], logs], 'nothing dirty or the setting off still saved or logged');
    pass('B18: sent from the page saves all files (untitled left alone) and logs the count; nothing dirty: no save, no line; saveOnSend false: nothing');

    assert.deepEqual(env.lenses.selector, { scheme: 'file' });
    const lens = env.lenses.provider;
    const doc = (text) => ({ uri: vscode.Uri.file(A), getText: () => text });
    const shown = (text) => lens.provideCodeLenses(doc(text)).map((l) => [l.range.args, l.command.title, l.command.command, l.command.arguments.slice(1)]);
    assert.deepEqual(shown(['const a = 1; // TODO: handle errors', '# FIXME tidy up', '/* TODO wrap this */', ' * TODO(alice): docs', '<!-- FIXME: alt text -->', '-- TODO',
      'see http://x.example/TODO', 'let x--; TODO no comment', '// later, not a TODO', 'TODO bare'].join('\r\n')), [
      [[0, 0, 0, 0], 'Implement with T3', 't3vscode.fixWithT3', [1, 'handle errors', 'TODO']],
      [[1, 0, 1, 0], 'Implement with T3', 't3vscode.fixWithT3', [2, 'tidy up', 'FIXME']],
      [[2, 0, 2, 0], 'Implement with T3', 't3vscode.fixWithT3', [3, 'wrap this', 'TODO']],
      [[3, 0, 3, 0], 'Implement with T3', 't3vscode.fixWithT3', [4, '(alice): docs', 'TODO']],
      [[4, 0, 4, 0], 'Implement with T3', 't3vscode.fixWithT3', [5, 'alt text', 'FIXME']],
      [[5, 0, 5, 0], 'Implement with T3', 't3vscode.fixWithT3', [6, 'TODO', 'TODO']],
    ]);
    assert.equal(lens.provideCodeLenses(doc('// TODO a\n'))[0].command.arguments[0].fsPath, A);
    const many = lens.provideCodeLenses(doc(Array.from({ length: 60 }, (_, i) => `// TODO ${i} ${'y'.repeat(200)}`).join('\n')));
    assert.deepEqual([many.length, many[49].command.arguments[2].length], [50, 120]);
    assert.deepEqual(lens.provideCodeLenses(doc('x'.repeat(205 * 1024) + '\n// TODO big')), [], 'a file over 200 KB got lenses');
    env.config['t3vscode.todoLens'] = false;
    assert.deepEqual(lens.provideCodeLenses(doc('// TODO a')), []);
    const emitter = lens.onDidChangeCodeLenses.emitter;
    env.configChanged({ affectsConfiguration: (k) => k === 't3vscode.notify' });
    env.configChanged({ affectsConfiguration: (k) => k === 't3vscode.todoLens' });
    assert.equal(emitter.fired, 1, 'the lens event did not fire once for todoLens');
    pass('B19: TODO and FIXME after //, #, --, /*, a leading * or <!-- get an "Implement with T3" lens with uri, line, text (capped at 120) and the keyword; ' +
      'not in a URL, after x--, or mid-comment; at most 50 per document, none over 200 KB or with todoLens off; a todoLens change fires the lens event');

    const realNow = Date.now;
    let clock = realNow();
    Date.now = () => (clock += 1000);
    try {
      const diffTab = (u) => { env.tab = { input: { original: {}, modified: { scheme: 'file', fsPath: u.fsPath } } }; };
      const diff = async (git, path = 'src/a.ts') => { env.exec.length = 0; env.tab = null; env.git = git; w.onMsg({ cmd: 'openDiff', path, relative: true }); await flush(); return env.exec.splice(0); };
      assert.deepEqual(await diff(diffTab), [['git.openChange', A]]);
      assert.equal(env.logs.at(-1), 'Diff: src/a.ts: git.openChange ok');
      assert.deepEqual(await diff((u) => { env.tab = { input: { modified: { scheme: 'git', fsPath: u.fsPath.toLowerCase() } } }; }), [['git.openChange', A]], 'a staged diff (git: uri) fell back');
      assert.deepEqual(await diff(() => {}), [['git.openChange', A], ['vscode.open', A]], 'a silent no-op of git.openChange did not open the file');
      assert.equal(env.logs.at(-1), 'Diff: src/a.ts: no diff tab (no uncommitted change), so vscode.open'); // test 16
      assert.deepEqual(await diff(() => { throw new Error("command 'git.openChange' not found"); }), [['git.openChange', A], ['vscode.open', A]]);
      assert.equal(env.logs.at(-1), "Diff: src/a.ts: git.openChange threw (command 'git.openChange' not found), so vscode.open", 'no git: not logged');
      assert.deepEqual(await diff(diffTab, '../other/x.ts'), [], 'a path that leaves the root reached git');
      assert.equal(env.logs.at(-1), 'Diff: refused: ../other/x.ts');
      pass('B20: openDiff resolves the relative path against the bound root and runs git.openChange; when no diff of the file shows (no change, or no git) the file opens instead; an escape opens nothing; one log line names the branch (test 16)');

      env.stat = () => 1;
      env.opened.length = 0;
      env.exec.length = 0;
      assert.deepEqual(await env.cmds['t3vscode._open']({ path: A, line: 4, column: 2 }), { ok: true });
      assert.deepEqual([env.opened, env.exec], [[{ path: A, range: [3, 1, 3, 1], preview: false }], [['revealInExplorer', A]]]);
      env.exec.length = 0;
      assert.deepEqual(await env.cmds['t3vscode._open']({ path: A, reveal: true }), { ok: true });
      assert.deepEqual([env.opened.length, env.exec], [1, [['workbench.view.explorer'], ['revealInExplorer', A]]], 'reveal opened an editor or expanded');
      assert.deepEqual(await env.cmds['t3vscode._open']({ path: 'src/a.ts' }), { ok: false, reason: 'refused or not found' });
      assert.deepEqual(await env.cmds['t3vscode._open'](), { ok: false, reason: 'refused or not found' });
      env.stat = () => { throw new Error('ENOENT'); };
      const warned = env.warnings.length;
      assert.deepEqual(await env.cmds['t3vscode._open']({ path: W`D:\GIT\proj\gone.ts` }), { ok: false, reason: 'refused or not found' });
      assert.equal(env.warnings.length, warned + 1);
      Date.now = () => clock - 1000; // back to the gate's reading: the R17 refusal read the clock once more
      assert.deepEqual(await env.cmds['t3vscode._open']({ path: A }), { ok: false, reason: 'busy' });
      clock += 1000;
      env.git = diffTab;
      assert.deepEqual(await env.cmds['t3vscode._diff']({ path: A }), { ok: true });
      clock += 1000;
      assert.deepEqual(await env.cmds['t3vscode._diff']({ path: 'src/a.ts' }), { ok: false, reason: 'refused' });
    } finally {
      Date.now = realNow;
    }
    pass('B22 plumbing: t3vscode._open opens an absolute path at line and column and returns ok; reveal true only reveals; relative, missing or no path: ok false (a missing file warns); ' +
      'within 300 ms: busy; t3vscode._diff runs the B20 rules on an absolute path');

    w.posted.length = 0;
    env.exec.length = 0;
    await env.cmds['t3vscode.reviewChanges']();
    await flush();
    assert.deepEqual(w.posted, [{ type: 't3vscode:mention', text: 'Review my uncommitted changes in this repository.' }, { type: 't3vscode:focus-composer' }]);
    assert.deepEqual(env.exec, [['t3vscode.focusComposer'], ['t3vscode.panel.focus']]);
    pass('B21: Review changes with T3 puts the request into the composer (never sent), then focuses it');

    // B12: insert from the page replaces the selection in the active editor, or opens a new untitled document without one.
    const edits = [];
    const sel = { start: [2, 4], end: [2, 9] };
    env.editor = { selection: sel, edit: async (fn) => { fn({ replace: (s, t) => edits.push([s, t]) }); return env.editOk !== false; } };
    env.logs.length = 0;
    w.onMsg({ cmd: 'insert', text: 'const a = 1;\n' });
    await flush();
    assert.deepEqual([edits, env.logs], [[[sel, 'const a = 1;\n']], ['Inserted 13 characters from T3']]);
    env.editOk = false;
    w.onMsg({ cmd: 'insert', text: 'b' });
    await flush();
    assert.equal(env.logs.at(-1), 'Insert: the editor refused the edit (read-only?)');
    env.editor = null;
    const created = [];
    const shownDocs = [];
    const show = vscode.window.showTextDocument;
    vscode.workspace.openTextDocument = async (o) => { created.push(o); return { untitled: o.content }; };
    vscode.window.showTextDocument = async (d, o) => { shownDocs.push([d, o]); };
    try {
      w.onMsg({ cmd: 'insert', text: 'x'.repeat(70000) });
      await flush();
      assert.deepEqual([created.map((o) => o.content.length), shownDocs.map(([d, o]) => [d.untitled.length, o])], [[65536], [[65536, undefined]]]);
      assert.equal(env.logs.at(-1), 'Inserted 65536 characters from T3 into a new document (no editor was active)');
      edits.length = 0;
      created.length = 0;
      w.onMsg({ cmd: 'insert', text: ['a'] });
      w.onMsg({ cmd: 'insert' });
      await flush();
      assert.deepEqual([edits, created], [[], []], 'a non-string insert reached an editor');
    } finally {
      vscode.window.showTextDocument = show;
      delete vscode.workspace.openTextDocument;
    }
    pass('B12: insert replaces the active editor selection and logs the count; a refused edit is logged; without an editor a new document opens with the text (capped at 64 KB) and the log says so; ' +
      'a non-string text does nothing');
  }

  { // B9 and B11 on a bound panel.
    const T = (id, title, x = {}) => ({ id, title, projectId: 'p1', projectTitle: 'proj', mine: true, at: '', status: 'idle', active: false, needsYou: false, requestId: '', kind: '', ...x });
    let items = [T('t-1', 'Fix the parser'), T('t-2', 'Two'), T('t-3', 'Three'), T('t-4', 'Four'), T('t-5', 'Five'), T('t-6', 'Six', { status: 'running', active: true })];
    start({ bearer: OLD, expiresAt: at(20), scopes: [] }, {
      ensureProject: async () => ({ path: '/env%201/t-1', title: 'proj', root: W`D:\GIT\proj`, fresh: false, note: null }),
      threadsFor: async () => ({ items: structuredClone(items), environmentId: 'env 1' }),
      pendingRequest: async () => ({ kind: 'command', live: true, prompt: '', command: 'npm test' }), // R2 below
    }, [{ uri: { scheme: 'file', fsPath: W`D:\GIT\proj` } }]);
    const w = openView();
    await flush();
    w.onMsg({ cmd: 'frameLoaded' });
    env.logs.length = 0;
    w.onMsg({ cmd: 'run', text: 'npm test' });
    assert.equal(env.terminals.length, 1);
    const [[opts, made]] = env.terminals;
    assert.deepEqual([opts, made.sent, env.logs], [{ name: 'T3', cwd: W`D:\GIT\proj` }, [['show', false], ['npm test', false]], ['Run in terminal: 8 characters into the terminal T3, not run']]);
    const other = { name: 'pwsh', sent: [], show(p) { other.sent.push(['show', p]); }, sendText(x, n) { other.sent.push([x, n]); } };
    env.terminal = other; // R4: the active terminal (a dev server, a REPL) never gets the text
    w.onMsg({ cmd: 'run', text: 'x'.repeat(20000) });
    assert.deepEqual([env.terminals.length, other.sent, made.sent[3][0].length, made.sent[3][1]], [1, [], 16384, false], 'T3 is reused (not the active one), the text capped at 16 KB, no Enter');
    for (const text of ['a\nb', 'rm -rf x\r', 'a\u001b[2J', '', 7, undefined]) w.onMsg({ cmd: 'run', text });
    assert.deepEqual([made.sent.length, env.terminals.length], [4, 1], 'a multi-line, control, empty or non-string command reached a terminal');
    pass('B9: run sends the text without Enter to our "T3" terminal (shown, focused) in the bound root; capped at 16 KB; control characters, empty or non-string: nothing');

    env.termStart({ terminal: other }); // a command in a terminal of the owner's changes nothing
    w.onMsg({ cmd: 'run', text: 'a' });
    assert.deepEqual([env.terminals.length, made.sent.at(-1)], [1, ['a', false]]);
    env.termStart({ terminal: made });
    w.onMsg({ cmd: 'run', text: 'b' });
    const [o2, second] = env.terminals[1];
    assert.deepEqual([env.terminals.length, o2, second.sent, made.sent.at(-1)], [2, { name: 'T3 2', cwd: W`D:\GIT\proj` }, [['show', false], ['b', false]], ['a', false]], 'a busy T3 got the text');
    w.onMsg({ cmd: 'run', text: 'c' });
    assert.deepEqual([env.terminals.length, second.sent.at(-1)], [2, ['c', false]], 'T3 2 is reused while T3 is busy');
    env.termEnd({ terminal: made });
    w.onMsg({ cmd: 'run', text: 'd' });
    assert.deepEqual([env.terminals.length, made.sent.at(-1)], [2, ['d', false]], 'T3 is idle again after its command ended');
    env.termStart({ terminal: made });
    env.termStart({ terminal: second });
    w.onMsg({ cmd: 'run', text: 'e' });
    assert.deepEqual([env.terminals.length, env.terminals[2][0].name], [3, 'T3 3'], 'both busy: a third');
    env.termClose(made);
    env.termClose(second);
    env.termClose(env.terminals[2][1]);
    w.onMsg({ cmd: 'run', text: 'f' });
    assert.deepEqual([env.terminals.length, env.terminals[3][0].name, env.terminals[3][1].sent.at(-1)], [4, 'T3', ['f', false]], 'a closed T3 was reused');
    env.terminal = undefined;
    pass('R4: a running command (shell integration start without end) makes T3 busy: the text goes to "T3 2", then "T3 3"; an ended command frees it; closed terminals are forgotten; without events a terminal counts as idle');

    const settings = () => w.posted.splice(0).filter((m) => m.type === 't3vscode:settings');
    w.posted.length = 0;
    env.config['t3vscode.runInTerminal'] = 't3';
    env.configChanged({ affectsConfiguration: (k) => k === 't3vscode.runInTerminal' });
    env.configChanged({ affectsConfiguration: (k) => k === 't3vscode.todoLens' });
    assert.deepEqual(settings(), [{ type: 't3vscode:settings', runInTerminal: 't3' }], 'one settings message per runInTerminal change, none for another key');
    w.onMsg({ cmd: 'frameLoaded' });
    assert.deepEqual(settings(), [{ type: 't3vscode:settings', runInTerminal: 't3' }]);
    env.config['t3vscode.runInTerminal'] = 'other';
    w.onMsg({ cmd: 'frameLoaded' });
    assert.deepEqual(settings(), [{ type: 't3vscode:settings', runInTerminal: 'vscode' }], 'an unknown value is vscode');
    pass('B9 setting: runInTerminal goes into the frame on every frameLoaded and on a change of that setting; t3 or vscode (anything else)');
    env.config['t3vscode.keysToVsCode'] = ['palette', 'panel', 7];
    env.configChanged({ affectsConfiguration: (k) => k === 't3vscode.keysToVsCode' });
    assert.deepEqual(settings(), [{ type: 't3vscode:settings', runInTerminal: 'vscode', keys: ['palette', 'panel'] }], 'one settings message per keysToVsCode change, strings only');
    w.onMsg({ cmd: 'frameLoaded' });
    assert.deepEqual(settings(), [{ type: 't3vscode:settings', runInTerminal: 'vscode', keys: ['palette', 'panel'] }]);
    env.config['t3vscode.keysToVsCode'] = 'palette';
    w.onMsg({ cmd: 'frameLoaded' });
    assert.deepEqual(settings(), [{ type: 't3vscode:settings', runInTerminal: 'vscode' }], 'a non-array keysToVsCode was sent');
    delete env.config['t3vscode.keysToVsCode'];
    pass('R24 setting: keysToVsCode (strings only) rides on the settings message on every frameLoaded and on a change of that setting; not an array: left out');

    const N = (tag, title = 'Thread completed', body = 'Fix the parser') => ({ cmd: 'notify', title, body, tag });
    const say = async (...a) => { w.onMsg(N(...a)); await flush(); }; // R2: notify fetches a fresh list first
    const FOREIGN = 'T3 notification: not a thread of this window, not shown';
    env.logs.length = 0;
    await say('env 1:t-1');
    assert.deepEqual([env.infos, env.logs], [[], ['T3 notification: Thread completed']], 'shown while the owner looks, or no log line');
    env.focused = false;
    await say('env 1:t-1');
    await say('env 1:t-1');
    assert.deepEqual(env.infos, ['T3: Thread completed: Fix the parser'], 'the same thread twice within 10 s');
    env.logs.length = 0;
    await say('env 1:t-9');
    await say('other:t-9', 'Input needed');
    assert.deepEqual([env.infos.length, env.logs.filter((l) => l === FOREIGN).length], [1, 2], 'a thread outside this window\'s list was shown, or no log line');
    await say('a:b:t-2', 'Thread failed', 'Two');
    assert.equal(env.infos.at(-1), 'T3: Thread failed: Two', 'the thread id is after the last colon');
    await say('', 'Thread completed', 'Three');
    assert.equal(env.infos.at(-1), 'T3: Thread completed: Three', 'no thread id in the tag: the body names a thread of the list');
    env.logs.length = 0;
    await say('', 'Thread completed', 'Nobody');
    await say('', 'Thread completed', '');
    assert.deepEqual([env.infos.length, env.logs.filter((l) => l === FOREIGN).length], [3, 2], 'no id and no matching title was shown');
    await say('env 1:t-4', 'Approval needed', 'Four');
    assert.equal(env.infos.length, 3, 'the shim\'s Approval needed was shown (ours has the buttons)');
    skip();
    await say('env 1:t-1');
    assert.equal(env.infos.length, 4, 'the same thread after 10 s did not show again');
    env.focused = true;
    env.visible = false;
    await say('env 1:t-5', 'Thread failed', 'Five');
    assert.equal(env.infos.at(-1), 'T3: Thread failed: Five', 'a hidden panel is away too');
    env.config['t3vscode.notify'] = 'off';
    env.logs.length = 0;
    skip();
    await say('env 1:t-4', 'Usage limit reached', 'Four');
    assert.deepEqual([env.infos.length, env.logs], [5, ['T3 notification: Usage limit reached']], 'notify off showed it, or no log line');
    env.config['t3vscode.notify'] = 'needsYou';
    await say('env 1:t-4', 'Thread completed', 'Four');
    await say('env 1:t-4', 'Thread failed', 'Four');
    assert.equal(env.infos.length, 5, 'notify needsYou showed a completed or failed');
    await say('env 1:t-4', 'Usage limit reached', 'Four');
    assert.equal(env.infos.at(-1), 'T3: Usage limit reached: Four');
    env.answer = 'Show';
    w.posted.length = 0;
    env.exec.length = 0;
    await say('env 1:t-3', 'Input needed', 'Three');
    await flush();
    assert.deepEqual([env.infos.at(-1), env.exec, w.posted], ['T3: Input needed: Three', [['t3vscode.panel.focus']], [{ type: 't3vscode:notify-click', tag: 'env 1:t-3' }]]);
    env.answer = undefined;
    pass('B11 and R2: notify logs "T3 notification: <title>" always; shows "T3: <title>: <body>" only while away (hidden panel or unfocused window), notify not off, and only for a thread of this window\'s list ' +
      '(the id after the tag\'s last colon; no id: a title equal to the body), else one more log line; never Approval needed; needsYou keeps Input needed and Usage limit reached; one per thread within 10 s; ' +
      'Show focuses the panel and posts notify-click with the tag into the frame');

    env.config['t3vscode.notify'] = 'all';
    const poll = async () => { env.intervals.find((i) => (i.ms === 4000 || i.ms === 30000) && !i.cleared).fn(); await flush(); };
    skip();
    items = items.map((t) => (t.id === 't-6' ? T('t-6', 'Six') : t));
    await poll();
    await say('env 1:t-6', 'Thread completed', 'Six');
    assert.deepEqual(env.infos.slice(-1), ['T3: Six finished'], 'the shim showed a thread the poll just showed');
    skip();
    await say('env 1:t-6', 'Thread completed', 'Six');
    items = items.map((t) => (t.id === 't-6' ? T('t-6', 'Six', { status: 'running', active: true }) : t));
    await poll();
    items = items.map((t) => (t.id === 't-6' ? T('t-6', 'Six') : t));
    await poll();
    assert.deepEqual(env.infos.slice(-2), ['T3: Six finished', 'T3: Thread completed: Six'], 'the poll showed a thread the shim just showed');
    items = items.map((t) => (t.id === 't-6' ? T('t-6', 'Six', { needsYou: true, requestId: 'r9', kind: 'command' }) : t));
    await poll();
    assert.equal(env.infos.at(-1), 'T3: Six needs approval (command): npm test', 'an approvable request is shown even within 10 s of a shim toast (its buttons)');
    await say('env 1:t-6', 'Input needed', 'Six');
    assert.equal(env.infos.at(-1), 'T3: Six needs approval (command): npm test', 'the shim showed a thread ask() just showed');
    // Review 2026-10-13: the window is per event (thread and run), not per thread.
    const five = (x) => { items = items.map((t) => (t.id === 't-5' ? T('t-5', 'Five', x) : t)); };
    const before = env.infos.length;
    skip();
    five({ status: 'running', active: true, run: 'a' });
    await poll();
    five({ run: 'a' });
    await poll(); // run a ended: Five finished
    await say('env 1:t-5', 'Thread completed', 'Five'); // the shim's delivery of run a: not again
    five({ status: 'running', active: true, run: 'b' });
    await poll();
    five({ run: 'b' });
    await poll(); // run b ended within 10 s of run a: shown too
    five({ status: 'running', active: true, run: 'c' });
    await poll();
    five({ run: 'c' });
    await say('env 1:t-5', 'Thread completed', 'Five'); // the shim first: its fresh list lets the poll's richer toast win, the shim's waits
    await poll();
    assert.deepEqual(env.infos.slice(before), ['T3: Five finished', 'T3: Five finished', 'T3: Five finished'], 'one toast per run end, none lost and none twice');
    env.visible = true;
    pass('R2: the poll and the shim share one 10 s window per event (thread plus request or run id) both ways (finished, then Thread completed; and the reverse, where the shim\'s fresh list lets the poll\'s text win); a second run\'s end within 10 s is shown; an approvable request keeps its toast and blocks the shim');
  }

  { // R1: commands that need the panel work on first use; R8: the status bar with the panel open.
    const timeouts = [];
    const realTimeout = [globalThis.setTimeout, globalThis.clearTimeout];
    globalThis.setTimeout = (fn, ms) => { const id = { fn, ms }; timeouts.push(id); return id; }; // driven by hand
    globalThis.clearTimeout = (id) => { if (id) id.cleared = true; };
    try {
      const PROJ = W`D:\GIT\proj`;
      const FOLDER = [{ uri: { scheme: 'file', fsPath: PROJ } }];
      const S = { bearer: OLD, expiresAt: at(20), scopes: [] };
      const T = (id, x = {}) => ({ id, title: 'one', projectId: 'p1', projectTitle: 'proj', mine: true, at: '', status: 'idle', active: false, needsYou: false, requestId: '', kind: '', ...x });
      const pkg = JSON.parse(require('fs').readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
      const link = (p) => vscode.Uri.parse(`vscode://${pkg.publisher}.${pkg.name}${p}`);
      const live = () => timeouts.filter((t) => !t.cleared && t.ms === 15000);
      let items = [T('t-1'), T('t-2')];
      let open;
      let w;
      // The panel was closed: the command's focus resolves the view (as VS Code does), and T3 answers the project only when open resolves.
      const closed = (stubs = {}) => {
        open = deferred();
        w = null;
        timeouts.length = 0;
        start(S, { ensureProject: async () => { await open; return { path: '/env%201/t-1', title: 'proj', root: PROJ, fresh: false, note: null }; },
          threadsFor: async () => ({ items: structuredClone(items), environmentId: 'env 1' }), ...stubs }, FOLDER);
        env.cmds['t3vscode.panel.focus'] = () => { if (!env.panel.view) w = openView(); };
      };
      const frame = (m) => !['t3vscode:theme', 't3vscode:settings'].includes(m.type);
      const first = async (run, between) => {
        closed();
        await run();
        await flush();
        const before = w.posted.splice(0).filter(frame);
        const waiting = live().length;
        if (between) await between();
        open.resolve();
        await flush();
        const bound = w.posted.splice(0).filter(frame);
        w.onMsg({ cmd: 'frameLoaded' });
        await flush();
        return [before, waiting, bound, w.posted.splice(0).filter(frame), live().length, env.clip];
      };
      const A = W`D:\GIT\proj\a.ts`;
      assert.deepEqual(await first(() => env.cmds['t3vscode.addToPrompt']({ scheme: 'file', fsPath: A })),
        [[], 1, [], [{ type: 't3vscode:mention', text: '[a.ts](D:%5CGIT%5Cproj%5Ca.ts)' }], 0, []]);
      w.onMsg({ cmd: 'mentionResult', ok: false });
      await flush();
      assert.deepEqual(env.clip, ['[a.ts](D:%5CGIT%5Cproj%5Ca.ts)'], 'the deferred mention is the pending one');
      assert.deepEqual(await first(() => env.cmds['t3vscode.newThread']()), [[], 1, [], [{ type: 't3vscode:new-thread', root: PROJ, title: 'proj' }], 0, []]);
      assert.deepEqual(await first(() => env.cmds['t3vscode.switchThread']()), [[], 1, [], [{ type: 'openPicker' }], 0, []]);
      assert.deepEqual(await first(() => env.uriHandler.handleUri(link('/thread/env%201/t-2'))), [[], 1, [], [{ type: 'navigate', path: '/env%201/t-2' }], 0, []]);
      assert.equal(env.workspace.get('t3vscode.thread.' + t3.normalizeRoot(PROJ)), 't-2');
      assert.deepEqual(await first(() => env.cmds['t3vscode.newThread'](), () => { w.onMsg({ cmd: 'reload' }); return flush(); }),
        [[], 1, [], [{ type: 't3vscode:new-thread', root: PROJ, title: 'proj' }], 0, []], 'a refresh between the command and the bind lost it');
      env.logs.length = 0;
      const [, , , wrong] = await first(() => env.uriHandler.handleUri(link('/thread/other/t-2')));
      assert.deepEqual([wrong, env.logs.filter((l) => l.startsWith('Link: not a thread of this window\'s project: ')).length], [[], 1]);
      pass('R1: on a closed panel, Add to prompt (mention), New thread, Switch thread and a thread link each wait in one slot with one live 15 s timer; the bind alone sends nothing; ' +
        'the frame\'s load runs it once (the mention then has its result); a refresh in between keeps it; a link to another environment logs once');

      // announce's Show on a closed panel: the bind from activation is reused and the thread opens once the frame loads.
      closed();
      items = [T('t-1', { status: 'running', active: true })];
      open.resolve();
      await flush();
      env.visible = false;
      env.answer = 'Show';
      items = [T('t-1')];
      env.intervals.find((i) => (i.ms === 4000 || i.ms === 30000) && !i.cleared).fn();
      await flush();
      env.answer = undefined;
      env.visible = true;
      assert.deepEqual([env.infos.at(-1), w.posted.filter((m) => m.type === 'navigate')], ['T3: one finished', []]);
      w.onMsg({ cmd: 'frameLoaded' });
      await flush();
      assert.deepEqual(w.posted.filter((m) => m.type === 'navigate'), [{ type: 'navigate', path: '/env%201/t-1' }]);
      pass('R1: Show on a notification while the panel was closed opens that thread after the frame loads');

      closed();
      await env.cmds['t3vscode.addToPrompt']({ scheme: 'file', fsPath: A });
      await flush();
      assert.deepEqual([live().length, env.clip], [1, []]);
      live()[0].fn();
      await flush();
      assert.deepEqual([env.clip, env.infos.at(-1)], [['[a.ts](D:%5CGIT%5Cproj%5Ca.ts)'], "T3 did not take the reference. It is on the clipboard: press Ctrl+V in T3's composer."]);
      await env.cmds['t3vscode.switchThread']();
      env.logs.length = 0;
      live()[0].fn();
      open.resolve();
      await flush();
      w.onMsg({ cmd: 'frameLoaded' });
      await flush();
      assert.deepEqual([env.logs.filter((l) => l === 'T3 has no bound project for openPicker; dropped').length, w.posted.filter((m) => m.type === 'openPicker')], [1, []], 'a dropped command ran later');
      pass('R1: no bind within 15 s: a waiting mention goes to the clipboard with the message, anything else is dropped with one log line and never runs later');

      closed({ ensureProject: async () => ({ path: '/', title: 'proj', fresh: false, note: 'T3 is not on proj: x. Reload to retry.' }) });
      await env.cmds['t3vscode.open']();
      await flush();
      env.logs.length = 0;
      await env.cmds['t3vscode.newThread']();
      assert.deepEqual([live().length, env.logs], [0, ['T3 has no bound project for newThread; dropped']], 'a finished page without a bound project waited');
      closed({ ensureProject: async () => { await open; return { path: '/', title: 'proj', fresh: false, note: 'T3 is not on proj: x. Reload to retry.' }; } });
      await env.cmds['t3vscode.addToPrompt']({ scheme: 'file', fsPath: A });
      await flush();
      assert.deepEqual(env.clip, [], 'clipped while connecting');
      open.resolve();
      await flush();
      assert.deepEqual([env.clip, states.at(-1).kind], [['[a.ts](D:%5CGIT%5Cproj%5Ca.ts)'], 'paired'], 'a refresh that ended without a bound project kept the mention waiting');
      pass('R1: a finished page without a bound project answers at once, as before (one log line; a mention: the clipboard), also for a command that waited while it connected');

      // R8 with the panel open: the state the refresh learns.
      const bar = () => [env.status.text, env.status.command];
      start(null, {}, FOLDER);
      openView();
      await flush();
      assert.deepEqual(bar(), ['T3: not paired', 't3vscode.pair']);
      start(S, { session: async () => ({ authenticated: false }) }, FOLDER);
      openView();
      await flush();
      assert.deepEqual([bar(), states.at(-1).ended], [['T3: not paired', 't3vscode.pair'], true]);
      let up = false;
      start(S, { discover: () => { if (!up) down(); return { origin: ORIGIN }; }, ensureProject: async () => ({ path: '/env%201/t-1', title: 'proj', root: PROJ, fresh: false, note: null }),
        threadsFor: async () => ({ items: [T('t-1', { status: 'running', active: true })], environmentId: 'env 1' }) }, FOLDER);
      openView();
      await flush();
      assert.deepEqual([bar(), states.at(-1).kind], [['T3: not running', 't3vscode.startT3'], 'down']);
      assert.match(env.status.tooltip.value, /not running/);
      up = true;
      env.intervals.find((i) => i.ms === 10000 && !i.cleared).fn();
      await flush();
      assert.deepEqual([bar(), states.at(-1).kind], [['$(sync~spin) T3: running', 't3vscode.open'], 'paired']);
      assert.match(env.status.tooltip.value, /^Open T3 Code/);
      start(S, { session: async () => { throw new Error('odd'); } }, FOLDER);
      openView();
      await flush();
      assert.deepEqual([bar(), states.at(-1).kind], [['T3', 't3vscode.open'], 'error']);
      pass('R8: unpaired and session ended say "T3: not paired" (click: pair); T3 down says "T3: not running" (click: start T3, tooltip too) until the poll finds T3, then the activity text and open; an error page: T3 and open');
    } finally {
      [globalThis.setTimeout, globalThis.clearTimeout] = realTimeout;
    }
  }

  { // R9, R10, R17: walkthrough keys and command, the clipboard prefill, an unanswered T3 link.
    start(undefined);
    const webview = openView();
    await flush();
    assert.deepEqual([env.ctx['t3vscode.running'], env.ctx['t3vscode.paired']], [true, false], 'unpaired: T3 answered, not paired');
    assert.ok(env.status.tooltip.value.includes('T3: Get started'), 'unpaired tooltip names the walkthrough');
    const ask = async (text) => { env.clipText = text; webview.posted.length = 0; webview.onMsg({ cmd: 'clipboard' }); await flush(); return webview.posted.splice(0); };
    const LINK = 'http://127.0.0.1:3773/pair#token=ABCDEFGHJKLM';
    assert.deepEqual(await ask(`  ${LINK}\n`), [{ type: 'prefill', value: LINK }], 'a pairing link, trimmed');
    assert.deepEqual(await ask('ABCDEFGHJKLM'), [{ type: 'prefill', value: 'ABCDEFGHJKLM' }], 'a pairing code');
    for (const x of ['hello', 'secret_word-1', 'https://example.com/', 'ABCDEFGHJKL1', 'abcdefghjklm', `${LINK}${'A'.repeat(2000)}`, '']) assert.deepEqual(await ask(x), [], `prefilled ${x.slice(0, 20)}`);
    assert.deepEqual([env.store, env.logs.filter((l) => l.includes('ABCDEFGHJKLM'))], [undefined, []], 'a prefill paired or was logged');
    env.externalOk = false;
    await env.cmds['t3vscode.openInDesktop']();
    assert.deepEqual([env.external.splice(0), env.warnings.at(-1)], [['t3code://new'], 'The T3 app did not take the link. Is T3 Code installed?']);
    env.externalOk = true;
    await env.cmds['t3vscode.walkthrough']();
    const pkg = JSON.parse(require('fs').readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    assert.deepEqual(env.exec.filter((e) => e[0] === 'workbench.action.openWalkthrough'), [['workbench.action.openWalkthrough', `${pkg.publisher}.${pkg.name}#${pkg.contributes.walkthroughs[0].id}`, false]]);
    start({ bearer: OLD, expiresAt: at(20), scopes: [] });
    let nudges = 0; // R18: context.js's command, stubbed out here
    env.cmds['t3vscode._mcpNudge'] = () => { nudges++; };
    openView();
    await flush();
    assert.deepEqual([env.ctx['t3vscode.running'], env.ctx['t3vscode.paired']], [true, true], 'paired');
    assert.equal(nudges, 1, 'R18: no MCP nudge after the paired render');
    start({ bearer: OLD, expiresAt: at(20), scopes: [] }, { session: down });
    env.cmds['t3vscode._mcpNudge'] = () => { nudges++; };
    openView();
    await flush();
    assert.equal(env.ctx['t3vscode.running'], false, 'down');
    assert.equal(nudges, 1, 'R18: an MCP nudge without a paired session');
    start({ bearer: OLD, expiresAt: at(20), scopes: [] }, { discover: down }); // the walkthrough's Start T3 with the panel closed: only the poll sees T3 come up
    await flush();
    t3.discover = () => ({ origin: ORIGIN });
    env.intervals.filter((i) => i.ms === 10000 && !i.cleared).forEach((i) => i.fn());
    await flush();
    assert.equal(env.ctx['t3vscode.running'], true, 'panel closed: the poll found T3 but the key stayed unset');
    const steps = Object.fromEntries(pkg.contributes.walkthroughs[0].steps.map((x) => [x.id, x.completionEvents]));
    assert.deepEqual([steps.startT3, steps.pair], [['onContext:t3vscode.running'], ['onContext:t3vscode.paired']]);
    pass('R9: t3vscode.running and t3vscode.paired follow what T3 answered and the walkthrough steps complete on them; T3: Get started opens our walkthrough; the unpaired tooltip names it. ' +
      'R10: a clipboard request answers a T3 pairing link or 12-character code (trimmed, under 2000) as prefill, anything else nothing, never pairs. R17: openExternal false warns');
  }

  { // R21: t3.json scripts as tasks of type t3, one per folder with a valid file.
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 't3vs-tasks-'));
    const dir = (n, body) => { const d = path.join(root, n); fs.mkdirSync(d); if (body !== undefined) fs.writeFileSync(path.join(d, 't3.json'), typeof body === 'string' ? body : JSON.stringify(body)); return { name: n, uri: { scheme: 'file', fsPath: d } }; };
    try {
      const scripts = [{ name: ' dev ', command: ' npm run dev ' }, { name: 'no command' }, { name: '', command: 'x' }, null, { name: 'n', command: 7 }, ...Array.from({ length: 60 }, (_, i) => ({ name: `s${i}`, command: `echo ${i}` }))];
      const a = dir('a', { scripts });
      const folders = [a, dir('b', '{not json'), dir('c', { scripts: 'x' }), dir('d'), dir('e', { scripts: [{ name: 'big', command: 'x'.repeat(300 * 1024) }] }), { name: 'v', uri: { scheme: 'vscode-vfs', fsPath: a.uri.fsPath } }];
      start(null, {}, folders);
      const [type, provider] = env.taskProvider;
      assert.equal(type, 't3');
      const tasks = await provider.provideTasks();
      assert.equal(tasks.length, 46, 'the first 50 entries of a, of which 46 are valid');
      const t = tasks[0];
      assert.deepEqual([t.definition, t.scope, t.name, t.source, t.execution.commandLine, t.execution.options, t.matchers], [{ type: 't3', script: 'dev' }, a, 'dev', 'T3', 'npm run dev', { cwd: a.uri.fsPath }, []]);
      assert.match(t.detail, /t3\.json.*npm run dev$/);
      assert.equal(provider.resolveTask(t), undefined);
      const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
      assert.deepEqual(pkg.contributes.taskDefinitions, [{ type: 't3', required: ['script'], properties: { script: { type: 'string', description: pkg.contributes.taskDefinitions[0].properties.script.description } } }]);
      pass('R21: a task per t3.json script (type t3, script, source T3, the folder as scope and cwd, trimmed name and command); at most 50 entries; bad entries, a non-JSON or over-256-KB file, a non-array scripts, no file and a non-file folder give none; taskDefinitions type t3 requires script');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  }

  { // B31: every command a walkthrough step links or waits for is contributed, and every step's markdown exists.
    const pkg = JSON.parse(require('fs').readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    const ids = new Set(pkg.contributes.commands.map((c) => c.command));
    const [walk] = pkg.contributes.walkthroughs;
    assert.equal(walk.steps.length, 4);
    for (const s of walk.steps) {
      const named = [...s.description.matchAll(/\(command:(t3vscode\.[\w.]+)/g), ...s.completionEvents.join(' ').matchAll(/onCommand:(t3vscode\.[\w.]+)/g)].map((m) => m[1]);
      for (const id of named) assert.ok(ids.has(id), `${s.id}: ${id} is not in contributes.commands`);
      assert.ok(require('fs').existsSync(new URL('../' + s.media.markdown, import.meta.url)), `${s.id}: ${s.media.markdown} missing`);
    }
    pass('B31: the walkthrough has four steps; every t3vscode command it links or completes on is contributed; every step markdown exists');
  }

  { // R22 and R23: a renewal with the panel open swaps the forwarder's bearer and posts no new html; the link of the shown thread.
    const PROJ = [{ uri: { scheme: 'file', fsPath: W`D:\GIT\proj` } }];
    const bound = (renew, binds = []) => ({ renew, ensureProject: async (o) => { binds.push(o.bearer); return { path: '/env/t-1', title: 'proj', root: W`D:\GIT\proj`, fresh: false, note: null }; },
      threadsFor: async () => ({ items: [], environmentId: 'env 1' }) });
    const renewal = deferred();
    start({ bearer: OLD, expiresAt: at(2), scopes: ['access:write'] }, bound(() => renewal), PROJ);
    const webview = openView();
    await flush();
    const before = [webview.renders, htmls.length, env.fwds.length];
    webview.posted.length = 0;
    renewal.resolve({ bearer: FRESH, expiresAt: at(30), scopes: ['access:write'] });
    await flush();
    assert.deepEqual([stored(), webview.renders, htmls.length, env.fwds.length, env.fwds[0].closed, env.fwds[0].token, env.panel.bind.bearer], [FRESH, ...before, false, FRESH, FRESH], 'renewal reloaded the page or kept the old bearer');
    assert.deepEqual(webview.posted, [{ type: 'session', text: `Paired as VS Code, renews itself, until ${page.date(at(30))}` }]);
    const binds = [];
    const closed = deferred();
    start({ bearer: OLD, expiresAt: at(2), scopes: ['access:write'] }, bound(() => closed, binds), PROJ);
    await flush();
    closed.resolve({ bearer: FRESH, expiresAt: at(30), scopes: ['access:write'] });
    await flush();
    assert.deepEqual([binds, env.fwds.length], [[OLD, FRESH], 0], 'a closed panel binds again with the new bearer');
    pass('R23: a renewal with the panel open swaps the forwarder token and the bind bearer, posts the new session line and no html; a closed panel binds again with the new bearer');

    start({ bearer: OLD, expiresAt: at(20), scopes: [] }, bound(async () => null), PROJ);
    const view = openView();
    await flush();
    await env.cmds['t3vscode.copyThreadLink']();
    view.onMsg({ cmd: 'copyLink' }); // the details card button
    await flush();
    assert.deepEqual([env.clip, env.infos], [['vscode://fundryi.t3-vscode/thread/env%201/t-1', 'vscode://fundryi.t3-vscode/thread/env%201/t-1'], ['Link copied.', 'Link copied.']]);
    start({ bearer: OLD, expiresAt: at(20), scopes: [] });
    openView();
    await flush();
    await env.cmds['t3vscode.copyThreadLink']();
    assert.deepEqual([env.clip, env.infos], [[], ['No thread open.']]);
    pass('R22: Copy link to this thread (command and the card button) puts the vscode:// thread link on the clipboard and says so; no thread: one message, no clipboard write');
  }

  { // Review 2026-10-13: the picker's list and the poll's list for one bind apply in the order they were asked.
    const T = (x = {}) => ({ id: 't-1', title: 'one', projectId: 'p1', projectTitle: 'proj', mine: true, at: '', status: 'idle', active: false, needsYou: false, requestId: '', kind: '', ...x });
    let next = null;
    start({ bearer: OLD, expiresAt: at(20), scopes: [] }, {
      ensureProject: async () => ({ path: '/env%201/t-1', title: 'proj', root: W`D:\GIT\proj`, fresh: false, note: null }),
      threadsFor: () => next || Promise.resolve({ items: [T()], environmentId: 'env 1' }),
    }, [{ uri: { scheme: 'file', fsPath: W`D:\GIT\proj` } }]);
    const w = openView();
    await flush();
    const slow = (next = deferred());
    env.panel.activity(); // the poll asks first and waits
    next = Promise.resolve({ items: [T()], environmentId: 'env 1' });
    w.onMsg({ cmd: 'threads' }); // the picker asks later and is answered first: idle
    await flush();
    w.posted.length = 0;
    slow.resolve({ items: [T({ status: 'running', active: true })], environmentId: 'env 1' });
    await flush();
    assert.deepEqual([env.status.text, w.posted.filter((m) => m.type === 'threads')], ['T3', []], 'an older running list overwrote a newer idle one');
    pass('threads and activity: a list older than the newest one applied for the bind gives way to it (no stale running state or badge)');
  }

  { // B32: T3 in an editor tab, the same page as the side view.
    const PROJ = W`D:\GIT\proj`;
    const T = (id, root) => ({ id, title: id, projectId: 'p1', projectTitle: 'proj', mine: true, at: '', status: 'idle', active: false, needsYou: false, requestId: '', kind: '', root });
    start({ bearer: OLD, expiresAt: at(20), scopes: [] }, {
      ensureProject: async () => ({ path: '/env%201/t-1', title: 'proj', root: PROJ, fresh: false, note: null }),
      threadsFor: async () => ({ items: [T('t-1', PROJ), T('t-2', W`D:\wt\two`), T('t-3', W`D:\wt\three`)], environmentId: 'env 1' }),
    }, [{ uri: { scheme: 'file', fsPath: PROJ } }]);
    await flush();
    await env.cmds['t3vscode.openInEditor']();
    await flush();
    const [tab] = env.tabs;
    const ctx = () => env.ctx['t3vscode.panelVisible'];
    assert.deepEqual(tab.created, ['t3vscode.editor', 'T3 Code', -2, { enableScripts: true, retainContextWhenHidden: true }]);
    assert.deepEqual([env.panel.view, tab.webview.renders > 0, states.at(-1).kind, env.fwds.length, ctx()], [null, true, 'paired', 1, true], 'the tab works without the side view');
    await env.cmds['t3vscode.openInEditor']();
    assert.deepEqual([env.tabs.length, tab.reveals], [1, 1], 'a second open shows the tab, no second tab');
    const view = openView();
    await flush();
    assert.ok(view.renders > 0, 'the side view got the page');
    for (const w of [view, tab.webview]) w.onMsg({ cmd: 'frameLoaded' });
    await flush();
    const sent = (w, type) => w.posted.filter((m) => m.type === type).length;
    const clear = () => { view.posted.length = 0; tab.webview.posted.length = 0; };
    assert.deepEqual([sent(view, 't3vscode:theme'), sent(tab.webview, 't3vscode:theme')], [2, 2], 'state reaches every page');
    clear();
    tab.webview.onMsg({ cmd: 'openThread', id: 't-2' });
    tab.webview.onMsg({ cmd: 'newThread' });
    await flush();
    assert.deepEqual([sent(view, 'navigate'), sent(tab.webview, 'navigate'), sent(view, 't3vscode:new-thread'), sent(tab.webview, 't3vscode:new-thread')], [1, 1, 0, 1], 'a switch reaches both pages, a new thread only the page that asked');
    // Review 2026-10-13: a switch inside one page moves the other once; the other's late report of the thread it leaves does not bounce it back,
    // and a click from each page resolves against the thread that page shows.
    for (const w of [view, tab.webview]) w.onMsg({ cmd: 'location', pathname: '/env%201/t-2' });
    clear();
    tab.webview.onMsg({ cmd: 'location', pathname: '/env%201/t-3' }); // the owner switches inside the tab
    view.onMsg({ cmd: 'location', pathname: '/env%201/t-2' }); // the side view still reports t-2 while the switch travels
    const realNow = Date.now;
    let clock = realNow();
    Date.now = () => (clock += 1000); // past the 300 ms open throttle
    try {
      env.stat = () => 1;
      for (const w of [view, tab.webview]) { w.onMsg({ cmd: 'openFile', path: 'a.ts', relative: true }); await flush(); }
    } finally { Date.now = realNow; }
    assert.deepEqual([view.posted, tab.webview.posted, env.panel.current, env.opened.map((o) => o.path)],
      [[{ type: 'navigate', path: '/env%201/t-3' }], [], 't-3', [W`D:\wt\two\a.ts`, W`D:\wt\three\a.ts`]], 'the side view did not follow, bounced the tab back, or a click took the other page\'s thread');
    view.onMsg({ cmd: 'location', pathname: '/env%201/t-3' }); // the switch landed
    assert.deepEqual([view.posted.length, tab.webview.posted.length, env.panel.current], [1, 0, 't-3'], 'the landing navigated again');
    pass('B32 sync: a thread switch inside one page navigates the other once, its late report of the old thread does not bounce back; a file click resolves against its own page\'s thread');
    clear();
    await env.cmds['t3vscode._mention']('one');
    env.visible = false; // the side view is hidden: the tab is the page on screen
    await env.cmds['t3vscode._mention']('two');
    env.visible = true;
    assert.deepEqual([view.posted, tab.webview.posted], [[{ type: 't3vscode:mention', text: 'one' }], [{ type: 't3vscode:mention', text: 'two' }]], 'a mention goes to one page');
    clear();
    tab.webview.onMsg({ cmd: 'dropped', uris: [W`D:\GIT\proj\a.ts`] });
    await flush();
    assert.deepEqual([sent(view, 't3vscode:mention'), sent(tab.webview, 't3vscode:mention')], [0, 1], 'a drop goes into the page it was dropped on');
    // Review 2026-10-13: readiness is per page. After a new render the tab loads first: the side view's mention and the deferred picker wait for the side view's frame.
    view.onMsg({ cmd: 'mentionResult', ok: true });
    view.onMsg({ cmd: 'reload' });
    await flush();
    clear();
    tab.webview.onMsg({ cmd: 'frameLoaded' });
    await env.cmds['t3vscode._mention']('three');
    await env.cmds['t3vscode.switchThread']();
    await flush();
    const acts = () => [sent(view, 't3vscode:mention'), sent(tab.webview, 't3vscode:mention'), sent(view, 'openPicker'), sent(tab.webview, 'openPicker')];
    assert.deepEqual(acts(), [0, 0, 0, 0], 'an action for the side view went out before its frame loaded, or to the tab');
    view.onMsg({ cmd: 'frameLoaded' });
    await flush();
    assert.deepEqual(acts(), [1, 0, 1, 0], 'the side view\'s frame loaded: its mention and picker');
    pass('B32 readiness: a queued mention and a deferred command wait for the frame of the page they go to; another page loading first does not take them');
    clear();
    const was = env.panel.current;
    view.onMsg({ cmd: 'openThread', id: 't-2' }); // right after a render: no page has reported a thread yet
    view.onMsg({ cmd: 'location', pathname: `/env%201/${was}` }); // the side view's first report is still the render's thread
    assert.deepEqual([sent(view, 'navigate'), sent(tab.webview, 'navigate'), env.panel.current], [1, 1, 't-2'], 'a first report after a render bounced the switch');
    tab.dispose();
    assert.deepEqual([env.fwds[0].closed, env.panel.editor, ctx()], [false, null, true], 'closing the tab keeps the side view served');
    await env.cmds['t3vscode.openInEditor']();
    await flush();
    const tab2 = env.tabs[1];
    view.dispose();
    assert.deepEqual([env.fwds[0].closed, env.panel.view, ctx()], [false, null, true], 'closing the side view keeps the tab served');
    tab2.visible = false;
    tab2.viewState();
    assert.equal(ctx(), false, 'the context key follows the tab');
    tab2.dispose();
    assert.deepEqual([env.fwds[0].closed, env.status.text], [true, 'T3'], 'the last page gone stops the forwarder and the watch');
    const pkg = JSON.parse(require('fs').readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    assert.ok(pkg.contributes.commands.some((c) => c.command === 't3vscode.openInEditor'), 'contributes.commands');
    assert.ok(pkg.contributes.menus['view/title'].some((c) => c.command === 't3vscode.openInEditor' && c.when === 'view == t3vscode.panel'), 'view/title');
    assert.ok(!pkg.contributes.menus.commandPalette.some((c) => c.command === 't3vscode.openInEditor'), 'not hidden in the palette');
    assert.ok(!pkg.contributes.keybindings.some((k) => k.command === 't3vscode.openInEditor'), 'no default key (Windows takes Ctrl+Shift+Escape)');
    pass('B32: T3: Open in editor tab opens one tab beside (a second open reveals it), also without the side view; state goes to every page, a new thread and a mention to one; either page closing keeps the other served, the last one stops the forwarder; palette and view title entries, no default key');
  }

  for (const st of states) assert.ok(!(st.session && 'bearer' in st.session), 'render() got a bearer');
  for (const h of htmls) assert.ok(!h.includes(OLD) && !h.includes(FRESH), 'bearer in html');
  pass('render() never receives or prints a bearer');
  console.log('ALL PASS');
} catch (e) {
  console.error('FAIL', e);
  process.exit(1);
}
