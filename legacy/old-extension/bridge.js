// stdio MCP bridge: newline-delimited JSON-RPC on stdin/stdout, forwarded to one VS Code window's MCP server.
// No dependencies; the extension copies this file to <home>/.t3-vscode/bridge.js. stdout carries only JSON-RPC; logs go to stderr.
// Usage: node bridge.js [--workspace <folder or .code-workspace path>]
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const HOME = process.env.T3VSCODE_HOME || path.join(os.homedir(), '.t3-vscode');
const DIR = path.join(HOME, 'windows');
const TIMEOUT = Number(process.env.T3VSCODE_BRIDGE_TIMEOUT_MS) || 30000; // env override exists for the selfcheck
const RECONNECT = 10000;
const WIN = process.platform === 'win32';
const CWD = process.cwd();
const argAt = process.argv.indexOf('--workspace');
const BIND = argAt > 0 && process.argv[argAt + 1] ? norm(process.argv[argAt + 1]) : null;

let pinned = null; // { id, pid, label, port, token }
let protocolVersion = null;

function norm(p) {
  const s = path.resolve(p).replace(/\\/g, '/').replace(/\/+$/, '');
  return WIN ? s.toLowerCase() : s;
}

function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false; // kill(0, 0) signals our own process group and succeeds
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

function readWindows() {
  let names = [];
  try { names = fs.readdirSync(DIR).filter((n) => n.endsWith('.json')); } catch { return []; }
  const out = [];
  for (const n of names) {
    try {
      const w = JSON.parse(fs.readFileSync(path.join(DIR, n), 'utf8'));
      // Validated before selection, so a malformed descriptor is skipped instead of winning and failing later.
      const ok = w && w.version === 1 && Number.isInteger(w.pid) && Number.isInteger(w.port) && w.port >= 1 && w.port <= 65535
        && typeof w.token === 'string' && /^[\x21-\x7e]+$/.test(w.token)
        && (w.workspaceFile == null || typeof w.workspaceFile === 'string')
        && Array.isArray(w.folders) && w.folders.every((f) => typeof f === 'string' && path.isAbsolute(f));
      if (ok && alive(w.pid)) out.push(w);
    } catch { /* malformed or half-deleted: skip */ }
  }
  return out;
}

const identity = (w) => (w.workspaceFile ? 'ws:' + norm(w.workspaceFile) : 'f:' + w.folders.map(norm).sort().join('|'));
const label = (w) => `${w.label || '?'} (pid ${w.pid})`;
const fail = (message) => { throw new Error(message); };
const latest = (ws) => ws.sort((a, b) => String(b.focusedAt || b.startedAt || '').localeCompare(String(a.focusedAt || a.startedAt || '')))[0]; // ISO strings

// R19: T3 puts worktrees under <T3 home>/worktrees, outside every window folder. The first .git up from dir, when it is a file
// reading "gitdir: <main>/.git/worktrees/<name>", names the main checkout. A .git directory or any other gitdir (submodule, bare) gives null.
function mainCheckout(dir) {
  for (let d = path.resolve(dir); ; d = path.dirname(d)) {
    let st, m;
    try {
      st = fs.statSync(path.join(d, '.git'), { throwIfNoEntry: false });
      if (st && st.isFile()) m = /^gitdir:\s*(.+?)\s*$/m.exec(fs.readFileSync(path.join(d, '.git'), 'utf8'));
    } catch { return null; } // an unreadable .git keeps decision 10's fallback
    if (st) {
      if (!st.isFile()) return null;
      const hit = m && /^(.*)\/\.git\/worktrees\/[^/]+$/.exec(path.resolve(d, m[1]).replace(/\\/g, '/')); // a relative gitdir resolves against d
      return hit ? hit[1] : null;
    }
    if (path.dirname(d) === d) return null;
  }
}

function select() {
  const wins = readWindows();
  if (!wins.length) fail('No VS Code window with t3-vscode active.');
  let hits;
  let worktree = false;
  if (BIND) {
    hits = wins.filter((w) => (w.workspaceFile && norm(w.workspaceFile) === BIND) || w.folders.some((f) => norm(f) === BIND));
    if (!hits.length) fail(`No VS Code window has ${BIND} open.`);
  } else {
    // The windows whose deepest folder holding p (on a directory boundary) is the deepest of all; none: [].
    const deepest = (p) => {
      const depth = (w) => Math.max(-1, ...w.folders.map(norm).filter((f) => p === f || p.startsWith(f + '/')).map((f) => f.length));
      const best = Math.max(...wins.map(depth));
      return best < 0 ? [] : wins.filter((w) => depth(w) === best);
    };
    hits = deepest(norm(CWD));
    const main = !hits.length && mainCheckout(CWD);
    if (main) { hits = deepest(norm(main)); worktree = hits.length > 0; }
    if (!hits.length) hits = wins; // no window has the cwd: fall back to the one used last
  }
  // Decision 10: never make the agent manage windows. A tie or a miss takes the last focused window; the result says so (match: fallback).
  const fallback = !BIND && (hits.length > 1 || hits === wins);
  const w = latest(hits);
  return { id: identity(w), pid: w.pid, label: label(w), port: w.port, token: w.token, fallback, worktree };
}

// Reconnect only to the pinned window: its own pid while that lives, else the window with the pinned identity (a reload); several: the last focused, flagged.
function repin() {
  const wins = readWindows().filter((x) => identity(x) === pinned.id);
  const w = wins.find((x) => x.pid === pinned.pid) || latest(wins);
  if (w) Object.assign(pinned, { pid: w.pid, port: w.port, token: w.token, label: label(w), fallback: pinned.fallback || (w.pid !== pinned.pid && wins.length > 1) });
}

function post(target, body) {
  return new Promise((resolve, reject) => {
    const headers = {
      Host: `127.0.0.1:${target.port}`,
      Authorization: `Bearer ${target.token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'X-T3-Cwd': Buffer.from(CWD, 'utf8').toString('base64url'),
    };
    if (target.fallback) headers['X-T3-Fallback'] = '1';
    if (target.worktree) headers['X-T3-Worktree'] = '1';
    if (protocolVersion) headers['MCP-Protocol-Version'] = protocolVersion;
    const req = http.request({ host: '127.0.0.1', port: target.port, path: '/mcp', method: 'POST', headers, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => { clearTimeout(timer); resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }); });
      res.on('error', (e) => { clearTimeout(timer); reject(e); });
    });
    const timer = setTimeout(() => req.destroy(Object.assign(new Error(`VS Code window ${target.label} did not answer within ${TIMEOUT / 1000} s.`), { timeout: true })), TIMEOUT);
    req.on('error', (e) => { clearTimeout(timer); reject(e); });
    req.end(body);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function forward(body) {
  if (!pinned) pinned = select();
  const deadline = Date.now() + RECONNECT;
  let retried401 = false;
  for (;;) {
    let r;
    try {
      r = await post(pinned, body);
    } catch (e) {
      if (e.timeout) throw e; // the request may have run: never re-send it
      // Only a refused connection proves the request never arrived (a reload or a closed window); after delivery an action may have run.
      if (e.code !== 'ECONNREFUSED') fail(`VS Code window ${pinned.label} lost the answer (${e.code || e.message}); the request may have run, check before repeating it.`);
      if (Date.now() > deadline) fail(`VS Code window ${pinned.label} is gone.`);
      await sleep(250);
      repin();
      continue;
    }
    if (r.status === 401 && !retried401) { retried401 = true; repin(); continue; }
    return r;
  }
}

const write = (obj) => process.stdout.write(JSON.stringify(obj) + '\n');
const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
const isObj = (m) => m !== null && typeof m === 'object' && !Array.isArray(m);
const isRequest = (m) => isObj(m) && (typeof m.id === 'string' || typeof m.id === 'number') && typeof m.method === 'string';

async function handleLine(line) {
  let msg;
  try { msg = JSON.parse(line); } catch { return write(rpcError(null, -32700, 'Parse error')); }
  if (Array.isArray(msg)) return write(rpcError(null, -32600, 'Batches are not supported')); // removed in MCP 2025-06-18
  const id = isRequest(msg) ? msg.id : null; // the server answers a malformed message with id null
  // Failures go back as an error for the request id; notifications get nothing.
  const failAll = (message) => (isRequest(msg) ? write(rpcError(id, -32000, message)) : void process.stderr.write(`t3-vscode bridge: ${message}\n`));
  let r;
  try { r = await forward(line); } catch (e) { return failAll(e.message); }
  if (r.status === 202) return;
  let out;
  try { out = JSON.parse(r.text); } catch { return failAll(`VS Code answered HTTP ${r.status} with a malformed body.`); }
  if (r.status !== 200) return failAll(`VS Code answered HTTP ${r.status}: ${(out && out.error) || r.text}`);
  const badError = isObj(out) && 'error' in out && !(isObj(out.error) && Number.isInteger(out.error.code) && typeof out.error.message === 'string');
  if (!isObj(out) || out.jsonrpc !== '2.0' || out.id !== id || ('result' in out) === ('error' in out) || badError) return failAll('VS Code sent a reply that is not a JSON-RPC response to this request.');
  if (isRequest(msg) && msg.method === 'initialize' && isObj(out.result) && typeof out.result.protocolVersion === 'string') protocolVersion = out.result.protocolVersion;
  write(out);
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (line) handleLine(line);
  }
});
process.stdin.on('end', () => { if (buf.trim()) handleLine(buf.trim()); });
