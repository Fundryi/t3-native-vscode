// VS Code side only. Everything that knows T3 lives in t3.js, the panel's HTML in panel.js.
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const t3 = require('./t3');
const page = require('./panel');
const contextServer = require('./context'); // Piece 2: VS Code context for agents, no T3 surface

const SECRET = 't3vscode.bearer';
const DAY = 24 * 60 * 60 * 1000;
const WRONG_CODE = 'T3 did not accept that code. It may be wrong, used or expired. Create a new link in T3 (Settings, Connections) and paste it here.';
let log;
let status;
let secrets;
// Same port = same origin = T3 keeps its localStorage. R14: each window takes the first free of ten stable ports, remembered per workspace.
const DEFAULT_PORT = 47730;
const PORTS = Array.from({ length: 10 }, (_, i) => DEFAULT_PORT + i);
const PORT_KEY = 't3vscode.forwarderPort';
let sessionPort; // this window's port, reused first on recreation; a random one (all ten taken) is never stored

// INJECT.md lead decision 2: a local absolute Windows path or null. No UNC or device namespace (fails the drive prefix),
// no drive-relative path, no extra colon (streams), no control characters, no reserved device names.
// A lexical filter only: a local link, junction or mapped drive can still point at a share, and stat follows it.
// Documented limit (INJECT.md, Codex code review 9); not a network barrier.
function localFilePath(p) {
  if (typeof p !== 'string' || !/^[A-Za-z]:[\\/]/.test(p) || p.indexOf(':', 2) >= 0 || /[\x00-\x1f\x7f]/.test(p)) return null;
  const n = path.win32.normalize(p);
  return n.split('\\').some((c) => /^(con|prn|aux|nul|conin\$|conout\$|com[1-9\u00b9\u00b2\u00b3]|lpt[1-9\u00b9\u00b2\u00b3])\s*(\..*)?$/i.test(c)) ? null : n;
}
// The folder T3 should be on: the window's first folder when it is local (decision 12, Codex C5). Remote and virtual folders have no T3 project.
const firstFolder = () => { const f = (vscode.workspace.workspaceFolders || [])[0]; return f && f.uri.scheme === 'file' ? f.uri.fsPath : null; };
const position = (n) => (Number.isSafeInteger(n) && n >= 1 && n <= 1000000 ? n : 1);
// Every local workspace folder: NAV.md section 2 lists threads for all of them.
const localFolders = () => (vscode.workspace.workspaceFolders || []).filter((f) => f.uri.scheme === 'file').map((f) => f.uri.fsPath);
const MEDIA = /\.(png|jpe?g|gif|webp|svg|bmp|ico|pdf|mp4|mp3|wav|webm)$/i;
const THREAD_ID = /^[A-Za-z0-9_-]{1,80}$/;
const titleOf = (t) => (t.title || 'Untitled').slice(0, 60); // T3's own fallback name, capped for the tooltip and notifications
const hhmm = (iso) => { const d = new Date(iso); return isNaN(d) ? 'later' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }; // R25: local time
// B14: the request kinds T3's own UI answers with Approve or Deny (providerPolicy.ts), in plain words for the notification.
const APPROVABLE = { command: 'command', 'file-read': 'file read', 'file-change': 'file change', permission: 'permission', 'mcp-elicitation': 'MCP question' };
// Keys the T3 frame relays (QOL items 7 and 8, B6): blur back to the editor, then VS Code's own palette, quick open, panel and terminal; test 12: our thread picker.
const KEY_COMMANDS = { blur: 'workbench.action.focusActiveEditorGroup', palette: 'workbench.action.showCommands', quickOpen: 'workbench.action.quickOpen',
  panel: 'workbench.action.togglePanel', terminal: 'workbench.action.terminal.toggleTerminal', switch: 't3vscode.switchThread' };
const listSig = (items) => items.map((t) => `${t.id}\t${t.title}`).join('\n'); // tests 11 and 17: what the panel's thread list and title show
let workspaceState;
const setContext = (k, v) => vscode.commands.executeCommand('setContext', k, v);

// A file chip click from T3's page (panel.js). Text documents only: no shell, no openExternal, no command from the page.
let lastOpen = 0; // a hostile page could flood tabs or warnings: at most one request per 300 ms, the rest dropped
const busy = () => { if (Date.now() - lastOpen < 300) return true; lastOpen = Date.now(); return false; };
const OK = { ok: true };
// R17: every refused chip says so, once per path per 10 s (like toast()), so one bad chip clicked again does not stack toasts.
const refusedAt = new Map();
function refuse(shown) {
  const now = Date.now();
  for (const [k, t] of refusedAt) if (now - t >= 10000) refusedAt.delete(k);
  if (refusedAt.has(shown)) return;
  refusedAt.set(shown, now);
  vscode.window.showWarningMessage(`T3 Code could not open ${shown}`);
}
// B5: a relative chip resolves against the bound root and must stay inside it (the page could send a parent step). Null when refused.
function resolvePath(m, root) {
  const rel = m.relative === true;
  const p = localFilePath(rel ? path.win32.join(root, String(m.path)) : m.path);
  return p && rel && !t3.normalizeRoot(p).startsWith(t3.normalizeRoot(root).replace(/\/?$/, '/')) ? null : p;
}
// Returns {ok} or {ok: false, reason} for t3vscode._open (B22); the warning is not awaited, its promise waits for the toast to close.
async function openFile(m, root) {
  if (busy()) return { ok: false, reason: 'busy' };
  const shown = String(m.path).slice(0, 300);
  if (m.relative === true && !root) { log.appendLine(`Open file: no bound project for the relative path ${shown}`); refuse(shown); return { ok: false, reason: 'no bound project' }; }
  const p = resolvePath(m, root);
  let st;
  try { if (p) st = await vscode.workspace.fs.stat(vscode.Uri.file(p)); } catch {}
  if (!st || !(st.type & (vscode.FileType.File | vscode.FileType.Directory))) {
    log.appendLine(`Open file: refused or not found: ${shown}`);
    refuse(shown);
    return { ok: false, reason: 'refused or not found' };
  }
  try {
    const uri = vscode.Uri.file(p);
    // NAV.md section 3: a folder is revealed and expanded, focus stays in the Explorer for the arrow keys. B22: reveal true does that for a file too.
    if (!(st.type & vscode.FileType.File) || m.reveal === true) {
      await vscode.commands.executeCommand('workbench.view.explorer');
      await vscode.commands.executeCommand('revealInExplorer', uri);
      if (!(st.type & vscode.FileType.File)) await vscode.commands.executeCommand('list.expand');
      return OK;
    }
    if (MEDIA.test(p)) await vscode.commands.executeCommand('vscode.open', uri); // VS Code's own viewer: images show as images
    else {
      const line = position(m.line) - 1;
      const col = position(m.column) - 1;
      await vscode.window.showTextDocument(uri, { selection: new vscode.Range(line, col, line, col), preview: m.preview === true }); // agents may ask for a preview tab; chips never do
    }
    if (!vscode.workspace.getWorkspaceFolder(uri)) { log.appendLine(`Open file: ${shown} is outside every workspace folder; the Explorer cannot show it`); return OK; }
    await vscode.commands.executeCommand('revealInExplorer', uri);
    return OK;
  } catch (e) {
    log.appendLine(`Open file: ${shown}: ${e.message}`);
    refuse(shown); // the click was taken from T3's preview: never a dead click
    return { ok: false, reason: e.message };
  }
}

// B20: Alt+click on a T3 diff title (or t3vscode._diff): the file's change in VS Code's diff view.
// git.openChange returns silently for a file with no change in the working tree or index (a committed turn), and throws without the git extension:
// then the active tab is not this file, and the file itself opens instead.
async function openDiff(m, root) {
  if (busy()) return { ok: false, reason: 'busy' };
  const shown = String(m.path).slice(0, 300);
  const p = m.relative === true && !root ? null : resolvePath(m, root);
  if (!p) { log.appendLine(`Diff: refused: ${shown}`); return { ok: false, reason: 'refused' }; }
  const uri = vscode.Uri.file(p);
  const shows = () => { const t = vscode.window.tabGroups.activeTabGroup.activeTab; const u = t && t.input && (t.input.modified || t.input.uri); return !!u && t3.normalizeRoot(u.fsPath) === t3.normalizeRoot(p); };
  let why;
  try {
    await vscode.commands.executeCommand('git.openChange', uri);
    if (shows()) { log.appendLine(`Diff: ${shown}: git.openChange ok`); return OK; }
    why = 'no diff tab (no uncommitted change)';
  } catch (e) { why = `git.openChange threw (${e.message})`; }
  log.appendLine(`Diff: ${shown}: ${why}, so vscode.open`); // test 16: the log names the branch that ran
  try {
    await vscode.commands.executeCommand('vscode.open', uri);
    return OK;
  } catch (e) {
    log.appendLine(`Diff: ${shown}: ${e.message}`);
    return { ok: false, reason: e.message };
  }
}

// R28: every change of the shown thread's repository (its worktree, else the bound root) in VS Code's multi-file diff.
// Status numbers of the git extension's Status enum: added 1, untracked 7, intent to add 9 have no HEAD side; deleted 2 and 6 no working file.
const NO_ORIGINAL = [1, 7, 9];
const NO_MODIFIED = [2, 6];
async function showChanges(panel) {
  const root = panel.root();
  if (!root) return void vscode.window.showInformationMessage('No T3 project bound.');
  try {
    const ext = vscode.extensions.getExtension('vscode.git');
    if (!ext) return void vscode.window.showInformationMessage('T3: the Git extension is not available.');
    const api = (await ext.activate()).getAPI(1); // throws while git is disabled
    const uri = vscode.Uri.file(root);
    const known = api.getRepository(uri);
    const repo = await api.openRepository(uri);
    if (!repo) return void vscode.window.showInformationMessage(`T3: ${root} is not a git repository.`);
    if (!known) log.appendLine(`Show changes: opened the git repository at ${root}; it now shows in Source Control`);
    // A file in the index and the working tree: the first entry says whether HEAD has it, the last whether it is on disk.
    const files = new Map();
    for (const c of [...repo.state.indexChanges, ...repo.state.workingTreeChanges, ...(repo.state.untrackedChanges || [])]) {
      const k = c.uri.fsPath;
      files.set(k, [(files.get(k) || [c])[0], c]);
    }
    if (!files.size) return void vscode.window.showInformationMessage(`T3: no changes in ${root}`);
    const t = panel.seen && panel.seen.get(panel.current);
    const triples = [...files.values()].map(([first, last]) => [last.uri, NO_ORIGINAL.includes(first.status) ? undefined : api.toGitUri(first.originalUri || first.uri, 'HEAD'), NO_MODIFIED.includes(last.status) ? undefined : last.uri])
      .filter((t) => t[1] || t[2]); // added in the index, deleted on disk: no side to show
    if (!triples.length) return void vscode.window.showInformationMessage(`T3: no changes to show in ${root} (files added and deleted again)`);
    await vscode.commands.executeCommand('vscode.changes', `T3: ${t ? titleOf(t) : path.basename(root)}`, triples);
  } catch (e) {
    log.appendLine(`Show changes: ${e.message}`);
    vscode.window.showInformationMessage(`T3: could not show the changes: ${e.message}`);
  }
}

// B12: Alt+click on Copy code in T3: the code replaces the selection in the active editor, or opens as a new untitled document without one.
async function insertCode(text) {
  try {
    const ed = vscode.window.activeTextEditor;
    if (ed) return log.appendLine(await ed.edit((b) => b.replace(ed.selection, text)) ? `Inserted ${text.length} characters from T3` : 'Insert: the editor refused the edit (read-only?)');
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ content: text }));
    log.appendLine(`Inserted ${text.length} characters from T3 into a new document (no editor was active)`);
  } catch (e) { log.appendLine(`Insert: ${e.message}`); }
}

// B18: agents read files from disk, so a prompt sent in T3 first saves what the editors hold. Untitled files are not saved by saveAll(false).
async function saveOnSend() {
  if (vscode.workspace.getConfiguration('t3vscode').get('saveOnSend') === false) return;
  const dirty = vscode.workspace.textDocuments.filter((d) => d.isDirty && !d.isUntitled).length;
  if (!dirty) return;
  try {
    await vscode.workspace.saveAll(false);
    log.appendLine(`Saved ${dirty} file${dirty === 1 ? '' : 's'} before T3 sent the prompt`);
  } catch (e) { log.appendLine(`Save on send: ${e.message}`); }
}

// B19: "Implement with T3" above a comment that starts with TODO or FIXME; the prefix must follow a line start or a space (no http://, no x--).
const TODO_LINE = /(?:^\s*\*|(?:^|\s)(?:\/\/+|#+|--|\/\*+|<!--))\s*(TODO|FIXME)\b:?\s*(.*)/;
function todoLenses(doc) {
  if (vscode.workspace.getConfiguration('t3vscode').get('todoLens') === false) return [];
  const text = doc.getText();
  if (text.length > 200 * 1024) return [];
  const out = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length && out.length < 50; i++) {
    const m = TODO_LINE.exec(lines[i]);
    if (!m) continue;
    const what = m[2].replace(/\s*(\*\/|-->)\s*$/, '').trim() || m[1];
    out.push(new vscode.CodeLens(new vscode.Range(i, 0, i, 0), { title: 'Implement with T3', command: 't3vscode.fixWithT3', arguments: [doc.uri, i + 1, what.slice(0, 120), m[1]] }));
  }
  return out;
}

// docs/QOL.md item 1: T3's own file link (serializeComposerFileLink, packages/shared/src/composerTrigger.ts); T3's parser wants label === basename.
// Inside the thread's root (R5) the path is relative with '/', like T3's file tree; anything else absolute. Null (and one log line) for a non-local uri.
function mentionText(uri, root) {
  const p = uri && uri.scheme === 'file' ? localFilePath(uri.fsPath) : null;
  if (!p) { log.appendLine(`Add to prompt: not a local file: ${String(uri && uri.fsPath).slice(0, 300)}`); return null; }
  const inside = root && t3.normalizeRoot(p).startsWith(t3.normalizeRoot(root).replace(/\/?$/, '/'));
  const target = inside ? path.win32.relative(root, p).replace(/\\/g, '/') : p;
  const label = target.slice(Math.max(target.lastIndexOf('/'), target.lastIndexOf('\\')) + 1).replaceAll('\\', '\\\\').replaceAll('[', '\\[').replaceAll(']', '\\]');
  return `[${label}](${encodeURI(target).replaceAll('(', '%28').replaceAll(')', '%29').replaceAll('#', '%23').replaceAll('?', '%3F').replaceAll('\\', '%5C')})`;
}
// docs/QOL.md item 1: the images T3 attaches itself (packages/contracts/src/chatAttachment.ts: its four mime types, at most 10 MiB each).
const IMAGE_TYPES = { '.gif': 'image/gif', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
const IMAGE_MAX = 10 * 1024 * 1024;
const CLIPPED = "T3 did not take the reference. It is on the clipboard: press Ctrl+V in T3's composer.";
async function clip(text) {
  await vscode.env.clipboard.writeText(text);
  vscode.window.showInformationMessage(CLIPPED);
}

// The secret holds { bearer, expiresAt, scopes }. A plain string is a bearer stored before decision 8.
async function loadSession() {
  const raw = await secrets.get(SECRET);
  try { return raw ? JSON.parse(raw) : null; } catch { return { bearer: raw }; }
}

let tipBase = 'Open T3 Code';
let tipThreads = ''; // docs/QOL.md item 5: one line per running or waiting thread, kept when the session part changes
// R8: what refresh and prebind learned; null is "as today". Module-level so tip() and paint() both keep it.
const BAR = {
  down: { text: 'T3: not running', command: 't3vscode.startT3', tip: 'T3 Code is not running. Click to start it.' },
  unpaired: { text: 'T3: not paired', command: 't3vscode.pair', tip: 'VS Code is not paired with T3 Code. Click to pair. New here? Run T3: Get started.' }, // R9
};
let bar = null;
const tip = (s) => {
  if (s !== undefined) tipBase = s && s.expiresAt ? `Open T3 Code (session ends ${page.date(s.expiresAt)})` : 'Open T3 Code';
  status.tooltip = new vscode.MarkdownString().appendText(bar ? BAR[bar].tip : tipBase + tipThreads); // appendText escapes titles; each \n becomes its own line
};

// Pair, Forget and dispose bump credGen at the call site, so the latest owner action wins. Every write bumps it again.
// Writers capture it before their network work; a stale one writes nothing. Returns the new generation, or false if stale.
// Other VS Code windows share the secret: a background write passes the bearer it replaces and is skipped when the store moved on.
// shortcut: a delete from another window between that read and the store still loses (milliseconds), upgrade to a lock file if it shows up.
let credGen = 0;
let queue = Promise.resolve();
let lastWrite; // what this window wrote last (null: deleted), to tell its own secret change events from other windows'
function saveCred(gen, s, expect) {
  const run = async () => {
    if (gen !== credGen) return false;
    if (expect !== undefined && ((await loadSession()) || {}).bearer !== expect) return false;
    if (gen !== credGen) return false;
    const mine = ++credGen; // a new credential: writers still holding the old one are stale now
    tip(s);
    lastWrite = s ? JSON.stringify(s) : null;
    await (s ? secrets.store(SECRET, lastWrite) : secrets.delete(SECRET));
    return mine === credGen && mine; // a Pair or Forget during the store wins: no side effects for this one
  };
  return (queue = queue.then(run, run)); // one write at a time; a failed store does not block later ones
}

// The picker, the poll, the shim and a refresh fetch the same bind's threads: a response older than the newest one applied gives way to that one.
async function threadsOf(b) {
  const n = (b.asked = (b.asked || 0) + 1);
  const r = await t3.threadsFor(b);
  if (n > (b.applied || 0)) Object.assign(b, { applied: n, last: r });
  return b.last;
}

class Panel {
  constructor() {
    Object.assign(this, { view: null, editor: null, pages: new Set(), fwd: null, seq: 0, poll: null, misses: 0, starting: false, wantFocus: false, acted: false, checked: 0, answered: new Set(),
      later: null, terms: [], running: new Set(), toasted: new Map(), ready: new Set(), at: new Map(), want: new Map() });
  }

  // R1: a command that needs the bound, loaded panel waits in one slot (the newest wins); adopt() and frameLoaded run it, 15 s drop it.
  defer(job) {
    clearTimeout(this.laterTimer);
    this.later = job;
    if (this.pages.size && !this.bind && this.kind !== 'connecting') return this.drop(job); // a finished page without a bound project binds no more: today's answer at once
    this.laterTimer = setTimeout(() => this.drop(job), 15000);
    this.drain();
  }

  drop(job) {
    if (this.later !== job) return;
    this.later = null;
    if (job.kind === 'mention') clip(job.text);
    else log.appendLine(`T3 has no bound project for ${job.kind}; dropped`);
  }

  drain() {
    const job = this.later;
    if (!job || !this.bind || !this.pages.size || !this.ready.has(this.front())) return; // the page it goes to has its frame up
    this.later = null;
    clearTimeout(this.laterTimer);
    if (job.kind === 'mention') this.send(job.text);
    else if (job.kind === 'newThread') this.startThread(this.bind, this.front());
    else if (job.kind === 'newThreadIn') this.threadIn(job.folder);
    else if (job.kind === 'openPicker') this.post({ type: 'openPicker' }, this.front());
    else if (job.kind === 'go') this.goTo(job.env, job.id);
  }

  // B13 and R1: a thread of this window's environment, or one log line; the env is compared, not the bind (a refresh may have made a new one).
  goTo(env, id) {
    if (this.bind && this.bind.env && this.bind.env === env && THREAD_ID.test(id)) return this.go(id);
    log.appendLine(`Link: not a thread of this window's project: /thread/${String(env).slice(0, 80)}/${String(id).slice(0, 100)}`);
  }

  resolveWebviewView(view) {
    this.view = view;
    this.attach(view);
    view.onDidChangeVisibility(() => this.visible());
    this.refresh();
  }

  // B32: T3 in an editor tab, the same page as the side view; a second open shows the tab that is there.
  openEditor() {
    if (this.editor) return this.editor.reveal();
    const tab = (this.editor = vscode.window.createWebviewPanel('t3vscode.editor', 'T3 Code', vscode.ViewColumn.Beside, { enableScripts: true, retainContextWhenHidden: true }));
    this.attach(tab);
    tab.onDidChangeViewState(() => this.visible());
    this.refresh(); // renders every page: the side view's frame loads again too
  }

  // B32: the side view and the editor tab are pages of one panel: the same html, the same messages. The last page gone stops what serves them.
  attach(host) {
    this.pages.add(host);
    host.webview.options = { enableScripts: true };
    host.webview.onDidReceiveMessage((m) => this.handle(m, host));
    this.visible();
    host.onDidDispose(() => {
      for (const s of [this.pages, this.ready, this.at, this.want]) s.delete(host);
      if (host === this.view) this.view = null;
      if (host === this.editor) this.editor = null;
      if (!this.pages.size) { this.seq++; this.stopPoll(); this.watch(0); this.paint([]); this.closeForwarder(); } // seq++ invalidates any refresh still awaiting
      this.visible();
    });
  }

  // B1: Alt+K is ours only while a page shows; Claude Code's otherwise. Ctrl+Alt+C (focusComposer) collides with nothing, so it is not gated.
  visible() { setContext('t3vscode.panelVisible', [...this.pages].some((p) => p.visible)); }

  // B32: where a command's action goes: a page on screen, the side view first (most commands focus it); state messages go to every page.
  front() { const all = [this.view, ...this.pages].filter(Boolean); return all.find((p) => p.visible) || all[0]; }

  // Messages from a page; host is the page that sent it, so an answer or an action it asked for goes back to that page only.
  handle(m, host) {
    if (m.cmd === 'reload' || m.cmd === 'check') { this.acted = true; this.refresh(); }
    else if (m.cmd === 'start') vscode.commands.executeCommand('t3vscode.startT3');
    else if (m.cmd === 'forget') vscode.commands.executeCommand('t3vscode.forget');
    else if (m.cmd === 'openDesktop') vscode.commands.executeCommand('t3vscode.openInDesktop');
    else if (m.cmd === 'showLogs') vscode.commands.executeCommand('t3vscode.showLogs'); // R17
    else if (m.cmd === 'clipboard') this.prefill(host);
    else if (m.cmd === 'copyLink') vscode.commands.executeCommand('t3vscode.copyThreadLink'); // R22
    else if (m.cmd === 'pair') this.pair(String(m.value || ''), host);
    else if (m.cmd === 'openFile') openFile(m, this.root(host)); // B32: the thread this page shows
    else if (m.cmd === 'openDiff') openDiff(m, this.root(host));
    else if (m.cmd === 'sent') saveOnSend();
    else if (m.cmd === 'insert' && typeof m.text === 'string') insertCode(m.text.slice(0, 65536));
    else if (m.cmd === 'run' && typeof m.text === 'string') this.run(m.text.slice(0, 16384), this.root(host));
    else if (m.cmd === 'notify' && typeof m.title === 'string') this.notify(m);
    else if (m.cmd === 'clickDebug') log.appendLine(`Click in T3 (no file chip): ${String(m.text).slice(0, 500)}`);
    else if (m.cmd === 'log') log.appendLine(`Panel: ${String(m.text).slice(0, 200)}`);
    else if (m.cmd === 'frameLoaded') {
      this.ready.add(host);
      this.theme();
      this.settings();
      if (this.queued && this.queued.to === host) { const { text } = this.queued; this.queued = null; clearTimeout(this.queueTimer); this.send(text, host); }
      if (this.newThread) { this.startThread(this.newThread, host); this.newThread = null; } // once per render, in the first page that loaded
      this.drain();
    } else if (m.cmd === 'newThreadFailed') log.appendLine("Project: T3 did not open the first thread; the card asks to pick it in T3's search box");
    else if (m.cmd === 'newThread' && this.bind) this.startThread(this.bind, host);
    else if (m.cmd === 'threads' && this.bind) this.threads();
    else if (m.cmd === 'openThread' && this.bind && this.bind.env && typeof m.id === 'string' && THREAD_ID.test(m.id)) this.go(m.id);
    else if (m.cmd === 'location' && this.bind && this.bind.env && typeof m.pathname === 'string') {
      // Only /<this environment>/<thread>: /settings/general has two segments too.
      const [, env, id] = /^\/([^/]+)\/([^/]+)$/.exec(m.pathname) || [];
      let same = false;
      try { same = !!env && decodeURIComponent(env) === this.bind.env; } catch {}
      this.landed(host, same && THREAD_ID.test(id) ? id : null);
      // The owner just acted: a run may have started or a request been answered. T3's router reports every history change, so at most one fetch per 2 s from here.
      if (!this.fetching && Date.now() - (this.lastLoc || 0) >= 2000) { this.lastLoc = Date.now(); this.activity(); }
    } else if (m.cmd === 'mentionResult' && this.pending) { // one result per mention sent; the page cannot trigger clipboard writes on its own
      const text = this.pending;
      this.pending = null;
      if (m.ok === true) vscode.commands.executeCommand('t3vscode.focusComposer');
      else clip(text);
    } else if (m.cmd === 'dropped' && Array.isArray(m.uris)) {
      // docs/QOL.md item 1 drop and pasted paths. text/plain carries absolute paths, which Uri.parse would read as scheme "d".
      const uris = m.uris.slice(0, 50).filter((s) => typeof s === 'string').map((s) => {
        try { return /^[A-Za-z]:[\\/]/.test(s) ? vscode.Uri.file(s) : vscode.Uri.parse(s); } catch { return null; }
      }).filter(Boolean);
      this.addUris(uris, host); // B32: into the page it was dropped on
    } else if (m.cmd === 'attachResult' && m.ok === false) log.appendLine('Attach: T3 has no drop target on this page; the image did not go in');
    else if (m.cmd === 'hint') {
      log.appendLine('Drag: the drag left the panel at once (no Shift held?); hint shown');
      vscode.window.showInformationMessage('Hold Shift while dragging files into T3 Code.');
    } else if (m.cmd === 'key' && typeof m.key === 'string' && Object.hasOwn(KEY_COMMANDS, m.key)) vscode.commands.executeCommand(KEY_COMMANDS[m.key]);
  }

  // To every page, or only to the page to (one still open). Actions take a page: two frames would each start the thread or insert the mention.
  post(m, to) { for (const p of this.pages) if (!to || p === to) p.webview.postMessage(m); }

  // R5: where the thread works (its worktree or its own project's root, from threadsFor): its relative chips, diff titles, mentions and terminal; no bind, no root.
  // B32: a page's own confirmed thread until the other page's switch reaches it; no page, the current thread.
  root(host) {
    const id = (host && this.at.get(host)) || this.current;
    return this.bind && ((this.roots && this.roots.get(id)) || this.bind.root);
  }

  // B32: a page reported its thread (null: not a thread of this window). An accepted switch moves the other pages; a page still on its way to a synced thread does not bounce it back.
  landed(host, id) {
    const w = this.want.get(host);
    const was = this.at.get(host);
    this.at.set(host, id);
    if (w && id !== w.id && (was === undefined || id === was) && Date.now() < w.until) return; // it still reports the thread it is leaving (or its first, after a render)
    this.want.delete(host);
    if (id) id === this.current ? this.remember(id) : this.go(id, host);
  }

  // A new T3 thread in the project b ({root, title}): the toolbar's plus button, the palette command and a fresh project's first thread.
  startThread(b, to) { this.post({ type: 't3vscode:new-thread', root: b.root, title: b.title }, to); }

  // R13: a thread in another folder of the window. T3's spelling of root and title: the palette row and the header must match them exactly.
  async threadIn(folder) {
    const b = this.bind;
    const s = await loadSession();
    const r = await t3.ensureProject({ origin: b.origin, bearer: b.bearer, folder, scopes: s && s.scopes });
    if (r.root) return this.startThread(r, this.front());
    log.appendLine(`New thread in: ${r.note}`);
    vscode.window.showWarningMessage(r.note || `T3 is not on ${folder}.`);
  }

  // docs/QOL.md item 8: T3's own light or dark mode follows VS Code's theme kind (the frame cannot see VS Code's theme classes).
  theme() {
    if (vscode.workspace.getConfiguration('t3vscode').get('followTheme') === false) return; // R16: T3 keeps its own choice
    const k = vscode.window.activeColorTheme.kind;
    this.post({ type: 't3vscode:theme', kind: k === vscode.ColorThemeKind.Light || k === vscode.ColorThemeKind.HighContrastLight ? 'light' : 'dark' });
  }

  // B9: the frame's script takes Run in terminal only with runInTerminal 'vscode' (also unset); a new script starts with 'vscode'.
  settings() {
    const c = vscode.workspace.getConfiguration('t3vscode');
    const keys = c.get('keysToVsCode'); // R24: the frame relays only these names
    this.post({ type: 't3vscode:settings', runInTerminal: c.get('runInTerminal') === 't3' ? 't3' : 'vscode', ...(Array.isArray(keys) ? { keys: keys.filter((k) => typeof k === 'string') } : {}) });
  }

  // B9: a code block's command goes into a VS Code terminal without Enter: the owner reads it and runs it. T3 shows the button for one-line commands only.
  run(text, root) {
    if (!text || /[\x00-\x1f\x7f]/.test(text)) return log.appendLine('Run in terminal: ignored a command that is empty or has control characters');
    // R4: our own terminals only ("T3", "T3 2", ...), never the active one; one whose command still runs (shell integration) is skipped. R5: one started in the thread's root.
    const cwd = root || undefined;
    let term = this.terms.find((t) => !this.running.has(t) && t.creationOptions.cwd === cwd);
    if (!term) this.terms.push((term = vscode.window.createTerminal({ name: this.terms.length ? `T3 ${this.terms.length + 1}` : 'T3', cwd })));
    term.show(false);
    term.sendText(text, false);
    log.appendLine(`Run in terminal: ${text.length} characters into the terminal ${term.name}, not run`);
  }

  // The owner is not looking at the panel: it is hidden, gone, or the window is not focused (QOL item 5 and B11).
  away() { return ![...this.pages].some((p) => p.visible) || vscode.window.state.focused === false; }

  // B11: T3's own notification rules (its Settings, Notifications; off by default) through the frame's Notification shim. The log line always.
  // R2: only a thread of this window's last list; T3's tag is `${environmentId}:${thread.id}` and its body the thread title (ThreadNotificationCoordinator.tsx:216-218).
  async notify(m) {
    const [title, body, tag] = [m.title, m.body, m.tag].map((x) => (typeof x === 'string' ? x.slice(0, 300) : ''));
    log.appendLine(`T3 notification: ${title}`);
    const notify = vscode.workspace.getConfiguration('t3vscode').get('notify');
    // Approval needed: ours (ask) has the buttons. needsYou keeps only T3's other two needs-you titles.
    const quiet = !this.away() || notify === 'off' || title === 'Approval needed' || (notify === 'needsYou' && title !== 'Input needed' && title !== 'Usage limit reached');
    // R2: the shim's event is newer than the last poll; a fresh list names its run or request (and lets the poll announce it first with its richer text).
    const b = this.bind;
    if (!quiet && b) this.track(b, await threadsOf(b));
    const seen = this.seen || new Map();
    const id = tag.includes(':') ? tag.slice(tag.lastIndexOf(':') + 1) : body && [...seen].find(([, t]) => t.title === body)?.[0];
    if (!id || !seen.has(id)) return log.appendLine('T3 notification: not a thread of this window, not shown');
    if (quiet) return;
    const t = seen.get(id);
    if (!this.toast(`${id}:${title === 'Input needed' ? t.requestId : t.run}`)) return;
    // MessageOptions.detail shows only in modal messages, so the body (the thread title) goes into the text.
    vscode.window.showInformationMessage(body ? `T3: ${title}: ${body}` : `T3: ${title}`, 'Show').then(async (a) => {
      if (a !== 'Show') return;
      await vscode.commands.executeCommand('t3vscode.panel.focus');
      this.post({ type: 't3vscode:notify-click', tag }, this.front());
    });
  }

  // R2: true (and recorded) when this event (`<thread>:<request id>` for a wait, `<thread>:<run id>` for a run's end) got no toast from the shim or the poll in the last 10 s.
  toast(key) {
    const now = Date.now();
    for (const [k, t] of this.toasted) if (now - t >= 10000) this.toasted.delete(k);
    if (this.toasted.has(key)) return false;
    this.toasted.set(key, now);
    return true;
  }

  // docs/QOL.md item 1: dropped, pasted or "Add to prompt" uris. A local gif, jpeg, png or webp up to 10 MiB goes in as a T3 image attachment
  // (T3's own file drop); everything else as one mention, and so does an image on a page with no thread yet (T3 drops attachments there silently).
  async addUris(uris, host) {
    const to = host || this.front();
    const id = to && this.at.has(to) ? this.at.get(to) : this.current; // null: the page is on a draft or settings, undefined: it has not reported yet
    const texts = [];
    const files = [];
    for (const u of uris) {
      const text = mentionText(u, this.root(host));
      if (!text) continue;
      const type = IMAGE_TYPES[path.win32.extname(u.fsPath).toLowerCase()];
      const name = path.win32.basename(u.fsPath);
      if (type) {
        try {
          if ((await vscode.workspace.fs.stat(u)).size > IMAGE_MAX) log.appendLine(`image ${name}: larger than 10 MiB, added as a link`);
          else if (!to || !this.ready.has(to)) log.appendLine(`image ${name}: T3 is not loaded yet, added as a link`);
          else if (!id) log.appendLine(`image ${name}: no thread yet, added as a link; send a first message, then drop it again`);
          else { files.push({ name, type, data: Buffer.from(await vscode.workspace.fs.readFile(u)).toString('base64') }); continue; }
        } catch (e) { log.appendLine(`image ${name}: ${e.message}, added as a link`); }
      }
      texts.push(text);
    }
    if (files.length) this.post({ type: 't3vscode:attach', files }, to);
    if (texts.length) return this.mention(texts.join(' '), host); // one insert: T3's parser chips every space-separated link
  }

  // docs/QOL.md items 1 and 4: into T3's composer through the frame; no bound project within 15 s of opening the panel (R1): the clipboard.
  // The frame's script is not there before frameLoaded: one queued text (the newest wins), clipped after 10 s so nothing is lost silently.
  async mention(text, to) {
    if (!this.pages.size || !this.bind) await vscode.commands.executeCommand('t3vscode.panel.focus');
    if (!this.pages.size || !this.bind) return this.defer({ kind: 'mention', text });
    to = to || this.front(); // B32: it waits for this page's frame, not another's
    if (this.ready.has(to)) return this.send(text, to);
    const q = (this.queued = { text, to });
    clearTimeout(this.queueTimer);
    this.queueTimer = setTimeout(() => { if (this.queued === q) { this.queued = null; clip(text); } }, 10000);
  }

  send(text, to = this.front()) {
    this.pending = text;
    this.post({ type: 't3vscode:mention', text }, to);
  }

  // NAV.md section 1: the thread the owner is in, kept per project root so Reload and a restart land on it.
  remember(id) {
    this.current = id;
    workspaceState.update(this.bind.key, id).then(undefined, (e) => log.appendLine(`Thread store: ${e.message}`));
  }

  // A thread of this window in the frames, through T3's router (panel.js); bind and bind.env checked by the caller.
  // B32: every page not already there (from: the page that switched itself), each awaited for 3 s by landed().
  go(id, from) {
    for (const p of this.pages) {
      if (p === from || this.at.get(p) === id) continue;
      this.want.set(p, { id, until: Date.now() + 3000 });
      this.post({ type: 'navigate', path: `/${encodeURIComponent(this.bind.env)}/${id}` }, p);
    }
    this.remember(id);
  }

  async threads() {
    const b = this.bind;
    const r = await threadsOf(b);
    if (r.note) log.appendLine(r.note);
    if (b !== this.bind) return; // a newer refresh bound something else
    if (r.environmentId) b.env = r.environmentId;
    this.post({ type: 'threads', items: r.items, current: this.current });
    this.listSig = listSig(r.items);
    this.track(b, r);
  }

  // docs/QOL.md item 5: this window's thread activity. One interval, 4 s while a thread runs or waits, else 30 s; watch(0) stops it.
  watch(ms) {
    if (this.watchMs === ms) return;
    clearInterval(this.watchTimer);
    this.watchMs = ms;
    this.watchTimer = ms ? setInterval(() => this.activity(), ms) : null;
  }

  async activity() {
    const b = this.bind;
    if (!b || this.fetching) return; // never two fetches at once; B7: also without the view (status bar)
    this.fetching = true;
    try { this.track(b, await threadsOf(b)); } finally { this.fetching = false; }
  }

  // The first list after a bind is the baseline: requests already pending then are not announced.
  track(b, r) {
    if (b !== this.bind) return;
    if (r.note) return this.watch(this.watchMs || 30000); // a failed fetch says nothing about the threads: keep the last picture
    this.roots = new Map(r.items.filter((t) => t.root).map((t) => [t.id, t.root])); // R5
    const seen = new Map(r.items.map((t) => [t.id, { active: t.active, status: t.status, requestId: t.requestId, run: t.run, title: t.title }])); // R2: notify() reads ids, titles and event ids
    const away = this.away();
    const notify = vscode.workspace.getConfiguration('t3vscode').get('notify'); // B26: all (also unset), needsYou or off
    if (this.seen && away && notify !== 'off') {
      for (const t of r.items) {
        const was = this.seen.get(t.id);
        const name = titleOf(t);
        // activeRunId is any interruptible run (ProjectionStore.ts), so a failed latest run can stay "active": warn on the change only.
        const failed = was && was.active && was.status !== 'failed' && t.status === 'failed';
        const ended = was && was.active && !t.active && t.status !== 'failed';
        const run = `${t.id}:${t.run}`; // R2: a run ends once
        if (t.requestId && t.requestId !== (was && was.requestId)) this.ask(b, t, name);
        // R25: a usage limit and a plan to review need the owner, so notify needsYou keeps them too.
        else if (failed && t.limitedUntil) { if (this.toast(run)) this.announce(b, t.id, vscode.window.showWarningMessage(`T3: ${name} hit the usage limit, resets ${hhmm(t.limitedUntil)}`, 'Show')); }
        else if (ended && t.plan) { if (this.toast(run)) this.announce(b, t.id, vscode.window.showInformationMessage(`T3: ${name} has a plan to review`, 'Show')); }
        else if (notify === 'needsYou') continue;
        else if (failed) { if (this.toast(run)) this.announce(b, t.id, vscode.window.showWarningMessage(`T3: ${name} failed${t.error ? `: ${t.error}` : ''}`, 'Show')); }
        else if (ended && this.toast(run)) this.announce(b, t.id, vscode.window.showInformationMessage(`T3: ${name} finished${t.said ? `: ${t.said}` : ''}`, 'Show')); // B2, R2
      }
    }
    // Tests 11 and 17: a new or renamed thread reaches the header without the picker; the first list after a bind is in the render.
    const sig = listSig(r.items);
    if (this.seen && sig !== this.listSig) this.post({ type: 'threads', items: r.items, current: this.current });
    this.listSig = sig;
    this.seen = seen; // ids gone from the list drop out here
    this.paint(r.items);
    this.watch(r.items.some((t) => t.active || t.needsYou) ? 4000 : 30000);
  }

  async announce(b, id, answer) {
    if ((await answer) !== 'Show') return;
    await vscode.commands.executeCommand('t3vscode.panel.focus');
    if (b.env) this.defer({ kind: 'go', env: b.env, id }); // R1: a panel that was closed binds after the focus
  }

  // B14: an approvable request shows what it asks, with Approve, Deny and Show; any other kind, or one T3 tells us nothing about, keeps Show only.
  async ask(b, t, name) {
    const first = this.toast(`${t.id}:${t.requestId}`); // R2: recorded before the awaits, so the shim's toast for this request waits; an approvable one shows anyway (its buttons)
    const plain = () => first && this.announce(b, t.id, vscode.window.showInformationMessage(`T3: ${name} waits for you`, 'Show')); // R2
    if (!Object.hasOwn(APPROVABLE, t.kind)) return plain();
    const r = await t3.pendingRequest({ origin: b.origin, bearer: b.bearer, threadId: t.id, requestId: t.requestId });
    const s = await loadSession().catch(() => null);
    if (b !== this.bind) return;
    if (r.note || !Object.hasOwn(APPROVABLE, r.kind)) { if (r.note) log.appendLine(r.note); return plain(); }
    // A command without its command_execution item shows the prompt as a reason, Show only: the prompt may not be what runs (review 2026-10-13).
    const fold = (x) => String(x).replace(/\s+/g, ' ').trim();
    const detail = fold(r.command || (r.prompt && r.kind === 'command' ? `reason: ${r.prompt}` : r.prompt)).slice(0, 200);
    // APPROVE.md step 3: a button only for a decision the request offers; the provider's warnings in full (only VS Code may cut the toast).
    const offers = [(r.decisions || []).includes('accept') && 'Approve', (r.decisions || []).includes('decline') && 'Deny'].filter(Boolean);
    const why = !(s && Array.isArray(s.scopes) && s.scopes.includes('orchestration:operate')) ? 'this pairing lacks orchestration:operate'
      : typeof globalThis.WebSocket !== 'function' ? 'this VS Code has no WebSocket client'
        : !r.live ? 'T3 cannot pass an answer on right now' : !detail ? 'no request text' : r.kind === 'command' && !r.command ? 'no command item for this command request'
          : !offers.length ? 'the request offers neither accept nor decline' : this.answered.has(t.requestId) ? 'already answered from this window' : null;
    if (why) log.appendLine(`Approve from the notification: Show only for ${name}: ${why}`);
    const app = r.app ? ` from ${fold(r.app).slice(0, 60)}` : '';
    const text = `T3: ${name} needs approval (${APPROVABLE[r.kind]}${app})${detail ? `: ${detail}` : ''}${(r.warnings || []).map((w) => ` Warning: ${fold(w)}`).join('')}`;
    const a = await vscode.window.showInformationMessage(text, ...(why ? [] : offers), 'Show');
    if (a === 'Approve' || a === 'Deny') return this.answer(b, t, a === 'Approve' ? 'accept' : 'decline');
    return this.announce(b, t.id, a);
  }

  // B14: a request in flight takes no second click; only an answer T3 took (or refused as already answered) locks it for good.
  // A failure frees it and offers Retry, which reads the request anew (ask) instead of replaying an answer whose outcome is unknown.
  async answer(b, t, decision) {
    const sending = (this.sending ||= new Set());
    if (this.answered.has(t.requestId)) return void vscode.window.showInformationMessage('Already answered in T3');
    if (sending.has(t.requestId)) return void vscode.window.showInformationMessage('An answer to this request is on its way to T3');
    sending.add(t.requestId);
    let r;
    try { r = await t3.respond({ origin: b.origin, bearer: b.bearer, threadId: t.id, requestId: t.requestId, decision }); } finally { sending.delete(t.requestId); }
    log.appendLine(`Answer ${decision} for ${titleOf(t)}: ${r.outcome}${r.reason ? `: ${r.reason}` : ''}`);
    if (r.outcome !== 'failed') this.answered.add(t.requestId);
    if (r.outcome === 'accepted') return this.activity(); // the badge clears with the next list
    if (r.outcome === 'answered') return void vscode.window.showInformationMessage('Already answered in T3');
    const a = await vscode.window.showWarningMessage(`T3 could not answer for ${titleOf(t)}: ${r.reason}`, 'Retry', 'Show');
    return a === 'Retry' ? this.ask(b, t, titleOf(t)) : this.announce(b, t.id, a);
  }

  // Status bar text and tooltip lines, view badge. paint([]) is idle.
  paint(items) {
    const wait = items.filter((t) => t.needsYou);
    const run = items.filter((t) => t.active && !t.needsYou);
    status.text = bar ? BAR[bar].text : wait.length ? '$(warning) T3: needs you' : run.length ? `$(sync~spin) T3: ${run.length > 1 ? `${run.length} ` : ''}running` : 'T3';
    status.command = bar ? BAR[bar].command : 't3vscode.open'; // R8: the click does the next step
    status.backgroundColor = wait.length ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
    tipThreads = [...wait.map((t) => `\n${titleOf(t)}: waits for you`), ...run.map((t) => `\n${titleOf(t)}: running`),
      ...items.filter((t) => t.limitedUntil).map((t) => `\n${titleOf(t)}: usage limit until ${hhmm(t.limitedUntil)}`), // R25
      ...items.filter((t) => t.unread && !t.active && !t.needsYou && !t.limitedUntil).map((t) => `\n${titleOf(t)}: done, not read yet`)].join(''); // R27
    tip();
    if (this.view) this.view.badge = wait.length ? { value: wait.length, tooltip: `${wait.length} thread${wait.length === 1 ? ' needs' : 's need'} you` } : undefined;
  }

  // R8: down, unpaired or null (as today), from where refresh and prebind learn it.
  setBar(s) { bar = s; this.paint([]); }

  // R10: the page asks while its pairing field is empty; only text shaped like a T3 pairing link or code goes back, never sent by itself.
  async prefill(host) {
    let text = '';
    try { text = String(await vscode.env.clipboard.readText()).trim(); } catch {}
    if (text.length < 2000 && t3.pairingText(text)) this.post({ type: 'prefill', value: text }, host);
  }

  // A failure is posted, not re-rendered, so the field keeps what the owner pasted.
  async pair(value, host) {
    try {
      const token = t3.tokenFromLink(value);
      if (!token) throw new Error('No pairing link or code found in what you pasted.');
      const { origin } = t3.discover();
      const gen = ++credGen; // claimed before the exchange: a later Pair or Forget wins
      const r = await t3.exchange(origin, token, 'VS Code');
      if (!(await saveCred(gen, r))) return;
      log.appendLine(`Paired with ${origin}; ${r.scopes.length} scopes; session ends ${r.expiresAt}`);
      this.closeForwarder();
      this.refresh();
    } catch (e) {
      log.appendLine(`Pairing: ${e.code || 'error'}: ${e.message}`); // the raw (redacted) refusal stays here
      this.post({ type: 'error', text: e.code === 'exchange-failed' && [400, 401, 403].includes(e.status) ? WRONG_CODE : e.message }, host);
    }
  }

  closeForwarder() { if (this.fwd) this.fwd.close(); this.fwd = null; }

  stopPoll() { clearInterval(this.poll); this.poll = null; }

  // While "T3 is not running" shows, probe quietly (a refresh each tick would flash "Connecting"); a stopped poll's late probe does nothing.
  // R8: also with the panel closed (prebind starts it), so the status bar does not keep saying "not running".
  startPoll() {
    if (this.poll) return;
    const poll = (this.poll = setInterval(() => Promise.resolve().then(() => t3.session(t3.discover().origin))
      .then(() => { setContext('t3vscode.running', true); if (this.poll === poll) this.refresh(); }, () => {}), 10000)); // R9: also with the panel closed
  }

  // Three dead upstream answers in a row: T3 stopped or moved to a new port.
  upstream(e) {
    log.appendLine(`${e.kind} ${e.method} ${e.path} -> ${e.status}`);
    if (e.kind === 'http' && !e.own && e.status === 401) this.revalidate(); // an upgrade 401 goes through upgradeFailed
    this.misses = e.own || e.status === 0 ? this.misses + 1 : 0; // T3's own 502s (unfetchable images) are answers, not misses
    if (this.misses >= 3 && this.fwd) { this.misses = 0; this.closeForwarder(); this.refresh(); }
  }

  // A 401 may mean T3 revoked the session; ask at most once per 30 s. A 403 is a missing scope, never revocation.
  async revalidate() {
    if (Date.now() - this.checked < 30000) return undefined;
    this.checked = Date.now();
    try {
      const s = await loadSession();
      const ok = s && (await t3.session(t3.discover().origin, s.bearer)).authenticated;
      if (s && !ok) this.refresh(); // its revoked branch does the guarded clear and shows "session ended"
      return s ? !!ok : undefined;
    } catch (e) { log.appendLine(`Session check: ${e.code || 'error'}: ${e.message}`); }
  }

  // B7: the status bar and badge work before the panel opens. Bind the first folder without the view: no forwarder, no render.
  // The promise is set at once, so a refresh that starts meanwhile takes it (once) instead of binding a second time.
  // R8: the status bar learns down or unpaired here too (discover first, as refresh does), also without a folder; a refresh that started meanwhile owns it.
  prebind() {
    const folder = firstFolder();
    const mine = (s) => { if (this.early !== p) return; this.setBar(s); if (s === 'down') this.startPoll(); else this.stopPoll(); };
    const p = (async () => {
      const { origin } = t3.discover();
      const s = await loadSession();
      if (!s || !s.bearer || (s.expiresAt && Date.parse(s.expiresAt) <= Date.now())) return void mine('unpaired');
      // A stale runtime file names a dead port and ensureProject would only note it: ask T3 first; no answer throws into down and the poll.
      if (!(await t3.session(origin, s.bearer)).authenticated) return void mine('unpaired');
      mine(null);
      if (!folder) return null;
      // Read only while the panel is closed: a project is created when the owner opens the panel, never at startup behind their back.
      const r = await this.bindProject(origin, { ...s, scopes: (s.scopes || []).filter((x) => x !== 'orchestration:operate') }, folder);
      return { ...r, bearer: s.bearer, origin };
    })().catch((e) => {
      if (e.code === 'no-runtime-file' || e.code === 'no-answer') mine('down');
      log.appendLine(`Project (panel closed): ${e.code || 'error'}: ${e.message}`);
      return null;
    });
    this.early = p;
    return p.then((r) => { if (this.early === p && r && r.b) this.adopt(r); }); // a refresh that took it binds itself
  }

  // Row 1 of docs/SYNC.md: T3 on the project of this window's folder, and its threads. ensureProject never throws and is bounded to 8 s. Null: stale.
  async bindProject(origin, s, folder, live = () => true) {
    const key = 't3vscode.thread.' + t3.normalizeRoot(folder);
    const bind = await t3.ensureProject({ origin, bearer: s.bearer, folder, scopes: s.scopes, preferThread: workspaceState.get(key) });
    if (!live()) return null;
    log.appendLine(`Project: ${folder} -> ${bind.path}${bind.note ? ` (${bind.note})` : ''}`);
    if (!bind.root) return { key, bind };
    const b = { origin, bearer: s.bearer, folders: localFolders(), project: bind.root, root: bind.root, title: bind.title, key, env: null };
    return this.listFor({ key, bind, b }, live);
  }

  async listFor(r, live) {
    const list = await threadsOf(r.b); // a reused bind's watch may be fetching too
    if (!live()) return null;
    if (list.note) log.appendLine(list.note);
    return { ...r, list };
  }

  // A bindProject result becomes the bind (NAV.md section 1, the thread bar) and feeds the status bar.
  adopt({ bind, b, list }) {
    const seg = bind.path.split('/'); // ours, from encodeURIComponent: decode cannot throw
    this.current = seg[2] ? decodeURIComponent(seg[2]) : null;
    b.env = list.environmentId || (seg[1] ? decodeURIComponent(seg[1]) : null);
    this.bind = b;
    this.track(b, list);
    this.drain(); // R1: runs now only on a loaded page; refresh renders after this, so mostly its frameLoaded runs it
  }

  async refresh() {
    const early = this.early; // B7: a bind from while the panel was closed, reused once below
    this.early = null;
    this.bind = null; // set again only when this refresh binds a project
    this.watch(0);
    this.seen = null;
    this.paint([]);
    if (!this.pages.size) return this.prebind(); // B7: Forget, another window, a folder change or a renewal while the panel is closed
    const seq = ++this.seq;
    const gen = credGen;
    this.stopPoll();
    // Re-checked after every await: a stale refresh must not touch the forwarder a newer one installed.
    const live = () => seq === this.seq && this.pages.size;
    // The pair command's request focuses in any state (paired: opens Details); a click focuses only the pair field.
    const show = (st) => {
      if (!live()) return;
      if (st.kind !== 'connecting') { st.focus = this.wantFocus || (this.acted && st.kind === 'unpaired'); this.wantFocus = this.acted = false; }
      this.newThread = st.newThread || null;
      this.kind = st.kind; // R1: a deferred command waits only while this is connecting
      if (st.kind !== 'connecting' && !this.bind && this.later) this.drop(this.later); // a page without a bound project: today's answer now, not after 15 s
      for (const s of [this.ready, this.at, this.want]) s.clear(); // new pages: no frame loaded yet, each on the render's thread
      const html = page.render(st);
      for (const p of this.pages) p.webview.html = html; // B32: the side view and the editor tab show the same page
    };
    show({ kind: 'connecting' });
    try {
      const { origin } = t3.discover();
      const s = await loadSession();
      if (!live()) return;
      const state = await t3.session(origin, s && s.bearer);
      setContext('t3vscode.running', true); // R9: T3 answered; the walkthrough's Start step completes on it
      if (!live()) return;
      if (!s || !state.authenticated) {
        setContext('t3vscode.paired', false);
        this.closeForwarder();
        this.setBar('unpaired');
        if (!s) return show({ kind: 'unpaired', origin });
        // Revoked or expired. Clear only if the store still holds this bearer (read here so a slow read does not hold the write queue, and again inside it for other windows).
        if (((await loadSession()) || {}).bearer === s.bearer) await saveCred(gen, null, s.bearer);
        if (!live()) return;
        return show({ kind: 'unpaired', origin, ended: true });
      }
      this.setBar(null);
      setContext('t3vscode.paired', true); // R9: the Pair step completes on a session T3 accepted, not on the command
      vscode.commands.executeCommand('t3vscode._mcpNudge').then(undefined, (e) => log.appendLine(`MCP nudge: ${e.message}`)); // R18: context.js asks once per window
      if (!this.fwd || this.fwd.origin !== origin) {
        this.closeForwarder();
        // A closed forwarder's late events must not count against its successor.
        const mine = (fn) => (x) => { if (fwd === this.fwd) fn.call(this, x); };
        const kept = workspaceState.get(PORT_KEY);
        const port = sessionPort || (PORTS.includes(kept) ? kept : PORTS[0]);
        const fwd = await t3.startForwarder({ origin, token: s.bearer, port, spare: PORTS.filter((p) => p !== port), onUpgradeFailure: mine(this.upgradeFailed), onRequest: mine(this.upstream) });
        if (!live()) return fwd.close();
        this.fwd = Object.assign(fwd, { origin, warned: false });
        sessionPort = fwd.port;
        if (PORTS.includes(fwd.port) && fwd.port !== kept) workspaceState.update(PORT_KEY, fwd.port).then(undefined, (e) => log.appendLine(`Port store: ${e.message}`));
        this.misses = 0;
        log.appendLine(`Forwarder ${fwd.url} -> ${origin}`);
      }
      const folder = firstFolder();
      let bind = { path: '/', note: null };
      let list = null;
      if (folder) {
        const key = 't3vscode.thread.' + t3.normalizeRoot(folder);
        // B7: the closed-panel bind of this folder, session and T3 saves the ensureProject; its thread list may be old, so a fresh one.
        let r = early && (await early);
        if (!live()) return;
        const reuse = r && r.b && r.key === key && r.bearer === s.bearer && r.origin === origin;
        if (reuse) r.b.folders = localFolders(); // a folder added while the panel was closed counts for the list
        r = reuse ? await this.listFor(r, live) : await this.bindProject(origin, s, folder, live);
        if (!r) return;
        bind = r.bind;
        if (r.b) { // bound: NAV.md section 1, the thread bar
          const b = r.b;
          list = r.list;
          this.adopt(r);
          // docs/QOL.md item 3: the remembered thread may sit in a nested project or a worktree; latestThread knows the bound project only.
          // Not on a fresh project: its first-thread flow runs after the load and must see the bound project.
          const pref = workspaceState.get(key);
          if (!bind.fresh && b.env && pref && pref !== this.current && list.items.some((t) => t.id === pref)) { bind.path = `/${encodeURIComponent(b.env)}/${pref}`; this.current = pref; }
        }
      } else log.appendLine('Project: no local first folder -> /');
      // folderName is T3's title, so a drive root shows its letter.
      show({ kind: 'paired', session: page.sessionView(s), forwarderUrl: this.fwd.url, path: bind.path, note: bind.note,
        newThread: bind.fresh ? { root: bind.root, title: bind.title } : null, folderName: bind.title || null,
        threads: list && list.items, current: list && this.current });
    } catch (e) {
      log.appendLine(`Refresh: ${e.code || 'error'}: ${e.message}`);
      if (!live()) return;
      this.closeForwarder(); // an error page must not leave a signed-in listener running
      if (e.code === 'no-runtime-file' || e.code === 'no-answer') {
        this.setBar('down');
        setContext('t3vscode.running', false);
        show({ kind: 'down', busy: this.starting });
        this.startPoll();
      } else {
        this.setBar(null);
        show({ kind: 'error', error: e.message });
      }
    }
  }

  async upgradeFailed(f) {
    log.appendLine(`WebSocket refused by T3: status ${f.status}, kind ${f.kind}, body ${f.body}`);
    // Transport failures are T3 being down or restarting; the reconnect handles those, not a warning.
    if (f.kind === 'transport' || !this.fwd) return;
    const fwd = this.fwd;
    if (f.kind === 'auth' && (await this.revalidate()) === false) return; // the session ended; not a nightly change
    if (fwd !== this.fwd || fwd.warned) return;
    fwd.warned = true;
    vscode.window.showWarningMessage(`T3 refused the WebSocket (status ${f.status}, ${f.kind}). A nightly may have changed the auth path. See the "T3 Code" output.`);
  }
}

// Decision 8: renew silently near expiry when the scope allows, otherwise remind at most once a day.
async function checkExpiry(context, panel) {
  let gen = credGen;
  let s = await loadSession();
  if (!s) return;
  const soon = () => new Date(s.expiresAt) - Date.now() < 5 * DAY;
  try {
    if (!s.expiresAt) { // a bearer stored before decision 8: ask T3 once
      const st = await t3.session(t3.discover().origin, s.bearer);
      if (!st.authenticated || !st.expiresAt) return;
      if (!(gen = await saveCred(gen, (s = { ...s, expiresAt: st.expiresAt, scopes: t3.grantedScopes(st) }), s.bearer))) return;
    }
    tip(s);
    if (!soon()) return;
    const { origin } = t3.discover();
    const r = await t3.renew(origin, s.bearer, s.scopes);
    if (r) {
      if (!(await saveCred(gen, r, s.bearer))) return; // Pair or Forget happened meanwhile, here or in another window: stale
      log.appendLine(`Session renewed until ${r.expiresAt}`);
      // R23: T3 keeps the old session (only a desktop-bootstrap grant replaces one), so a shown page stays and the forwarder sends the new bearer from now on.
      if (panel.pages.size && panel.fwd && panel.fwd.origin === origin && panel.kind === 'paired') {
        panel.fwd.setToken(r.bearer);
        if (panel.bind) panel.bind.bearer = r.bearer;
        return panel.post({ type: 'session', text: page.sessionStatus(page.sessionView(r)) });
      }
      panel.closeForwarder(); // it still sends the old bearer
      return panel.refresh();
    }
  } catch (e) {
    log.appendLine(`Session check: ${e.code || 'error'}: ${e.message}`);
    if (e.code === 'no-answer' || e.code === 'no-runtime-file') return; // T3 is down: nothing to remind about now
    if (!s.expiresAt || !soon()) return;
  }
  if (gen !== credGen) return; // the session this reminder is about is gone
  const today = new Date().toDateString();
  if (context.globalState.get('t3vscode.reminded') === today) return;
  await context.globalState.update('t3vscode.reminded', today);
  if (await vscode.window.showInformationMessage(`Your T3 session ends on ${page.date(s.expiresAt)}. Pair again.`, 'Pair again')) vscode.commands.executeCommand('t3vscode.pair');
}

// R21: t3.json scripts (T3ProjectFileScript: name, command; at most 50) as VS Code tasks, run at the folder like T3 runs them at the project root.
async function t3Tasks() {
  const tasks = [];
  for (const f of vscode.workspace.workspaceFolders || []) {
    if (f.uri.scheme !== 'file') continue;
    const file = path.join(f.uri.fsPath, 't3.json');
    let scripts;
    try {
      if ((await fs.promises.stat(file)).size > 256 * 1024) continue;
      scripts = JSON.parse(await fs.promises.readFile(file, 'utf8')).scripts;
    } catch { continue; } // no t3.json, or not JSON
    if (!Array.isArray(scripts)) continue;
    for (const s of scripts.slice(0, 50)) {
      const name = s && typeof s.name === 'string' ? s.name.trim() : '';
      const command = s && typeof s.command === 'string' ? s.command.trim() : '';
      if (!name || !command) continue;
      const t = new vscode.Task({ type: 't3', script: name }, f, name, 'T3', new vscode.ShellExecution(command, { cwd: f.uri.fsPath }), []);
      t.detail = `t3.json (scripts kept only in T3's settings are not listed): ${command}`;
      tasks.push(t);
    }
  }
  return tasks;
}

function activate(context) {
  log = vscode.window.createOutputChannel('T3 Code');
  secrets = context.secrets;
  workspaceState = context.workspaceState;
  const panel = new Panel();
  let bound = firstFolder(); // the panel follows only a change of this folder
  const fail = (e) => { log.appendLine(`Error: ${e.message}`); vscode.window.showErrorMessage(e.message); };
  const startFailed = (e) => { panel.starting = false; panel.refresh(); fail(e); }; // re-render first: Start T3 comes back

  const commands = {
    't3vscode.open': () => vscode.commands.executeCommand('t3vscode.panel.focus'),
    't3vscode.openInEditor': () => panel.openEditor(), // B32
    // Pairing happens in the panel (decision 9); the command only brings its field into view.
    't3vscode.pair': async () => {
      const open = !!panel.view; // a fresh view first shows 'connecting', where a message would be lost
      if (!open) panel.wantFocus = true;
      await vscode.commands.executeCommand('t3vscode.panel.focus');
      if (open) panel.post({ type: 'focusInput' }, panel.front());
    },
    't3vscode.startT3': () => {
      const exe = t3.t3ExePath();
      if (!exe) return startFailed(new Error('T3 Code (Nightly) is not installed in the usual place (%LOCALAPPDATA%\\Programs\\t3code).'));
      // The extension host runs with ELECTRON_RUN_AS_NODE and VS Code variables; T3 must not inherit them.
      const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(ELECTRON_|VSCODE_)/.test(k)));
      spawn(exe, [], { detached: true, stdio: 'ignore', env }).on('error', startFailed).unref();
      log.appendLine('Started the T3 desktop app.');
      panel.starting = true;
      panel.refresh();
      // The poll shows T3 as soon as it answers; this only drops "Starting T3..." if it never does.
      setTimeout(() => { panel.starting = false; if (panel.poll) panel.refresh(); }, 15000);
    },
    't3vscode.forget': async () => {
      await saveCred(++credGen, null);
      log.appendLine('Pairing forgotten.');
      panel.closeForwarder();
      panel.acted = true;
      panel.refresh();
    },
    // docs/QOL.md item 6: this thread in the T3 desktop app (t3code://threads/<environmentId>/<threadId>, promptLinks.ts); no thread: a new one.
    't3vscode.openInDesktop': () => {
      const b = panel.bind;
      const link = b && b.env && panel.current ? `t3code://threads/${encodeURIComponent(b.env)}/${encodeURIComponent(panel.current)}` : 't3code://new';
      return vscode.env.openExternal(vscode.Uri.parse(link)).then((ok) => { // R17: a link nobody takes is said, not silent
        if (ok) return;
        log.appendLine(`Open in the T3 app: no handler took ${link}`);
        vscode.window.showWarningMessage('The T3 app did not take the link. Is T3 Code installed?');
      });
    },
    // R22: a link our URI handler (B13) opens; uriScheme so Insiders gets vscode-insiders.
    't3vscode.copyThreadLink': async () => {
      const b = panel.bind;
      if (!(b && b.env && panel.current)) return void vscode.window.showInformationMessage('No thread open.');
      await vscode.env.clipboard.writeText(`${vscode.env.uriScheme}://fundryi.t3-vscode/thread/${encodeURIComponent(b.env)}/${encodeURIComponent(panel.current)}`);
      vscode.window.showInformationMessage('Link copied.');
    },
    // docs/QOL.md item 8: the toolbar's plus button from the palette; R1: a panel that was closed runs it once it binds.
    't3vscode.newThread': async () => {
      await vscode.commands.executeCommand('t3vscode.panel.focus');
      panel.defer({ kind: 'newThread' });
    },
    // R13: a multi-root window picks the folder; one local folder is New thread.
    't3vscode.newThreadIn': async () => {
      const folders = localFolders();
      if (folders.length < 2) return vscode.commands.executeCommand('t3vscode.newThread');
      const pick = await vscode.window.showQuickPick(folders.map((f) => ({ label: path.basename(f) || f, description: f, folder: f })), { placeHolder: 'New T3 thread in which folder?' });
      if (!pick) return;
      await vscode.commands.executeCommand('t3vscode.panel.focus');
      panel.defer({ kind: 'newThreadIn', folder: pick.folder });
    },
    // R13: T3's own command palette (projects, threads, settings) on its root view.
    't3vscode.t3Palette': async () => {
      await vscode.commands.executeCommand('t3vscode.panel.focus');
      panel.post({ type: 't3vscode:palette' }, panel.front());
    },
    // B4: the thread quick pick from the keyboard; R1: waits for the bind like newThread.
    't3vscode.switchThread': async () => {
      await vscode.commands.executeCommand('t3vscode.panel.focus');
      panel.defer({ kind: 'openPicker' });
    },
    't3vscode.showLogs': () => log.show(true), // B25
    't3vscode.walkthrough': () => vscode.commands.executeCommand('workbench.action.openWalkthrough', 'fundryi.t3-vscode#t3vscode.start', false), // R9
    // B29: T3's own settings page in the panel, through T3's router like a thread switch.
    't3vscode.openSettings': async () => {
      await vscode.commands.executeCommand('t3vscode.panel.focus');
      panel.post({ type: 'navigate', path: '/settings/general' }, panel.front());
    },
    // B10: the terminal selection as a fenced block in the composer. Copy needs the clipboard; an empty selection copies nothing, so the old text comes back.
    't3vscode.addTerminalSelection': async () => {
      const old = await vscode.env.clipboard.readText();
      await vscode.env.clipboard.writeText('');
      await vscode.commands.executeCommand('workbench.action.terminal.copySelection');
      const text = await vscode.env.clipboard.readText();
      if (text) return panel.mention('```\n' + text.slice(0, 4000) + '\n```');
      await vscode.env.clipboard.writeText(old);
      vscode.window.showInformationMessage('Select text in the terminal first.');
    },
    // B15: the light bulb's "Fix with T3": the file, the line and the problem into the composer, never sent.
    't3vscode.fixWithT3': (uri, line, message, source) => {
      const text = mentionText(uri, panel.root());
      if (text) return panel.mention(`${text} line ${line}: ${message}${source ? ` (${source})` : ''}`);
    },
    // B21: the Source Control title's request into the composer (plain text survives the drop contract); never sent.
    't3vscode.reviewChanges': async () => {
      await panel.mention('Review my uncommitted changes in this repository.');
      return vscode.commands.executeCommand('t3vscode.focusComposer');
    },
    // Plumbing for Piece 2 slice 2 (B22, context.js): an absolute path with the chip landing rules; reveal true only selects it in the Explorer.
    't3vscode._open': (a) => openFile({ path: a && a.path, line: a && a.line, column: a && a.column, reveal: !!(a && a.reveal), preview: !!(a && a.preview) }),
    't3vscode._diff': (a) => openDiff({ path: a && a.path }),
    't3vscode.showChanges': () => showChanges(panel), // R28
    't3vscode._mention': (text) => { if (typeof text === 'string' && text) return panel.mention(text); }, // R20: context.js's last terminal command
    // docs/QOL.md item 7: the panel, then T3's composer inside it.
    't3vscode.focusComposer': async () => {
      await vscode.commands.executeCommand('t3vscode.panel.focus');
      panel.post({ type: 't3vscode:focus-composer' }, panel.front());
    },
    // Explorer and tab menus pass the uri; the palette runs it on the active file. R7: the Explorer also passes every selected uri, one mention like a drop.
    't3vscode.addToPrompt': (uri, uris) => {
      const ed = vscode.window.activeTextEditor;
      const picked = Array.isArray(uris) && uris.length ? uris.slice(0, 50) : [uri && uri.fsPath ? uri : ed && ed.document.uri];
      if (!picked[0]) return void vscode.window.showInformationMessage('Open a file first.'); // R17: the palette with no editor
      return panel.addUris(picked.filter(Boolean)); // docs/QOL.md item 1: an image goes in as an attachment
    },
    // docs/QOL.md item 4: the file chip, then the lines as plain text (T3 has no line-range mention).
    't3vscode.addSelection': () => {
      const ed = vscode.window.activeTextEditor;
      const text = ed && mentionText(ed.document.uri, panel.root());
      if (!text) return;
      const s = ed.selection;
      const a = s.start.line + 1;
      const b = s.end.line + (s.end.character === 0 && s.end.line > s.start.line ? 0 : 1); // a selection of whole lines ends at column 0 of the next one
      return panel.mention(s.isEmpty ? text : `${text} ${a === b ? `line ${a}` : `lines ${a}-${b}`}`);
    },
  };

  const lensChanged = new vscode.EventEmitter();
  status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.text = 'T3';
  status.command = 't3vscode.open';
  tip(null);
  status.show();
  panel.prebind(); // B7
  const check = () => checkExpiry(context, panel).catch((e) => log.appendLine(`Session check: ${e.message}`));
  const daily = setInterval(check, DAY);
  check();

  context.subscriptions.push(
    log,
    status,
    vscode.window.registerWebviewViewProvider('t3vscode.panel', panel, { webviewOptions: { retainContextWhenHidden: true } }),
    ...Object.entries(commands).map(([id, fn]) => vscode.commands.registerCommand(id, fn)),
    { dispose: () => { credGen++; panel.stopPoll(); panel.watch(0); panel.closeForwarder(); clearInterval(daily); } },
    // Another window paired, renewed or forgot: drop what this window holds and show the shared truth.
    secrets.onDidChange(async (e) => {
      if (e.key !== SECRET) return;
      const raw = (await secrets.get(SECRET)) ?? null;
      if (raw === lastWrite) return; // our own write
      credGen++;
      lastWrite = raw;
      panel.closeForwarder();
      panel.refresh();
    }),
    contextServer.activate(context, log),
    vscode.tasks.registerTaskProvider('t3', { provideTasks: t3Tasks, resolveTask: () => undefined }), // R21: a tasks.json entry matches a provided task by script
    // A new first folder binds anew; any other change updates the bound folder list (threadsFor's filter) and fetches (or the next tick does, if one is in flight).
    vscode.workspace.onDidChangeWorkspaceFolders(() => { if (firstFolder() !== bound) { bound = firstFolder(); panel.refresh(); } else if (panel.bind) { panel.bind.folders = localFolders(); panel.activity(); } }),
    vscode.window.onDidChangeActiveColorTheme(() => panel.theme()),
    vscode.window.onDidChangeWindowState((s) => { if (s.focused) panel.activity(); }), // B8: no stale badge after an alt-tab
    // R4: which of our terminals runs a command; without shell integration no event comes and a terminal counts as idle.
    vscode.window.onDidStartTerminalShellExecution((e) => panel.running.add(e.terminal)),
    vscode.window.onDidEndTerminalShellExecution((e) => panel.running.delete(e.terminal)),
    vscode.window.onDidCloseTerminal((t) => { panel.running.delete(t); panel.terms = panel.terms.filter((x) => x !== t); }),
    // B13: vscode://fundryi.t3-vscode/thread/<environmentId>/<threadId> opens that thread of this window's project; nothing else is accepted.
    vscode.window.registerUriHandler({
      handleUri: async (uri) => {
        let env, id;
        try { [, env, id] = (/^\/thread\/([^/]+)\/([^/]+)$/.exec(uri.path) || []).map(decodeURIComponent); } catch {}
        if (typeof id !== 'string') return log.appendLine(`Link: not a thread link: ${String(uri.path).slice(0, 200)}`);
        await vscode.commands.executeCommand('t3vscode.panel.focus');
        panel.defer({ kind: 'go', env, id }); // R1
      },
    }),
    vscode.languages.registerCodeActionsProvider({ scheme: 'file' }, {
      provideCodeActions: (doc, range, ctx) => ctx.diagnostics.slice(0, 3).map((d) => Object.assign(new vscode.CodeAction(`Fix with T3: ${d.message.slice(0, 60)}`, vscode.CodeActionKind.QuickFix), {
        diagnostics: [d],
        command: { command: 't3vscode.fixWithT3', title: 'Fix with T3', arguments: [doc.uri, d.range.start.line + 1, d.message, d.source || ''] },
      })),
    }, { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }),
    lensChanged,
    vscode.languages.registerCodeLensProvider({ scheme: 'file' }, { onDidChangeCodeLenses: lensChanged.event, provideCodeLenses: todoLenses }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('t3vscode.todoLens')) lensChanged.fire(); // B19: no reload needed
      if (e.affectsConfiguration('t3vscode.runInTerminal') || e.affectsConfiguration('t3vscode.keysToVsCode')) panel.settings(); // B9, R24: the frame follows at once
      if (e.affectsConfiguration('t3vscode.followTheme')) panel.theme(); // R16: turned on, VS Code's theme applies at once
    }),
  );
  // VS Code restores an open sidebar itself; this matters only when the view was closed.
  if (vscode.workspace.getConfiguration('t3vscode').get('openOnStartup')) vscode.commands.executeCommand('t3vscode.panel.focus');
}

module.exports = { activate, localFilePath };
