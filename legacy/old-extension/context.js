// Piece 2, VS Code side: tracks the editor, runs the MCP server (mcp.js) and publishes this window's discovery file.
// Uses no T3 surface.
const vscode = require('vscode');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { startMcpServer } = require('./mcp');

const HOME = process.env.T3VSCODE_HOME || path.join(os.homedir(), '.t3-vscode');
const DIR = path.join(HOME, 'windows');
const FILE = path.join(DIR, `${process.pid}.json`);
const BRIDGE = path.join(HOME, 'bridge.js');
const MAX_TEXT = 8192;
const MAX_FOLDERS = 50;
// Slice 1 caps, docs/PIECE2.md section 3.
const MAX_TABS = 200;
const MAX_DIAG_DEFAULT = 100;
const MAX_DIAG = 500;
const MAX_MESSAGE = 500;
const MAX_GIT_FILES = 200;
const MAX_REPOS = 20;
// B23 caps.
const MAX_EXTENSIONS = 300;
const MAX_RUNS = 20;
const MAX_RUN_OUTPUT = 8192;
const MAX_COMMAND = 1024;
const MAX_REASON = 300;
const MAX_LAST = 4000; // R20, like B10's terminal selection
const WIN = process.platform === 'win32';

// Upper-case drive letter: VS Code reports d:\, a process cwd D:\. Output then spells every path the same way.
const slash = (p) => p.replace(/\\/g, '/').replace(/^[a-z]:/, (d) => d.toUpperCase());
const key = (p) => { const s = slash(p).replace(/\/+$/, ''); return WIN ? s.toLowerCase() : s; };
const now = () => new Date().toISOString();
const pos = (p) => ({ line: p.line + 1, character: p.character + 1 });

function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false; // kill(0, 0) signals our own process group and succeeds
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

// A reader never sees half a token or port: write a temp file next to the target, then rename over it.
function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

const folders = () => (vscode.workspace.workspaceFolders || []).filter((f) => f.uri.scheme === 'file').slice(0, MAX_FOLDERS);
const workspaceFile = () => { const u = vscode.workspace.workspaceFile; return u && u.scheme === 'file' ? slash(u.fsPath) : null; };
const label = () => { const ws = workspaceFile(); return ws ? path.basename(ws, '.code-workspace') : (folders()[0] || {}).name || ''; };

const inside = (p, root) => { const c = key(p); const k = key(root); return c === k || c.startsWith(k + '/'); };

// The deepest folder that holds cwd on a directory boundary.
function cwdFolder(cwd) {
  if (!cwd) return null;
  const hits = folders().filter((f) => inside(cwd, f.uri.fsPath));
  return hits.sort((a, b) => b.uri.fsPath.length - a.uri.fsPath.length)[0] || null;
}

// A relative path resolves only against the folder that holds the cwd; no such folder is an error, never folder zero.
function resolvePath(p, cwd) {
  if (typeof p !== 'string' || !p.trim()) throw new Error('path must be a non-empty string.');
  if (path.isAbsolute(p)) return path.resolve(p);
  const f = cwdFolder(cwd);
  if (!f) throw new Error(`No folder of this VS Code window holds your cwd, so the relative path ${p} has no base; pass an absolute path.`);
  return path.resolve(f.uri.fsPath, p);
}

const SEVERITY = ['error', 'warning', 'info', 'hint']; // index = vscode.DiagnosticSeverity
const GIT_STATUS = ['modified', 'added', 'deleted', 'renamed', 'copied', 'modified', 'deleted', 'untracked', 'ignored', 'intent-to-add', 'intent-to-rename',
  'type-changed', 'added-by-us', 'added-by-them', 'deleted-by-us', 'deleted-by-them', 'both-added', 'both-deleted', 'both-modified']; // index = git.d.ts Status

function diagnostics({ path: p, minSeverity, max }, cwd) {
  const file = p === undefined ? null : key(resolvePath(p, cwd));
  const min = minSeverity === undefined ? 3 : SEVERITY.indexOf(minSeverity);
  if (min < 0) throw new Error('minSeverity must be error, warning, info or hint.');
  if (max !== undefined && !(Number.isInteger(max) && max >= 1)) throw new Error('max must be an integer of at least 1.');
  const limit = Math.min(max === undefined ? MAX_DIAG_DEFAULT : max, MAX_DIAG);
  let total = 0;
  const items = [];
  for (const [uri, list] of vscode.languages.getDiagnostics()) {
    if (uri.scheme !== 'file' || (file && key(uri.fsPath) !== file)) continue;
    for (const d of list) {
      if (d.severity > min) continue;
      total++;
      if (items.length >= limit) continue; // keep counting for total, stop building
      const code = d.code !== null && typeof d.code === 'object' ? d.code.value : d.code;
      items.push({ path: slash(uri.fsPath), line: d.range.start.line + 1, column: d.range.start.character + 1, severity: SEVERITY[d.severity],
        message: d.message.slice(0, MAX_MESSAGE), source: d.source ?? null, code: code ?? null });
    }
  }
  return { total, truncated: total > items.length, items };
}

function openTabs() {
  const all = [];
  let total = 0;
  for (const g of vscode.window.tabGroups.all) {
    total += g.tabs.length;
    for (const t of g.tabs) {
      if (all.length >= MAX_TABS) break;
      const i = t.input;
      const kind = i instanceof vscode.TabInputText ? 'text' : i instanceof vscode.TabInputTextDiff ? 'diff' : 'other';
      const uri = kind === 'text' ? i.uri : kind === 'diff' ? i.modified : null;
      all.push({ path: uri && uri.scheme === 'file' ? slash(uri.fsPath) : null, label: t.label, group: g.viewColumn, active: t.isActive, dirty: t.isDirty, kind, first: g.isActive && t.isActive });
    }
  }
  // The tab the user looks at goes first; the rest keep VS Code's order (sort is stable).
  const tabs = all.sort((a, b) => b.first - a.first).map(({ first, ...t }) => t);
  return { total, truncated: total > tabs.length, tabs };
}

async function gitState({ path: p }, cwd) {
  const target = p === undefined ? null : resolvePath(p, cwd);
  const ext = vscode.extensions.getExtension('vscode.git');
  let api;
  try { api = ext && (ext.isActive ? ext.exports : await ext.activate()).getAPI(1); } catch { api = null; } // getAPI throws while git.enabled is off
  if (!api) return { available: false };
  let repos = api.repositories;
  // With a path: only the deepest repository that holds it.
  if (target) repos = repos.filter((r) => inside(target, r.rootUri.fsPath)).sort((a, b) => b.rootUri.fsPath.length - a.rootUri.fsPath.length).slice(0, 1);
  const files = (list, room) => list.slice(0, room).map((c) => ({ path: slash((c.renameUri || c.uri).fsPath), status: GIT_STATUS[c.status] || 'unknown' }));
  return {
    available: true,
    truncated: repos.length > MAX_REPOS,
    repos: repos.slice(0, MAX_REPOS).map((r) => {
      const s = r.state;
      const h = s.HEAD; // undefined in a repository without commits
      const changes = [...(s.mergeChanges || []), ...s.workingTreeChanges, ...(s.untrackedChanges || [])];
      // shortcut: 200 files per repository in total, staged first; split the cap if agents miss changes behind a large index.
      const staged = files(s.indexChanges, MAX_GIT_FILES);
      return {
        root: slash(r.rootUri.fsPath), branch: (h && h.name) || null, upstream: h && h.upstream ? `${h.upstream.remote}/${h.upstream.name}` : null,
        ahead: (h && h.ahead) ?? null, behind: (h && h.behind) ?? null,
        staged, changes: files(changes, MAX_GIT_FILES - staged.length), truncated: s.indexChanges.length + changes.length > MAX_GIT_FILES,
      };
    }),
  };
}

function extensions({ query }) {
  if (query !== undefined && typeof query !== 'string') throw new Error('query must be a string.');
  const q = (query || '').toLowerCase();
  const root = vscode.env.appRoot;
  // packageJSON is VS Code's extension description and carries isBuiltin; without it, an extension inside the install folder counts as built in.
  const builtin = (e) => (typeof e.packageJSON.isBuiltin === 'boolean' ? e.packageJSON.isBuiltin : !!root && inside(e.extensionPath, root));
  const items = vscode.extensions.all.filter((e) => !builtin(e))
    .map((e) => ({ id: e.id, name: e.packageJSON.displayName || e.packageJSON.name || e.id, version: e.packageJSON.version || null, active: e.isActive }))
    .filter((x) => !q || x.id.toLowerCase().includes(q) || String(x.name).toLowerCase().includes(q))
    .sort((a, b) => a.id.localeCompare(b.id));
  return { total: items.length, truncated: items.length > MAX_EXTENSIONS, items: items.slice(0, MAX_EXTENSIONS) };
}

function terminalOutput({ count, terminal }, runs, supported) {
  if (count !== undefined && !(Number.isInteger(count) && count >= 1 && count <= MAX_RUNS)) throw new Error('count must be an integer from 1 to 20.');
  if (terminal !== undefined && typeof terminal !== 'string') throw new Error('terminal must be a string.');
  if (!supported) return { supported: false, items: [], note: 'This VS Code has no terminal shell integration API (VS Code 1.93 or newer has it), so terminal commands cannot be read.' };
  const t = (terminal || '').toLowerCase();
  const items = runs.filter((r) => !t || r.terminal.toLowerCase().includes(t)).slice(-(count || 5)).reverse();
  return { supported: true, items: items.map((r) => ({ ...r })) };
}

// R20: CSI and OSC sequences (incl. VS Code's OSC 633 markers) and other control characters out, line ends as \n.
const plain = (t) => t.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]|\x1b[@-Z\\-_]/g, '').replace(/\r\n/g, '\n').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');

// R18: the last arg is our bridge (CC Switch on this PC writes "cmd /c node <bridge>", the add lines "node <bridge>").
const ours = (args) => Array.isArray(args) && typeof args[args.length - 1] === 'string' && key(args[args.length - 1]) === key(BRIDGE);
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const hasOurs = (servers) => !!servers && typeof servers === 'object' && Object.values(servers).some((x) => x && ours(x.args));
// shortcut: a regex over [mcp_servers.<name>] blocks, not a TOML parser (no dependency); an inline table or a dotted mcp_servers.x.args key is missed, use a parser if one shows up.
function codexHas(text) {
  return text.split(/^\s*\[/m).some((block) => {
    if (!/^mcp_servers\.(?:[\w-]+|"[^"]*"|'[^']*')\s*\]/.test(block)) return false;
    const m = /^\s*args\s*=\s*\[([\s\S]*?)\]/m.exec(block);
    const strs = m ? [...m[1].matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'/g)].map((x) => {
      if (x[2] !== undefined) return x[2];
      try { return JSON.parse(`"${x[1]}"`); } catch { return x[1]; }
    }) : [];
    return ours(strs);
  });
}
// R18: read only; CC Switch keeps its own list in ~/.cc-switch/cc-switch.db and writes the live entries into these same files.
function harnesses() {
  const claudeJson = readJson(path.join(os.homedir(), '.claude.json')) || {};
  const local = Object.entries(claudeJson.projects || {}).some(([p, e]) => folders().some((f) => key(f.uri.fsPath) === key(p)) && e && hasOurs(e.mcpServers));
  const project = folders().some((f) => hasOurs((readJson(path.join(f.uri.fsPath, '.mcp.json')) || {}).mcpServers));
  const claude = hasOurs(claudeJson.mcpServers) ? 'user scope' : local ? 'local scope' : project ? 'project scope, .mcp.json' : null;
  let codex = null;
  try { if (codexHas(fs.readFileSync(path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'config.toml'), 'utf8'))) codex = 'user scope'; } catch { /* no config */ }
  return { 'Claude Code': claude, Codex: codex };
}

const atLeastOne = (v, name) => { if (v !== undefined && !(Number.isInteger(v) && v >= 1)) throw new Error(`${name} must be an integer of at least 1.`); };

// Slice 2: an action runs extension.js's internal command (the chip landing rules), only inside a window folder (PIECE2 question 4), and is never retried.
async function act(command, args, cwd) {
  const target = resolvePath(args.path, cwd);
  if (!folders().some((f) => inside(target, f.uri.fsPath))) return { ok: false, reason: 'outside the workspace folders' };
  try {
    const r = await vscode.commands.executeCommand(command, { ...args, path: target });
    return r && r.ok === true ? { ok: true } : { ok: false, reason: String((r && r.reason) || 'no answer').slice(0, MAX_REASON) };
  } catch (e) { return { ok: false, reason: String((e && e.message) || e).slice(0, MAX_REASON) }; }
}

function openFile({ path: p, line, column, preview }, cwd) {
  atLeastOne(line, 'line');
  atLeastOne(column, 'column');
  if (preview !== undefined && typeof preview !== 'boolean') throw new Error('preview must be a boolean.');
  return act('t3vscode._open', { path: p, line, column, preview }, cwd);
}

function activate(context, log) {
  const subs = [];
  const token = crypto.randomBytes(32).toString('hex');
  const startedAt = now();
  let focusedAt = vscode.window.state.focused ? startedAt : null;
  let srv = null;
  let disposed = false;
  let last = null; // { doc, sel }: the last file editor; kept while focus sits in a webview such as the T3 panel
  const runs = []; // finished terminal commands, oldest first, in memory only
  const termOf = new WeakMap(); // R20: record -> terminal; names repeat, and terminalOutput must not serialize the object
  const shellApi = typeof vscode.window.onDidEndTerminalShellExecution === 'function'; // missing before VS Code 1.93

  const relevant = (doc) => doc.uri.scheme === 'file' && !!vscode.workspace.getWorkspaceFolder(doc.uri);
  const track = (editor, sel) => { if (editor && relevant(editor.document)) last = { doc: editor.document, sel: sel || editor.selection }; };
  track(vscode.window.activeTextEditor);
  subs.push(
    vscode.window.onDidChangeActiveTextEditor((e) => track(e)), // undefined when focus moves into a webview: keep the last one
    // A background editor may move the remembered document's selection, never become the remembered document.
    vscode.window.onDidChangeTextEditorSelection((e) => { if (e.textEditor === vscode.window.activeTextEditor || (last && last.doc === e.textEditor.document)) track(e.textEditor, e.selections[0]); }),
    vscode.workspace.onDidCloseTextDocument((d) => { if (last && last.doc === d) last = null; }),
  );

  const tools = [
    {
      name: 'workspace',
      description: 'Folders of the VS Code window this agent belongs to, its .code-workspace file, and which folder holds your cwd.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      run: (_, { cwd }) => {
        const hit = cwdFolder(cwd);
        return { folders: folders().map((f) => ({ name: f.name, path: slash(f.uri.fsPath) })), workspaceFile: workspaceFile(), cwd: cwd && slash(cwd), cwdFolder: hit ? slash(hit.uri.fsPath) : null };
      },
    },
    {
      name: 'activeFile',
      description: 'The file the user last worked in inside this VS Code window: path, language, cursor and selected text (lines and characters 1-based). path is null when there is none.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      run: () => {
        if (!last || last.doc.isClosed || !relevant(last.doc)) { last = null; return { path: null }; }
        const { doc, sel } = last;
        const range = doc.validateRange(sel); // the document may have changed since the selection event
        let text = doc.getText(range);
        const truncated = text.length > MAX_TEXT;
        if (truncated) text = text.slice(0, MAX_TEXT);
        return {
          path: slash(doc.uri.fsPath), languageId: doc.languageId, dirty: doc.isDirty,
          cursor: pos(doc.validatePosition(sel.active)), selection: { start: pos(range.start), end: pos(range.end), text, truncated },
        };
      },
    },
    {
      name: 'openTabs',
      description: 'Tabs open in all editor groups of this VS Code window: path (file tabs; for a diff the modified side), label, group (view column), active, dirty, kind (text, diff, other). The tab the user looks at comes first. At most 200.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      run: () => openTabs(),
    },
    {
      name: 'diagnostics',
      description: 'Problems panel entries of this VS Code window: path, line and column (1-based), severity, message, source, code. A relative path resolves against the window folder that holds your cwd. Default 100 entries, at most 500; total counts all matches.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Only this file; absolute, or relative to the folder that holds your cwd.' },
          minSeverity: { type: 'string', enum: SEVERITY, description: 'Lowest severity to include. Default hint (everything).' },
          max: { type: 'integer', minimum: 1, maximum: MAX_DIAG, description: 'Entries to return. Default 100; larger values are capped at 500.' },
        },
        additionalProperties: false,
      },
      run: (args, { cwd }) => diagnostics(args, cwd),
    },
    {
      name: 'gitState',
      description: 'Branch, upstream, ahead/behind, staged and changed files per repository of this VS Code window, from the built-in Git extension (the Source Control view). available is false when the Git extension is off. At most 20 repositories and 200 files per repository.',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Only the repository that holds this path; absolute, or relative to the folder that holds your cwd.' } },
        additionalProperties: false,
      },
      run: (args, { cwd }) => gitState(args, cwd),
    },
    {
      name: 'extensions',
      description: 'Extensions the user installed in this VS Code window (built-in ones left out): id, name, version, active. Sorted by id, at most 300; total counts all matches.',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Only extensions whose id or name contains this text, case-insensitive.' } },
        additionalProperties: false,
      },
      run: (args) => extensions(args),
    },
    {
      name: 'terminalOutput',
      description: 'The last commands the user ran in the terminals of this VS Code window, newest first: terminal name, cwd, commandLine, exitCode, startedAt, endedAt and the last 8192 characters of raw output (with terminal escape codes; truncated says when older output was dropped). Only terminals with shell integration, and only commands that finished since this window opened; the last 20 are kept. Nothing is run.',
      inputSchema: {
        type: 'object',
        properties: {
          count: { type: 'integer', minimum: 1, maximum: MAX_RUNS, description: 'Commands to return. Default 5, at most 20.' },
          terminal: { type: 'string', description: 'Only terminals whose name contains this text, case-insensitive.' },
        },
        additionalProperties: false,
      },
      run: (args) => terminalOutput(args, runs, shellApi),
    },
    {
      name: 'openFile',
      description: 'Open a file in this VS Code window with the cursor at a line and column (1-based), and select it in the Explorer; a folder is revealed in the Explorer instead. Only paths inside the window folders. Returns ok, or ok false with a reason (busy means another open ran in the last 300 ms). Never retried.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute, or relative to the folder that holds your cwd.' },
          line: { type: 'integer', minimum: 1, description: 'Line for the cursor. Default 1.' },
          column: { type: 'integer', minimum: 1, description: 'Column for the cursor. Default 1.' },
          preview: { type: 'boolean', description: 'Open as a preview tab that the next open replaces. Default false.' },
        },
        required: ['path'],
        additionalProperties: false,
      },
      run: (args, { cwd }) => openFile(args, cwd),
    },
    {
      name: 'revealInExplorer',
      description: 'Select a file or folder in the Explorer of this VS Code window (a folder is also expanded). Only paths inside the window folders. Returns ok, or ok false with a reason. Never retried.',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Absolute, or relative to the folder that holds your cwd.' } },
        required: ['path'],
        additionalProperties: false,
      },
      run: (args, { cwd }) => act('t3vscode._open', { path: args.path, reveal: true }, cwd),
    },
    {
      name: 'showDiff',
      description: 'Show the uncommitted change of a file in the diff editor of this VS Code window (the Source Control view\'s diff); a file without a change opens as is. Only paths inside the window folders. Returns ok, or ok false with a reason. Never retried.',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Absolute, or relative to the folder that holds your cwd.' } },
        required: ['path'],
        additionalProperties: false,
      },
      run: (args, { cwd }) => act('t3vscode._diff', { path: args.path }, cwd),
    },
  ];
  const meta = (cwd, fallback, worktree) => {
    // fallback: the bridge found no single window for the cwd and took the last focused one (decision 10).
    // worktree (R19): the window of the main checkout of the git worktree that holds the cwd. bound: reached through --workspace.
    // The bridge's fallback flag wins over the cwd match: in a tie every window holds the cwd, and decision 10 wants the note anyway.
    const match = !cwd ? 'none' : fallback ? 'fallback' : cwdFolder(cwd) ? 'cwd' : worktree ? 'worktree' : 'bound';
    const note = match === 'fallback' ? (cwdFolder(cwd) ? `Several VS Code windows have ${cwd} open; this is the one the owner used last.` : `No VS Code window has ${cwd} open; this is the window the owner used last.`)
      : match === 'worktree' ? `Your cwd ${cwd} is a git worktree and this window has its main checkout open; gitState describes the main checkout, because VS Code knows only the repositories it has open.`
        : null;
    return { window: { label: label(), workspaceFile: workspaceFile(), folders: folders().map((f) => slash(f.uri.fsPath)) }, match, ...(note ? { note } : {}) };
  };

  const unpublish = () => { try { fs.unlinkSync(FILE); } catch { /* already gone */ } };
  const publish = () => {
    if (!srv || disposed) return;
    const f = folders();
    if (!f.length) return unpublish(); // nothing to match an agent's cwd against
    try {
      fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
      writeAtomic(FILE, JSON.stringify({ version: 1, pid: process.pid, port: srv.port, token, label: label(), workspaceFile: workspaceFile(), folders: f.map((x) => slash(x.uri.fsPath)), focusedAt, startedAt }));
    } catch (e) { log.appendLine(`Context server: could not write ${FILE}: ${e.message}`); }
  };

  try {
    fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
    for (const n of fs.readdirSync(DIR).filter((x) => x.endsWith('.json'))) {
      try {
        const { pid } = JSON.parse(fs.readFileSync(path.join(DIR, n), 'utf8'));
        if (Number.isInteger(pid) && pid !== process.pid && !alive(pid)) fs.unlinkSync(path.join(DIR, n)); // crash leftover
      } catch { /* malformed or racing another window: leave it */ }
    }
    const src = fs.readFileSync(path.join(__dirname, 'bridge.js'), 'utf8');
    let dest = null;
    try { dest = fs.readFileSync(BRIDGE, 'utf8'); } catch { /* first run */ }
    if (dest !== src) writeAtomic(BRIDGE, src);
  } catch (e) { log.appendLine(`Context server: setup in ${HOME} failed: ${e.message}`); }

  const remote = vscode.env.remoteName || (vscode.workspace.workspaceFolders || []).some((f) => f.uri.scheme !== 'file');
  if (remote) {
    log.appendLine(`Context server: not started, this window is remote or virtual (${vscode.env.remoteName || 'non-file folders'}).`);
  } else {
    startMcpServer({ token, tools, meta }).then((s) => {
      if (disposed) return s.close();
      srv = s;
      publish();
      log.appendLine(`Context server on 127.0.0.1:${s.port}, discovery ${FILE}`);
    }, (e) => log.appendLine(`Context server failed to start: ${e.message}`));
    subs.push(
      vscode.window.onDidChangeWindowState((s) => { if (s.focused) { focusedAt = now(); publish(); } }),
      vscode.workspace.onDidChangeWorkspaceFolders(publish),
    );
    if (shellApi) {
      const open = new WeakMap(); // execution -> record; the same object arrives in the start and the end event
      const record = (e) => {
        const cl = e.execution.commandLine;
        const cwd = e.execution.cwd;
        return { terminal: e.terminal.name, cwd: cwd ? slash(cwd.fsPath) : null, commandLine: String((cl && typeof cl === 'object' ? cl.value : cl) || '').slice(0, MAX_COMMAND),
          exitCode: null, startedAt: now(), endedAt: null, output: '', truncated: false };
      };
      const recordOf = (e) => { const r = record(e); termOf.set(r, e.terminal); return r; };
      subs.push(
        vscode.window.onDidStartTerminalShellExecution((e) => {
          const r = recordOf(e);
          open.set(e.execution, r);
          const stream = e.execution.read(); // data written before the first read() is lost, so read at once
          (async () => {
            try {
              // shortcut: raw VT data incl. colour codes and OSC 633 markers; strip them if agents trip over the noise.
              for await (const chunk of stream) {
                const s = r.output + chunk;
                if (s.length > MAX_RUN_OUTPUT) r.truncated = true;
                r.output = s.slice(-MAX_RUN_OUTPUT);
              }
            } catch { /* the terminal closed mid-stream: keep what arrived */ }
          })();
        }),
        // An end without a start: the command began before this window's listener; it gets a record without output.
        vscode.window.onDidEndTerminalShellExecution((e) => {
          const r = open.get(e.execution) || Object.assign(recordOf(e), { startedAt: null });
          open.delete(e.execution);
          Object.assign(r, { exitCode: e.exitCode ?? null, endedAt: now() });
          runs.push(r);
          if (runs.length > MAX_RUNS) runs.shift();
        }),
      );
    }
  }

  const bridgePath = slash(BRIDGE);
  const entry = JSON.stringify({ mcpServers: { vscode: { command: 'node', args: [bridgePath] } } }, null, 2);
  // B16: the native way next to CC Switch. Typed into a new terminal, never run: the owner presses Enter.
  const ADD = {
    'Add to Claude Code': ['t3vscode.mcpAddClaude', `claude mcp add --scope user vscode -- node "${bridgePath}"`],
    'Add to Codex': ['t3vscode.mcpAddCodex', `codex mcp add vscode -- node "${bridgePath}"`],
  };
  const type = (line) => { const t = vscode.window.createTerminal({ name: 'T3' }); t.show(false); t.sendText(line, false); };
  for (const [id, line] of Object.values(ADD)) subs.push(vscode.commands.registerCommand(id, () => type(line)));
  // R20: the newest finished command of the active terminal, else of any terminal, into the composer through extension.js.
  subs.push(vscode.commands.registerCommand('t3vscode.addLastCommand', () => {
    const active = vscode.window.activeTerminal;
    const r = [...runs].reverse().find((x) => termOf.get(x) === active) || runs[runs.length - 1];
    if (!r) return void vscode.window.showInformationMessage('No command recorded yet (shell integration needed)'); // not awaited: the command returns now
    const out = plain(r.output).replace(/\n+$/, '').slice(-MAX_LAST);
    const text = '```\n$ ' + r.commandLine + '\n' + out + '\n```' + (r.exitCode ? `\nexit ${r.exitCode}` : '');
    return vscode.commands.executeCommand('t3vscode._mention', text);
  }));
  // R18: once per window after the first paired render (extension.js), only when no harness has the server; "Not now" is kept.
  let nudged = false;
  subs.push(vscode.commands.registerCommand('t3vscode._mcpNudge', async () => {
    if (nudged || remote || context.globalState.get('t3vscode.mcpNudgeOff')) return;
    nudged = true;
    if (Object.values(harnesses()).some(Boolean)) return;
    const pick = await vscode.window.showInformationMessage('Agents in T3 cannot see VS Code yet.', 'Set up', 'Not now');
    if (pick === 'Set up') return vscode.commands.executeCommand('t3vscode.mcpSetup');
    if (pick === 'Not now') await context.globalState.update('t3vscode.mcpNudgeOff', true);
  }));
  // B16: VS Code's own MCP list (Copilot Chat and other agents inside VS Code). The API exists since VS Code 1.101.
  if (vscode.lm && typeof vscode.lm.registerMcpServerDefinitionProvider === 'function') {
    subs.push(vscode.lm.registerMcpServerDefinitionProvider('t3vscode.mcp', {
      provideMcpServerDefinitions: () => {
        if (remote) return []; // the bridge and the context server live on this machine only
        const def = new vscode.McpStdioServerDefinition('T3 VS Code context', 'node', [bridgePath]);
        const folders = vscode.workspace.workspaceFolders;
        if (folders && folders.length) def.cwd = folders[0].uri;
        return [def];
      },
    }));
  }
  subs.push(vscode.commands.registerCommand('t3vscode.mcpSetup', async () => {
    const found = harnesses(); // R18
    const lines = Object.entries(found).map(([h, scope]) => `${h}: ${scope ? `registered (${scope})` : 'not registered'}`);
    const missing = Object.keys(ADD).filter((b) => !found[b.slice('Add to '.length)]);
    const content = [
      '# T3 Code: VS Code context server setup',
      '',
      ...lines.map((l) => `- ${l}`),
      '',
      'Three ways to give your agents this server. Use one per harness:',
      '',
      '1. CC Switch: import the Claude Code form below at user scope. The button "Copy CC Switch entry" puts it on the clipboard.',
      '2. The buttons in the notification that opened with this page ("Add to Claude Code", "Add to Codex", shown only for a harness not registered; also commands "T3: Add MCP server to ..."):',
      '   each opens a VS Code terminal named T3 with the add line below typed in. Press Enter to run it.',
      '3. VS Code\'s own MCP list: agents inside VS Code (Copilot Chat) get "T3 VS Code context" from this extension;',
      '   it appears in MCP: List Servers without a config file (VS Code 1.101 or newer).',
      '',
      '## Claude Code (the form CC Switch imports)',
      '',
      '```json',
      entry,
      '```',
      '',
      '## Codex (~/.codex/config.toml)',
      '',
      '```toml',
      '[mcp_servers.vscode]',
      'command = "node"',
      `args = ["${bridgePath}"]`,
      '```',
      '',
      '## The add lines the buttons type',
      '',
      '```',
      ...Object.values(ADD).map(([, line]) => line),
      '```',
      '',
    ].join('\n');
    const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content });
    await vscode.window.showTextDocument(doc);
    // Not awaited: the message stays until a click or a dismiss, the command returns now.
    vscode.window.showInformationMessage(`${lines.join('. ')}.`, ...missing, 'Copy CC Switch entry').then(async (pick) => {
      if (ADD[pick]) return type(ADD[pick][1]);
      if (pick !== 'Copy CC Switch entry') return;
      await vscode.env.clipboard.writeText(entry);
      vscode.window.showInformationMessage('The CC Switch entry is on the clipboard.');
    }).catch((e) => log.appendLine(`MCP setup: ${e.message}`));
  }));

  process.on('exit', unpublish);
  return vscode.Disposable.from(...subs, {
    dispose: () => {
      disposed = true;
      process.removeListener('exit', unpublish);
      unpublish();
      if (srv) srv.close();
    },
  });
}

module.exports = { activate };
