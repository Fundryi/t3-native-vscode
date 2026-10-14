// The only file that knows T3. Every T3 surface we touch is a nightly risk, so it stays here.
// No vscode import: scripts/selfcheck.mjs requires this file directly.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);
const HOME = process.env.T3VSCODE_HOME || path.join(os.homedir(), '.t3-vscode'); // the extension's data dir, same expression as context.js
const CREDENTIAL_FIELDS =['access_token', 'refresh_token', 'subject_token', 'id_token', 'credential', 'token'];

function fail(code, message, extra) {
  return Object.assign(new Error(message), { code }, extra);
}

// Mask the exact secret, then anything token-shaped (long, digits and letters) as an extra layer, then cap.
// Redact before the cap: a cut can leave a prefix of the secret that no longer matches it.
// Masks keep the length (and '*' is outside the token class): a shorter mask would pull a copy cut off past the window back under the cap.
function redact(text, ...secrets) {
  const mask = (m) => '*'.repeat(m.length);
  let s = String(text);
  for (const secret of secrets) if (secret) s = s.split(secret).join(mask(secret));
  return s.replace(/[A-Za-z0-9._~+/=-]{20,}/g, (m) => (/\d/.test(m) && /[A-Za-z]/.test(m) ? mask(m) : m)).slice(0, 300);
}

function discover({ home } = {}) {
  const base = home || process.env.T3CODE_HOME || path.join(os.homedir(), '.t3');
  const file = path.join(base, 'userdata', 'server-runtime.json');
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    throw fail('no-runtime-file', `T3 has not run on this computer yet (${file} missing or unreadable).`);
  }
  let url;
  try {
    url = new URL(data.origin);
  } catch {
    throw fail('not-loopback', 'T3 runtime file has no usable origin.');
  }
  // A bearer must never leave this machine.
  if (url.protocol !== 'http:' || !LOOPBACK.has(url.hostname)) {
    throw fail('not-loopback', `T3 origin ${url.origin} is not a local http address.`);
  }
  return { origin: url.origin };
}

function call(url, { method = 'GET', headers = {}, body, timeout = 2000 } = {}) {
  return new Promise((resolve, reject) => {
    const lost = (why) => reject(fail('no-answer', `T3 did not answer at ${new URL(url).origin} (${why}).`, { why }));
    const req = http.request(url, { method, headers, timeout, agent: false }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, type: String(res.headers['content-type'] || ''), text }));
      // A body cut after the headers emits no 'end'; without these the promise never settles.
      res.on('error', (e) => lost(e.message));
      res.on('close', () => { if (!res.complete) lost('answer cut off'); });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (e) => lost(e.message));
    req.end(body);
  });
}

// /api/auth/session sends a short `scopes` summary; the full grant (with access:write) is in `permissions`.
const grantedScopes = (st) => st.permissions || st.scopes || [];

async function session(origin, token) {
  const headers = { accept: 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await call(origin + '/api/auth/session', { headers });
  // The SPA fallback answers 200 HTML for any unknown path, so HTML here means the route moved.
  if (!res.type.startsWith('application/json')) throw fail('route-moved', `T3 /api/auth/session answered ${res.type || 'no content type'}; a nightly may have moved it.`);
  try {
    return JSON.parse(res.text);
  } catch {
    throw fail('route-moved', 'T3 /api/auth/session answered invalid JSON.');
  }
}

function tokenFromLink(text) {
  const s = String(text || '').trim();
  if (/^[A-Za-z0-9_-]+$/.test(s)) return s;
  // Hash first, like T3's own parser. The query form is only read from what the owner pasted, never built.
  const m = /#(?:[^#]*&)?token=([^&#]+)/.exec(s) || /\?(?:[^#]*&)?token=([^&#]+)/.exec(s);
  try {
    return m ? decodeURIComponent(m[1]).trim() || null : null;
  } catch {
    return null; // malformed escape such as "#token=%"
  }
}

// R10: text worth putting into the pairing field from the clipboard: T3's link (/pair, token in the hash or query; packages/shared/src/remote.ts)
// or a bare 12-character code (PairingGrantStore.ts). tokenFromLink alone would take any single word.
const pairingText = (s) => (/^https?:\/\/\S+$/.test(s) ? !!tokenFromLink(s) : /^[2-9A-HJ-NP-Z]{12}$/.test(s));

function parseJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

// The replacer drops credential fields at any depth, not only the top level.
const refusal = (res, json, secret) => redact(json ? JSON.stringify(json, (k, v) => (CREDENTIAL_FIELDS.includes(k) ? undefined : v)) : res.text, secret);

async function exchange(origin, pairingToken, label) {
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
    subject_token: pairingToken,
    subject_token_type: 'urn:t3:params:oauth:token-type:environment-bootstrap',
    requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
    client_label: label,
  }).toString();
  const res = await call(origin + '/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json', 'content-length': Buffer.byteLength(body) },
    body,
    timeout: 5000,
  });
  const json = parseJson(res.text);
  if (res.status !== 200 || !json || !json.access_token) {
    throw fail('exchange-failed', `T3 refused the pairing token (status ${res.status}): ${refusal(res, json, pairingToken)}`, { status: res.status });
  }
  const expiresAt = Number.isFinite(json.expires_in) ? new Date(Date.now() + json.expires_in * 1000).toISOString() : null;
  // This object is what the extension stores. OAuth sends scopes space-joined; /api/auth/session sends an array.
  return { bearer: json.access_token, expiresAt, scopes: String(json.scope || '').split(' ').filter(Boolean) };
}

// Decision 8: a session is a fixed 30 days with no refresh, so one holding access:write mints its own next pairing token.
async function renew(origin, bearer, scopes, label = 'VS Code') {
  if (!Array.isArray(scopes) || !scopes.includes('access:write')) return null;
  // Without scopes T3 grants its standard set, which lacks access:write, so the renewal after this one would fail.
  // review:write is not grantable (AuthGrantScope).
  const body = JSON.stringify({ label, scopes: scopes.filter((x) => x !== 'review:write') });
  const res = await call(origin + '/api/auth/pairing-token', {
    method: 'POST',
    headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json', accept: 'application/json', 'content-length': Buffer.byteLength(body) },
    body,
    timeout: 5000,
  });
  const json = parseJson(res.text);
  if (res.status !== 200 || !json || !json.credential) {
    throw fail('renew-failed', `T3 refused to mint a pairing token (status ${res.status}): ${refusal(res, json, bearer)}`, { status: res.status });
  }
  return exchange(origin, json.credential, label);
}

// Row 1 of docs/SYNC.md, design in docs/PROJECT.md ("Lead decisions after the review").
// T3's client compares roots like this (packages/shared/src/path.ts); the server compares path.resolve output exactly.
function normalizeRoot(p) {
  const s = path.resolve(p).replace(/\\/g, '/');
  return (/^[A-Za-z]:\/$/.test(s) ? s : s.replace(/\/+$/, '')).toLowerCase();
}
// VS Code's fsPath has a lower-case drive, T3's rows an upper-case one: one spelling for every window, so the server's own lock dedupes.
const createRoot = (p) => path.resolve(p).replace(/^[a-z](?=:)/, (c) => c.toUpperCase());

// Ensure-step errors are written here from route and status only, never from an upstream header or body (Codex C2): they reach the card and the log.
const unanswered = (route, e) => fail('no-answer', `T3 did not answer on ${route}${e.why === 'timeout' ? ' within 5 s' : ''}`);

// Status 200 and JSON or a throw: the SPA fallback answers 200 HTML for a route that moved.
async function getJson(origin, route, headers = {}) {
  let res;
  try { res = await call(origin + route, { headers: { accept: 'application/json', ...headers }, timeout: 5000 }); } catch (e) { throw unanswered(route, e); }
  if (res.status !== 200) throw fail('route-failed', `T3 answered ${res.status} on ${route}`, { status: res.status });
  const json = res.type.startsWith('application/json') ? parseJson(res.text) : null;
  if (!json || typeof json !== 'object') throw fail('route-failed', `the answer on ${route} was not JSON`, { status: res.status });
  return json;
}

async function environmentId(origin) {
  const j = await getJson(origin, '/.well-known/t3/environment');
  if (typeof j.environmentId !== 'string' || !j.environmentId) throw fail('route-failed', 'T3 /.well-known/t3/environment has no environmentId');
  return j.environmentId;
}

// Active projects: { id, title, workspaceRoot, ... } (packages/contracts/src/project.ts).
async function projects(origin, bearer) {
  const j = await getJson(origin, '/api/projects', { authorization: `Bearer ${bearer}` });
  if (!Array.isArray(j.projects)) throw fail('route-failed', 'T3 /api/projects has no projects list');
  return j.projects.filter((p) => p && typeof p.id === 'string' && typeof p.workspaceRoot === 'string' && !p.deletedAt);
}

// Decision 5: the minimal payload, no scripts (scripts would need settings scopes).
async function createProject(origin, bearer, root, title) {
  const body = JSON.stringify({ type: 'project.create', commandId: crypto.randomUUID(), projectId: crypto.randomUUID(), title, workspaceRoot: root, createWorkspaceRootIfMissing: false });
  let res;
  try {
    res = await call(origin + '/api/projects/mutate', {
      method: 'POST',
      headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json', accept: 'application/json', 'content-length': Buffer.byteLength(body) },
      body,
      timeout: 5000,
    });
  } catch (e) { throw unanswered('/api/projects/mutate', e); }
  if (res.status !== 200) throw fail('create-failed', `T3 refused to create the project (${res.status})`, { status: res.status });
}

// Codex C4: one create per folder across VS Code windows. The server dedupes only identical spellings; two windows may spell a root differently.
// A lock dir older than 30 s was left by a window that died mid-create.
async function takeLock(want, late) {
  const lock = path.join(HOME, 'locks', crypto.createHash('sha1').update(want).digest('hex'));
  for (;;) {
    if (late()) throw new Error('T3 did not answer within 8 s');
    try {
      fs.mkdirSync(path.dirname(lock), { recursive: true });
      fs.mkdirSync(lock); // not recursive: EEXIST is the lock being held
      return lock;
    } catch (e) { if (e.code !== 'EEXIST') throw new Error('the create lock could not be taken'); }
    let age = 0;
    try { age = Date.now() - fs.statSync(lock).mtimeMs; } catch {} // released meanwhile: the next try takes it
    // shortcut: two windows that both find a stale lock can both take it (a crash leftover, a microsecond window), upgrade to an owner file if it shows up.
    if (age > 30000) try { fs.rmdirSync(lock); continue; } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
}

// Decision 4, the rule of T3's getLatestThreadForProject (threadSort.ts): first valid of latestUserMessageAt, updatedAt, createdAt; ties to the larger id.
const when = (t) => { for (const v of [t.latestUserMessageAt, t.updatedAt, t.createdAt]) { const n = Date.parse(v); if (!isNaN(n)) return n; } return -Infinity; };
const newestFirst = (a, b) => when(b) - when(a) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
// An open thread: not archived, not deleted, not a subagent's.
const open = (t) => t && typeof t.id === 'string' && t.archivedAt == null && t.deletedAt == null && !(t.lineage && t.lineage.relationshipToParent === 'subagent');
async function shell(origin, bearer) {
  const j = await getJson(origin, '/api/orchestration/shell', { authorization: `Bearer ${bearer}`, 'x-t3-orchestration-protocol': '2' });
  if (!Array.isArray(j.threads)) throw fail('route-failed', 'T3 /api/orchestration/shell has no threads list');
  return j;
}
// preferThread: the thread the owner was last in (NAV.md section 1), used while it is still an open thread of the project.
async function latestThread(origin, bearer, projectId, preferThread) {
  const mine = (await shell(origin, bearer)).threads.filter((t) => open(t) && t.projectId === projectId);
  if (mine.some((t) => t.id === preferThread)) return preferThread;
  return mine.length ? mine.sort(newestFirst)[0].id : null;
}

// The run statuses that are still going (OrchestrationV2RunStatus in packages/contracts/src/orchestrationV2.ts); the rest are ends.
const RUNNING = new Set(['preparing', 'queued', 'starting', 'running', 'waiting']);
// a is b or inside it, directory boundary only (both normalizeRoot values).
const within = (a, b) => a === b || a.startsWith(b.endsWith('/') ? b : b + '/');
// R25: the first non-blank line of a T3 text, capped for a toast.
const line = (s) => String(s || '').trim().split(/\r?\n/)[0].trim().slice(0, 120);
// R27: T3's hasUnseenCompletion (Sidebar.logic.ts): a run completed after the last visit; no server visit is never unread (no local store).
const unread = (t) => {
  const done = Date.parse(t.latestRunCompletedAt);
  if (isNaN(done) || !t.lastVisitedAt) return false;
  const seen = Date.parse(t.lastVisitedAt);
  return isNaN(seen) || done > seen;
};

// NAV.md section 2: the threads related to this window's folders. Bounded to 5 s, never throws.
async function threadsFor({ origin, bearer, folders, project }) {
  const dirs = (folders || []).map(normalizeRoot);
  const want = normalizeRoot(project);
  let timer;
  const limit = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('T3 did not answer within 5 s')), 5000); });
  try {
    const [j, env] = await Promise.race([Promise.all([shell(origin, bearer), environmentId(origin)]), limit]);
    const projs = (Array.isArray(j.projects) ? j.projects : []).filter((p) => p && typeof p.id === 'string' && typeof p.workspaceRoot === 'string');
    const roots = new Map(projs.map((p) => [p.id, normalizeRoot(p.workspaceRoot)]));
    const titles = new Map(projs.map((p) => [p.id, String(p.title || '')]));
    const raw = new Map(projs.map((p) => [p.id, p.workspaceRoot])); // T3's own spelling, for paths and terminals
    const bound = new Set(projs.filter((p) => roots.get(p.id) === want).map((p) => p.id));
    const take = (t) => {
      if (!open(t)) return false;
      const root = roots.get(t.projectId);
      if (bound.has(t.projectId) || (root && dirs.some((f) => within(root, f)))) return true;
      if (root && dirs.some((f) => f !== root && within(f, root))) return false; // a parent project (the home folder) would swallow everything
      return typeof t.worktreePath === 'string' && dirs.some((f) => within(normalizeRoot(t.worktreePath), f));
    };
    const items = j.threads.filter(take).sort(newestFirst).map((t) => {
      const req = t.pendingRuntimeRequest && typeof t.pendingRuntimeRequest.id === 'string' ? t.pendingRuntimeRequest.id : '';
      return { id: t.id, title: typeof t.title === 'string' ? t.title : '', projectId: t.projectId, projectTitle: titles.get(t.projectId) || '', mine: bound.has(t.projectId),
        // R5: where the thread works (T3's RuntimePolicy: its worktree, else its project's root); its relative chips, mentions and terminal resolve here.
        root: typeof t.worktreePath === 'string' ? t.worktreePath : raw.get(t.projectId) || null,
        run: typeof t.latestRunId === 'string' ? t.latestRunId : '', // R2: one toast per run end
        at: [t.latestUserMessageAt, t.updatedAt, t.createdAt].find((v) => typeof v === 'string' && !isNaN(Date.parse(v))) || '', // the time when() sorted by, for the row
        // docs/QOL.md item 5: the thread's activity for the status bar, badge and notifications.
        status: typeof t.status === 'string' ? t.status : '', active: RUNNING.has(t.status) || typeof t.activeRunId === 'string',
        needsYou: !!req || t.hasActionableProposedPlan === true, requestId: req, kind: req && typeof t.pendingRuntimeRequest.kind === 'string' ? t.pendingRuntimeRequest.kind : '',
        // R25: what the toast says; R27: the unread marker.
        said: t.latestVisibleMessage && t.latestVisibleMessage.role === 'assistant' ? line(t.latestVisibleMessage.text) : '', error: line(t.lastError),
        limitedUntil: t.status === 'failed' && t.lastErrorClass === 'usage_limit' && typeof t.usageLimitResetAt === 'string' ? t.usageLimitResetAt : null,
        plan: t.hasActionableProposedPlan === true && !req, unread: unread(t) };
    });
    return { items, environmentId: env };
  } catch (e) {
    return { items: [], environmentId: null, note: `T3 threads: ${redact(String(e && e.message), bearer)}` };
  } finally {
    clearTimeout(timer);
  }
}

// B14 (docs/APPROVE.md): what a pending request asks, from the thread's bounded snapshot. Never throws: { note } when unreadable.
// live: T3's own UI offers Approve only for a pending request it can still pass to a live provider session (threadRequests.ts).
// command: both adapters give the approval item and the tool's command_execution item the same nativeItemRef.
// decisions: the provider's options, else T3's own default buttons; warnings: each option's caution (a prompt injection warning), label first.
const DEFAULT_DECISIONS = ['cancel', 'decline', 'acceptForSession', 'accept']; // DEFAULT_APPROVAL_OPTIONS, ComposerPendingApprovalActions.tsx
async function pendingRequest({ origin, bearer, threadId, requestId }) {
  try {
    const j = await getJson(origin, `/api/orchestration/threads/${encodeURIComponent(threadId)}/bounded`, { authorization: `Bearer ${bearer}`, 'x-t3-orchestration-protocol': '2' });
    const p = j.projection || {};
    const req = (Array.isArray(p.runtimeRequests) ? p.runtimeRequests : []).find((r) => r && r.id === requestId);
    if (!req) return { note: `T3 request: ${requestId} is not in the thread` };
    const items = Array.isArray(p.turnItems) ? p.turnItems.filter((i) => i && typeof i === 'object') : [];
    const ask = items.findLast((i) => i.type === 'approval_request' && i.requestId === requestId);
    const ref = ask && ask.nativeItemRef;
    const cmd = ref && ref.nativeId && items.findLast((i) => i.type === 'command_execution' && i.nativeItemRef && i.nativeItemRef.nativeId === ref.nativeId && i.nativeItemRef.driver === ref.driver);
    const options = ask && Array.isArray(ask.options) ? ask.options.filter((o) => o && typeof o.decision === 'string') : null; // [] is no button, as in T3's UI
    return {
      kind: typeof req.kind === 'string' ? req.kind : '',
      live: req.status === 'pending' && !!req.responseCapability && req.responseCapability.type === 'live',
      prompt: ask && typeof ask.prompt === 'string' ? ask.prompt : '',
      command: cmd && typeof cmd.input === 'string' ? cmd.input : '',
      decisions: options ? options.map((o) => o.decision) : DEFAULT_DECISIONS,
      warnings: (options || []).filter((o) => typeof o.warning === 'string' && o.warning.trim()).map((o) => `${typeof o.label === 'string' ? o.label : o.decision}: ${o.warning.trim()}`),
      app: ask && typeof ask.appName === 'string' ? ask.appName : '',
    };
  } catch (e) {
    return { note: `T3 request: ${redact(String(e && e.message), bearer)}` };
  }
}

// T3's refusals for a request that is no longer pending (Orchestrator.ts, runtime-request.respond).
const ANSWERED = /Runtime request \S+ (is resolved|is expired|is cancelled|was not found)/;
// B14: what T3's web UI sends on Approve or Deny (respondToThreadApproval, packages/client-runtime/src/operations/commands.ts):
// one Effect RPC request over /ws, JSON per frame. Never throws, bounded to 10 s. { outcome: accepted | answered | failed, reason }.
async function respond({ origin, bearer, threadId, requestId, decision }) {
  let ws, timer, ticket, late = false; // late: the 10 s limit fired, so run() must not open or send anything after it
  const limit = new Promise((resolve) => { timer = setTimeout(() => { late = true; resolve({ outcome: 'failed', reason: 'T3 did not answer within 10 s' }); }, 10000); });
  const run = async () => {
    if (typeof globalThis.WebSocket !== 'function') throw new Error('this VS Code has no WebSocket client');
    let res;
    // content-length 0: a bodyless POST would otherwise go out chunked.
    try { res = await call(origin + '/api/auth/websocket-ticket', { method: 'POST', headers: { authorization: `Bearer ${bearer}`, accept: 'application/json', 'content-length': 0 }, timeout: 5000 }); } catch (e) { throw unanswered('/api/auth/websocket-ticket', e); }
    ticket = res.status === 200 ? (parseJson(res.text) || {}).ticket : null;
    if (typeof ticket !== 'string' || !ticket) throw new Error(`T3 gave no socket ticket (${res.status})`);
    if (late) throw new Error('too late to open the socket');
    // The ticket, not a bearer header: the standard WebSocket cannot set one, and it is what T3's own remote clients use.
    ws = new globalThis.WebSocket(`${origin.replace(/^http/, 'ws')}/ws?wsTicket=${encodeURIComponent(ticket)}&orchestrationProtocol=2`);
    return new Promise((resolve, reject) => {
      ws.onopen = () => late ? reject(new Error('too late to send')) : ws.send(JSON.stringify({ _tag: 'Request', id: '1', tag: 'orchestration.dispatchCommand',
        payload: { type: 'runtime-request.respond', commandId: crypto.randomUUID(), threadId, requestId, decision }, headers: [] }));
      ws.onmessage = (ev) => {
        for (const m of [].concat(parseJson(String(ev.data)) || [])) { // the server may batch messages in one array
          if (m && m._tag === 'Defect') return reject(new Error(`T3 refused the request: ${JSON.stringify(m.defect)}`));
          if (!m || m._tag !== 'Exit' || String(m.requestId) !== '1' || !m.exit) continue;
          if (m.exit._tag === 'Success') return resolve({ outcome: 'accepted' });
          const c = (Array.isArray(m.exit.cause) && m.exit.cause[0]) || {};
          const reason = redact((c.error && typeof c.error.message === 'string' && c.error.message) || JSON.stringify(c.defect !== undefined ? c.defect : m.exit), bearer, ticket);
          return resolve({ outcome: ANSWERED.test(JSON.stringify(m.exit)) ? 'answered' : 'failed', reason });
        }
      };
      ws.onerror = () => reject(new Error('the T3 socket failed'));
      ws.onclose = (ev) => reject(new Error(`T3 closed the socket (${ev.code}) before it answered`));
    });
  };
  try {
    return await Promise.race([run(), limit]);
  } catch (e) {
    return { outcome: 'failed', reason: redact(String(e && e.message), bearer, ticket) };
  } finally {
    clearTimeout(timer);
    try { if (ws) ws.close(); } catch {}
  }
}

// Decisions 1 to 7 in one place. Never throws: a failure lands on '/' with a visible note.
async function ensureProject({ origin, bearer, folder, scopes, preferThread }) {
  const root = createRoot(folder);
  const title = path.basename(root) || root.slice(0, 1); // a drive root has no basename: its letter
  const has = (x) => Array.isArray(scopes) && scopes.includes(x);
  let over = false;
  const step = async () => {
    if (!has('orchestration:read')) throw new Error('this pairing may not read threads. Pair again with that right');
    const want = normalizeRoot(folder);
    const find = async () => (await projects(origin, bearer)).filter((p) => normalizeRoot(p.workspaceRoot) === want);
    let hits = await find();
    if (!hits.length) {
      if (!has('orchestration:operate')) throw new Error('T3 has no project for it and this pairing may not create one. Add it in T3, or pair with the right to start threads');
      const lock = await takeLock(want, () => over);
      try {
        hits = await find(); // another window may have created it while this one waited
        if (!hits.length) {
          if (over) throw new Error('too late'); // the panel already fell back: no write behind its back
          let refused;
          try { await createProject(origin, bearer, root, title); } catch (e) { refused = e; }
          hits = await find(); // decision 3: only an exact active match counts, also after a refusal
          if (!hits.length) throw refused || new Error('T3 does not list the project it just created');
        }
      } finally {
        try { fs.rmdirSync(lock); } catch {}
      }
    }
    if (hits.length > 1) throw new Error(`T3 has ${hits.length} projects for this folder: ${hits.map((p) => p.title).join(', ')}. Keep one in T3`);
    const p = hits[0];
    const thread = await latestThread(origin, bearer, p.id, preferThread);
    if (!thread) return { path: '/', title: p.title, root: p.workspaceRoot, fresh: true, note: null }; // root exactly as T3 gave it: the palette row shows it
    const env = await environmentId(origin);
    return { path: `/${encodeURIComponent(env)}/${encodeURIComponent(thread)}`, title: p.title, root: p.workspaceRoot, fresh: false, note: null };
  };
  let timer;
  const limit = new Promise((_, reject) => { timer = setTimeout(() => { over = true; reject(new Error('T3 did not answer within 8 s')); }, 8000); });
  try {
    return await Promise.race([step(), limit]);
  } catch (e) {
    // redact() again at the boundary: a bearer must never reach the card or the log, even from a message this file did not write.
    return { path: '/', title, fresh: false, note: `T3 is not on ${title}: ${redact(String(e && e.message).replace(/\.$/, ''), bearer)}. Reload to retry.` };
  } finally {
    clearTimeout(timer);
  }
}

// Runs inside T3's page (injected by the forwarder). Stringified, so every literal stays inside; plain DOM calls only (selfcheck feeds plain objects).
// A plain click on a chat file chip, a mention chip or a diff title with a local absolute or a safe relative path goes to our panel instead of T3's preview;
// anything unsure stays with T3.
function injected() {
  try {
    if (window.__t3vscode) return;
    window.__t3vscode = true;
    if (window.parent === window) return;
    try { void window.parent.location.origin; return; } catch (e) {} // readable: a same-origin parent, not our panel
    // B11: T3's desktop notifications (ThreadNotificationCoordinator.tsx) go to VS Code; the frame's real permission cannot be granted. Before T3's bundle runs.
    var shown = []; // the last 20 by tag: a Show in VS Code calls T3's own click listeners, which navigate
    try {
      var Shim = function Notification(title, options) {
        var o = options && typeof options === 'object' ? options : {};
        this.title = String(title);
        this.body = o.body == null ? '' : String(o.body);
        this.tag = o.tag == null ? '' : String(o.tag);
        this.onclick = null;
        this.clicks = [];
        var tag = this.tag;
        shown = shown.filter(function (n) { return n.tag !== tag; }).concat([this]).slice(-20);
        try { window.parent.postMessage({ type: 't3vscode:notify', title: this.title.slice(0, 300), body: this.body.slice(0, 300), tag: tag.slice(0, 300) }, '*'); } catch (e) {}
      };
      Shim.permission = 'granted';
      Shim.requestPermission = function (cb) { if (typeof cb === 'function') cb('granted'); return Promise.resolve('granted'); };
      Shim.prototype.close = function () {};
      Shim.prototype.addEventListener = function (type, fn) { if (type === 'click' && typeof fn === 'function') this.clicks.push(fn); };
      window.Notification = Shim;
    } catch (e) {}
    // NAV.md section 1: the panel learns which thread is shown. Wrapped now, from <head>, before T3's router takes the history methods.
    var where = function () { try { window.parent.postMessage({ type: 't3vscode:location', pathname: String(window.location.pathname) }, '*'); } catch (e) {} };
    try {
      ['pushState', 'replaceState'].forEach(function (k) {
        var orig = window.history[k];
        if (typeof orig !== 'function') return;
        window.history[k] = function () { var r = orig.apply(this, arguments); where(); return r; };
      });
      window.addEventListener('popstate', where);
    } catch (e) {}
    where();
    // NAV.md section 5: the panel switches threads in place. T3's router (TanStack browser history) reads a popstate like a back step and renders
    // only the thread view; the wrapped pushState above reports the new pathname. A path only, never a URL: the panel falls back to a reload.
    window.addEventListener('message', function (e) {
      try {
        var d = e.data;
        if (e.source !== window.parent || !d || typeof d !== 'object' || d.type !== 't3vscode:go' || typeof d.pathname !== 'string' || d.pathname.charAt(0) !== '/' || d.pathname.indexOf('://') !== -1) return;
        // The proof that T3 switched: its chat header shows the target title (the title sits next to [data-thread-title-chevron], ChatHeader.tsx).
        // Same title before and after, or no title given: nothing to prove, report ok. No proof within 1.5 s: ok:false, the panel reloads.
        var title = typeof d.title === 'string' ? d.title : '';
        var shows = function () { try { var c = document.querySelector('[data-thread-title-chevron]'); return !!(c && c.parentElement && c.parentElement.textContent.indexOf(title) !== -1); } catch (x) { return false; } };
        var proof = !title || shows();
        window.history.pushState(null, '', d.pathname);
        window.dispatchEvent(new PopStateEvent('popstate'));
        var reply = function (ok) { try { window.parent.postMessage({ type: 't3vscode:go-result', ok: ok }, '*'); } catch (x) {} };
        if (proof) return reply(true);
        var left = 15;
        var t = setInterval(function () { try { if (shows()) { clearInterval(t); reply(true); } else if (--left <= 0) { clearInterval(t); reply(false); } } catch (x) { clearInterval(t); reply(false); } }, 100);
      } catch (err) {}
    });
    try { // the nightly mobile beta toast reads this key before it shows (NightlyMobileBeta.tsx)
      var key = 't3code:nightly-mobile-beta-notice-dismissed:v1';
      if (window.localStorage.getItem(key) === null) window.localStorage.setItem(key, 'true');
    } catch (e) {}
    try { // docs/QOL.md item 2: T3 chrome with no use inside VS Code, by aria-label (PanelLayoutControls.tsx); the :has part drops the tooltip wrapper span
      // R3: only while not pressed (Base UI's Toggle renders aria-pressed), so a drawer a script opened can still be closed
      var HIDE = ['[aria-label="Toggle terminal drawer"]:not([aria-pressed="true"])'];
      var css = document.createElement('style');
      css.textContent = HIDE.map(function (s) { return 'span:has(> ' + s + '), ' + s + ' { display: none !important; }'; }).join(' ');
      document.head.appendChild(css);
    } catch (e) {}
    var runHere = true; // B9: false when the extension's runInTerminal setting is 't3' (t3vscode:settings below)
    var keys = null; // R24: the key names keysToVsCode leaves with VS Code (t3vscode:settings below); null until it arrives: all six
    window.addEventListener('click', function (e) {
      try {
        if (!e.isTrusted || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
        var alt = e.altKey; // B20 and B12: Alt only on a diff title (VS Code's diff view) or a code block's Copy code (insert); any other Alt click stays with T3
        var path = e.composedPath();
        // Diagnostic for the owner's log: what the first link or button under a click looks like (tag and attributes, capped).
        var seen = function (el) { try { var a = []; for (var k = 0; k < el.attributes.length; k++) a.push(el.attributes[k].name + '=' + el.attributes[k].value); return (el.tagName + ' ' + a.join(' ')).slice(0, 400); } catch (x) { return '?'; } };
        var tell = function (why, el) { try { window.parent.postMessage({ type: 't3vscode:click', text: why + ': ' + (el ? seen(el) : 'no link or button in the path') }, '*'); } catch (x) {} };
        var send = function (raw, el) {
          var m = /:(\d+)(?::(\d+))?$/.exec(raw);
          var file = m ? raw.slice(0, m.index) : raw;
          // shortcut: Windows only (drive-letter paths); slash-rooted paths stay with T3 until a non-Windows host rule exists.
          var abs = /^[A-Za-z]:[\\/][^:]*$/.test(file);
          // B5: relative to the bound root (the extension resolves it): no scheme or drive (no colon), no leading slash, #, ? or parent step.
          var rel = !abs && file !== '' && file.indexOf(':') < 0 && !/^[\\/#?]/.test(file) && file.split(/[\\/]/).indexOf('..') < 0;
          if (!abs && !rel) return tell('href is not a local path', el);
          e.preventDefault();
          e.stopPropagation();
          var msg = { type: alt ? 't3vscode:open-diff' : 't3vscode:open-file', path: file, line: m ? Number(m[1]) : undefined, column: m && m[2] ? Number(m[2]) : undefined };
          if (rel) msg.relative = true;
          window.parent.postMessage(msg, '*');
        };
        var tags = path.map(function (n) { return n && typeof n.tagName === 'string' ? n.tagName.toLowerCase() : ''; });
        // B5: a diff file title (DiffPanel.tsx): repo-relative text of [data-title] under [data-diffs-header]; like T3, only with no link or button in the path.
        if (tags.indexOf('a') < 0 && tags.indexOf('button') < 0) {
          for (var j = 0; j < path.length; j++) {
            if (!tags[j] || path[j].getAttribute('data-title') === null) continue;
            for (var h = j + 1; h < path.length; h++) if (tags[h] && path[h].getAttribute('data-diffs-header') !== null) return send(String(path[j].textContent || '').trim(), path[j]);
            break;
          }
          return path.length && !alt ? tell('no match') : undefined;
        }
        // B12 and B9: the code of the block a button sits in (ChatMarkdown.tsx): the pre inside the chat-markdown-codeblock wrapper, else null.
        var codeOf = function (from) {
          for (var b = from + 1; b < path.length; b++) {
            if (!tags[b] || (' ' + (path[b].getAttribute('class') || '') + ' ').indexOf(' chat-markdown-codeblock ') < 0) continue;
            var pre = path[b].querySelector('pre');
            return pre ? String(pre.textContent || '') : null;
          }
          return null;
        };
        var first = tags.findIndex(function (t) { return t === 'a' || t === 'button'; });
        var labelled = function (l) { return tags[first] === 'button' && path[first].getAttribute('aria-label') === l; };
        if (alt) {
          // B12: Alt+click on a code block's "Copy code" sends the block's code to the VS Code cursor instead of copying it.
          var code = labelled('Copy code') ? codeOf(first) : null;
          if (code === null) return;
          e.preventDefault();
          e.stopPropagation();
          return window.parent.postMessage({ type: 't3vscode:insert', text: code.slice(0, 65536) }, '*');
        }
        // B9: a plain click on "Run in terminal" goes to a VS Code terminal; cancelled before React's root listener, so T3's drawer never opens.
        var run = runHere && labelled('Run in terminal') ? codeOf(first) : null;
        if (run !== null) {
          e.preventDefault();
          e.stopImmediatePropagation();
          return window.parent.postMessage({ type: 't3vscode:run', text: run.trim().slice(0, 16384) }, '*');
        }
        for (var i = 0; i < path.length; i++) {
          var el = path[i];
          var tag = tags[i];
          if (tag !== 'a' && tag !== 'button') continue;
          // The first link or button decides. Live check 2026-10-12: the chat's file chip is a plain <a href="D:..."> without data-slot (the source
          // suggested one), so the file path itself is the identity: a link to a local path, never a thread chip (aria-label "Thread, ...").
          var label = el.getAttribute('aria-label') || '';
          // B5: a mention chip in a message or the composer names its workspace-relative path in the label; image previews have no data-slot.
          if (tag === 'button') return el.getAttribute('data-slot') === 'context-chip' && label.indexOf('Preview ') === 0 ? send(label.slice(8), el) : tell('not a link', el);
          var href = el.getAttribute('href');
          if (href === null || /^Thread/.test(label)) return tell('no href or a thread chip', el);
          return send(href, el);
        }
      } catch (err) {}
    }, true);
    // The panel asks for the first thread of a fresh project (PROJECT.md Research 2, lead decisions after review 2): T3's command palette, searched
    // by folder name, one click on the only mounted project row whose path is exactly this root, then T3's header must name the project.
    var polling = false;
    window.addEventListener('message', function (e) {
      try {
        var d = e.data;
        if (polling || e.source !== window.parent || !d || typeof d !== 'object' || d.type !== 't3vscode:new-thread' || typeof d.root !== 'string' || typeof d.title !== 'string') return;
        var root = d.root;
        var label = 'New thread in ' + d.title;
        var header = function () { var all = document.querySelectorAll('button[aria-label]'); for (var k = 0; k < all.length; k++) if (all[k].getAttribute('aria-label') === label) return all[k]; return null; }; // no selector built from the title: a quote in it would throw
        var named = function () { return !!header(); };
        // NAV.md section 1: the project is already active in the frame, so its header button starts the thread. One click.
        var button = header();
        if (button) { button.click(); return window.parent.postMessage({ type: 't3vscode:new-thread-result', ok: true }, '*'); }
        // The last folder name, never the root: a path-like query turns the palette into folder browsing, ">" into actions only. A drive root: its letter.
        var query = (root.split(/[\\/]/).filter(Boolean).pop() || '').replace(/^([A-Za-z]):$/, '$1');
        if (!query || /^(\.{0,2}[\\/]|~\/|[A-Za-z]:|>)/.test(query)) return window.parent.postMessage({ type: 't3vscode:new-thread-result', ok: false }, '*');
        polling = true;
        var tries = 0;
        var sent = false; // dispatched at least once: only a palette this run opened is used
        var clicked = 0; // the tick of our click, 0 before it
        var closed = 0; // the tick the palette was first seen gone after the click
        var done = false;
        var timer;
        // The panel shows a note on ok:false (Codex C1). Our own click() is untrusted, so it never counts as the owner.
        var finish = function (ok) {
          if (done) return;
          done = true;
          clearInterval(timer);
          polling = false;
          window.removeEventListener('click', owner, true);
          window.removeEventListener('keydown', owner, true);
          window.parent.postMessage({ type: 't3vscode:new-thread-result', ok: ok }, '*');
        };
        // The owner clicking or typing in the page takes over: no scripted click after that (Codex C3).
        var owner = function (ev) { if (ev && ev.isTrusted) finish(false); };
        window.addEventListener('click', owner, true);
        window.addEventListener('keydown', owner, true);
        var text = function (el) { return (el.textContent || '').trim(); };
        timer = setInterval(function () {
          try {
            tries++;
            var open = document.querySelector('[data-command-palette]');
            if (clicked) {
              // T3 closes the palette when it runs the item (2 s); then its header button must name our project (3 s). One click, no second attempt.
              if (open && !closed) { if (tries - clicked >= 4) finish(false); return; }
              if (!closed) closed = tries;
              // R13: a project with threads opens its newest thread, not a new one (openProjectFromSearch); a fresh one is on its draft already. One header click.
              if (named()) { if (String(window.location.pathname).indexOf('/draft/') !== 0) header().click(); return finish(true); }
              if (tries - closed >= 6) finish(false);
              return;
            }
            if (open && !sent) return finish(false); // the owner's own palette: touch nothing
            if (tries >= 20) return finish(false); // 10 s; an open palette stays open with the query, for the owner to pick
            // The listener mounts with the page, so a dispatch before that is lost: repeat until the palette is there.
            if (!open) { sent = true; return window.dispatchEvent(new CustomEvent('t3code:open-command-palette', { detail: { query: query } })); }
            // Mounted rows only, no scrolling. T3 gives the path no attribute: a project row's text leaves end with its path (title, environment, dot, root),
            // a thread row ends with its time. So the root must be the last leaf and appear once (a title equal to the root never matches).
            var rows = document.querySelectorAll('[data-command-palette] [data-slot="command-item"]');
            var hits = [];
            for (var i = 0; i < rows.length; i++) {
              var spans = rows[i].querySelectorAll('span');
              var leaves = [];
              var roots = 0;
              for (var j = 0; j < spans.length; j++) if (!spans[j].children || !spans[j].children.length) { leaves.push(spans[j]); if (text(spans[j]) === root) roots++; }
              if (roots === 1 && leaves.length > 1 && text(leaves[leaves.length - 1]) === root) hits.push(rows[i]);
            }
            // A header that already names our title belongs to an older project with the same name: the post-check could not tell them apart, so the owner picks.
            if (hits.length === 1 && named()) return finish(false);
            if (hits.length === 1) { clicked = tries; hits[0].click(); } // none, grouped, unmounted or two: keep looking until 10 s
          } catch (err) { finish(false); }
        }, 500);
      } catch (err) {}
    });
    // docs/QOL.md item 7: no VS Code key reaches a focused frame, so Ctrl+Alt+C (T3 binds no mod+alt+c, keybindings.ts) asks the panel for the editor.
    // Not Ctrl+Escape: Windows opens the Start menu on it before any app sees the Escape.
    // Item 8: Ctrl+Shift+P opens VS Code's palette, not T3's pin thread (keybindings.ts). Immediate: T3 has capture listeners on window too; ours runs first.
    // B6: Ctrl+P (T3's file picker), Ctrl+J (T3's terminal) and Ctrl+Backquote go to VS Code too. Test 12: Ctrl+Alt+T (B4 thread picker; T3 binds only mod+alt+shift+t) as well.
    window.addEventListener('keydown', function (e) {
      try {
        if (!e.isTrusted || !e.ctrlKey || e.metaKey) return;
        var k = String(e.key).toLowerCase();
        // Test 12: VS Code binds ctrl+oem_3, which a German layout puts on the key right of L (code Semicolon, the O-umlaut key); a US Ctrl+; and other layouts' keys there stay with T3.
        var tick = e.code === 'Backquote' || e.key === '`' || (e.code === 'Semicolon' && (e.key === '\u00f6' || e.key === '\u00d6'));
        var name = e.altKey ? (e.shiftKey ? '' : k === 'c' ? 'blur' : k === 't' ? 'switch' : '') : e.shiftKey ? (k === 'p' ? 'palette' : '') : k === 'p' ? 'quickOpen' : k === 'j' ? 'panel' : tick ? 'terminal' : '';
        if (!name || (keys && keys.indexOf(name) < 0)) return; // R24: a name the owner took out stays with T3
        e.preventDefault();
        e.stopImmediatePropagation();
        window.parent.postMessage({ type: 't3vscode:key', key: name }, '*');
      } catch (err) {}
    }, true);
    // docs/QOL.md item 1: a Shift-drop from VS Code's Explorer or a tab. Trusted only: our own mention drop below crosses this window too.
    var dragTypes = function (e) { return e.isTrusted && e.dataTransfer ? Array.prototype.slice.call(e.dataTransfer.types || []).map(String) : null; };
    // A cross-origin frame may not see VS Code's own types; then text/plain (absolute paths, one per line) is the trail. Never T3's tree drag, never OS files.
    var low = function (types) { return types.map(function (t) { return t.toLowerCase(); }); };
    var ours = function (types) { var l = low(types); return l.indexOf('application/x-t3code-composer-mention') < 0 && l.indexOf('files') < 0 && (fromCode(types) || l.indexOf('text/plain') >= 0); };
    var fromCode = function (types) { var l = low(types); return l.indexOf('application/vnd.code.uri-list') >= 0 || l.indexOf('resourceurls') >= 0; };
    var dragSeen = ''; // one diagnostic line per drag: what the frame could see
    window.addEventListener('dragover', function (e) {
      try {
        var types = dragTypes(e);
        if (!types) return;
        var key = types.join(',');
        if (key !== dragSeen) { dragSeen = key; window.parent.postMessage({ type: 't3vscode:click', text: 'drag types: ' + key }, '*'); }
        if (!ours(types)) return;
        e.preventDefault(); // else the browser accepts the drop only on the editor
        e.dataTransfer.dropEffect = 'copy';
      } catch (err) {}
    }, true);
    window.addEventListener('drop', function (e) {
      try {
        dragSeen = '';
        var types = dragTypes(e);
        if (!types) return;
        if (ours(types)) {
          var dt = e.dataTransfer;
          var code = fromCode(types);
          var raw = (code && dt.getData('application/vnd.code.uri-list')) || dt.getData('text/plain') || (code && dt.getData('text/uri-list')) || ''; // text/plain carries every item, text/uri-list the first only
          var uris = raw.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(function (l) { return l && l.charAt(0) !== '#' && (code || /^[A-Za-z]:[\\/]/.test(l)); }).slice(0, 50).map(function (l) { return l.slice(0, 2000); });
          if (code || uris.length) { e.preventDefault(); e.stopPropagation(); } // no navigation to the file; T3's form and editor handlers never see it
          if (uris.length) return window.parent.postMessage({ type: 't3vscode:dropped', uris: uris }, '*');
        }
        if (types.indexOf('application/x-t3code-composer-mention') >= 0) return; // T3's own tree drag
        window.parent.postMessage({ type: 't3vscode:click', text: 'drop types: ' + types.join(',') }, '*'); // the owner's log shows what a drop carried when nothing happened
      } catch (err) {}
    }, true);
    // docs/QOL.md item 1: pasted absolute Windows paths (VS Code's Copy Path) go to the extension like a drop: chips, images as attachments.
    // Only plain text where every line is such a path; files, other text and anything outside the composer stay with T3.
    window.addEventListener('paste', function (e) {
      try {
        var cd = e.clipboardData;
        var el = e.target && e.target.nodeType === 1 ? e.target : e.target && e.target.parentElement;
        if (!e.isTrusted || !cd || cd.files.length || !el || !el.closest('[data-chat-composer-form]')) return;
        var lines = String(cd.getData('text/plain') || '').split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
        if (!lines.length || lines.length > 50 || !lines.every(function (l) { return l.length <= 2000 && /^[A-Za-z]:[\\/]/.test(l); })) return;
        e.preventDefault();
        e.stopImmediatePropagation(); // T3 must not paste the raw text too
        window.parent.postMessage({ type: 't3vscode:dropped', uris: lines }, '*');
      } catch (err) {}
    }, true);
    // docs/QOL.md items 7 and 1: T3's own composer focus event (ChatView.tsx), and a mention through T3's own drop contract (composerMentionDrag.ts).
    window.addEventListener('message', function (e) {
      var d = e.data;
      if (e.source !== window.parent || !d || typeof d !== 'object') return;
      if (d.type === 't3vscode:focus-composer') {
        try {
          window.dispatchEvent(new Event('t3code:focus-composer'));
          var ed = document.querySelector('[data-testid="composer-editor"]');
          if (ed && !ed.contains(document.activeElement)) ed.focus(); // the event did not land (no chat view mounted yet)
        } catch (err) {}
        return;
      }
      // Item 8: T3's own appearance mode key (themePalette.ts); its storage listener (useTheme.ts) applies a same-window event too. Kept for the next load.
      if (d.type === 't3vscode:theme') {
        try {
          var THEME = 't3code:theme-appearance-mode';
          if ((d.kind === 'dark' || d.kind === 'light') && window.localStorage.getItem(THEME) !== d.kind) {
            window.localStorage.setItem(THEME, d.kind);
            window.dispatchEvent(new StorageEvent('storage', { key: THEME, newValue: d.kind }));
          }
        } catch (err) {}
        return;
      }
      if (d.type === 't3vscode:settings') { // B9 and R24
        runHere = d.runInTerminal !== 't3';
        if (Array.isArray(d.keys)) keys = d.keys.filter(function (k) { return typeof k === 'string'; });
        return;
      }
      if (d.type === 't3vscode:palette') { // R13: T3's own palette, root view (no detail); not while a new-thread run drives it
        if (!polling) try { window.dispatchEvent(new CustomEvent('t3code:open-command-palette')); } catch (err) {}
        return;
      }
      if (d.type === 't3vscode:notify-click') { // B11: Show on a VS Code notification; T3's listener closes it, focuses and navigates
        var hit = shown.filter(function (n) { return n.tag === d.tag; })[0];
        if (hit) [hit.onclick].concat(hit.clicks).forEach(function (fn) { try { if (typeof fn === 'function') fn.call(hit, { type: 'click', target: hit }); } catch (err) {} });
        return;
      }
      // docs/QOL.md item 1: images through T3's own OS file drop on the chat view (workspaceFileDrop.ts checks only the "Files" type).
      // ok: the target was there and the drop dispatched; T3 still ignores it without a thread, so the extension sends none then.
      if (d.type === 't3vscode:attach') {
        var sent = false;
        try {
          var target = document.querySelector('[data-chat-workspace-drop-target]');
          if (target && Array.isArray(d.files)) {
            var files = new DataTransfer();
            d.files.forEach(function (f) { files.items.add(new File([Uint8Array.from(atob(f.data), function (c) { return c.charCodeAt(0); })], f.name, { type: f.type })); });
            target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: files }));
            sent = true;
          }
        } catch (err) {}
        try { window.parent.postMessage({ type: 't3vscode:attach-result', ok: sent }, '*'); } catch (err) {}
        return;
      }
      if (d.type !== 't3vscode:mention' || typeof d.text !== 'string') return;
      var ok = false;
      try {
        var form = document.querySelector('[data-chat-composer-form]');
        if (form) {
          var dt = new DataTransfer();
          dt.setData('application/x-t3code-composer-mention', d.text);
          ok = !form.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt })); // canceled: T3 claimed it
        }
      } catch (err) {}
      try { window.parent.postMessage({ type: 't3vscode:mention-result', ok: ok }, '*'); } catch (err) {}
    });
    // B18: T3 sends from Enter and the submit button by calling submitComposer itself, no form submit event (ChatComposer.tsx); submit covers a build that does.
    // shortcut: Enter that picks a mention menu item, or plain Enter with T3's Ctrl+Enter send setting, counts as a send too; a save too many is harmless.
    var onSent = function (e) {
      try {
        if (!e.isTrusted) return;
        var p = e.composedPath();
        var at = function (name, value) {
          for (var i = 0; i < p.length; i++) { var v = p[i] && typeof p[i].tagName === 'string' ? p[i].getAttribute(name) : null; if (v !== null && (value === undefined || v === value)) return i; }
          return -1;
        };
        var form = at('data-chat-composer-form');
        var hit = false;
        if (e.type === 'submit') hit = form >= 0;
        else if (e.type === 'click') {
          for (var b = 0; b < p.length && !(p[b] && typeof p[b].tagName === 'string' && p[b].tagName.toLowerCase() === 'button'); b++) {}
          hit = e.button === 0 && b < form && p[b].getAttribute('type') === 'submit';
        } else hit = e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.isComposing && !e.repeat && at('data-testid', 'composer-editor') >= 0;
        if (hit) window.parent.postMessage({ type: 't3vscode:sent' }, '*');
      } catch (err) {}
    };
    ['submit', 'click', 'keydown'].forEach(function (t) { window.addEventListener(t, onSent, true); });
  } catch (e) {}
}
const INJECT = '(' + injected + ')();';
const INJECT_CAP = 2 * 1024 * 1024;
const HOLD_MS = 15000; // a held page load that has not ended by then gets a 504

// Idea from VSmux (MIT): a local forwarder in front of T3 that adds the bearer. The code is our own and streams instead of buffering.
// port: preferred port; when taken, the spare ports in order (R14), then a random one (usedRequested false unless port was bound).
// holdMs: only for selfcheck.mjs, so the 504 path runs without a 15 s wait.
async function startForwarder({ origin, token, onUpgradeFailure, onRequest, port: wanted, spare = [], holdMs = HOLD_MS }) {
  const up = new URL(origin);
  const upHost = up.hostname.replace(/^\[|\]$/g, '');
  const upPort = up.port || 80;
  const sockets = new Set();
  // No keep-alive: an idle pooled socket to T3 would outlive close().
  const agent = new http.Agent({ keepAlive: false });
  let closed = false;
  const server = http.createServer();
  const self = () => `127.0.0.1:${server.address().port}`;

  // Path only: the query can carry the ws ticket, so it never reaches the callback.
  // own: the forwarder itself failed (status 0). T3 answers 502 itself, for example for GitHub images it cannot fetch.
  const note = (kind, req, status, own = false) => { if (onRequest) onRequest({ kind, method: req.method, path: req.url.split('?')[0], status, own }); };
  const track = (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); };
  const badOrigin = (req) => req.headers.origin !== undefined && req.headers.origin !== `http://${self()}`;
  // Refuse browser top-level navigations and cross-site subresources. Requests without Sec-Fetch headers (curl, local tools) pass: accepted hole.
  // Seen live 2026-10-12: the panel frame sends dest iframe / site cross-site / mode navigate, its fetches same-origin, its /ws upgrade no sec-fetch-* at all.
  const badFetch = (req, upgrade) => {
    const dest = req.headers['sec-fetch-dest'];
    if (dest === 'document') return true;
    return req.headers['sec-fetch-site'] === 'cross-site' && dest !== 'iframe' && !(upgrade && req.headers.origin === `http://${self()}`);
  };
  const upstreamRequest = (req) => {
    const headers = { ...req.headers };
    delete headers.cookie; // a stale t3_session_* cookie would win over the bearer with no fallback
    if (req.headers['sec-fetch-dest'] === 'iframe') delete headers['accept-encoding']; // the page comes back plain, so INJECT can go in
    headers.host = up.host;
    headers.authorization = `Bearer ${token}`;
    return http.request({ hostname: upHost, port: upPort, method: req.method, path: req.url, headers, agent });
  };

  server.on('request', (req, res) => {
    if (req.headers.host !== self()) return note('http', req, 421), res.writeHead(421).end();
    if (badOrigin(req) || badFetch(req, false)) return note('http', req, 403), res.writeHead(403).end();
    const out = upstreamRequest(req);
    let timedOut = false; // the 504 is on its way: the upstream teardown it causes must not cut it
    out.on('response', (upRes) => {
      note('http', req, upRes.statusCode);
      const h = { ...upRes.headers };
      delete h['set-cookie'];
      h['access-control-allow-origin'] = `http://${self()}`;
      // Keep any stricter upstream CSP; a second header is enforced alongside it. Ancestors: the VS Code webview frame and workbench
      // (confirmed in a real panel 2026-10-12), plus this forwarder itself for T3's nested HTML previews (BrowserDocumentFrame).
      const ancestors = `frame-ancestors vscode-webview: vscode-file: http://${self()}`;
      const html = String(h['content-type'] || '').startsWith('text/html');
      if (html) h['content-security-policy'] = [].concat(h['content-security-policy'] || [], ancestors);
      upRes.on('error', () => { if (!timedOut) res.destroy(); });
      const stream = (held) => { res.writeHead(upRes.statusCode, upRes.statusMessage, h); for (const c of held) res.write(c); upRes.pipe(res); };
      const enc = h['content-encoding'];
      const attachment = /^attachment/i.test(String(h['content-disposition'] || '')); // a download, not the page
      if (!(html && !attachment && req.method === 'GET' && req.headers['sec-fetch-dest'] === 'iframe' && upRes.statusCode === 200 && (!enc || enc === 'identity'))) return stream([]);
      // The panel's page load: hold it (capped), put INJECT right after <head>. No head or too big: the original bytes, unchanged.
      const held = [];
      let size = 0;
      // No headers are out while held, so a stalled upstream would leave the navigation pending forever.
      const timer = setTimeout(() => {
        timedOut = true;
        out.destroy();
        res.writeHead(504, { 'content-type': 'text/plain' }).end('T3 did not finish the page in time.');
      }, holdMs);
      res.on('close', () => clearTimeout(timer));
      const hold = (c) => { held.push(c); if ((size += c.length) > INJECT_CAP) { clearTimeout(timer); upRes.off('data', hold).off('end', done); stream(held); } };
      const done = () => {
        clearTimeout(timer);
        const body = Buffer.concat(held);
        const m = /<head(?:\s[^>]*)?>/i.exec(body.toString('latin1')); // latin1: one char per byte, so m.index is a byte offset
        if (m) {
          const at = m.index + m[0].length;
          for (const k of ['transfer-encoding', 'content-length', 'etag', 'last-modified']) delete h[k];
          const page = Buffer.concat([body.subarray(0, at), Buffer.from('<script>' + INJECT + '</script>'), body.subarray(at)]);
          h['content-length'] = Buffer.byteLength(page);
          return res.writeHead(200, upRes.statusMessage, h).end(page);
        }
        res.writeHead(upRes.statusCode, upRes.statusMessage, h).end(body);
      };
      upRes.on('data', hold).on('end', done).on('close', () => { clearTimeout(timer); if (!upRes.complete && !timedOut) res.destroy(); }); // a cut while held: no headers sent yet
    });
    // Headers already sent means a half-streamed body: abort it so the client cannot take it as complete.
    out.on('error', () => { if (timedOut) return; if (res.headersSent) res.destroy(); else { if (!res.destroyed) note('http', req, 0, true); res.writeHead(502); res.end(); } }); // destroyed: the client hung up, not T3
    res.on('close', () => out.destroy());
    req.on('error', () => out.destroy());
    req.pipe(out);
  });

  server.on('upgrade', (req, socket, head) => {
    socket.on('error', () => socket.destroy());
    if (req.headers.host !== self()) return note('upgrade', req, 421), socket.end('HTTP/1.1 421 Misdirected Request\r\nconnection: close\r\n\r\n');
    if (badOrigin(req) || badFetch(req, true)) return note('upgrade', req, 403), socket.end('HTTP/1.1 403 Forbidden\r\nconnection: close\r\n\r\n');
    // A handshake has no body; T3 would wait for bytes we only pass on after its 101.
    if (Number(req.headers['content-length'] || 0) !== 0 || req.headers['transfer-encoding']) return note('upgrade', req, 400), socket.end('HTTP/1.1 400 Bad Request\r\nconnection: close\r\n\r\n');
    track(socket);
    const sent = token; // R23: a refusal that comes after a swap redacts the bearer this handshake carried
    const out = upstreamRequest(req);
    out.on('socket', track); // so close() also kills an upgrade still waiting for T3; it is the same socket as upSocket later
    let settled = false; // one outcome per handshake: a reset can fire on both out and upRes
    const record = (status, body, kind) => {
      clearTimeout(timer);
      if (settled) return '';
      settled = true;
      note('upgrade', req, status, status === 0); // 0 only comes from broken(): our side, not a T3 answer
      const f = { status, body: redact(body.slice(0, 300 + sent.length), sent), kind };
      if (!closed && onUpgradeFailure) onUpgradeFailure(f); // our own close() is not a T3 refusal
      return f.body;
    };
    const broken = (why) => { record(0, why, 'transport'); socket.destroy(); out.destroy(); };
    const timer = setTimeout(() => broken('upstream timeout'), 10000);
    // The client hung up (frame reload): drop the upstream side too, and do not report it as a T3 refusal.
    // Reading is what surfaces its FIN ('end'), so hold any early bytes until the 101.
    const abandon = () => { settled = true; clearTimeout(timer); out.destroy(); };
    const early = [];
    let held = head.length; // head is also held until the 101
    const hold = (c) => { early.push(c); if ((held += c.length) > 64 * 1024) broken('too many early bytes'); };
    // 'end': a client that half-closes its sending side before the 101 is treated as gone; browsers never do this.
    socket.on('data', hold).on('end', abandon).on('close', abandon);
    out.on('upgrade', (upRes, upSocket, upHead) => {
      clearTimeout(timer);
      settled = true;
      socket.off('data', hold).off('end', abandon);
      if (socket.destroyed) return upSocket.destroy();
      note('upgrade', req, upRes.statusCode);
      const kill = () => { socket.destroy(); upSocket.destroy(); };
      for (const s of [socket, upSocket]) { s.on('error', kill); s.on('close', kill); }
      let lines = `HTTP/1.1 ${upRes.statusCode} ${upRes.statusMessage}\r\n`;
      for (let i = 0; i < upRes.rawHeaders.length; i += 2) {
        if (upRes.rawHeaders[i].toLowerCase() !== 'set-cookie') lines += `${upRes.rawHeaders[i]}: ${upRes.rawHeaders[i + 1]}\r\n`;
      }
      socket.write(lines + '\r\n');
      if (upHead.length) socket.write(upHead);
      for (const c of [head, ...early]) if (c.length) upSocket.write(c);
      upSocket.pipe(socket);
      socket.pipe(upSocket);
    });
    out.on('response', (upRes) => {
      let body = '';
      upRes.setEncoding('utf8');
      // Keep enough past 300 chars to finish a bearer that crosses the cap, so it is redacted whole.
      upRes.on('data', (c) => { if (body.length < 300 + sent.length) body += c; });
      upRes.on('end', () => {
        const s = upRes.statusCode;
        const text = record(s, body, s === 426 ? 'protocol' : s === 401 || s === 403 ? 'auth' : 'transport');
        socket.end(`HTTP/1.1 ${s} ${upRes.statusMessage}\r\ncontent-type: text/plain\r\ncontent-length: ${Buffer.byteLength(text)}\r\nconnection: close\r\n\r\n${text}`);
      });
      upRes.on('error', () => broken('refusal body cut off'));
      upRes.on('close', () => { if (!upRes.complete) broken('refusal body cut off'); });
    });
    out.on('error', (e) => broken(e.message));
    out.end();
  });

  const bind = (p) => new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(p, '127.0.0.1', resolve);
  });
  let bound = false;
  for (const p of [wanted, ...spare].filter(Boolean)) {
    try { await bind(p); bound = true; break; } catch (e) { if (e.code !== 'EADDRINUSE') throw e; }
  }
  if (!bound) await bind(0);
  const port = server.address().port;
  return {
    port,
    usedRequested: !!wanted && port === wanted,
    url: `http://127.0.0.1:${port}`,
    setToken(t) { token = t; }, // R23: a renewal swaps the bearer in place; T3 does not revoke the old session, so open sockets and the page stay
    close() {
      closed = true;
      server.close();
      server.closeAllConnections();
      for (const s of sockets) s.destroy();
      sockets.clear();
      agent.destroy();
    },
  };
}

function t3ExePath() {
  const exe = path.join(process.env.LOCALAPPDATA || '', 'Programs', 't3code', 'T3 Code (Nightly).exe');
  return fs.existsSync(exe) ? exe : null;
}

module.exports = { discover, session, grantedScopes, tokenFromLink, pairingText, exchange, renew, startForwarder, t3ExePath, INJECT, normalizeRoot, createRoot, environmentId, projects, createProject, latestThread, ensureProject, threadsFor, pendingRequest, respond };
