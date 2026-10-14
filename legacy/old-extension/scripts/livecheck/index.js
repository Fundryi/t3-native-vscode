// Runs inside the isolated VS Code window that scripts/livecheck.mjs starts. Writes <tmp>/result.json after every step.
// Unpaired on purpose: no bearer, no POST to T3. The MCP calls go to this window's own context server (context.js, mcp.js).
const fs = require('fs');
const path = require('path');
const http = require('http');
const Module = require('module');

const HOME = process.env.T3VSCODE_HOME;
const TMP = HOME ? path.dirname(HOME) : path.join(__dirname, '.livecheck');
const WS = path.join(TMP, 'ws');
const OUT = path.join(TMP, 'result.json');
const r = { steps: [], checks: [], errors: [], notes: [], passes: 0 };
const save = () => fs.writeFileSync(OUT, JSON.stringify(r, null, 2));
const step = (s) => { r.steps.push(`${new Date().toISOString()} ${s}`); save(); };
const check = (name, ok, detail) => { r.checks.push({ name, ok: !!ok, detail: ok ? undefined : detail }); if (ok) r.passes++; save(); };
const wait = (ms) => new Promise((res) => setTimeout(res, ms));
const norm = (p) => String(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase(); // context.js upper-cases the drive, fsPath lower-cases it
const within = (p, ms) => Promise.race([Promise.resolve(p), wait(ms).then(() => { throw new Error(`did not resolve in ${ms / 1000} s`); })]);
async function until(fn, ms) { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v || Date.now() > end) return v; await wait(250); } }

// The extension's own vscode object, wrapped: the panel provider and its setContext calls become visible. Pass-through only.
let provider = null;
let mcpProvider = null; // B16: context.js's MCP server definition provider; VS Code's own list is a proposed API
const contextCalls = [];
const origReq = Module.prototype.require;
Module.prototype.require = function (request) {
  const api = origReq.apply(this, arguments);
  if (request === 'vscode' && api.lm && norm(this && this.filename) === norm(path.join(__dirname, '..', '..', 'context.js'))) {
    const lm = Object.create(api.lm);
    lm.registerMcpServerDefinitionProvider = (id, p) => { mcpProvider = p; return api.lm.registerMcpServerDefinitionProvider(id, p); };
    return Object.defineProperty(Object.create(api), 'lm', { value: lm });
  }
  if (request !== 'vscode' || norm(this && this.filename) !== norm(path.join(__dirname, '..', '..', 'extension.js'))) return api;
  const win = Object.create(api.window);
  win.registerWebviewViewProvider = (id, p, o) => { provider = p; return api.window.registerWebviewViewProvider(id, p, o); };
  const cmds = Object.create(api.commands);
  cmds.executeCommand = (id, ...a) => { if (id === 'setContext') contextCalls.push(a); return api.commands.executeCommand(id, ...a); };
  const wrapped = Object.create(api);
  Object.defineProperty(wrapped, 'window', { value: win });
  Object.defineProperty(wrapped, 'commands', { value: cmds });
  r.instrumented = true;
  return wrapped;
};

function mcp(win, body) {
  return new Promise((resolve, reject) => {
    const text = JSON.stringify({ jsonrpc: '2.0', id: Date.now(), ...body });
    const req = http.request({ host: '127.0.0.1', port: win.port, path: '/mcp', method: 'POST', agent: false, headers: {
      Authorization: `Bearer ${win.token}`, 'Content-Type': 'application/json', Accept: 'application/json', 'Content-Length': Buffer.byteLength(text),
      'X-T3-Cwd': Buffer.from(WS, 'utf8').toString('base64url'),
    } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(new Error(`HTTP ${res.statusCode}: not JSON`)); } });
    });
    req.setTimeout(10000, () => req.destroy(new Error('MCP request timed out')));
    req.on('error', reject);
    req.end(text);
  });
}
async function tool(win, name, args = {}) {
  const res = await mcp(win, { method: 'tools/call', params: { name, arguments: args } });
  if (res.error) throw new Error(`${name}: ${res.error.message}`);
  if (res.result.isError) throw new Error(`${name}: ${res.result.content[0].text}`);
  return res.result.structuredContent;
}

async function run() {
  const vscode = require('vscode');
  try {
    step('run() started');
    const pkg = require('../../package.json');
    const ext = vscode.extensions.getExtension(`${pkg.publisher}.${pkg.name}`);
    r.activeBefore = ext ? ext.isActive : null;
    check('1 extension found', ext, `${pkg.publisher}.${pkg.name} not in extensions`);
    await ext.activate();
    check('1 extension activates', ext.isActive, 'isActive false after activate()');
    const all = new Set(await vscode.commands.getCommands(true));
    const missing = pkg.contributes.commands.map((c) => c.command).filter((c) => !all.has(c));
    check('1 every contributed command is registered', !missing.length, `missing: ${missing.join(', ')}`);
    check('1 the extension host has a global WebSocket (B14 Approve and Deny)', typeof globalThis.WebSocket === 'function', `typeof WebSocket is ${typeof globalThis.WebSocket} on Node ${process.version}`);
    step('step 1 done');

    // 2. The panel. Context keys and status bar items cannot be read through the API; setContext calls can be seen through the wrapper.
    await vscode.commands.executeCommand('t3vscode.panel.focus');
    await until(() => provider && provider.view, 10000);
    check('2 t3vscode.panel.focus resolves the webview view', provider && provider.view, `instrumented=${!!r.instrumented} provider=${!!provider}`);
    await until(() => contextCalls.some((a) => a[0] === 't3vscode.panelVisible' && a[1] === true), 5000);
    check('2 the extension sets t3vscode.panelVisible true', contextCalls.some((a) => a[0] === 't3vscode.panelVisible' && a[1] === true), JSON.stringify(contextCalls));
    r.notes.push('Context key values (t3vscode.panelVisible) and status bar items are not readable through the VS Code API; the check proves only the setContext call the extension made.');
    step('step 2 done');

    // 3. Code action on an error.
    const aUri = vscode.Uri.file(path.join(WS, 'a.ts'));
    const bUri = vscode.Uri.file(path.join(WS, 'b.ts'));
    const diag = vscode.languages.createDiagnosticCollection('livecheck');
    const range = new vscode.Range(0, 0, 0, 7);
    diag.set(aUri, [Object.assign(new vscode.Diagnostic(range, 'livecheck error', vscode.DiagnosticSeverity.Error), { source: 'livecheck' })]);
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(aUri));
    // The diagnostic reaches the workbench's marker service a moment after set(): ask again until it shows up.
    let actions = [];
    const fixes = () => actions.filter((a) => String(a.title).startsWith('Fix with T3:'));
    await until(async () => { actions = (await vscode.commands.executeCommand('vscode.executeCodeActionProvider', aUri, range)) || []; return fixes().length; }, 5000);
    const fix = fixes();
    check('3 one "Fix with T3:" code action for the error', fix.length === 1 && fix[0].title.includes('livecheck error'), JSON.stringify(actions.map((a) => a.title)));
    step('step 3 done');

    // 4. Code lens on the TODO line, and the setting that turns it off.
    const lenses = async () => ((await vscode.commands.executeCommand('vscode.executeCodeLensProvider', aUri)) || []).filter((l) => l.command && l.command.title === 'Implement with T3');
    const on = await lenses();
    check('4 one "Implement with T3" lens on the TODO line', on.length === 1 && on[0].range.start.line === 0, JSON.stringify(on.map((l) => l.range.start.line)));
    const cfg = () => vscode.workspace.getConfiguration('t3vscode');
    await cfg().update('todoLens', false, vscode.ConfigurationTarget.Global);
    const off = await lenses();
    check('4 no lens with t3vscode.todoLens false', off.length === 0, `${off.length} lenses`);
    await cfg().update('todoLens', undefined, vscode.ConfigurationTarget.Global);
    check('4 lens back after restoring the setting', (await lenses()).length === 1, 'no lens after restore');
    step('step 4 done');

    // 5. The MCP server of this window over HTTP, the way bridge.js calls it.
    const discovery = path.join(HOME, 'windows', `${process.pid}.json`);
    const win = await until(() => { try { return JSON.parse(fs.readFileSync(discovery, 'utf8')); } catch { return null; } }, 10000);
    check('5 discovery file written', win && win.port && win.token, `${discovery} missing`);
    const init = await mcp(win, { method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'livecheck', version: '0' } } });
    check('5 initialize', init.result && init.result.serverInfo && init.result.serverInfo.name === 't3-vscode', JSON.stringify(init));
    const names = ((await mcp(win, { method: 'tools/list' })).result || {}).tools.map((t) => t.name);
    const want = ['workspace', 'activeFile', 'openTabs', 'diagnostics', 'gitState', 'extensions', 'terminalOutput', 'openFile', 'revealInExplorer', 'showDiff'];
    check('5 tools/list has every tool', want.every((n) => names.includes(n)), JSON.stringify(names));

    const wsr = await tool(win, 'workspace');
    check('5 workspace lists the folder and matches the cwd', wsr.folders.some((f) => norm(f.path) === norm(WS)) && norm(wsr.cwdFolder) === norm(WS) && wsr.match === 'cwd', JSON.stringify(wsr));

    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(bUri), { preview: false });
    const tabs = await tool(win, 'openTabs');
    const tabPaths = tabs.tabs.map((t) => norm(t.path));
    check('5 openTabs lists both files, the active first', tabPaths[0] === norm(bUri.fsPath) && tabPaths.includes(norm(aUri.fsPath)), JSON.stringify(tabs.tabs));

    const d = await tool(win, 'diagnostics', { path: 'a.ts' });
    check('5 diagnostics has the error', d.items.some((i) => i.message === 'livecheck error' && i.line === 1 && i.severity === 'error' && i.source === 'livecheck'), JSON.stringify(d));

    // The Git extension opens the repository a moment after the window.
    const g = await until(async () => { const s = await tool(win, 'gitState'); return s.available && s.repos.length && s.repos[0].changes.length >= 2 ? s : null; }, 20000)
      || await tool(win, 'gitState');
    const repo = (g.repos || [])[0] || { changes: [] };
    const has = (name, status) => repo.changes.some((c) => norm(c.path) === norm(path.join(WS, name)) && c.status === status);
    check('5 gitState: branch main, b.ts modified, c.txt untracked', repo.branch === 'main' && has('b.ts', 'modified') && has('c.txt', 'untracked'), JSON.stringify(g));

    const ex = await tool(win, 'extensions');
    check('5 extensions has total and items', Number.isInteger(ex.total) && Array.isArray(ex.items), JSON.stringify(ex).slice(0, 300));
    const term = await tool(win, 'terminalOutput');
    check('5 terminalOutput answers', typeof term.supported === 'boolean' && Array.isArray(term.items), JSON.stringify(term));
    r.notes.push(`terminalOutput supported: ${term.supported}`);

    // Actions share a 300 ms gate in extension.js (busy()), so they are spaced.
    const of = await tool(win, 'openFile', { path: 'a.ts', line: 2 });
    const ed = vscode.window.activeTextEditor;
    check('5 openFile a.ts line 2', of.ok && ed && norm(ed.document.uri.fsPath) === norm(aUri.fsPath) && ed.selection.active.line === 1, `${JSON.stringify(of)} active=${ed && ed.document.uri.fsPath}:${ed && ed.selection.active.line + 1}`);
    await wait(400);
    const outside = await tool(win, 'openFile', { path: path.join(HOME, 'outside.txt') });
    check('5 openFile outside the folders is refused', outside.ok === false && outside.reason === 'outside the workspace folders', JSON.stringify(outside));
    await wait(400);
    const rv = await tool(win, 'revealInExplorer', { path: 'a.ts' });
    check('5 revealInExplorer a.ts', rv.ok === true, JSON.stringify(rv));
    await wait(400);
    const sd = await tool(win, 'showDiff', { path: 'b.ts' });
    const t = vscode.window.tabGroups.activeTabGroup.activeTab;
    const isDiff = t && t.input instanceof vscode.TabInputTextDiff;
    const shown = t && t.input && (t.input.modified || t.input.uri);
    check('5 showDiff b.ts opens its diff', sd.ok === true && isDiff && norm(shown.fsPath) === norm(bUri.fsPath), `${JSON.stringify(sd)} tab=${t && t.label} diff=${isDiff}`);
    // Test 16: a committed file without a working-tree change gives git.openChange nothing to show, so the plain file opens.
    await wait(400);
    const sa = await tool(win, 'showDiff', { path: 'a.ts' });
    const ta = vscode.window.tabGroups.activeTabGroup.activeTab;
    check('5 showDiff a.ts (committed, unchanged) opens the plain file', sa.ok === true && ta && ta.input instanceof vscode.TabInputText && norm(ta.input.uri.fsPath) === norm(aUri.fsPath), `${JSON.stringify(sa)} tab=${ta && ta.label}`);
    step('step 5 done');
    diag.dispose();

    // 6. Commands that must not throw unpaired (focusComposer has a keybinding with the panel closed; addSelection is gated on t3vscode.panelVisible).
    // reviewChanges and addSelection fall back to the clipboard: the owner's clipboard is put back.
    const clipboard = await vscode.env.clipboard.readText();
    for (const id of ['t3vscode.showLogs', 't3vscode.newThread', 't3vscode.switchThread', 't3vscode.openSettings', 't3vscode.reviewChanges', 't3vscode.focusComposer', 't3vscode.addSelection', 't3vscode.walkthrough', 't3vscode.copyThreadLink', 't3vscode.addLastCommand', 't3vscode.openInEditor', 't3vscode.showChanges']) {
      let err = null;
      try { await within(vscode.commands.executeCommand(id), 5000); } catch (e) { err = String((e && e.message) || e); }
      check(`6 ${id} does not throw unpaired`, !err, err);
    }
    // R7: two Explorer uris become one mention; unpaired, nothing binds, so it lands on the clipboard.
    await vscode.env.clipboard.writeText('');
    await vscode.commands.executeCommand('t3vscode.addToPrompt', aUri, [aUri, bUri]);
    const both = await until(async () => { const t = await vscode.env.clipboard.readText(); return t.includes('[a.ts](') && t.includes('[b.ts](') ? t : null; }, 20000);
    check('6 R7 addToPrompt with two selected uris puts one mention with both files', both && / \[b\.ts\]\(/.test(both) && both.split('](').length === 3, JSON.stringify(both));
    await vscode.env.clipboard.writeText(clipboard);
    // R4: Run in terminal goes to our own "T3" terminal, also when another terminal is active, and reuses it while no command runs there.
    const theirs = vscode.window.createTerminal({ name: 'livecheck' });
    theirs.show(false);
    await until(() => vscode.window.activeTerminal === theirs, 5000);
    provider.run('echo t3-livecheck');
    provider.run('echo again');
    const ours = vscode.window.terminals.filter((t) => t.name === 'T3' || t.name.startsWith('T3 '));
    check('6 Run in terminal makes one "T3" terminal and reuses it, never the active one', ours.length === 1 && ours[0].name === 'T3' && ours[0] !== theirs, JSON.stringify(vscode.window.terminals.map((t) => t.name)));
    for (const t of [...ours, theirs]) t.dispose();
    step('step 6 done');

    // 7. B16: the setup command unpaired, and the definition context.js hands VS Code's own MCP list.
    let setupErr = null;
    try { await within(vscode.commands.executeCommand('t3vscode.mcpSetup'), 5000); } catch (e) { setupErr = String((e && e.message) || e); }
    check('7 t3vscode.mcpSetup does not throw unpaired', !setupErr, setupErr);
    if (typeof (vscode.lm && vscode.lm.registerMcpServerDefinitionProvider) === 'function') {
      const defs = mcpProvider ? await mcpProvider.provideMcpServerDefinitions() : null;
      const a = defs && defs[0] && defs[0].args;
      check('7 the MCP provider answers one definition: node <...>/bridge.js', defs && defs.length === 1 && defs[0].command === 'node' && Array.isArray(a) && String(a.at(-1)).endsWith('bridge.js'),
        `provider=${!!mcpProvider} defs=${JSON.stringify(defs)}`);
      r.notes.push('The MCP definition is read from the provider through the test hook; VS Code\'s own server list (lm.mcpServerDefinitions) is a proposed API and cannot be read here.');
    } else r.notes.push('vscode.lm.registerMcpServerDefinitionProvider missing in this VS Code: no provider check.');
    step('step 7 done');

    // 8. R21: a t3.json with one script becomes one task of type t3 (written after the git checks: it is an untracked file).
    fs.writeFileSync(path.join(WS, 't3.json'), JSON.stringify({ scripts: [{ name: 'hello', command: 'echo t3-livecheck' }] }));
    const t3Tasks = await within(vscode.tasks.fetchTasks({ type: 't3' }), 10000);
    const hello = t3Tasks[0];
    check('8 R21 fetchTasks type t3 lists the t3.json script', t3Tasks.length === 1 && hello.name === 'hello' && hello.source === 'T3' && hello.definition.script === 'hello'
      && hello.execution && hello.execution.commandLine === 'echo t3-livecheck' && norm(hello.execution.options.cwd) === norm(WS), JSON.stringify(t3Tasks.map((t) => ({ name: t.name, source: t.source, definition: t.definition }))));
    step('step 8 done');
  } catch (e) {
    r.errors.push(String((e && e.stack) || e));
  }
  step('done');
  r.finished = true;
  save();
  try { await vscode.commands.executeCommand('workbench.action.closeWindow'); } catch { /* the launcher kills it */ }
}

module.exports = { run };
