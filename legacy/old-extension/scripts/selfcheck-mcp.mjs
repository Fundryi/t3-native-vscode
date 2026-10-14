// Offline check of mcp.js (HTTP server) and bridge.js (stdio bridge) with fake tools and a fake discovery folder.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const Module = require('module');
const { startMcpServer } = require('../mcp.js');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pass = (name) => console.log('PASS ' + name);
const TOKEN = 'a'.repeat(64);
const slash = (p) => p.replace(/\\/g, '/');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 't3vs-selfcheck-'));
const HOME = path.join(tmp, 'home');
const FOLDER = path.join(tmp, 'work', 'app');
const SUB = path.join(FOLDER, 'sub');
const SIBLING = path.join(tmp, 'work', 'app2'); // shares a prefix with FOLDER but is not inside it
for (const d of [path.join(HOME, 'windows'), SUB, SIBLING]) fs.mkdirSync(d, { recursive: true });

const tools = [
  { name: 'workspace', description: 'fake', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, run: (_, { cwd }) => ({ folders: [{ name: 'app', path: slash(FOLDER) }], cwd }) },
  { name: 'activeFile', description: 'fake', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, run: () => ({ path: null }) },
  { name: 'stall', description: 'never answers', inputSchema: { type: 'object', properties: {} }, run: () => new Promise(() => {}) },
];
const meta = (cwd, fallback, worktree) => ({ window: { label: 'app', workspaceFile: null, folders: [slash(FOLDER)] }, match: fallback ? 'fallback' : worktree ? 'worktree' : cwd ? 'cwd' : 'none' });
let srv = await startMcpServer({ token: TOKEN, tools, meta });
const children = [];

function request({ port = srv.port, token = TOKEN, method = 'POST', urlPath = '/mcp', host = `127.0.0.1:${port}`, headers = {}, body, declaredLength } = {}) {
  return new Promise((resolve, reject) => {
    const h = { host, authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers };
    if (declaredLength) h['content-length'] = declaredLength;
    const req = http.request({ host: '127.0.0.1', port, path: urlPath, method, headers: h, agent: false }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, text, json: text ? JSON.parse(text) : undefined }));
    });
    req.on('error', reject);
    if (declaredLength) req.flushHeaders(); // send headers only; the server must answer without the body
    else req.end(body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body));
  });
}
const rpc = (id, method, params) => ({ jsonrpc: '2.0', id, method, params });

// Streams 3 MB without Content-Length; resolves with the status the client managed to read.
function chunkedOversize() {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: srv.port, path: '/mcp', method: 'POST', agent: false,
      headers: { host: `127.0.0.1:${srv.port}`, authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' } }, (res) => { res.resume(); resolve(res.statusCode); });
    req.on('error', (e) => reject(new Error('no readable answer: ' + e.code)));
    const mb = Buffer.alloc(1024 * 1024, 32);
    req.write(mb); req.write(mb); req.write(mb); req.end();
  });
}

async function server() {
  assert.equal((await request({ host: 'localhost:' + srv.port, body: rpc(1, 'ping') })).status, 421);
  pass('wrong Host -> 421');
  assert.equal((await request({ headers: { origin: 'http://evil.example' }, body: rpc(1, 'ping') })).status, 403);
  pass('Origin present -> 403');
  assert.equal((await request({ headers: { 'sec-fetch-site': 'same-origin' }, body: rpc(1, 'ping') })).status, 403);
  pass('Sec-Fetch-Site present (a browser) -> 403');
  assert.equal((await request({ method: 'GET' })).status, 405);
  assert.equal((await request({ urlPath: '/other', body: rpc(1, 'ping') })).status, 404);
  pass('GET /mcp -> 405, other path -> 404');
  assert.equal((await request({ headers: { authorization: 'Bearer wrong' }, body: rpc(1, 'ping') })).status, 401);
  assert.equal((await request({ headers: { authorization: '' }, body: rpc(1, 'ping') })).status, 401);
  pass('wrong or missing bearer -> 401');
  assert.equal((await request({ declaredLength: 3 * 1024 * 1024 })).status, 413);
  pass('oversize body -> 413 before the body is read');
  assert.equal(await chunkedOversize(), 413);
  pass('oversize chunked body -> readable 413');
  let r = await request({ body: '{not json' });
  assert.equal(r.json.error.code, -32700);
  pass('malformed JSON -> -32700');
  r = await request({ body: rpc(1, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 't', version: '0' } }) });
  assert.equal(r.json.result.protocolVersion, '2025-11-25');
  assert.equal(r.json.result.serverInfo.name, 't3-vscode');
  assert.ok(r.json.result.serverInfo.version);
  r = await request({ body: rpc(2, 'initialize', { protocolVersion: '1999-01-01' }) });
  assert.equal(r.json.result.protocolVersion, '2025-06-18');
  pass('initialize returns the client version when supported, else 2025-06-18, and serverInfo');
  r = await request({ body: { jsonrpc: '2.0', method: 'notifications/initialized' } });
  assert.equal(r.status, 202);
  assert.equal(r.text, '');
  pass('notifications/initialized -> 202 empty');
  assert.deepEqual((await request({ body: rpc(3, 'ping') })).json.result, {});
  pass('ping -> {}');
  const names = (await request({ body: rpc(4, 'tools/list') })).json.result.tools.map((t) => t.name);
  assert.ok(names.includes('workspace') && names.includes('activeFile'));
  pass('tools/list lists workspace and activeFile');
  r = await request({ body: rpc(5, 'tools/call', { name: 'workspace', arguments: {} }), headers: { 'x-t3-cwd': Buffer.from('D:/x y/ä', 'utf8').toString('base64url') } });
  const sc = r.json.result.structuredContent;
  assert.equal(sc.match, 'cwd');
  assert.deepEqual(sc.window.folders, [slash(FOLDER)]);
  assert.equal(sc.cwd, 'D:/x y/ä');
  assert.deepEqual(JSON.parse(r.json.result.content[0].text), sc);
  pass('tools/call workspace -> structuredContent with window, match and the decoded cwd');
  r = await request({ body: rpc(6, 'tools/call', { name: 'nope' }) });
  assert.equal(r.json.result.isError, true);
  pass('unknown tool -> isError');
  assert.equal((await request({ body: rpc(7, 'tools/call', { name: 'workspace', arguments: { x: 1 } }) })).json.error.code, -32602);
  assert.equal((await request({ body: rpc(8, 'tools/call', { name: 'workspace', arguments: 'x' }) })).json.error.code, -32602);
  assert.equal((await request({ body: rpc(9, 'nope') })).json.error.code, -32601);
  assert.equal((await request({ body: { jsonrpc: '2.0', id: 10 } })).json.error.code, -32600);
  pass('bad arguments -> -32602, unknown method -> -32601, bad shape -> -32600');
  r = await request({ body: [rpc(11, 'ping')] });
  assert.equal(r.json.error.code, -32600);
  assert.equal(r.json.id, null);
  pass('array body (a batch, removed in 2025-06-18) -> -32600');
}

function startBridge(cwd) {
  const child = spawn(process.execPath, [path.join(ROOT, 'bridge.js')], {
    cwd,
    env: { ...process.env, T3VSCODE_HOME: HOME, T3VSCODE_BRIDGE_TIMEOUT_MS: '500' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  children.push(child);
  const lines = [];
  let waiters = [];
  let buf = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (c) => {
    buf += c;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      lines.push(JSON.parse(buf.slice(0, i))); // throws on anything that is not JSON-RPC on stdout
      buf = buf.slice(i + 1);
    }
    waiters = waiters.filter((w) => !w());
  });
  const send = (x) => child.stdin.write((typeof x === 'string' ? x : JSON.stringify(x)) + '\n');
  // Resolves with the first reply whose id matches; rejects after 5 s.
  const reply = (id) => new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`no reply for id ${id}`)), 5000);
    const check = () => { const m = lines.find((l) => l.id === id); if (m) { clearTimeout(t); resolve(m); } return !!m; };
    if (!check()) waiters.push(check);
  });
  return { send, reply, lines };
}

// A fake window that answers every request with answer() -> [status, body]. unref: a failed run still exits.
async function fakeWindow(answer) {
  const s = http.createServer((q, r) => { q.resume(); q.on('end', () => { const [status, body] = answer(); r.writeHead(status, { 'content-type': 'application/json', connection: 'close' }); r.end(body); }); });
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  s.unref();
  return s.address().port;
}
const sleeper = () => { const c = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' }); children.push(c); return c.pid; }; // a live pid for a fake window

async function bridge() {
  const win = (name, data) => fs.writeFileSync(path.join(HOME, 'windows', name), typeof data === 'string' ? data : JSON.stringify(data));
  win(`${process.pid}.json`, { version: 1, pid: process.pid, port: srv.port, token: TOKEN, label: 'app', workspaceFile: null, folders: [slash(FOLDER)], focusedAt: new Date().toISOString(), startedAt: new Date().toISOString() });
  win('1.json', '{half a file');
  win('2147483646.json', { version: 1, pid: 2147483646, port: 1, token: 'x', label: 'dead', folders: [slash(FOLDER)] });
  win('0.json', { version: 1, pid: 0, port: 1, token: 'x', label: 'pid zero', folders: [slash(FOLDER)] }); // kill(0, 0) succeeds: must still count as dead
  // Live, deeper than FOLDER, one bad field each: if any were admitted it would win selection (and get 401 or an ambiguity error).
  const live = sleeper();
  const bad = { version: 1, pid: live, port: srv.port, token: 'b'.repeat(64), label: 'bad', workspaceFile: null, folders: [slash(SUB)] };
  [{ port: 0 }, { port: 70000 }, { workspaceFile: {} }, { version: 2 }, { token: 'a\nb' }, { token: '' }, { folders: [slash(SUB), 'rel'] }, { folders: [''] }]
    .forEach((o, i) => win(`bad${i}.json`, { ...bad, ...o }));

  const b = startBridge(SUB);
  b.send(rpc(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'selfcheck', version: '0' } }));
  assert.equal((await b.reply(1)).result.protocolVersion, '2025-06-18');
  pass('bridge: initialize over stdio (malformed, dead-pid, pid-0 and invalid-field discovery files skipped)');
  b.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  b.send(rpc(2, 'ping'));
  assert.deepEqual((await b.reply(2)).result, {});
  pass('bridge: ping');
  b.send(rpc(3, 'tools/call', { name: 'workspace', arguments: {} }));
  const sc = (await b.reply(3)).result.structuredContent;
  assert.equal(slash(sc.cwd).toLowerCase(), slash(SUB).toLowerCase());
  assert.equal(sc.match, 'cwd');
  pass('bridge: tools/call reaches the server with X-T3-Cwd = the bridge cwd');
  b.send(rpc(4, 'tools/call', { name: 'stall' }));
  const t = await b.reply(4);
  assert.equal(t.error.code, -32000);
  assert.match(t.error.message, /did not answer/);
  pass('bridge: a stalled server -> JSON-RPC error with the request id');
  b.send('{bad json');
  assert.equal((await b.reply(null)).error.code, -32700);
  pass('bridge: malformed stdin line -> -32700');
  assert.deepEqual(b.lines.map((l) => l.id), [1, 2, 3, 4, null]);
  pass('bridge: no reply for the notification, nothing else on stdout');

  // Window reload: the old port dies, the same window comes back on a new port. The pinned bridge must follow it.
  srv.close();
  srv = await startMcpServer({ token: TOKEN, tools, meta });
  win(`${process.pid}.json`, { version: 1, pid: process.pid, port: srv.port, token: TOKEN, label: 'app', workspaceFile: null, folders: [slash(FOLDER)], startedAt: new Date().toISOString() });
  b.send(rpc(5, 'ping'));
  assert.deepEqual((await b.reply(5)).result, {});
  pass('bridge: after a reload on a new port the pinned bridge reconnects to the same window');

  const s = startBridge(SIBLING);
  s.send(rpc(1, 'tools/call', { name: 'workspace', arguments: {} }));
  assert.equal((await s.reply(1)).result.structuredContent.match, 'fallback');
  pass('bridge: a sibling folder with a shared prefix does not match (directory boundary); the last focused window answers with match fallback');
  s.send([rpc(2, 'ping')]);
  assert.equal((await s.reply(null)).error.code, -32600);
  pass('bridge: an array line (a batch) -> -32600 without forwarding');

  // R19: a worktree outside every window folder whose .git file points at FOLDER's .git/worktrees/<name>; the bridge starts one level down.
  const WT = path.join(tmp, 'wt');
  fs.mkdirSync(path.join(WT, 'sub'), { recursive: true });
  const wtMatch = async (gitdir) => {
    fs.writeFileSync(path.join(WT, '.git'), `gitdir: ${gitdir}\n`);
    const x = startBridge(path.join(WT, 'sub'));
    x.send(rpc(1, 'tools/call', { name: 'workspace', arguments: {} }));
    return (await x.reply(1)).result.structuredContent.match;
  };
  assert.equal(await wtMatch(path.join(FOLDER, '.git', 'worktrees', 'wt')), 'worktree');
  assert.equal(await wtMatch('../work/app/.git/worktrees/wt'), 'worktree'); // relative to the folder that holds the .git file
  if (process.platform === 'win32') assert.equal(await wtMatch(slash(FOLDER).toUpperCase() + '/.git/worktrees/wt'), 'worktree'); // git writes .git/worktrees in lower case
  assert.equal(await wtMatch(path.join(SIBLING, '.git', 'worktrees', 'wt')), 'fallback'); // shares a prefix with FOLDER: the directory boundary holds
  assert.equal(await wtMatch(path.join(FOLDER, '.git', 'modules', 'wt')), 'fallback'); // a submodule, not a worktree
  const PLAIN = path.join(WT, 'plain');
  fs.mkdirSync(path.join(PLAIN, '.git'), { recursive: true }); // a normal repository below the worktree: the walk stops there
  const q = startBridge(PLAIN);
  q.send(rpc(1, 'tools/call', { name: 'workspace', arguments: {} }));
  assert.equal((await q.reply(1)).result.structuredContent.match, 'fallback');
  pass('R19: a cwd in a git worktree (absolute or relative gitdir, either case on Windows) reaches the window of its main checkout with match worktree; a submodule, a prefix sibling or a .git directory first -> fallback');

  // A window that answers HTTP 200 with JSON that is no JSON-RPC response to the request.
  const BOGUS = path.join(tmp, 'work', 'bogus');
  fs.mkdirSync(BOGUS);
  const replies = ['{"notRpc":"anything"}', '{"jsonrpc":"2.0","id":999,"result":{}}', '{"jsonrpc":"2.0","id":9,"error":null}', '{"jsonrpc":"2.0","id":10,"error":{"code":"bad","message":7}}'];
  const fakePort = await fakeWindow(() => [200, replies.shift()]);
  const z = sleeper();
  win(`${z}.json`, { version: 1, pid: z, port: fakePort, token: TOKEN, label: 'bogus', workspaceFile: null, folders: [slash(BOGUS)] });
  const f = startBridge(BOGUS);
  f.send(rpc(7, 'ping'));
  assert.match((await f.reply(7)).error.message, /not a JSON-RPC response/);
  f.send(rpc(8, 'ping'));
  assert.equal((await f.reply(8)).error.code, -32000);
  f.send(rpc(9, 'ping'));
  assert.match((await f.reply(9)).error.message, /not a JSON-RPC response/);
  f.send(rpc(10, 'ping'));
  assert.match((await f.reply(10)).error.message, /not a JSON-RPC response/);
  assert.deepEqual(f.lines.map((l) => l.id), [7, 8, 9, 10]);
  pass('bridge: a 200 reply without a JSON-RPC envelope, with another id or with a malformed error object -> error for the request id');

  // Pin by pid: same workspace file, decoys on other folders so only the real window wins the first selection.
  const W = slash(path.join(tmp, 'app.code-workspace'));
  const stalePort = await fakeWindow(() => [401, '{"error":"bad token"}']);
  win(`${process.pid}.json`, { version: 1, pid: process.pid, port: stalePort, token: TOKEN, label: 'app', workspaceFile: W, folders: [slash(FOLDER)] });
  const decoy = (pid) => win(`${pid}.json`, { version: 1, pid, port: srv.port, token: TOKEN, label: 'other', workspaceFile: W, folders: [slash(SIBLING)], startedAt: new Date(Date.now() + 60000).toISOString() });
  const [d1, d2] = [sleeper(), sleeper()];
  decoy(d1);
  const p = startBridge(SUB);
  p.send(rpc(1, 'ping'));
  assert.match((await p.reply(1)).error.message, /HTTP 401/);
  pass('bridge: a 401 while the pinned pid lives stays on it, no jump to a newer window with the same workspace');
  fs.rmSync(path.join(HOME, 'windows', `${process.pid}.json`));
  decoy(d2);
  p.send(rpc(2, 'tools/call', { name: 'workspace', arguments: {} }));
  assert.equal((await p.reply(2)).result.structuredContent.match, 'fallback');
  fs.rmSync(path.join(HOME, 'windows', `${d2}.json`));
  p.send(rpc(3, 'ping'));
  assert.deepEqual((await p.reply(3)).result, {});
  pass('bridge: pinned pid gone -> of two replacements the last focused answers with match fallback');

  // Review 2026-10-13: the window read the request (an action may have run) and then the connection reset: one delivery, no retry.
  const LOST = path.join(tmp, 'work', 'lost');
  fs.mkdirSync(LOST);
  let hits = 0;
  const cut = http.createServer((q) => { q.resume(); q.on('end', () => { hits++; q.socket.destroy(); }); });
  await new Promise((r) => cut.listen(0, '127.0.0.1', r));
  cut.unref();
  const y = sleeper();
  win(`${y}.json`, { version: 1, pid: y, port: cut.address().port, token: TOKEN, label: 'lost', workspaceFile: null, folders: [slash(LOST)] });
  const l = startBridge(LOST);
  l.send(rpc(1, 'tools/call', { name: 'openFile', arguments: { path: 'a.js' } }));
  const lost = await l.reply(1);
  assert.deepEqual([lost.error.code, hits], [-32000, 1]);
  assert.match(lost.error.message, /lost the answer .*the request may have run, check before repeating it/);
  pass('bridge: a connection reset after the window read the request -> one delivery and an error that the request may have run, never a retry');
}

// context.js with a stubbed vscode and a stubbed mcp.js that hands over the tools.
async function editorTracking() {
  process.env.T3VSCODE_HOME = path.join(tmp, 'ctxhome'); // read at module load; keeps its discovery file out of HOME
  const doc = (p) => ({ uri: { scheme: 'file', fsPath: p }, isClosed: false, languageId: 'javascript', isDirty: false, validateRange: (x) => x, validatePosition: (x) => x, getText: () => '' });
  const at = (line) => { const p = { line, character: 0 }; return { start: p, end: p, active: p }; };
  const A = { document: doc(path.join(FOLDER, 'a.js')), selection: at(0) };
  const B = { document: doc(path.join(FOLDER, 'b.js')), selection: at(0) };
  const on = {};
  const ev = (name) => (fn) => { on[name] = fn; return { dispose() {} }; };
  const vscode = {
    window: { state: { focused: false }, activeTextEditor: A, onDidChangeActiveTextEditor: ev('active'), onDidChangeTextEditorSelection: ev('sel'), onDidChangeWindowState: ev('state') },
    workspace: { workspaceFolders: [{ name: 'app', uri: { scheme: 'file', fsPath: FOLDER } }], getWorkspaceFolder: () => ({}), onDidCloseTextDocument: ev('close'), onDidChangeWorkspaceFolders: ev('folders') },
    env: {},
    commands: { registerCommand: () => ({ dispose() {} }) },
    Disposable: { from: (...d) => ({ dispose: () => d.forEach((x) => x.dispose()) }) },
  };
  let ctxTools;
  const load = Module._load;
  Module._load = function (req, ...rest) {
    if (req === 'vscode') return vscode;
    if (req === './mcp') return { startMcpServer: async (o) => { ctxTools = o.tools; return { port: 1, close() {} }; } };
    return load.call(this, req, ...rest);
  };
  const ctx = require('../context.js').activate({}, { appendLine() {} });
  Module._load = load;
  const activeFile = () => ctxTools.find((t) => t.name === 'activeFile').run({}, {});
  on.sel({ textEditor: B, selections: [at(5)] });
  assert.equal(activeFile().path.toLowerCase(), slash(A.document.uri.fsPath).toLowerCase());
  on.sel({ textEditor: A, selections: [at(3)] });
  assert.equal(activeFile().cursor.line, 4);
  pass('context: a background editor selection does not change activeFile; the active editor selection does');
  const old = await ctxTools.find((t) => t.name === 'terminalOutput').run({}, {});
  assert.deepEqual([old.supported, old.items], [false, []]);
  assert.match(old.note, /shell integration/);
  ctx.dispose();
  pass('context: terminalOutput without the shell integration API -> supported false with a note, not an error');
}

// Slice 1 tools: context.js with a stubbed vscode and the real mcp.js, called over HTTP with the port and token from its discovery file.
async function sliceOne() {
  const furi = (p) => ({ scheme: 'file', fsPath: p });
  const A = path.join(FOLDER, 'a.js');
  const B = path.join(FOLDER, 'b.js');
  const C = path.join(FOLDER, 'c.js');
  const at = (line, character) => ({ start: { line, character } });
  class TabInputText { constructor(uri) { this.uri = uri; } }
  class TabInputTextDiff { constructor(original, modified) { this.original = original; this.modified = modified; } }
  const tab = (label, input, isActive = false, isDirty = false) => ({ label, input, isActive, isDirty });
  const change = (p, status, renameTo) => ({ uri: furi(p), status, renameUri: renameTo && furi(renameTo) });
  const repo = (root, state = {}) => ({ rootUri: furi(root), state: {
    HEAD: { name: 'main', commit: 'abc', upstream: { remote: 'origin', name: 'main' }, ahead: 2, behind: 0 },
    indexChanges: [change(A, 0), change(path.join(FOLDER, 'old.js'), 3, path.join(FOLDER, 'new.js'))],
    workingTreeChanges: [change(B, 5)], mergeChanges: [change(C, 18)], untrackedChanges: [change(path.join(FOLDER, 'u.js'), 7)], ...state } });
  const gitExt = (api, isActive = true) => {
    const exports = { getAPI: (v) => { assert.equal(v, 1); if (!api) throw new Error('Git model not found'); return api; } };
    return { isActive, exports: isActive ? exports : undefined, activate: async () => exports };
  };
  const on = () => ({ dispose() {} });
  const shell = {}; // the terminal shell execution listeners context.js registers
  let shellDisposed = 0;
  const onShell = (name) => (fn) => { shell[name] = fn; return { dispose() { shellDisposed++; } }; };
  const APP_ROOT = path.join(tmp, 'vscode', 'resources', 'app');
  const executed = []; // slice 2: the internal commands the action tools ran
  let answer = async () => ({ ok: true });
  const cmds = {}; // R20: the commands context.js registers
  const infos = [];
  const vscode = {
    window: { state: { focused: false }, activeTextEditor: undefined, onDidChangeActiveTextEditor: on, onDidChangeTextEditorSelection: on, onDidChangeWindowState: on, tabGroups: { all: [] },
      onDidStartTerminalShellExecution: onShell('start'), onDidEndTerminalShellExecution: onShell('end'), activeTerminal: undefined, showInformationMessage: async (m) => { infos.push(m); } },
    workspace: { workspaceFolders: [{ name: 'app', uri: furi(FOLDER) }], getWorkspaceFolder: () => ({}), onDidCloseTextDocument: on, onDidChangeWorkspaceFolders: on },
    languages: { getDiagnostics: () => [] },
    extensions: { getExtension: () => undefined, all: [] },
    TabInputText, TabInputTextDiff,
    env: { appRoot: APP_ROOT },
    commands: { registerCommand: (id, fn) => { cmds[id] = fn; return { dispose() {} }; }, executeCommand: (name, arg) => { executed.push([name, arg]); return answer(); } },
    Disposable: { from: (...d) => ({ dispose: () => d.forEach((x) => x.dispose()) }) },
  };
  delete require.cache[require.resolve('../context.js')];
  const load = Module._load;
  Module._load = function (req, ...rest) { return req === 'vscode' ? vscode : load.call(this, req, ...rest); };
  let ctx;
  try { ctx = require('../context.js').activate({}, { appendLine() {} }); } finally { Module._load = load; }
  try {
    const file = path.join(process.env.T3VSCODE_HOME, 'windows', `${process.pid}.json`);
    for (let i = 0; i < 250 && !fs.existsSync(file); i++) await new Promise((r) => setTimeout(r, 20));
    const { port, token } = JSON.parse(fs.readFileSync(file, 'utf8'));
    const call = async (name, args, cwd = SUB) => (await request({ port, token, body: rpc(1, 'tools/call', { name, arguments: args }), headers: { 'x-t3-cwd': Buffer.from(cwd, 'utf8').toString('base64url') } })).json;
    const ok = async (...a) => { const r = (await call(...a)).result; assert.ok(!r.isError, r.content[0].text); return r.structuredContent; };
    const err = async (...a) => { const r = (await call(...a)).result; assert.equal(r.isError, true); return r.content[0].text; };
    const same = (a, b) => assert.equal(slash(a).toLowerCase(), slash(b).toLowerCase());

    const listed = (await request({ port, token, body: rpc(1, 'tools/list') })).json.result.tools;
    for (const n of ['openTabs', 'diagnostics', 'gitState', 'extensions', 'terminalOutput']) assert.equal(listed.find((t) => t.name === n).inputSchema.type, 'object');
    assert.deepEqual(Object.keys(listed.find((t) => t.name === 'diagnostics').inputSchema.properties), ['path', 'minSeverity', 'max']);
    assert.deepEqual(Object.keys(listed.find((t) => t.name === 'gitState').inputSchema.properties), ['path']);
    assert.deepEqual(Object.keys(listed.find((t) => t.name === 'extensions').inputSchema.properties), ['query']);
    assert.deepEqual(Object.keys(listed.find((t) => t.name === 'terminalOutput').inputSchema.properties), ['count', 'terminal']);
    assert.equal((await call('diagnostics', { severity: 'error' })).error.code, -32602);
    pass('slice 1: tools/list lists openTabs, diagnostics and gitState with input schemas; an unknown argument -> -32602');
    const wt = (await request({ port, token, body: rpc(1, 'tools/call', { name: 'openTabs', arguments: {} }), headers: { 'x-t3-cwd': Buffer.from(path.join(tmp, 'wt'), 'utf8').toString('base64url'), 'x-t3-worktree': '1' } })).json.result.structuredContent;
    assert.equal(wt.match, 'worktree');
    assert.match(wt.note, /git worktree.*gitState describes the main checkout/);
    pass('R19: X-T3-Worktree with a cwd outside the window folders -> match worktree and a note that gitState describes the main checkout');
    const tie = (await request({ port, token, body: rpc(1, 'tools/call', { name: 'openTabs', arguments: {} }), headers: { 'x-t3-cwd': Buffer.from(SUB, 'utf8').toString('base64url'), 'x-t3-fallback': '1' } })).json.result.structuredContent;
    assert.deepEqual([tie.match, /^Several VS Code windows have .+ open; this is the one the owner used last\.$/.test(tie.note)], ['fallback', true], tie.note);
    pass('decision 10: X-T3-Fallback wins over a cwd inside the window folders (a tie between windows) -> match fallback with a note that several windows have the cwd');

    // diagnostics
    vscode.languages.getDiagnostics = () => [
      [furi(A), [{ severity: 0, message: 'boom', source: 'ts', code: 2304, range: at(4, 2) }, { severity: 1, message: 'm'.repeat(1000), code: { value: 'W1', target: {} }, range: at(0, 0) }, { severity: 3, message: 'hint', range: at(1, 0) }]],
      [{ scheme: 'untitled', fsPath: 'Untitled-1' }, [{ severity: 0, message: 'not a file', range: at(0, 0) }]],
    ];
    let d = await ok('diagnostics', {});
    assert.equal(d.match, 'cwd');
    assert.equal(d.total, 3);
    assert.equal(d.truncated, false);
    same(d.items[0].path, A);
    assert.deepEqual({ ...d.items[0], path: 0 }, { path: 0, line: 5, column: 3, severity: 'error', message: 'boom', source: 'ts', code: 2304 });
    assert.equal(d.items[1].code, 'W1');
    assert.equal(d.items[1].source, null);
    assert.equal(d.items[1].message.length, 500);
    pass('slice 1: diagnostics without arguments -> file entries in VS Code order, 1-based, severity words, code value, message capped at 500');
    assert.equal((await ok('diagnostics', { minSeverity: 'error' })).total, 1);
    assert.equal((await ok('diagnostics', { minSeverity: 'warning' })).total, 2);
    assert.equal((await ok('diagnostics', { path: 'a.js' })).total, 3);
    assert.equal((await ok('diagnostics', { path: A })).total, 3);
    assert.equal((await ok('diagnostics', { path: 'b.js' })).total, 0);
    pass('slice 1: diagnostics minSeverity filters; path relative to the cwd folder or absolute picks one file');
    assert.match(await err('diagnostics', { path: 'a.js' }, SIBLING), /no base/);
    assert.match(await err('diagnostics', { path: 5 }), /path/);
    assert.match(await err('diagnostics', { path: '' }), /path/);
    assert.match(await err('diagnostics', { minSeverity: 'fatal' }), /minSeverity/);
    assert.match(await err('diagnostics', { max: 0 }), /max/);
    assert.match(await err('diagnostics', { max: 1.5 }), /max/);
    pass('slice 1: diagnostics bad path (relative without a cwd folder, not a string, empty), bad minSeverity or max -> isError');
    vscode.languages.getDiagnostics = () => [[furi(B), Array.from({ length: 600 }, (_, i) => ({ severity: 2, message: 'i' + i, range: at(i, 0) }))]];
    d = await ok('diagnostics', {});
    assert.deepEqual([d.total, d.truncated, d.items.length, d.items[99].line], [600, true, 100, 100]);
    assert.equal((await ok('diagnostics', { max: 7 })).items.length, 7);
    assert.equal((await ok('diagnostics', { max: 100000 })).items.length, 500);
    pass('slice 1: diagnostics default 100, max honored, hard cap 500, total counts all and truncated says so');

    // openTabs
    vscode.window.tabGroups.all = [
      { viewColumn: 1, isActive: false, tabs: [tab('a.js', new TabInputText(furi(A)), true, true), tab('a.js <-> b.js', new TabInputTextDiff(furi(A), furi(B))), tab('T3', {})] },
      { viewColumn: 2, isActive: true, tabs: [tab('b.js', new TabInputText(furi(B))), tab('c.js', new TabInputText(furi(C)), true)] },
    ];
    let t = await ok('openTabs', {});
    assert.deepEqual([t.total, t.truncated], [5, false]);
    assert.deepEqual(t.tabs.map((x) => x.label), ['c.js', 'a.js', 'a.js <-> b.js', 'T3', 'b.js']);
    assert.deepEqual({ ...t.tabs[0], path: 0 }, { path: 0, label: 'c.js', group: 2, active: true, dirty: false, kind: 'text' });
    assert.deepEqual([t.tabs[1].active, t.tabs[1].dirty, t.tabs[1].group], [true, true, 1]);
    same(t.tabs[2].path, B);
    assert.equal(t.tabs[2].kind, 'diff');
    assert.deepEqual([t.tabs[3].path, t.tabs[3].kind], [null, 'other']);
    pass('slice 1: openTabs -> the active tab of the active group first, then VS Code order; text, diff (modified side) and other kinds');
    vscode.window.tabGroups.all = [{ viewColumn: 1, isActive: true, tabs: Array.from({ length: 250 }, (_, i) => tab('t' + i, new TabInputText(furi(A)))) }];
    t = await ok('openTabs', {});
    assert.deepEqual([t.total, t.truncated, t.tabs.length], [250, true, 200]);
    pass('slice 1: openTabs caps at 200 tabs and says so');

    // gitState
    let repos = [repo(FOLDER)];
    vscode.extensions.getExtension = (id) => (id === 'vscode.git' ? gitExt({ repositories: repos }) : undefined);
    let g = await ok('gitState', {});
    assert.deepEqual([g.match, g.available, g.truncated, g.repos.length], ['cwd', true, false, 1]);
    const r0 = g.repos[0];
    same(r0.root, FOLDER);
    assert.deepEqual([r0.branch, r0.upstream, r0.ahead, r0.behind, r0.truncated], ['main', 'origin/main', 2, 0, false]);
    assert.deepEqual(r0.staged.map((x) => [path.basename(x.path), x.status]), [['a.js', 'modified'], ['new.js', 'renamed']]);
    assert.deepEqual(r0.changes.map((x) => [path.basename(x.path), x.status]), [['c.js', 'both-modified'], ['b.js', 'modified'], ['u.js', 'untracked']]);
    pass('slice 1: gitState -> root, branch, upstream, ahead/behind, staged and changes (merge, working tree, untracked) with status words');
    repos = [repo(FOLDER), repo(SUB)];
    g = await ok('gitState', { path: 'sub/x.js' });
    assert.equal(g.repos.length, 1);
    same(g.repos[0].root, SUB);
    assert.deepEqual((await ok('gitState', { path: SIBLING })).repos, []);
    assert.match(await err('gitState', { path: 'x.js' }, SIBLING), /no base/);
    pass('slice 1: gitState path -> the deepest repository that holds it, none -> repos [], relative without a cwd folder -> isError');
    repos = [repo(FOLDER, { HEAD: undefined, indexChanges: [change(A, 1)], workingTreeChanges: Array.from({ length: 300 }, (_, i) => change(path.join(FOLDER, `f${i}.js`), 5)) })];
    g = await ok('gitState', {});
    assert.deepEqual([g.repos[0].branch, g.repos[0].upstream, g.repos[0].ahead, g.repos[0].behind], [null, null, null, null]);
    assert.deepEqual([g.repos[0].staged.length, g.repos[0].changes.length, g.repos[0].truncated], [1, 199, true]);
    repos = Array.from({ length: 25 }, (_, i) => repo(path.join(tmp, `r${i}`)));
    g = await ok('gitState', {});
    assert.deepEqual([g.repos.length, g.truncated], [20, true]);
    pass('slice 1: gitState without HEAD -> nulls; 200 files per repository and 20 repositories, each flagged');
    repos = [];
    assert.deepEqual(Object.entries(await ok('gitState', {})).filter(([k]) => ['available', 'repos'].includes(k)), [['available', true], ['repos', []]]);
    vscode.extensions.getExtension = () => gitExt({ repositories: [repo(FOLDER)] }, false);
    assert.equal((await ok('gitState', {})).repos.length, 1);
    vscode.extensions.getExtension = () => undefined;
    g = await ok('gitState', {});
    assert.deepEqual([g.available, g.repos, g.match], [false, undefined, 'cwd']);
    vscode.extensions.getExtension = () => gitExt(null);
    assert.equal((await ok('gitState', {})).available, false);
    pass('slice 1: gitState no repository -> repos []; inactive extension activated; extension missing or git disabled -> available false, not an error');

    // extensions
    const ext = (id, packageJSON, isActive = false, extensionPath = path.join(tmp, 'exts', id)) => ({ id, packageJSON, isActive, extensionPath });
    vscode.extensions.all = [
      ext('vscode.git', { name: 'git', displayName: 'Git', version: '1.0.0', isBuiltin: true }, true),
      ext('vscode.css', { name: 'css', version: '1.0.0' }, false, path.join(APP_ROOT, 'extensions', 'css')), // no flag, inside the install
      ext('zeta.tool', { name: 'tool', version: '2.0.0', isBuiltin: false }, true),
      ext('Alpha.Thing', { name: 'thing', displayName: 'Thing Helper', version: '0.1.0' }),
    ];
    let x = await ok('extensions', {});
    assert.deepEqual([x.match, x.total, x.truncated], ['cwd', 2, false]);
    assert.deepEqual(x.items, [{ id: 'Alpha.Thing', name: 'Thing Helper', version: '0.1.0', active: false }, { id: 'zeta.tool', name: 'tool', version: '2.0.0', active: true }]);
    pass('extensions -> built-in left out (isBuiltin, or inside the install without the flag), sorted by id, displayName over name, active');
    assert.deepEqual((await ok('extensions', { query: 'HELPER' })).items.map((i) => i.id), ['Alpha.Thing']);
    assert.deepEqual((await ok('extensions', { query: 'zeta' })).items.map((i) => i.id), ['zeta.tool']);
    assert.equal((await ok('extensions', { query: 'git' })).total, 0);
    assert.match(await err('extensions', { query: 5 }), /query/);
    vscode.extensions.all = Array.from({ length: 350 }, (_, i) => ext(`p.e${String(i).padStart(3, '0')}`, { name: 'e', version: '1' }));
    x = await ok('extensions', {});
    assert.deepEqual([x.total, x.truncated, x.items.length, x.items[0].id], [350, true, 300, 'p.e000']);
    pass('extensions query matches id or name case-insensitively, never a built-in; a non-string query -> isError; cap 300 with total and truncated');

    // terminalOutput
    const tick = () => new Promise((r) => setImmediate(r)); // lets the fake stream drain
    const exec = (chunks, commandLine = { value: 'npm test', isTrusted: true, confidence: 2 }, cwd = furi(FOLDER)) =>
      ({ commandLine, cwd, read: async function* () { for (const c of chunks) { await null; yield c; } } });
    const runCmd = async (name, execution, exitCode) => { shell.start({ terminal: { name }, execution }); await tick(); shell.end({ terminal: { name }, execution, exitCode }); await tick(); };
    let o = await ok('terminalOutput', {});
    assert.deepEqual([o.match, o.supported, o.items], ['cwd', true, []]);
    await cmds['t3vscode.addLastCommand']();
    assert.deepEqual([infos, executed], [['No command recorded yet (shell integration needed)'], []]);
    pass('R20: Add last terminal command with no finished command -> one information message, nothing mentioned');
    await runCmd('pwsh', exec(['hello ', 'world\n']), 1);
    o = await ok('terminalOutput', {});
    const i0 = o.items[0];
    same(i0.cwd, FOLDER);
    assert.deepEqual({ ...i0, cwd: 0, startedAt: 0, endedAt: 0 }, { terminal: 'pwsh', cwd: 0, commandLine: 'npm test', exitCode: 1, startedAt: 0, endedAt: 0, output: 'hello world\n', truncated: false });
    assert.ok(i0.startedAt <= i0.endedAt);
    pass('terminalOutput -> one finished command with terminal, cwd, commandLine, exitCode, times and the streamed output');
    await runCmd('pwsh 2', { ...exec(['a'.repeat(5000), 'b'.repeat(5000)], 'x'.repeat(2000)), cwd: undefined }, undefined);
    shell.end({ terminal: { name: 'bash' }, execution: exec([]), exitCode: 0 });
    o = await ok('terminalOutput', {});
    assert.deepEqual(o.items.map((i) => i.terminal), ['bash', 'pwsh 2', 'pwsh']);
    assert.deepEqual([o.items[0].startedAt, o.items[0].output, o.items[0].exitCode], [null, '', 0]);
    const big = o.items[1];
    assert.deepEqual([big.output.length, big.output.endsWith('b'), big.truncated, big.commandLine.length, big.cwd, big.exitCode], [8192, true, true, 1024, null, null]);
    pass('terminalOutput newest first; output keeps the last 8192 chars, commandLine 1024 (string form too); no cwd or exit code -> null; an end without a start -> record without output');
    assert.deepEqual((await ok('terminalOutput', { terminal: 'PWSH' })).items.map((i) => i.terminal), ['pwsh 2', 'pwsh']);
    assert.deepEqual((await ok('terminalOutput', { count: 1 })).items.map((i) => i.terminal), ['bash']);
    for (let i = 0; i < 25; i++) await runCmd('loop', exec([`out${i}`], `c${i}`), 0);
    assert.deepEqual((await ok('terminalOutput', {})).items.map((i) => i.commandLine), ['c24', 'c23', 'c22', 'c21', 'c20']);
    o = await ok('terminalOutput', { count: 20 });
    assert.deepEqual([o.items.length, o.items[19].commandLine, o.items[0].output], [20, 'c5', 'out24']);
    assert.deepEqual((await ok('terminalOutput', { terminal: 'bash' })).items, []);
    for (const count of [0, 21, 1.5, '5']) assert.match(await err('terminalOutput', { count }), /count/);
    assert.match(await err('terminalOutput', { terminal: 1 }), /terminal/);
    pass('terminalOutput keeps the last 20; default 5, count and terminal filter (case-insensitive part of the name); bad count or terminal -> isError');

    // R20: the newest run of the active terminal (a name another terminal shares), escapes stripped, exit code when not 0; else the newest of all.
    const T = { name: 'loop' };
    const ex2 = exec(['\x1b]633;C\x07\x1b[31mboom\x1b[0m\r\n', 'two\r\n\x1b]633;D;2\x1b\\'], 'make');
    shell.start({ terminal: T, execution: ex2 }); await tick(); shell.end({ terminal: T, execution: ex2, exitCode: 2 }); await tick();
    await runCmd('loop', exec(['fine\r\n'], 'ls'), 0);
    const last = async () => { executed.length = 0; await cmds['t3vscode.addLastCommand'](); assert.equal(executed.length, 1); assert.equal(executed[0][0], 't3vscode._mention'); return executed[0][1]; };
    vscode.window.activeTerminal = T;
    assert.equal(await last(), '```\n$ make\nboom\ntwo\n```\nexit 2');
    vscode.window.activeTerminal = { name: 'never ran' };
    assert.equal(await last(), '```\n$ ls\nfine\n```');
    vscode.window.activeTerminal = T;
    const ex3 = exec(['z'.repeat(6000)], 'big');
    shell.start({ terminal: T, execution: ex3 }); await tick(); shell.end({ terminal: T, execution: ex3, exitCode: 0 }); await tick();
    assert.equal(await last(), '```\n$ big\n' + 'z'.repeat(4000) + '\n```');
    assert.equal(infos.length, 1);
    executed.length = 0;
    pass('R20: Add last terminal command -> the active terminal\'s newest run (not a namesake\'s), CSI and OSC 633 removed, CRLF as LF, last 4000 characters, "exit N" only when not 0; no run there -> the newest of all');

    // Slice 2 actions
    const schema = (n) => listed.find((x) => x.name === n).inputSchema;
    assert.deepEqual(Object.keys(schema('openFile').properties), ['path', 'line', 'column', 'preview']);
    for (const n of ['openFile', 'revealInExplorer', 'showDiff']) assert.deepEqual([schema(n).required, schema(n).additionalProperties], [['path'], false]);
    assert.deepEqual(Object.keys(schema('revealInExplorer').properties), ['path']);
    assert.deepEqual(Object.keys(schema('showDiff').properties), ['path']);
    assert.equal((await call('openFile', { path: A, reveal: true })).error.code, -32602);
    pass('slice 2: tools/list lists openFile, revealInExplorer and showDiff with path required; openFile refuses a smuggled reveal -> -32602');
    const X = path.join(SUB, 'x.js');
    const ran = async (name, args, command, sent) => {
      executed.length = 0;
      const r = await ok(name, args);
      assert.deepEqual([r.ok, r.reason, r.match], [true, undefined, 'cwd']);
      assert.equal(executed.length, 1);
      assert.equal(executed[0][0], command);
      same(executed[0][1].path, X);
      assert.deepEqual({ ...executed[0][1], path: 0 }, { path: 0, ...sent });
    };
    await ran('openFile', { path: 'sub/x.js', line: 7, column: 3, preview: true }, 't3vscode._open', { line: 7, column: 3, preview: true });
    await ran('openFile', { path: X }, 't3vscode._open', { line: undefined, column: undefined, preview: undefined });
    await ran('revealInExplorer', { path: 'sub/x.js' }, 't3vscode._open', { reveal: true });
    await ran('revealInExplorer', { path: X }, 't3vscode._open', { reveal: true });
    await ran('showDiff', { path: 'sub/x.js' }, 't3vscode._diff', {});
    await ran('showDiff', { path: X }, 't3vscode._diff', {});
    executed.length = 0;
    assert.equal((await ok('revealInExplorer', { path: FOLDER })).ok, true);
    same(executed[0][1].path, FOLDER);
    pass('slice 2: each action, relative to the cwd folder or absolute, runs its internal command once with the resolved path and returns ok plus meta');
    executed.length = 0;
    for (const n of ['openFile', 'revealInExplorer', 'showDiff']) {
      for (const p of [path.join(SIBLING, 'x.js'), '../app2/x.js', path.join(tmp, 'x.js')]) {
        const r = await ok(n, { path: p });
        assert.deepEqual([r.ok, r.reason], [false, 'outside the workspace folders']);
      }
    }
    assert.equal(executed.length, 0);
    pass('slice 2: a path outside every window folder (prefix sibling, parent steps, elsewhere) -> ok false, no command run');
    for (const n of ['openFile', 'revealInExplorer', 'showDiff']) {
      assert.match(await err(n, {}), /path/);
      assert.match(await err(n, { path: 5 }), /path/);
      assert.match(await err(n, { path: 'x.js' }, SIBLING), /no base/);
    }
    for (const line of [0, 1.5, '2']) assert.match(await err('openFile', { path: 'x.js', line }), /line/);
    assert.match(await err('openFile', { path: 'x.js', column: -1 }), /column/);
    assert.match(await err('openFile', { path: 'x.js', preview: 'yes' }), /preview/);
    assert.equal(executed.length, 0);
    pass('slice 2: missing or non-string path, relative without a cwd folder, bad line, column or preview -> isError, no command run');
    answer = async () => ({ ok: false, reason: 'busy' });
    assert.deepEqual(Object.entries(await ok('openFile', { path: 'x.js' })).filter(([k]) => ['ok', 'reason'].includes(k)), [['ok', false], ['reason', 'busy']]);
    answer = async () => { throw new Error('e'.repeat(400)); };
    let a = await ok('showDiff', { path: 'x.js' });
    assert.deepEqual([a.ok, a.reason.length], [false, 300]);
    answer = async () => undefined;
    a = await ok('revealInExplorer', { path: 'x.js' });
    assert.deepEqual([a.ok, a.reason], [false, 'no answer']);
    executed.length = 0;
    answer = async () => { throw new Error('once'); };
    await ok('openFile', { path: 'x.js' });
    assert.equal(executed.length, 1);
    pass('slice 2: busy passes through; a throwing command -> ok false with the message capped at 300, run once and never retried; no answer -> ok false');
  } finally {
    ctx.dispose();
  }
  assert.equal(shellDisposed, 2);
  pass('context: dispose removes both terminal shell execution listeners');
}

// B16: the setup command, the add buttons and VS Code's own MCP registration (context.js; selfcheck-ext stubs context.js out).
async function setup() {
  const BR = slash(path.join(process.env.T3VSCODE_HOME, 'bridge.js')); // context.js spells it with forward slashes
  const LINES = [`claude mcp add --scope user vscode -- node "${BR}"`, `codex mcp add vscode -- node "${BR}"`];
  const BUTTONS = ['Add to Claude Code', 'Add to Codex', 'Copy CC Switch entry'];
  // R18: the harness configs come from a fake home, never this machine's.
  const FAKE = path.join(tmp, 'fakehome');
  fs.mkdirSync(path.join(FAKE, '.codex'), { recursive: true });
  const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, CODEX_HOME: process.env.CODEX_HOME };
  Object.assign(process.env, { HOME: FAKE, USERPROFILE: FAKE });
  delete process.env.CODEX_HOME;
  assert.equal(os.homedir(), FAKE);
  const NONE = 'Claude Code: not registered. Codex: not registered.';
  const flushAll = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); }; // the message answer is handled after the command returns
  const on = () => ({ dispose() {} });
  const load = Module._load;
  const boot = (lm, remoteName, extCtx = {}) => {
    const s = { cmds: {}, terminals: [], infos: [], clip: [], docs: [], answer: undefined, providers: [] };
    const vscode = {
      window: { state: { focused: false }, onDidChangeActiveTextEditor: on, onDidChangeTextEditorSelection: on, onDidChangeWindowState: on,
        createTerminal: (o) => { const t = { sent: [], show(p) { t.sent.push(['show', p]); }, sendText(x, n) { t.sent.push([x, n]); } }; s.terminals.push([o, t]); return t; },
        showInformationMessage: async (m, ...b) => { s.infos.push([m, ...b]); return s.answer; },
        showTextDocument: async () => {} },
      workspace: { workspaceFolders: [{ name: 'app', uri: { scheme: 'file', fsPath: FOLDER } }], getWorkspaceFolder: () => ({}), onDidCloseTextDocument: on, onDidChangeWorkspaceFolders: on,
        openTextDocument: async (o) => { s.docs.push(o.content); return {}; } },
      env: { remoteName, clipboard: { writeText: async (t) => { s.clip.push(t); } } },
      commands: { registerCommand: (id, fn) => { s.cmds[id] = fn; return { dispose() {} }; }, executeCommand: async (id) => { (s.exec ||= []).push(id); } },
      Disposable: { from: (...d) => ({ dispose: () => d.forEach((x) => x.dispose()) }) },
      ...(lm ? { lm: { registerMcpServerDefinitionProvider: (id, p) => { s.providers.push([id, p]); return { dispose() {} }; } },
        McpStdioServerDefinition: class { constructor(label, command, args) { Object.assign(this, { label, command, args }); } } } : {}),
    };
    s.vscode = vscode;
    delete require.cache[require.resolve('../context.js')];
    Module._load = function (req, ...rest) {
      if (req === 'vscode') return vscode;
      if (req === './mcp') return { startMcpServer: async () => ({ port: 1, close() {} }) };
      return load.call(this, req, ...rest);
    };
    try { s.ctx = require('../context.js').activate(extCtx, { appendLine() {} }); } finally { Module._load = load; }
    return s;
  };

  const s = boot(true);
  try {
    await s.cmds['t3vscode.mcpSetup']();
    assert.deepEqual(s.infos, [[NONE, ...BUTTONS]]);
    const doc = s.docs[0];
    const at = (t) => { const i = doc.indexOf(t); assert.ok(i >= 0, `the setup page lacks ${t}`); return i; };
    assert.ok(at('- Claude Code: not registered\n- Codex: not registered') < at('1. CC Switch'));
    assert.ok(at('1. CC Switch') < at('2. The buttons') && at('2. The buttons') < at("3. VS Code's own MCP list"), 'the three ways are not named in order');
    for (const l of LINES) at(l);
    assert.ok(!/opencode/i.test(doc), 'the setup page still names OpenCode');
    at(`"args": [\n        "${BR}"\n      ]`);
    assert.deepEqual(s.terminals, [], 'the setup command opened a terminal on its own');
    pass('B16: Show MCP setup opens the page (CC Switch, the buttons, VS Code\'s own list, in that order; the two add lines) and one message with the three buttons');

    for (const [i, b] of BUTTONS.slice(0, 2).entries()) {
      s.answer = b;
      await s.cmds['t3vscode.mcpSetup']();
      await flushAll();
      const [o, t] = s.terminals.at(-1);
      assert.deepEqual([s.terminals.length, o, t.sent], [i + 1, { name: 'T3' }, [['show', false], [LINES[i], false]]], b);
    }
    for (const [i, id] of ['t3vscode.mcpAddClaude', 't3vscode.mcpAddCodex'].entries()) {
      await s.cmds[id]();
      assert.deepEqual(s.terminals.at(-1)[1].sent, [['show', false], [LINES[i], false]], id);
    }
    pass('B16: each Add button and each command opens a new terminal T3 with the exact add line typed, without Enter');

    s.answer = 'Copy CC Switch entry';
    const terms = s.terminals.length;
    await s.cmds['t3vscode.mcpSetup']();
    await flushAll();
    assert.deepEqual(JSON.parse(s.clip[0]), { mcpServers: { vscode: { command: 'node', args: [BR] } } });
    assert.deepEqual([s.clip.length, s.terminals.length, s.infos.at(-1)], [1, terms, ['The CC Switch entry is on the clipboard.']]);
    s.answer = undefined;
    await s.cmds['t3vscode.mcpSetup']();
    await flushAll();
    assert.deepEqual([s.clip.length, s.terminals.length], [1, terms], 'a dismissed message did something');
    pass('B16: Copy CC Switch entry puts the Claude Code JSON on the clipboard with one message; a dismiss does nothing');

    assert.deepEqual(s.providers.map(([id]) => id), ['t3vscode.mcp']);
    const defs = await s.providers[0][1].provideMcpServerDefinitions();
    assert.deepEqual(JSON.parse(JSON.stringify(defs)), [{ label: 'T3 VS Code context', command: 'node', args: [BR], cwd: { scheme: 'file', fsPath: FOLDER } }]);
    assert.equal(defs[0].cwd, s.vscode.workspace.workspaceFolders[0].uri, 'cwd is not the first workspace folder uri');
    const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    assert.ok(!pkg.contributes.commands.some((c) => /opencode/i.test(c.command)), 'package.json still has an OpenCode command');
    assert.deepEqual(pkg.contributes.mcpServerDefinitionProviders.map((p) => p.id), ['t3vscode.mcp'], 'VS Code throws on a provider id missing from package.json');
    for (const id of ['t3vscode.mcpAddClaude', 't3vscode.mcpAddCodex']) assert.ok(pkg.contributes.commands.some((c) => c.command === id && c.category === 'T3'), id);
    pass('B16: with vscode.lm one provider t3vscode.mcp (contributed in package.json) answers one stdio definition node <bridge>, cwd the first folder');

    // R18: an entry counts when its last arg is our bridge (also "cmd /c node <bridge>" with backslashes); a namesake with another path does not.
    const CLAUDE = path.join(FAKE, '.claude.json');
    const TOML = path.join(FAKE, '.codex', 'config.toml');
    const MCPJSON = path.join(FOLDER, '.mcp.json');
    const winBr = BR.replace(/\//g, '\\');
    const setupNow = async () => { s.answer = undefined; s.docs.length = 0; await s.cmds['t3vscode.mcpSetup'](); return [s.infos.at(-1), s.docs[0]]; };
    fs.writeFileSync(CLAUDE, JSON.stringify({ mcpServers: { vscode: { command: 'node', args: ['/elsewhere/bridge.js'] } }, projects: { [FOLDER]: { mcpServers: { ctx: { command: 'cmd', args: ['/c', 'node', winBr] } } } } }));
    fs.writeFileSync(TOML, `[mcp_servers.other]\nargs = ["x"]\n\n[mcp_servers."vs code"]\ncommand = "node"\nargs = [\n  "-e",\n  "${winBr.replace(/\\/g, '\\\\')}",\n]\n\n[mcp_servers."vs code".env]\nA = "1"\n`);
    let [msg, page] = await setupNow();
    assert.deepEqual(msg, ['Claude Code: registered (local scope). Codex: registered (user scope).', 'Copy CC Switch entry']);
    assert.ok(page.includes('- Claude Code: registered (local scope)\n- Codex: registered (user scope)\n'));
    fs.writeFileSync(TOML, `[mcp_servers.vscode]\nargs = ['/elsewhere/bridge.js']\n`);
    fs.writeFileSync(CLAUDE, JSON.stringify({ mcpServers: { vscode: { command: 'node', args: [BR] } } }));
    assert.deepEqual((await setupNow())[0], ['Claude Code: registered (user scope). Codex: not registered.', 'Add to Codex', 'Copy CC Switch entry']);
    fs.writeFileSync(CLAUDE, '{not json');
    fs.writeFileSync(MCPJSON, JSON.stringify({ mcpServers: { vscode: { command: 'node', args: [BR] } } }));
    fs.writeFileSync(TOML, `[mcp_servers.vscode]\ncommand = "node"\nargs = ['${BR}']\n`);
    assert.deepEqual((await setupNow())[0], ['Claude Code: registered (project scope, .mcp.json). Codex: registered (user scope).', 'Copy CC Switch entry']);
    for (const f of [CLAUDE, TOML, MCPJSON]) fs.rmSync(f);
    assert.deepEqual((await setupNow())[0], [NONE, ...BUTTONS]);
    pass('R18: the setup page and the message say per harness registered (user, local or project scope) or not registered; only the missing Add buttons show; an unreadable file counts as none');
  } finally { s.ctx.dispose(); }

  const rem = boot(true, 'wsl');
  try {
    assert.deepEqual(await rem.providers[0][1].provideMcpServerDefinitions(), [], 'a remote window offered the local bridge');
  } finally { rem.ctx.dispose(); }
  pass('B16: in a remote window the provider answers no definition');

  const old = boot(false);
  old.ctx.dispose();
  assert.equal(typeof old.cmds['t3vscode.mcpSetup'], 'function');
  pass('B16: without vscode.lm (before VS Code 1.101) activate registers no provider and does not throw');

  // R18: the nudge after the first paired render (extension.js runs t3vscode._mcpNudge on every one).
  const nudge = async (g, answer, remoteName) => {
    const n = boot(true, remoteName, { globalState: { get: (k) => g.get(k), update: async (k, v) => { g.set(k, v); } } });
    n.answer = answer;
    try {
      await n.cmds['t3vscode._mcpNudge']();
      await n.cmds['t3vscode._mcpNudge']();
      return [n.infos, n.exec || []];
    } finally { n.ctx.dispose(); }
  };
  const ASK = ['Agents in T3 cannot see VS Code yet.', 'Set up', 'Not now'];
  const kept = new Map();
  assert.deepEqual(await nudge(kept, 'Not now'), [[ASK], []]);
  assert.deepEqual(await nudge(kept, 'Not now'), [[], []], '"Not now" was not kept');
  assert.deepEqual(await nudge(new Map(), 'Set up'), [[ASK], ['t3vscode.mcpSetup']]);
  assert.deepEqual(await nudge(new Map(), undefined, 'wsl'), [[], []], 'a remote window asked');
  fs.writeFileSync(path.join(FAKE, '.codex', 'config.toml'), `[mcp_servers.vscode]\nargs = ["${BR}"]\n`);
  assert.deepEqual(await nudge(new Map(), 'Set up'), [[], []], 'asked although Codex has the server');
  pass('R18: nudge once per window when no harness has the server: "Set up" runs the setup, "Not now" is kept in globalState; never with a registration or in a remote window');
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
}

try {
  await server();
  await bridge();
  await editorTracking();
  await sliceOne();
  await setup();
  console.log('ALL PASS');
} catch (e) {
  console.error('FAIL', e);
  process.exitCode = 1;
} finally {
  // A child's cwd sits inside tmp, and Windows will not delete it until the child has exited.
  await Promise.all(children.map((c) => new Promise((r) => { c.once('exit', r); if (!c.kill()) r(); })));
  srv.close();
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
}
