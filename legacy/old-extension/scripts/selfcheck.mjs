// Offline check of t3.js against a fake upstream. `--live` adds read-only GETs against the running T3 with an invalid bearer.
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import vm from 'node:vm';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';

const t3 = createRequire(import.meta.url)('../t3.js');
const pass = (name) => console.log('PASS ' + name);
// Reminder only, not a check: a T3 nightly bump nobody reviewed yet (docs/DRIFT.md).
const driftLog = new URL('../docs/T3-UPDATES.md', import.meta.url);
const unreviewed = (existsSync(driftLog) ? readFileSync(driftLog, 'utf8') : '').match(/^Status: unreviewed$/gm)?.length;
if (unreviewed) console.log(`WARN ${unreviewed} T3 bump(s) await review: docs/T3-UPDATES.md`);
// Letters only, so only exact-match redaction can hide it; the letters-plus-digits heuristic would not.
const TOKEN = 'testbearerlettersonlyabcdefghijk';

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

function get(fwd, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: fwd.port, path, headers: { host: `127.0.0.1:${fwd.port}`, ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => { const buf = Buffer.concat(chunks); resolve({ status: res.statusCode, headers: res.headers, body: buf.toString('utf8'), buf }); });
      res.on('error', reject); // a body cut after the headers emits no 'end'
      res.on('aborted', () => reject(new Error('aborted')));
    });
    req.on('error', reject);
    req.end();
  });
}

const handshake = (fwd, path, { host = `127.0.0.1:${fwd.port}`, origin = fwd.url, extra = '', body = '' } = {}) =>
  `GET ${path} HTTP/1.1\r\nHost: ${host}\r\nOrigin: ${origin}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n` +
  `Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nCookie: t3_session_1=stale\r\n${extra}\r\n${body}`;

// Raw handshake so we see exactly what the forwarder writes back. Resolves with the head and any bytes after it.
function rawUpgrade(fwd, path, opts) {
  return new Promise((resolve, reject) => {
    const s = net.connect(fwd.port, '127.0.0.1', () => s.write(handshake(fwd, path, opts)));
    let buf = '';
    const onData = (c) => {
      buf += c;
      const i = buf.indexOf('\r\n\r\n');
      if (i < 0) return;
      s.off('data', onData);
      resolve({ s, head: buf.slice(0, i), rest: buf.slice(i + 4) });
    };
    s.setEncoding('utf8');
    s.on('data', onData);
    s.on('close', () => resolve({ s, head: buf, rest: '', closed: true }));
    s.on('error', reject);
  });
}

// Everything the forwarder sent after the head, up to close.
function drain(u) {
  return new Promise((resolve) => {
    let got = u.rest;
    if (u.closed) return resolve(got);
    u.s.on('data', (c) => { got += c; });
    u.s.on('close', () => resolve(got));
  });
}

function closed(s, ms = 2000) {
  return new Promise((resolve, reject) => {
    if (s.destroyed) return resolve();
    const t = setTimeout(() => reject(new Error('socket still open')), ms);
    s.on('close', () => { clearTimeout(t); resolve(); });
  });
}

// Resolves 'end' for a clean complete body, 'aborted' when the body was cut.
function outcome(fwd, path) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: fwd.port, path, headers: { host: `127.0.0.1:${fwd.port}` } }, (res) => {
      res.on('aborted', () => resolve('aborted'));
      res.on('error', () => resolve('aborted'));
      res.on('end', () => resolve('end'));
      res.resume();
    });
    req.on('error', () => resolve('aborted'));
  });
}

async function offline() {
  let hangSeen, lateSeen;
  const hang = new Promise((resolve) => { hangSeen = resolve; });
  const late = new Promise((resolve) => { lateSeen = resolve; });
  const upstream = http.createServer((req, res) => {
    if (req.url === '/cut') {
      res.writeHead(200, { 'content-type': 'text/plain' }); // chunked, so a clean end downstream would look complete
      res.write('partial');
      return setTimeout(() => res.socket.destroy(), 50);
    }
    if (req.url === '/bad-gateway') return res.writeHead(502).end(); // T3 itself answers 502, e.g. a GitHub image it cannot fetch
    res.writeHead(200, {
      'content-type': req.url === '/' ? 'text/html; charset=utf-8' : 'application/json',
      'set-cookie': 't3_session_1=new; HttpOnly',
      'access-control-allow-origin': '*',
    });
    res.end(JSON.stringify({ url: req.url, headers: req.headers }));
  });
  let open = 0;
  upstream.on('connection', (s) => { open++; s.on('close', () => open--); });
  upstream.on('upgrade', (req, socket, head) => {
    if (req.url === '/upgrade-hang') { socket.on('error', () => {}); socket.on('end', () => socket.end()); socket.resume(); return hangSeen(); } // never answers; ends its half once we hang up, as a real server would
    if (req.url === '/upgrade-late') { // answers 101 only after the client has already gone
      socket.on('error', () => {});
      socket.on('end', () => socket.end());
      lateSeen(socket);
      return setTimeout(() => { if (!socket.destroyed) socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n'); }, 600);
    }
    if (req.url === '/upgrade-cut') { // refusal headers, part of the body, then a reset
      socket.write('HTTP/1.1 403 Forbidden\r\ncontent-type: text/plain\r\ncontent-length: 100\r\n\r\npartial');
      return setTimeout(() => socket.destroy(), 50);
    }
    if (req.url === '/upgrade-flood') { socket.on('error', () => {}); socket.on('end', () => socket.end()); return socket.resume(); } // never answers; the client floods first
    if (req.url.startsWith('/upgrade-leak')) { // echoes the forwarder's own bearer right across the 300-char cap; ?twice: at char 0 and again at 301
      const b = req.headers.authorization.slice('Bearer '.length);
      const body = req.url.endsWith('twice') ? b + ' '.repeat(301 - b.length) + b : ' '.repeat(290) + b;
      return socket.end(`HTTP/1.1 403 Forbidden\r\ncontent-type: text/plain\r\ncontent-length: ${body.length}\r\n\r\n${body}`);
    }
    if (req.url.startsWith('/upgrade-426')) {
      const body = '{"error":"orchestration_protocol_incompatible","detail":"ABCDEFGHIJKLMNOPQRSTUVWXYZ0123"}';
      return socket.end(`HTTP/1.1 426 Upgrade Required\r\ncontent-type: application/json\r\ncontent-length: ${body.length}\r\n\r\n${body}`);
    }
    const accept = () => {
      socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: fakeaccept\r\n' +
        `X-Seen-Url: ${req.url}\r\nX-Seen-Auth: ${req.headers.authorization}\r\nX-Seen-Cookie: ${req.headers.cookie || 'none'}\r\nSet-Cookie: leak=1\r\n\r\n`);
      if (head.length) socket.write(head);
      socket.on('error', () => {});
      socket.pipe(socket);
    };
    if (req.url === '/upgrade-slow') return setTimeout(accept, 150); // client bytes sent before this 101 must still arrive
    accept();
  });
  const upPort = await listen(upstream);
  const events = [];
  const failures = [];
  const fwd = await t3.startForwarder({ origin: `http://127.0.0.1:${upPort}`, token: TOKEN, onRequest: (e) => events.push(e), onUpgradeFailure: (f) => failures.push(f) });

  try {
    let r = await get(fwd, '/api/echo?a=1', { cookie: 't3_session_1=stale' });
    const seen = JSON.parse(r.body);
    assert.equal(seen.url, '/api/echo?a=1');
    assert.equal(seen.headers.cookie, undefined);
    assert.equal(seen.headers.authorization, `Bearer ${TOKEN}`);
    assert.equal(seen.headers.host, `127.0.0.1:${upPort}`);
    pass('cookie stripped, bearer added, upstream host and query kept');
    assert.equal(r.headers['set-cookie'], undefined);
    assert.equal(r.headers['access-control-allow-origin'], fwd.url);
    pass('set-cookie dropped, ACAO rewritten to forwarder origin');
    assert.equal(r.headers['content-security-policy'], undefined);
    r = await get(fwd, '/');
    assert.ok(String(r.headers['content-security-policy']).includes(`frame-ancestors vscode-webview: vscode-file: ${fwd.url}`));
    pass('frame-ancestors CSP (VS Code plus the forwarder itself) on html only');
    r = await get(fwd, '/api/echo', { host: 'evil.example:80' });
    assert.equal(r.status, 421);
    pass('wrong Host -> 421');
    r = await get(fwd, '/api/echo', { origin: 'https://evil.example' });
    assert.equal(r.status, 403);
    pass('foreign Origin -> 403');
    r = await get(fwd, '/api/echo', { origin: fwd.url });
    assert.equal(r.status, 200);
    pass('own Origin passes');
    assert.equal(await outcome(fwd, '/cut'), 'aborted');
    pass('upstream cut mid-body reaches the client as aborted, not a clean end');
    // Plain GETs after this leave an idle upstream socket for the close() check below.
    r = await get(fwd, '/', { 'sec-fetch-dest': 'document', 'sec-fetch-site': 'none' });
    assert.equal(r.status, 403);
    pass('sec-fetch-dest document (browser navigation) -> 403');
    r = await get(fwd, '/', { 'sec-fetch-dest': 'iframe', 'sec-fetch-site': 'cross-site' });
    assert.equal(r.status, 200);
    assert.equal(JSON.parse(r.body).url, '/'); // html without <head>: passed through unchanged
    pass('cross-site + dest iframe -> 200');
    r = await get(fwd, '/api/echo', { 'sec-fetch-dest': 'image', 'sec-fetch-site': 'cross-site' });
    assert.equal(r.status, 403);
    pass('cross-site + dest image -> 403');
    r = await get(fwd, '/api/echo');
    assert.equal(r.status, 200);
    pass('no sec-fetch headers -> 200');

    let u = await rawUpgrade(fwd, '/ws', { host: 'evil.example:80' });
    assert.match(u.head, /^HTTP\/1\.1 421/);
    pass('upgrade with wrong Host -> 421');
    u = await rawUpgrade(fwd, '/ws', { origin: 'https://evil.example' });
    assert.match(u.head, /^HTTP\/1\.1 403 Forbidden/);
    await closed(u.s);
    pass('upgrade with foreign Origin -> 403 then closed');

    u = await rawUpgrade(fwd, '/ws?wsTicket=&p=2');
    assert.match(u.head, /^HTTP\/1\.1 101/);
    assert.match(u.head, /Sec-WebSocket-Accept: fakeaccept/);
    assert.match(u.head, /X-Seen-Url: \/ws\?wsTicket=&p=2/);
    assert.ok(u.head.includes(`X-Seen-Auth: Bearer ${TOKEN}`));
    assert.match(u.head, /X-Seen-Cookie: none/);
    assert.doesNotMatch(u.head, /Set-Cookie/i);
    const established = u.s;
    const echoed = new Promise((resolve) => {
      let got = u.rest;
      u.s.on('data', (c) => { got += c; if (got.includes('ping')) resolve(got); });
    });
    u.s.write('ping');
    assert.match(await echoed, /ping/);
    pass('upgrade piped: 101 headers kept, path and query kept, bearer on upgrade, bytes echoed');

    const bad = await rawUpgrade(fwd, '/upgrade-426?p=1');
    assert.match(bad.head, /^HTTP\/1\.1 426/);
    const fail = failures.at(-1);
    assert.equal(fail.status, 426);
    assert.equal(fail.kind, 'protocol');
    assert.doesNotMatch(fail.body, /ABCDEFGHIJKLMNOPQRSTUVWXYZ0123/);
    pass('non-101 upgrade recorded as protocol failure, body redacted');
    r = await get(fwd, '/bad-gateway');
    assert.equal(r.status, 502);
    for (const e of [{ kind: 'http', method: 'GET', path: '/api/echo', status: 200, own: false }, { kind: 'upgrade', method: 'GET', path: '/ws', status: 101, own: false }, { kind: 'upgrade', method: 'GET', path: '/upgrade-426', status: 426, own: false }, { kind: 'http', method: 'GET', path: '/bad-gateway', status: 502, own: false }]) {
      assert.ok(events.some((x) => JSON.stringify(x) === JSON.stringify(e)), `onRequest missed ${JSON.stringify(e)}`);
    }
    assert.ok(events.every((x) => !x.path.includes('?')));
    pass('onRequest reports kind, method, path without query, status and own for http and upgrades; an upstream 502 is own false');

    for (const p of ['/upgrade-leak', '/upgrade-leak?twice']) {
      u = await rawUpgrade(fwd, p);
      assert.match(u.head, /^HTTP\/1\.1 403/);
      const leaked = u.head + (await drain(u));
      assert.equal(failures.at(-1).kind, 'auth');
      for (const text of [leaked, failures.at(-1).body]) assert.ok(!text.includes(TOKEN.slice(0, 10)), 'bearer prefix exposed: ' + p);
    }
    pass('refusal body with the bearer across the 300-char cap, also twice (0 and 301): no prefix in callback or client response');
    // R23: a renewal swaps the bearer in place; the next request and handshake carry it and its refusal redacts it.
    const SWAPPED = 'swappedbearerlettersonlyabcdefgh';
    fwd.setToken(SWAPPED);
    r = await get(fwd, '/api/echo');
    assert.equal(JSON.parse(r.body).headers.authorization, `Bearer ${SWAPPED}`);
    u = await rawUpgrade(fwd, '/upgrade-leak');
    const swapLeak = u.head + (await drain(u));
    for (const text of [swapLeak, failures.at(-1).body]) assert.ok(!text.includes(SWAPPED.slice(0, 10)), 'swapped bearer exposed');
    fwd.setToken(TOKEN);
    pass('R23: setToken swaps the bearer for the next request and handshake, and the refusal redacts the new one');

    let count = failures.length;
    const t0 = Date.now();
    u = await rawUpgrade(fwd, '/upgrade-cut');
    await closed(u.s);
    assert.ok(Date.now() - t0 < 3000, 'cut refusal only ended by the 10 s deadline');
    assert.equal(failures.length, count + 1);
    assert.equal(failures.at(-1).kind, 'transport');
    pass('refusal body cut mid-way: client socket closed, transport failure recorded');

    count = failures.length;
    const early = net.connect(fwd.port, '127.0.0.1', () => early.write(handshake(fwd, '/upgrade-late')));
    early.on('error', () => {});
    const lateUp = await late;
    early.destroy();
    await closed(lateUp, 400); // before the late 101 at 600 ms: the forwarder dropped T3's side when the client left
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(failures.length, count);
    pass('client gone before the 101: upstream socket destroyed at once, no failure recorded');

    const slow = net.connect(fwd.port, '127.0.0.1', () => {
      slow.write(handshake(fwd, '/upgrade-slow'));
      setTimeout(() => slow.write('early'), 50);
    });
    let slowGot = '';
    await new Promise((resolve, reject) => {
      slow.on('data', (c) => { slowGot += c; if (slowGot.includes('\r\n\r\nearly')) resolve(); });
      slow.on('error', reject);
      slow.on('close', () => reject(new Error('closed before the early bytes came back')));
      setTimeout(() => reject(new Error('early bytes lost')), 2000).unref();
    });
    slow.destroy();
    pass('client bytes sent before the 101 reach T3 after it');

    count = failures.length;
    const flood = net.connect(fwd.port, '127.0.0.1', () => {
      flood.write(handshake(fwd, '/upgrade-flood'));
      setTimeout(() => flood.write(Buffer.alloc(70 * 1024, 97)), 50); // later, so it goes through the hold buffer, not head
    });
    flood.on('error', () => {});
    await closed(flood);
    assert.equal(failures.length, count + 1);
    assert.equal(failures.at(-1).kind, 'transport');
    assert.equal(failures.at(-1).body, 'too many early bytes');
    pass('70 KB sent before the 101: client socket closed, transport failure recorded');

    u = await rawUpgrade(fwd, '/ws', { extra: 'Content-Length: 4\r\n', body: 'abcd' });
    assert.match(u.head, /^HTTP\/1\.1 400/);
    u = await rawUpgrade(fwd, '/ws', { extra: 'Transfer-Encoding: chunked\r\n', body: '4\r\nabcd\r\n0\r\n\r\n' });
    assert.match(u.head, /^HTTP\/1\.1 400/);
    pass('upgrade with a body (content-length or transfer-encoding) -> 400');

    count = failures.length;
    const pending = rawUpgrade(fwd, '/upgrade-hang');
    await hang;
    await get(fwd, '/api/echo'); // leaves an idle upstream socket if the forwarder pools them
    assert.ok(!established.destroyed, "established socket was already closed before close()");
    fwd.close();
    await closed(established);
    pass('close() destroys an open upgraded socket');
    assert.equal((await pending).closed, true);
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(open, 0, `upstream still has ${open} open socket(s)`);
    assert.equal(failures.length, count);
    pass('close() leaves no upstream socket (idle keep-alive, pending upgrade) and records no failure');
    await assert.rejects(get(fwd, '/api/echo'));
    pass('close() stops listening');

    const gone = http.createServer();
    const gonePort = await listen(gone);
    await new Promise((resolve) => gone.close(resolve));
    const deadEvents = [];
    const dead = await t3.startForwarder({ origin: `http://127.0.0.1:${gonePort}`, token: TOKEN, onRequest: (e) => deadEvents.push(e) });
    try {
      r = await get(dead, '/api/echo');
      assert.equal(r.status, 502);
      assert.deepEqual(deadEvents, [{ kind: 'http', method: 'GET', path: '/api/echo', status: 0, own: true }]);
    } finally {
      dead.close();
    }
    pass('T3 unreachable (closed port): client gets 502, event reported as status 0, own true');
  } finally {
    fwd.close();
    upstream.closeAllConnections();
    upstream.close();
  }
}

async function parsing() {
  assert.equal(t3.tokenFromLink('http://127.0.0.1:3773/pair#token=ABCD2345EFGH'), 'ABCD2345EFGH');
  assert.equal(t3.tokenFromLink('  ABCD2345EFGH  '), 'ABCD2345EFGH');
  assert.equal(t3.tokenFromLink('http://x/pair?token=QUERY234&a=1#token=HASH2345'), 'HASH2345');
  assert.equal(t3.tokenFromLink('http://x/pair?token=QUERY234'), 'QUERY234');
  assert.equal(t3.tokenFromLink('http://x/pair'), null);
  assert.equal(t3.tokenFromLink('http://x/pair#token=%'), null);
  pass('tokenFromLink: hash first, query only as pasted fallback, bare token, malformed escape -> null');
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 't3home-'));
  assert.throws(() => t3.discover({ home }), { code: 'no-runtime-file' });
  fs.mkdirSync(path.join(home, 'userdata'));
  const write = (origin) => fs.writeFileSync(path.join(home, 'userdata', 'server-runtime.json'), JSON.stringify({ origin, pid: 1 }));
  write('http://192.168.1.5:3773');
  assert.throws(() => t3.discover({ home }), { code: 'not-loopback' });
  write('https://127.0.0.1:3773');
  assert.throws(() => t3.discover({ home }), { code: 'not-loopback' });
  write('http://127.0.0.1:3773');
  assert.deepEqual(t3.discover({ home }), { origin: 'http://127.0.0.1:3773' });
  fs.rmSync(home, { recursive: true });
  pass('discover: missing file, non-loopback and non-http refused');
}

// session() and exchange() buffer the whole answer; check cut answers and error redaction against a fake (never T3).
async function buffered() {
  const PAIR = 'pairingtokenlettersonlyabcdefgh';
  let mode;
  const server = http.createServer((req, res) => {
    if (mode === 'cut') {
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': 100 });
      res.write('{"authenticated":');
      return setTimeout(() => res.socket.destroy(), 50);
    }
    if (mode === 'json') return res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'invalid_grant', access_token: 'secretaccesstokenlettersonly', detail: { refresh_token: 'nestedrefreshlettersonly' }, pad: 'x'.repeat(500) }));
    res.writeHead(400, { 'content-type': 'text/plain' }).end(' '.repeat(290) + PAIR);
  });
  const origin = `http://127.0.0.1:${await listen(server)}`;
  try {
    mode = 'cut';
    const limit = new Promise((_, reject) => setTimeout(() => reject(new Error('session() still pending after 3 s')), 3000).unref());
    await assert.rejects(Promise.race([t3.session(origin), limit]), { code: 'no-answer' });
    pass('session(): JSON answer cut mid-body rejects instead of hanging');
    mode = 'json';
    let e = await t3.exchange(origin, PAIR, 'test').catch((x) => x);
    assert.equal(e.code, 'exchange-failed');
    assert.ok(!e.message.includes('secretaccesstoken'), 'access_token exposed');
    assert.ok(!e.message.includes('nestedrefresh'), 'nested refresh_token exposed');
    assert.ok(e.message.length < 400, 'detail not capped');
    mode = 'text';
    e = await t3.exchange(origin, PAIR, 'test').catch((x) => x);
    assert.equal(e.code, 'exchange-failed');
    assert.ok(!e.message.includes(PAIR.slice(0, 10)), 'pairing token prefix exposed');
    pass('exchange() errors: credential fields dropped, pairing token redacted before the cap');
  } finally {
    server.closeAllConnections();
    server.close();
  }
}

// renew() against a fake: the bearer goes on the mint POST, the minted credential into the exchange. Never T3.
async function renewal() {
  const OLD = 'oldbearerlettersonlyabcdefghijk';
  const seen = [];
  let refuse = false;
  const server = http.createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      if (req.url === '/api/auth/session') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ authenticated: true, expiresAt: '2030-01-01T00:00:00.000Z', scopes: ['orchestration:read'], permissions: ['orchestration:read', 'terminal:operate', 'access:write'] }));
      seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, type: req.headers['content-type'], body });
      if (req.url === '/api/auth/pairing-token') {
        if (refuse) return res.writeHead(403, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'scope_required', echo: OLD }));
        return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ id: 'p1', credential: 'MINTEDPAIRING', label: 'VS Code', expiresAt: '2030-01-01T00:00:00.000Z' }));
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ access_token: 'NEWBEARER', issued_token_type: 'urn:ietf:params:oauth:token-type:access_token', token_type: 'Bearer', expires_in: 2592000, scope: 'orchestration:read access:write' }));
    });
  });
  const origin = `http://127.0.0.1:${await listen(server)}`;
  try {
    const r = await t3.renew(origin, OLD, ['orchestration:read', 'access:write', 'review:write']);
    assert.equal(r.bearer, 'NEWBEARER');
    assert.deepEqual(r.scopes, ['orchestration:read', 'access:write']);
    assert.ok(Math.abs(new Date(r.expiresAt) - Date.now() - 2592000 * 1000) < 60000);
    assert.equal(seen.length, 2);
    assert.deepEqual([seen[0].method, seen[0].url, seen[0].auth, seen[0].type], ['POST', '/api/auth/pairing-token', `Bearer ${OLD}`, 'application/json']);
    assert.deepEqual(JSON.parse(seen[0].body), { label: 'VS Code', scopes: ['orchestration:read', 'access:write'] });
    const form = new URLSearchParams(seen[1].body);
    assert.deepEqual([seen[1].url, seen[1].auth, form.get('subject_token'), form.get('client_label')], ['/oauth/token', undefined, 'MINTEDPAIRING', 'VS Code']);
    pass('renew(): POST with the bearer and our own scopes (review:write dropped), exchanges the minted credential, returns the new bearer');
    assert.equal(await t3.renew(origin, OLD, ['orchestration:read', 'terminal:operate']), null);
    assert.equal(await t3.renew(origin, OLD, undefined), null);
    assert.equal(seen.length, 2);
    pass('renew(): without access:write returns null and sends nothing');
    refuse = true;
    const e = await t3.renew(origin, OLD, ['access:write']).catch((x) => x);
    assert.equal(e.code, 'renew-failed');
    assert.equal(e.status, 403);
    assert.ok(!e.message.includes(OLD.slice(0, 10)), 'bearer exposed in renew error');
    assert.equal(seen.length, 3);
    pass('renew(): a refusal throws renew-failed without the bearer and does not exchange');
    const st = await t3.session(origin, OLD);
    assert.deepEqual(t3.grantedScopes(st), ['orchestration:read', 'terminal:operate', 'access:write']);
    assert.deepEqual(t3.grantedScopes({ scopes: ['orchestration:read'] }), ['orchestration:read']);
    assert.deepEqual(t3.grantedScopes({}), []);
    pass('grantedScopes(): the stored scopes come from /api/auth/session permissions, not its short scopes list');
  } finally {
    server.closeAllConnections();
    server.close();
  }
}

// Row 1 of docs/SYNC.md: ensureProject against a fake of T3's project, shell and descriptor routes. Never T3.
async function binding() {
  const W = String.raw;
  const BS = '\\'; // a raw template cannot end in a backslash
  assert.deepEqual([t3.normalizeRoot(W`d:\GIT\Proj` + BS), t3.normalizeRoot('D:' + BS), t3.createRoot(W`d:\GIT\Proj` + BS), t3.createRoot('d:' + BS)], ['d:/git/proj', 'd:/', W`D:\GIT\Proj`, 'D:' + BS]);
  pass('normalizeRoot: resolved, no trailing separator except a drive root, slashes, lower case; createRoot: upper-case drive only');
  const ALL = ['orchestration:read', 'orchestration:operate'];
  let list, threads, onCreate, slow = false, slowShell = false, weird = false;
  const seen = [];
  const json = (res, status, body) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  const server = http.createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, proto: req.headers['x-t3-orchestration-protocol'], type: req.headers['content-type'], body });
      if (req.url === '/.well-known/t3/environment') return json(res, 200, { environmentId: 'env 1', label: 'PC' });
      if (req.url === '/api/projects' && weird) return res.writeHead(200, { 'content-type': `text/html; x=${TOKEN}` }).end(`<html>${TOKEN} secret</html>`);
      if (req.url === '/api/projects') return slow ? setTimeout(() => json(res, 200, { projects: list }), 9000).unref() : json(res, 200, { projects: list, updatedAt: '2026-10-12T00:00:00Z' });
      if (req.url === '/api/projects/mutate' && req.method === 'POST') { const r = onCreate(JSON.parse(body)); return json(res, r.status, r.body); }
      if (req.url === '/api/orchestration/shell' && slowShell) return setTimeout(() => json(res, 200, { projects: list, threads, archivedThreads: [] }), 6000).unref();
      if (req.url === '/api/orchestration/shell') return json(res, 200, { projects: list, threads, archivedThreads: [{ id: 'z-archived-list', projectId: 'p1', archivedAt: null, latestUserMessageAt: '2026-10-12T09:00:00Z' }] });
      res.writeHead(404).end();
    });
  });
  const origin = `http://127.0.0.1:${await listen(server)}`;
  const ensure = (folder, scopes = ALL) => { seen.length = 0; return t3.ensureProject({ origin, bearer: TOKEN, folder, scopes }); };
  const posts = () => seen.filter((r) => r.method === 'POST');
  const parent = { id: 'p0', title: 'GIT', workspaceRoot: W`D:\GIT` };
  try {
    list = [parent, { id: 'p1', title: 'proj', workspaceRoot: W`D:\GIT\proj` }, { id: 'p2', title: 'sub', workspaceRoot: W`D:\GIT\proj\sub` }];
    const t = (id, extra) => ({ id, projectId: 'p1', archivedAt: null, lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: id }, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', latestUserMessageAt: null, ...extra });
    threads = [
      t('t-a', { latestUserMessageAt: '2026-10-10T00:00:00Z' }),
      t('t-b', { latestUserMessageAt: '2026-10-10T00:00:00Z' }), // same time as t-a: the larger id wins
      t('t-updated', { latestUserMessageAt: '2026-10-05T00:00:00Z', updatedAt: '2026-10-11T00:00:00Z' }), // newest updatedAt loses to a newer user message
      t('t-sub', { latestUserMessageAt: '2026-10-12T00:00:00Z', lineage: { parentThreadId: 't-a', relationshipToParent: 'subagent', rootThreadId: 't-a' } }),
      t('t-archived', { latestUserMessageAt: '2026-10-12T00:00:00Z', archivedAt: '2026-10-12T01:00:00Z' }),
      t('t-parent', { projectId: 'p0', latestUserMessageAt: '2026-10-12T00:00:00Z' }),
    ];
    let r = await ensure(W`d:\GIT\proj` + BS); // lower-case drive and trailing backslash, as VS Code may give it
    assert.deepEqual(r, { path: '/env%201/t-b', title: 'proj', root: W`D:\GIT\proj`, fresh: false, note: null }); // root as T3 stores it, not as opened
    const shell = seen.find((x) => x.url === '/api/orchestration/shell');
    assert.deepEqual([shell.auth, shell.proto, posts().length], [`Bearer ${TOKEN}`, '2', 0]);
    pass('ensureProject: an existing project (stored D:, opened d:\\...\\) lands on its newest thread: user message beats updatedAt, ties to the larger id, no subagent, archived, archivedThreads or parent-project thread; ids encoded; shell header 2');
    const prefer = (preferThread) => t3.ensureProject({ origin, bearer: TOKEN, folder: W`D:\GIT\proj`, scopes: ALL, preferThread }).then((x) => x.path);
    assert.deepEqual(await Promise.all(['t-updated', 't-archived', 't-sub', 't-parent', 'nope', undefined].map(prefer)),
      ['/env%201/t-updated', '/env%201/t-b', '/env%201/t-b', '/env%201/t-b', '/env%201/t-b', '/env%201/t-b']);
    pass('ensureProject preferThread: an open thread of the project is the landing; archived, subagent, another project\'s or unknown falls back to the newest');

    list = [parent];
    threads = [];
    onCreate = (p) => { list.push({ id: p.projectId, title: p.title, workspaceRoot: p.workspaceRoot }); return { status: 200, body: list.at(-1) }; };
    r = await ensure(W`d:\GIT\newproj`);
    assert.deepEqual(r, { path: '/', title: 'newproj', root: W`D:\GIT\newproj`, fresh: true, note: null });
    assert.equal(posts().length, 1);
    const sent = JSON.parse(posts()[0].body);
    assert.deepEqual(Object.keys(sent).sort(), ['commandId', 'createWorkspaceRootIfMissing', 'projectId', 'title', 'type', 'workspaceRoot']);
    assert.deepEqual([sent.type, sent.title, sent.workspaceRoot, sent.createWorkspaceRootIfMissing], ['project.create', 'newproj', W`D:\GIT\newproj`, false]);
    assert.ok([sent.commandId, sent.projectId].every((u) => /^[0-9a-f-]{36}$/.test(u)) && sent.commandId !== sent.projectId, 'random UUIDs');
    assert.deepEqual([posts()[0].auth, posts()[0].type], [`Bearer ${TOKEN}`, 'application/json']);
    pass('ensureProject: a missing project is created (upper-case drive, basename title, createWorkspaceRootIfMissing false, no scripts), then fresh with path /');

    list = [parent];
    threads = [{ id: 't9', projectId: 'server-id', archivedAt: null, lineage: null, updatedAt: '2026-10-01T00:00:00Z' }];
    onCreate = () => { list.push({ id: 'server-id', title: 'raced', workspaceRoot: W`D:\GIT\raced` }); return { status: 400, body: { error: 'invalid_command' } }; };
    r = await ensure(W`d:\GIT\raced`);
    assert.deepEqual([r.path, r.note], ['/env%201/t9', null]);
    pass("ensureProject: a refused create whose project then exists uses the server's id");

    list = [parent];
    onCreate = () => ({ status: 400, body: { error: 'invalid_command', detail: 'Workspace root does not exist', echo: TOKEN } });
    r = await ensure(W`d:\GIT\gone`);
    assert.equal(r.path, '/');
    assert.equal(r.note, 'T3 is not on gone: T3 refused to create the project (400). Reload to retry.');
    weird = true; // 200 HTML whose content type and body echo the bearer
    r = await ensure(W`d:\GIT\gone`);
    assert.equal(r.note, 'T3 is not on gone: the answer on /api/projects was not JSON. Reload to retry.');
    weird = false;
    pass('ensureProject: notes are written from route and status only: a refused create says (400), a non-JSON answer names the route; no server text or echoed bearer');

    list = [parent];
    threads = [];
    let creates = 0;
    onCreate = (p) => { creates++; list.push({ id: p.projectId, title: p.title, workspaceRoot: p.workspaceRoot }); return { status: 200, body: list.at(-1) }; };
    const both = await Promise.all([ensure(W`D:\GIT\Race`), ensure(W`d:\git\RACE`)]); // two windows, two spellings of one folder
    assert.deepEqual([creates, both.map((x) => x.note)], [1, [null, null]]);
    assert.deepEqual(readdirSync(join(process.env.T3VSCODE_HOME || join(homedir(), '.t3-vscode'), 'locks')), [], 'lock left behind');
    pass('ensureProject: two concurrent ensures of one folder (different spellings) send exactly one create; the lock is released');

    list = [parent, { id: 'a', title: 'Dup', workspaceRoot: W`D:\GIT\dup` }, { id: 'b', title: 'dup2', workspaceRoot: W`d:\git\DUP` + BS }];
    r = await ensure(W`D:\GIT\dup`);
    assert.deepEqual([r.path, r.note, posts().length], ['/', 'T3 is not on dup: T3 has 2 projects for this folder: Dup, dup2. Keep one in T3. Reload to retry.', 0]);
    pass('ensureProject: two projects matching after normalization: a note, no create');

    list = [parent, { id: 'n1', title: 'same', workspaceRoot: W`D:\a\same` }, { id: 'n2', title: 'same', workspaceRoot: W`D:\b\same` }];
    threads = [];
    r = await ensure(W`D:\a\same`);
    assert.deepEqual([r.path, r.fresh, r.root, r.note], ['/', true, W`D:\a\same`, null]);
    pass('ensureProject: a fresh project whose title another project shares is still fresh, with its own root (identity is the root, not the title)');

    r = await ensure(W`D:\GIT\proj`, ['orchestration:operate']);
    assert.deepEqual([r.path, seen.length], ['/', 0]);
    assert.match(r.note, /^T3 is not on proj: this pairing may not read threads/);
    list = [parent];
    r = await ensure(W`D:\GIT\newproj`, ['orchestration:read']);
    assert.deepEqual([r.path, posts().length, seen.map((x) => x.url)], ['/', 0, ['/api/projects']]);
    assert.match(r.note, /may not create one/);
    pass('ensureProject: no orchestration:read sends nothing; no orchestration:operate and no project sends no POST; both leave a note');

    // NAV.md section 2: the threads related to the window's folders.
    list = [parent, { id: 'p1', title: 'proj', workspaceRoot: W`D:\GIT\proj` }, { id: 'p2', title: 'sub', workspaceRoot: W`D:\GIT\proj\sub` },
      { id: 'p3', title: 'other', workspaceRoot: W`D:\other` }, { id: 'p4', title: 'projx', workspaceRoot: W`D:\GIT\projx` }, { id: 'p5', title: 'multi', workspaceRoot: W`D:\multi` }];
    const day = (d) => `2026-10-${d}T00:00:00Z`;
    const IN = W`D:\GIT\proj\.wt\x`;
    threads = [
      t('a1', { latestUserMessageAt: day(10), status: 'running', activeRunId: 'r1', latestRunId: 'r1', pendingRuntimeRequest: { id: 'req-1', kind: 'permission', createdAt: day(10) } }),
      t('a2', { updatedAt: day(11) }), // no user message: updatedAt counts; no activity fields at all
      t('s1', { projectId: 'p2', latestUserMessageAt: day('09'), status: 'idle', activeRunId: null, pendingRuntimeRequest: null, hasActionableProposedPlan: true }), // a project nested in the folder
      t('w1', { projectId: 'p3', worktreePath: IN, latestUserMessageAt: day('08'), status: 'queued', pendingRuntimeRequest: { kind: 'command' } }), // another project, its worktree inside the folder
      t('m1', { projectId: 'p5', latestUserMessageAt: day('07'), status: 'failed', activeRunId: 'r2', hasActionableProposedPlan: 'yes' }), // the root of the second folder
      t('o1', { projectId: 'p3', latestUserMessageAt: day(12) }), // another project, no worktree here
      t('x1', { projectId: 'p4', latestUserMessageAt: day(12) }), // D:\GIT\projx is not inside D:\GIT\proj
      t('par', { projectId: 'p0', latestUserMessageAt: day(12) }), // the parent project
      t('par-wt', { projectId: 'p0', worktreePath: IN, latestUserMessageAt: day(12) }), // still the parent project
      t('arch', { archivedAt: day(12), latestUserMessageAt: day(12) }),
      t('del', { deletedAt: day(12), latestUserMessageAt: day(12) }),
      t('sub', { latestUserMessageAt: day(12), lineage: { parentThreadId: 'a1', relationshipToParent: 'subagent', rootThreadId: 'a1' } }),
    ].map((x) => ({ title: `T ${x.id}`, ...x }));
    seen.length = 0;
    const tf = await t3.threadsFor({ origin, bearer: TOKEN, folders: [W`d:\GIT\proj` + BS, W`D:\multi`], project: W`D:\GIT\proj` });
    assert.equal(tf.environmentId, 'env 1');
    assert.deepEqual(tf.items.map((x) => [x.id, x.title, x.projectId, x.projectTitle, x.mine]), [
      ['a2', 'T a2', 'p1', 'proj', true], ['a1', 'T a1', 'p1', 'proj', true], ['s1', 'T s1', 'p2', 'sub', false], ['w1', 'T w1', 'p3', 'other', false], ['m1', 'T m1', 'p5', 'multi', false]]);
    assert.ok(!('note' in tf) && seen.some((x) => x.url === '/api/orchestration/shell' && x.proto === '2' && x.auth === `Bearer ${TOKEN}`) && posts().length === 0, 'shell GET with bearer and header 2, no POST');
    pass('threadsFor: the bound project (mine), projects inside or equal to a folder, threads whose worktree is inside one; no parent project (also with a worktree inside), sibling prefix, unrelated, archived, deleted or subagent thread; newest first');
    assert.deepEqual(tf.items.map((x) => x.at), [day(11), day(10), day('09'), day('08'), day('07')]);
    pass('threadsFor: items carry at, the time they were sorted by (latestUserMessageAt, else updatedAt)');
    assert.deepEqual(tf.items.map((x) => [x.root, x.run]), [[W`D:\GIT\proj`, ''], [W`D:\GIT\proj`, 'r1'], [W`D:\GIT\proj\sub`, ''], [IN, ''], [W`D:\multi`, '']]);
    pass('threadsFor: items carry root, the thread\'s worktreePath else its own project\'s workspaceRoot as T3 spells them (R5: nested projects too), and run, the latestRunId or "" (R2)');
    assert.deepEqual(tf.items.map((x) => [x.id, x.status, x.active, x.needsYou, x.requestId, x.kind]), [
      ['a2', '', false, false, '', ''], ['a1', 'running', true, true, 'req-1', 'permission'], ['s1', 'idle', false, true, '', ''], ['w1', 'queued', true, false, '', ''], ['m1', 'failed', true, false, '', '']]);
    pass('threadsFor: items carry status, active (a running status or an activeRunId), needsYou (a pending request with an id, or a proposed plan === true), requestId and its kind (B14); missing fields give "", false, false, "", ""');
    assert.deepEqual(tf.items.map((x) => [x.said, x.error, x.limitedUntil, x.plan, x.unread]), [['', '', null, false, false], ['', '', null, false, false], ['', '', null, true, false], ['', '', null, false, false], ['', '', null, false, false]]);
    const saved = threads;
    const RESET = '2026-10-13T14:05:00Z';
    const at = (h) => `2026-10-10T${h}:00:00Z`;
    threads = [
      t('fin', { latestUserMessageAt: day(20), status: 'idle', latestVisibleMessage: { id: 'm', role: 'assistant', text: '\n\n  Done: tests pass.  \r\nmore', updatedAt: day(10) }, latestRunCompletedAt: at(10), lastVisitedAt: at('09') }),
      t('long', { latestUserMessageAt: day(19), latestVisibleMessage: { role: 'assistant', text: 'x'.repeat(200) }, latestRunCompletedAt: at(10), lastVisitedAt: at(11) }),
      t('usr', { latestUserMessageAt: day(18), latestVisibleMessage: { role: 'user', text: 'mine' }, latestRunCompletedAt: at(10), lastVisitedAt: null }),
      t('err', { latestUserMessageAt: day(17), status: 'failed', lastError: 'boom\nat stack', lastErrorClass: 'provider_error', usageLimitResetAt: RESET, latestRunCompletedAt: at(10) }),
      t('lim', { latestUserMessageAt: day(16), status: 'failed', lastError: 'Limit reached', lastErrorClass: 'usage_limit', usageLimitResetAt: RESET, latestRunCompletedAt: null, lastVisitedAt: at('09') }),
      t('limidle', { latestUserMessageAt: day(15), status: 'idle', lastErrorClass: 'usage_limit', usageLimitResetAt: RESET, latestRunCompletedAt: at(10), lastVisitedAt: 'not a date' }),
      t('plan', { latestUserMessageAt: day(14), hasActionableProposedPlan: true, pendingRuntimeRequest: null }),
      t('planreq', { latestUserMessageAt: day(13), hasActionableProposedPlan: true, pendingRuntimeRequest: { id: 'q', kind: 'user_input' } }),
    ];
    const tr = await t3.threadsFor({ origin, bearer: TOKEN, folders: [W`D:\GIT\proj`], project: W`D:\GIT\proj` });
    threads = saved;
    assert.deepEqual(tr.items.map((x) => [x.id, x.said, x.error, x.limitedUntil, x.plan, x.unread]), [
      ['fin', 'Done: tests pass.', '', null, false, true], ['long', 'x'.repeat(120), '', null, false, false], ['usr', '', '', null, false, false],
      ['err', '', 'boom', null, false, false], ['lim', '', 'Limit reached', RESET, false, false], ['limidle', '', '', null, false, true],
      ['plan', '', '', null, true, false], ['planreq', '', '', null, false, false]]);
    pass('threadsFor R25 and R27: said (first line of an assistant message, 120 max), error (first line of lastError), limitedUntil (failed and usage_limit only), plan (a proposed plan without a request), ' +
      'unread by T3\'s hasUnseenCompletion (completed after the visit; no completion or a null or absent visit: no; an unreadable visit: yes); missing fields give "", "", null, false, false');
    slowShell = true;
    let t0 = Date.now();
    const late = await t3.threadsFor({ origin, bearer: TOKEN, folders: [W`D:\GIT\proj`], project: W`D:\GIT\proj` });
    assert.ok(Date.now() - t0 < 5600, 'threadsFor not bounded');
    assert.deepEqual([late.items, late.environmentId], [[], null]);
    assert.match(late.note, /^T3 threads: .*5 s/);
    slowShell = false;
    pass('threadsFor: a shell that sleeps 6 s gives an empty list with a note within 5 s, no throw');

    slow = true;
    t0 = Date.now();
    r = await ensure(W`D:\GIT\proj`);
    assert.ok(Date.now() - t0 < 8500, 'slow upstream not bounded');
    assert.equal(r.path, '/');
    assert.equal(r.note, 'T3 is not on proj: T3 did not answer on /api/projects within 5 s. Reload to retry.');
    pass('ensureProject: an upstream that sleeps 9 s falls back to / with a note within 8 s');
  } finally {
    server.closeAllConnections();
    server.close();
  }
}

// B14: pendingRequest and respond against a fake T3 (ticket route, bounded thread route, /ws with a minimal frame codec).
async function approval() {
  const seen = [];
  const frames = [];
  let reply; // what the fake /ws answers to the Request frame: an array of messages, or null for silence
  let ticketStatus = 200;
  let closedByClient = 0;
  const json = (res, status, body) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  const ref = (driver, nativeId) => ({ driver, nativeId, strength: 'strong' });
  const projection = {
    runtimeRequests: [
      { id: 'req-1', kind: 'command', status: 'pending', responseCapability: { type: 'live', providerSessionId: 'ps-1' } },
      { id: 'req-2', kind: 'permission', status: 'resolved', responseCapability: { type: 'live', providerSessionId: 'ps-1' } },
      { id: 'req-3', kind: 'command', status: 'pending', responseCapability: { type: 'live', providerSessionId: 'ps-1' } },
    ],
    turnItems: [
      { type: 'command_execution', nativeItemRef: ref('codex', 'item-1'), input: 'git push --force' },
      { type: 'approval_request', requestId: 'req-1', requestKind: 'command', nativeItemRef: ref('codex', 'item-1'), prompt: 'needs the network' },
      { type: 'approval_request', requestId: 'req-2', requestKind: 'permission', nativeItemRef: ref('claude', 'item-2'), prompt: 'write outside the folder', appName: 'docs',
        options: [{ decision: 'decline', label: 'No' }, { decision: 'acceptForSession', label: 'Always', warning: 'may be a prompt injection' }, { label: 'no decision' }] },
      { type: 'command_execution', nativeItemRef: ref('codex', 'item-2'), input: 'another driver' },
      { type: 'command_execution', nativeItemRef: ref('codex', null), input: 'no native id' },
      { type: 'approval_request', requestId: 'req-3', requestKind: 'command', nativeItemRef: ref('codex', null), prompt: 'null ref' },
    ],
  };
  const server = http.createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, proto: req.headers['x-t3-orchestration-protocol'], length: req.headers['content-length'], chunked: req.headers['transfer-encoding'], body });
      if (req.url === '/api/auth/websocket-ticket' && req.method === 'POST') return json(res, ticketStatus, ticketStatus === 200 ? { ticket: 'tick et/1', expiresAt: '2026-10-13T00:05:00Z' } : { error: 'nope' });
      if (req.url === '/api/orchestration/threads/t%201/bounded') return json(res, 200, { snapshotSequence: 7, projection, historyCursor: null, hasMoreHistory: false, latestLocalTurnOrdinal: 3 });
      res.writeHead(500).end();
    });
  });
  server.on('upgrade', (req, socket) => {
    seen.push({ method: 'UPGRADE', url: req.url, auth: req.headers.authorization, cookie: req.headers.cookie });
    socket.on('error', () => {});
    const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    const send = (text) => { const d = Buffer.from(text); socket.write(Buffer.concat([d.length < 126 ? Buffer.from([0x81, d.length]) : Buffer.from([0x81, 126, d.length >> 8, d.length & 255]), d])); };
    let buf = Buffer.alloc(0);
    socket.on('data', (c) => {
      buf = Buffer.concat([buf, c]);
      for (;;) { // client frames are masked; 7 or 16 bit lengths are enough here
        if (buf.length < 2) return;
        let len = buf[1] & 127, at = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); at = 4; }
        if (buf.length < at + 4 + len) return;
        const key = buf.subarray(at, at + 4);
        const data = Buffer.from(buf.subarray(at + 4, at + 4 + len)).map((b, i) => b ^ key[i & 3]);
        const op = buf[0] & 15;
        buf = buf.subarray(at + 4 + len);
        if (op === 8) { closedByClient++; return socket.end(Buffer.from([0x88, 0])); }
        if (op !== 1) continue;
        frames.push(JSON.parse(Buffer.from(data).toString('utf8')));
        if (reply) for (const m of reply) send(JSON.stringify(m));
      }
    });
  });
  const origin = `http://127.0.0.1:${await listen(server)}`;
  const exit = (exit) => ({ _tag: 'Exit', requestId: '1', exit });
  const refused = (message) => exit({ _tag: 'Failure', cause: [{ _tag: 'Fail', error: { _tag: 'OrchestrationV2DispatchCommandError', commandId: 'c', commandType: 'runtime-request.respond', message } }] });
  const go = (decision = 'accept') => { seen.length = 0; frames.length = 0; return t3.respond({ origin, bearer: TOKEN, threadId: 't 1', requestId: 'req-1', decision }); };
  try {
    seen.length = 0;
    assert.deepEqual(await t3.pendingRequest({ origin, bearer: TOKEN, threadId: 't 1', requestId: 'req-1' }), { kind: 'command', live: true, prompt: 'needs the network', command: 'git push --force',
      decisions: ['cancel', 'decline', 'acceptForSession', 'accept'], warnings: [], app: '' });
    assert.deepEqual([seen[0].method, seen[0].auth, seen[0].proto], ['GET', `Bearer ${TOKEN}`, '2']);
    assert.deepEqual(await t3.pendingRequest({ origin, bearer: TOKEN, threadId: 't 1', requestId: 'req-2' }), { kind: 'permission', live: false, prompt: 'write outside the folder', command: '',
      decisions: ['decline', 'acceptForSession'], warnings: ['Always: may be a prompt injection'], app: 'docs' });
    assert.equal((await t3.pendingRequest({ origin, bearer: TOKEN, threadId: 't 1', requestId: 'req-3' })).command, '', 'a null nativeId matched a command');
    assert.match((await t3.pendingRequest({ origin, bearer: TOKEN, threadId: 't 1', requestId: 'req-9' })).note, /^T3 request: req-9 is not in the thread$/);
    assert.match((await t3.pendingRequest({ origin, bearer: TOKEN, threadId: 'gone', requestId: 'req-1' })).note, /^T3 request: T3 answered 500 on \/api\/orchestration\/threads\/gone\/bounded$/);
    pass('pendingRequest: GET /bounded with bearer and protocol 2; kind, live (pending and a live capability), prompt of the approval item, command of the command_execution item with the same nativeItemRef (driver too, never a null nativeId); the decisions of the provider options (else T3\'s four defaults), their warnings with the label, appName; a missing request or a failed route gives a note');

    reply = [{ _tag: 'Pong' }, exit({ _tag: 'Success', value: { sequence: 9 } })];
    assert.deepEqual(await go(), { outcome: 'accepted' });
    assert.deepEqual(seen.slice(0, 2).map((x) => [x.method, x.url, x.auth]), [['POST', '/api/auth/websocket-ticket', `Bearer ${TOKEN}`], ['UPGRADE', '/ws?wsTicket=tick%20et%2F1&orchestrationProtocol=2', undefined]]);
    assert.deepEqual([seen[0].length, seen[0].chunked, seen[0].body, seen[1].cookie], ['0', undefined, '', undefined]);
    assert.equal(frames.length, 1);
    const [f] = frames;
    assert.match(f.payload.commandId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.deepEqual(f, { _tag: 'Request', id: '1', tag: 'orchestration.dispatchCommand', payload: { type: 'runtime-request.respond', commandId: f.payload.commandId, threadId: 't 1', requestId: 'req-1', decision: 'accept' }, headers: [] });
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(closedByClient, 1, 'the socket was not closed after the answer');
    pass('respond: ticket POST with the bearer and an empty body (content-length 0), /ws?wsTicket=<encoded>&orchestrationProtocol=2 without a bearer, exactly one Request frame (runtime-request.respond, uuid v4 commandId, headers []); other frames ignored; Success is accepted; the socket closed');

    reply = [[refused('Runtime request req-1 is resolved.')]]; // one frame holding an array, as the JSON serializer allows
    assert.deepEqual([await go('decline'), frames[0].payload.decision], [{ outcome: 'answered', reason: 'Runtime request req-1 is resolved.' }, 'decline']);
    reply = [refused('Runtime request req-1 was not found.')];
    assert.deepEqual(await go(), { outcome: 'answered', reason: 'Runtime request req-1 was not found.' });
    reply = [refused(`The authenticated token is missing required scope: orchestration:operate. ${TOKEN}`)];
    assert.deepEqual(await go(), { outcome: 'failed', reason: `The authenticated token is missing required scope: orchestration:operate. ${'*'.repeat(TOKEN.length)}` });
    reply = [refused('bad ticket tick et/1')];
    assert.deepEqual(await go(), { outcome: 'failed', reason: `bad ticket ${'*'.repeat(9)}` });
    reply = [exit({ _tag: 'Failure', cause: [{ _tag: 'Die', defect: 'boom' }] })];
    assert.deepEqual(await go(), { outcome: 'failed', reason: '"boom"' });
    pass('respond: "is resolved" (also in a batched array) and "was not found" are answered; any other Fail is failed with its message, bearer and ticket redacted; a Die is failed with its defect; decline is sent as decline');

    ticketStatus = 401;
    assert.deepEqual(await go(), { outcome: 'failed', reason: 'T3 gave no socket ticket (401)' });
    assert.ok(!seen.some((x) => x.method === 'UPGRADE'), 'opened a socket without a ticket');
    ticketStatus = 200;
    const ws = globalThis.WebSocket;
    globalThis.WebSocket = undefined;
    try { assert.deepEqual(await go(), { outcome: 'failed', reason: 'this VS Code has no WebSocket client' }); } finally { globalThis.WebSocket = ws; }
    assert.equal(seen.length, 0, 'no WebSocket client, yet T3 was called');
    pass('respond: a refused ticket opens no socket; no global WebSocket sends nothing; both failed with a reason');

    reply = null;
    const closes = closedByClient;
    const t0 = Date.now();
    assert.deepEqual(await go(), { outcome: 'failed', reason: 'T3 did not answer within 10 s' });
    assert.ok(Date.now() - t0 < 10600, 'respond not bounded');
    await new Promise((r) => setTimeout(r, 100));
    assert.deepEqual([frames.length, closedByClient - closes], [1, 1]);
    pass('respond: no answer within 10 s is failed, the socket closed');
  } finally {
    server.closeAllConnections();
    server.close();
  }
}

// Read-only: GETs with an invalid bearer, never a POST, never a pairing token.
async function live() {
  const { origin } = t3.discover();
  console.log(`LIVE origin ${origin}`);
  const failures = [];
  const fwd = await t3.startForwarder({ origin, token: 'invalid', onUpgradeFailure: (f) => failures.push(f) });
  try {
    let r = await get(fwd, '/api/auth/session');
    assert.match(String(r.headers['content-type']), /^application\/json/);
    assert.equal(JSON.parse(r.body).authenticated, false);
    console.log(`LIVE /api/auth/session ${r.status} ${r.headers['content-type']} authenticated=false`);
    r = await get(fwd, '/');
    assert.match(String(r.headers['content-type']), /^text\/html/);
    assert.match(String(r.headers['content-security-policy']), /frame-ancestors/);
    console.log(`LIVE / ${r.status} ${r.headers['content-type']} ${r.body.length} bytes, csp="${r.headers['content-security-policy']}"`);
    const u = await rawUpgrade(fwd, '/ws');
    u.s.destroy();
    console.log(`LIVE bare /ws upgrade: ${u.head.split('\r\n')[0]}, recorded ${JSON.stringify(failures)}`);
  } finally {
    fwd.close();
  }
  pass('live read-only check through the forwarder');
}

// The panel's page load gets INJECT after <head>; everything else passes unchanged (INJECT.md lead decision 5).
async function injection() {
  const HTML = '<!doctype html><!-- é --><html><head lang="en"><title>t</title></head><body>hi</body></html>'; // a multibyte char before <head>
  const BIG = '<html><head></head><body>' + 'x'.repeat(2.5 * 1024 * 1024) + '</body></html>';
  const gz = zlib.gzipSync(HTML);
  let onStall; // '/stall' sends part of a page and never ends; stalled() resolves once it is reached, with a promise for its close
  const stalled = () => new Promise((r) => { onStall = (res) => r({ closed: new Promise((c) => res.on('close', c)) }); }); // wrapped: a bare promise would be adopted
  const within = (p, why) => Promise.race([p, new Promise((_, j) => setTimeout(() => j(new Error(why)), 2000).unref())]);
  const upstream = http.createServer((req, res) => {
    const seen = { 'x-seen-ae': req.headers['accept-encoding'] || 'none' };
    if (req.url === '/att') return res.writeHead(200, { 'content-type': 'text/html', 'content-disposition': 'attachment; filename="a.html"' }).end(HTML);
    if (req.url === '/nohead') return res.writeHead(200, { 'content-type': 'text/html', etag: '"nh"' }).end('<html><body>no head</body></html>');
    if (req.url === '/cut') { res.writeHead(200, { 'content-type': 'text/html' }); res.write('<html><head>'); return setTimeout(() => res.socket.destroy(), 20); }
    if (req.url === '/stall') { res.writeHead(200, { 'content-type': 'text/html' }); res.write('<html><head>'); return onStall(res); }
    if (req.url === '/gz') return res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip', ...seen }).end(gz);
    if (req.url === '/big') { res.writeHead(200, { 'content-type': 'text/html', ...seen }); res.write(BIG.slice(0, 1e6)); return res.end(BIG.slice(1e6)); }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': Buffer.byteLength(HTML), etag: '"v1"', 'last-modified': 'Mon, 12 Oct 2026 00:00:00 GMT', ...seen }).end(HTML);
  });
  const origin = `http://127.0.0.1:${await listen(upstream)}`;
  const fwd = await t3.startForwarder({ origin, token: TOKEN });
  const slow = await t3.startForwarder({ origin, token: TOKEN, holdMs: 100 });
  const iframe = { 'sec-fetch-dest': 'iframe', 'sec-fetch-site': 'cross-site', 'accept-encoding': 'gzip' };
  try {
    let r = await get(fwd, '/', iframe);
    assert.equal(r.headers['x-seen-ae'], 'none');
    assert.equal(r.body, HTML.replace('<head lang="en">', (m) => m + '<script>' + t3.INJECT + '</script>'));
    assert.equal(Number(r.headers['content-length']), r.buf.length);
    for (const k of ['transfer-encoding', 'etag', 'last-modified']) assert.equal(r.headers[k], undefined, k);
    assert.match(String(r.headers['content-security-policy']), /frame-ancestors/);
    pass('iframe GET of html: no accept-encoding upstream, INJECT right after <head>, content-length matches, no transfer-encoding, etag or last-modified');
    r = await get(fwd, '/', { 'accept-encoding': 'gzip' });
    assert.deepEqual([r.headers['x-seen-ae'], r.body, r.headers.etag], ['gzip', HTML, '"v1"']);
    pass('non-iframe GET of the same html: unchanged');
    r = await get(fwd, '/gz', iframe);
    assert.equal(r.headers['content-encoding'], 'gzip');
    assert.ok(r.buf.equals(gz));
    pass('gzip-encoded html for an iframe: passed through byte for byte');
    r = await get(fwd, '/big', iframe);
    assert.ok(r.body === BIG, 'big html changed');
    pass('html over 2 MB for an iframe: streamed through unchanged');
    r = await get(fwd, '/att', iframe);
    assert.deepEqual([r.body, r.headers['content-disposition']], [HTML, 'attachment; filename="a.html"']);
    pass('html attachment for an iframe: passed through unchanged');
    r = await get(fwd, '/nohead', iframe);
    assert.deepEqual([r.body, r.headers.etag], ['<html><body>no head</body></html>', '"nh"']);
    pass('held html without <head>: replayed unchanged, etag kept');
    await within(assert.rejects(get(fwd, '/cut', iframe)), 'cut while held: client hangs');
    pass('upstream cut while held: the client gets an error, no hang');
    let closed = stalled();
    const c = http.request({ host: '127.0.0.1', port: fwd.port, path: '/stall', headers: { host: `127.0.0.1:${fwd.port}`, ...iframe } });
    c.on('error', () => {});
    c.end();
    const upClosed = (await closed).closed;
    await new Promise((r) => setTimeout(r, 50)); // let the forwarder get the headers and start holding
    c.destroy();
    await within(upClosed, 'client abort while held: upstream request still open');
    pass('client abort while held: the upstream request is closed');
    closed = stalled();
    const pending = get(slow, '/stall', iframe);
    const slowClosed = (await closed).closed;
    r = await within(pending, 'stalled hold: no answer');
    assert.deepEqual([r.status, r.headers['content-type'], r.body], [504, 'text/plain', 'T3 did not finish the page in time.']);
    await within(slowClosed, 'stalled hold: upstream request still open after the 504');
    pass('stalled hold: 504 with a plain text body after the hold time, upstream request closed');
  } finally {
    fwd.close();
    slow.close();
    upstream.closeAllConnections();
    upstream.close();
  }
}

async function ports() {
  const opts = { origin: 'http://127.0.0.1:1', token: TOKEN }; // nothing listens upstream: the forwarder answers 502 itself
  const busy = http.createServer();
  const taken = await listen(busy);
  let f = await t3.startForwarder({ ...opts, port: taken });
  f.close();
  assert.equal(f.usedRequested, false);
  assert.notEqual(f.port, taken);
  await new Promise((resolve) => busy.close(resolve));
  f = await t3.startForwarder({ ...opts, port: taken });
  assert.deepEqual([f.usedRequested, f.port], [true, taken]);
  assert.equal((await get(f, '/x')).status, 502); // a served connection, then recreate on the same port at once (as refresh does)
  f.close();
  f = await t3.startForwarder({ ...opts, port: taken });
  f.close();
  assert.deepEqual([f.usedRequested, f.port], [true, taken]);
  pass('port option: taken -> random port, usedRequested false; free -> that port, usedRequested true, also right after close()');

  // R14: ephemeral ports only (the owner's VS Code may hold 47730 to 47739).
  const busy2 = http.createServer();
  const taken2 = await listen(busy2);
  const probes = [http.createServer(), http.createServer()];
  const [free, free2] = await Promise.all(probes.map(listen));
  await Promise.all(probes.map((p) => new Promise((resolve) => p.close(resolve))));
  f = await t3.startForwarder({ ...opts, port: taken2, spare: [taken2, free, free2] });
  f.close();
  assert.deepEqual([f.usedRequested, f.port], [false, free]);
  f = await t3.startForwarder({ ...opts, port: free, spare: [taken2] });
  f.close();
  assert.deepEqual([f.usedRequested, f.port], [true, free]);
  f = await t3.startForwarder({ ...opts, port: taken2, spare: [taken2] });
  f.close();
  assert.equal(f.usedRequested, false);
  assert.notEqual(f.port, taken2);
  await new Promise((resolve) => busy2.close(resolve));
  pass('port option with spare (R14): taken -> the first free spare in order, usedRequested false; port free -> port; port and every spare taken -> random');
}

// INJECT in a vm with a stubbed cross-origin parent; clicks are plain objects with composedPath().
function script() {
  new Function(t3.INJECT); // parses
  const KEY = 't3code:nightly-mobile-beta-notice-dismissed:v1';
  const posted = [];
  const store = new Map();
  let tick = null; // the poll is driven by hand, no real 500 ms waits
  let goTick = null; // the go poll (100 ms), driven by hand too
  let chevron = null; // what document.querySelector('[data-thread-title-chevron]') returns
  const rows = [];
  const buttons = [];
  const dispatched = []; // CustomEvents on window, copied out of the vm realm
  let palette = false; // whether T3's command palette is open
  const listeners = { click: [], keydown: [], message: [], popstate: [], dragover: [], drop: [], submit: [], paste: [] };
  const moves = []; // history calls that reached the original methods
  const styles = []; // <style> text appended to head
  let form = null; // what document.querySelector('[data-chat-composer-form]') returns
  let editor = null; // what document.querySelector('[data-testid="composer-editor"]') returns
  let dropTarget = null; // what document.querySelector('[data-chat-workspace-drop-target]') returns
  const PICK = { '[data-thread-title-chevron]': () => chevron, '[data-chat-composer-form]': () => form, '[data-testid="composer-editor"]': () => editor, '[data-chat-workspace-drop-target]': () => dropTarget };
  const win = {
    parent: { get location() { throw new Error('cross-origin'); }, postMessage: (m, target) => posted.push({ m: { ...m }, target }) },
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) },
    location: { pathname: '/' },
    history: { pushState(...a) { moves.push(['push', this === win.history, ...a]); if (a[2]) win.location.pathname = a[2]; }, replaceState(...a) { moves.push(['replace', this === win.history, ...a]); } },
    addEventListener: (type, fn, capture) => { listeners[type].push({ fn, capture }); },
    removeEventListener: (type, fn, capture) => { listeners[type] = listeners[type].filter((l) => !(l.fn === fn && l.capture === capture)); },
    document: {
      querySelector: (s) => (PICK[s] ? PICK[s]() : (assert.equal(s, '[data-command-palette]'), palette ? {} : null)),
      activeElement: null,
      querySelectorAll: (s) => (s === 'button[aria-label]' ? buttons : (assert.equal(s, '[data-command-palette] [data-slot="command-item"]'), palette ? rows : [])),
      createElement: (t) => (assert.equal(t, 'style'), { textContent: '' }),
      head: { appendChild: (el) => styles.push(el.textContent) },
    },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
    PopStateEvent: class { constructor(type) { this.type = type; } },
    Event: class { constructor(type) { this.type = type; } },
    StorageEvent: class { constructor(type, init) { this.type = type; this.detail = { ...init }; } }, // init in detail, so dispatched keeps one shape
    DataTransfer: class { constructor() { this.data = {}; this.files = []; this.items = { add: (f) => this.files.push(f) }; } setData(k, v) { this.data[k] = v; } },
    File: class { constructor(parts, name, init) { Object.assign(this, { parts, name, type: init.type }); } },
    atob: (s) => Buffer.from(s, 'base64').toString('latin1'),
    DragEvent: class { constructor(type, init) { Object.assign(this, { type }, init); } },
    dispatchEvent: (ev) => { dispatched.push({ type: ev.type, detail: { ...ev.detail } }); return true; },
    setInterval: (fn, ms) => { if (ms === 100) { goTick = fn; return 2; } assert.equal(ms, 500); tick = fn; return 1; },
    clearInterval: (id) => { if (id === 2) goTick = null; else tick = null; },
  };
  win.window = win;
  const native = { ...win.history };
  vm.runInNewContext(t3.INJECT, win);
  const LOC = (pathname) => ({ m: { type: 't3vscode:location', pathname }, target: '*' });
  assert.deepEqual(posted.splice(0), [LOC('/')], 'location on load');
  assert.ok(win.history.pushState !== native.pushState && win.history.replaceState !== native.replaceState, 'history not wrapped at inject time');
  win.location.pathname = '/env/t-1';
  win.history.pushState({ a: 1 }, '', '/env/t-1');
  win.location.pathname = '/env/t-2';
  win.history.replaceState(null, '', '/env/t-2');
  win.location.pathname = '/env/t-1';
  listeners.popstate.forEach((l) => l.fn({}));
  assert.deepEqual(moves, [['push', true, { a: 1 }, '', '/env/t-1'], ['replace', true, null, '', '/env/t-2']], 'originals not called with their arguments and this');
  assert.deepEqual(posted.splice(0), [LOC('/env/t-1'), LOC('/env/t-2'), LOC('/env/t-1')], 'location after push, replace, popstate');
  pass('INJECT location: posts the pathname on load, after history.pushState and replaceState (originals still run) and on popstate');
  assert.deepEqual(styles, ['span:has(> [aria-label="Toggle terminal drawer"]:not([aria-pressed="true"])), [aria-label="Toggle terminal drawer"]:not([aria-pressed="true"]) { display: none !important; }']);
  pass('INJECT chrome: one style rule hides the terminal drawer toggle and its tooltip wrapper (docs/QOL.md item 2)');
  assert.deepEqual([listeners.click.length, listeners.click[0].capture, listeners.keydown.length, listeners.keydown[0].capture, listeners.message.length,
    listeners.dragover.length, listeners.dragover[0].capture, listeners.drop.length, listeners.drop[0].capture, listeners.submit.length], [2, true, 2, true, 3, 1, true, 1, true, 1]);
  const onSent = listeners.submit[0].fn; // B18: one handler for submit, click and keydown, registered last
  assert.ok(listeners.submit[0].capture && listeners.click[1].fn === onSent && listeners.keydown[1].fn === onSent && listeners.click[1].capture && listeners.keydown[1].capture);
  const onClick = listeners.click[0].fn;
  const onGo = listeners.message[0].fn;
  const onMessage = listeners.message[1].fn;
  const GO = (ok) => ({ m: { type: 't3vscode:go-result', ok }, target: '*' });
  const go = (data, source = win.parent) => { moves.length = 0; dispatched.length = 0; onGo({ source, data: { type: 't3vscode:go', ...data } }); };
  const moved = (path) => assert.deepEqual([moves, dispatched], [[['push', true, null, '', path]], [{ type: 'popstate', detail: {} }]], 'go: push then popstate');
  go({ pathname: '/env/t-9', extra: 1 });
  moved('/env/t-9');
  assert.deepEqual([posted.splice(0), goTick], [[LOC('/env/t-9'), GO(true)], null], 'go without a title: location, then ok at once, no poll');
  chevron = { parentElement: { textContent: 'Fix the parser' } };
  go({ pathname: '/env/t-8', title: 'Fix the parser' });
  moved('/env/t-8');
  assert.deepEqual([posted.splice(0), goTick], [[LOC('/env/t-8'), GO(true)], null], 'go with the title already shown: ok at once, no poll');
  chevron = null;
  go({ pathname: '/env/t-7', title: 'Write the docs' });
  moved('/env/t-7');
  assert.deepEqual(posted.splice(0), [LOC('/env/t-7')], 'go with the title not shown: location only, the result waits');
  assert.ok(goTick, 'go with the title not shown: no poll started');
  goTick(); // no header yet
  chevron = { parentElement: { textContent: 'Fix the parser' } };
  goTick(); // the old thread's header
  assert.deepEqual([posted.length, !!goTick], [0, true], 'go: answered before the title showed');
  chevron = { parentElement: { textContent: 'Write the docs' } };
  goTick();
  assert.deepEqual([posted.splice(0), goTick], [[GO(true)], null], 'go: title shown on the third tick -> ok, poll cleared');
  chevron = { parentElement: { textContent: 'Fix the parser' } };
  go({ pathname: '/env/t-6', title: 'Never shown' });
  moved('/env/t-6');
  assert.deepEqual(posted.splice(0), [LOC('/env/t-6')]);
  for (let i = 0; i < 14; i++) goTick();
  assert.deepEqual([posted.length, !!goTick], [0, true], 'go: gave up before 15 ticks');
  goTick();
  assert.deepEqual([posted.splice(0), goTick], [[GO(false)], null], 'go: no title after 15 ticks -> ok:false, poll cleared');
  chevron = null;
  for (const [why, data, source] of [['wrong source', { type: 't3vscode:go', pathname: '/env/t-8' }, {}], ['a URL', { type: 't3vscode:go', pathname: '/x?u=http://evil.example' }],
    ['no leading slash', { type: 't3vscode:go', pathname: 'env/t-8' }], ['not a string', { type: 't3vscode:go', pathname: ['/env/t-8'] }], ['other type', { type: 't3vscode:new-thread', pathname: '/env/t-8' }]]) {
    moves.length = 0;
    dispatched.length = 0;
    onGo({ source: source || win.parent, data: { ...data, title: 'Write the docs' } });
    assert.deepEqual([moves.length, dispatched.length, posted.length, goTick], [0, 0, 0, null], why);
  }
  dispatched.length = 0;
  pass('INJECT go: from the parent, pushState with the pathname then a popstate event, the location message follows; go-result ok at once without a title or with it shown, ' +
    'else ok when the chat header shows it within 15 ticks of 100 ms (poll cleared), ok:false after; a URL, a path without a leading slash, a non-string or another source is ignored');
  assert.equal(store.get(KEY), 'true');
  pass('INJECT seeds the nightly popup key');
  const el = (tagName, attrs = {}) => ({ tagName, getAttribute: (n) => (n in attrs ? attrs[n] : null) });
  const chip = (href, label = 'a.ts') => el('A', { 'data-slot': 'context-chip', href, 'aria-label': label });
  const click = (target, extra = {}) => {
    const e = { isTrusted: true, button: 0, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, prevented: false, stopped: false,
      composedPath: () => [el('SPAN'), target, el('DIV'), win], preventDefault() { e.prevented = true; }, stopPropagation() { e.stopped = true; }, stopImmediatePropagation() { e.stopped = e.immediate = true; }, ...extra };
    posted.length = 0;
    onClick(e);
    return e;
  };
  let e = click(chip('D:\\x\\a.ts:12:3'));
  assert.ok(e.prevented && e.stopped);
  assert.deepEqual(posted, [{ m: { type: 't3vscode:open-file', path: 'D:\\x\\a.ts', line: 12, column: 3 }, target: '*' }]);
  click(chip('C:/x/b.js:7'));
  assert.deepEqual(posted.map((p) => p.m), [{ type: 't3vscode:open-file', path: 'C:/x/b.js', line: 7, column: undefined }]);
  posted.length = 0;
  e = click(el('A', { href: 'D:/GIT/t3-vscode/t3.js' })); // the live chip of 2026-10-12: a plain link, no data-slot
  assert.ok(e.prevented && posted[0].m.path === 'D:/GIT/t3-vscode/t3.js', 'plain link with a local path');
  posted.length = 0;
  pass('INJECT: a file chip click posts path, line and column to the parent and is cancelled, with or without the data-slot marker');
  // B5: relative links, mention chips (message and composer) and diff titles post relative: true; the extension resolves them against the bound root.
  const REL = (path, line, column) => [{ m: { type: 't3vscode:open-file', path, line, column, relative: true }, target: '*' }];
  e = click(chip('src/a.ts:12:3'));
  assert.ok(e.prevented && e.stopped, 'relative link not cancelled');
  assert.deepEqual(posted, REL('src/a.ts', 12, 3));
  click(el('A', { href: 'lib\\b.js:7' }));
  assert.deepEqual(posted, REL('lib\\b.js', 7, undefined));
  const CHIP = (label, slot = 'context-chip') => el('BUTTON', { 'data-slot': slot, 'aria-label': label });
  e = click(CHIP('Preview apps/web/src/x.tsx'));
  assert.ok(e.prevented && e.stopped, 'mention chip not cancelled');
  assert.deepEqual(posted, REL('apps/web/src/x.tsx', undefined, undefined));
  click(CHIP('Preview D:\\x\\a.ts'));
  assert.deepEqual(posted.map((p) => p.m), [{ type: 't3vscode:open-file', path: 'D:\\x\\a.ts', line: undefined, column: undefined }], 'an absolute mention is not relative');
  const title = (text) => ({ ...el('SPAN', { 'data-title': '' }), textContent: text });
  const header = el('DIV', { 'data-diffs-header': '' });
  e = click(title(' src/diff.ts '), { composedPath: () => [el('SPAN'), title(' src/diff.ts '), header, win] });
  assert.ok(e.prevented && e.stopped, 'diff title not cancelled');
  assert.deepEqual(posted, REL('src/diff.ts', undefined, undefined));
  pass('INJECT B5: a relative link, a mention chip (button with data-slot and "Preview <path>") and a diff title under [data-diffs-header] post relative: true with line and column, cancelled');
  for (const [why, target, extra] of [['thread chip', chip('D:\\x\\a.ts', 'Thread, foo')], ['posix path', chip('/home/u/b.js:7')], ['double-slash path', chip('//host/share/a.txt')], ['backslash-rooted', chip('\\x\\a.ts')],
    ['parent step', chip('src/../../a.ts')], ['parent step, backslash', chip('..\\a.ts')], ['scheme', chip('https://example.com/a.ts')], ['mailto', chip('mailto:a@b.c')], ['javascript', chip('javascript:alert(1)')],
    ['fragment', chip('#top')], ['query', chip('?q=1')], ['drive-relative', chip('C:a.ts')], ['empty href', chip('')], ['ctrl-click', chip('D:\\x\\a.ts'), { ctrlKey: true }],
    ['untrusted', chip('D:\\x\\a.ts'), { isTrusted: false }], ['plain button', el('BUTTON')], ['image preview (no data-slot)', CHIP('Preview shot.png', null)], ['other chip button', CHIP('File options for a.ts')],
    ['second colon', chip('D:\\x\\a.ts:zone:1')], ['diff title with a button in the path', title('src/a.ts'), { composedPath: () => [title('src/a.ts'), el('BUTTON'), header, win] }],
    ['title outside a diff header', title('src/a.ts'), { composedPath: () => [title('src/a.ts'), el('DIV'), win] }], ['diff title, parent step', title('../a.ts'), { composedPath: () => [title('../a.ts'), header, win] }]]) {
    e = click(target, extra);
    assert.ok(!e.prevented && !e.stopped && !posted.some((p) => p.m.type === 't3vscode:open-file'), why);
    const d = posted.pop(); assert.ok(!d || d.m.type === 't3vscode:click', why + ' diagnostic'); // the no-match diagnostic for the owner's log (none before the walk)
    if (!['ctrl-click', 'untrusted'].includes(why)) assert.ok(d, why + ': no diagnostic line');
  }
  pass('INJECT ignores thread chips, rooted paths (POSIX, //host/share, backslash), parent steps, schemes (https, mailto, javascript), # and ? links, drive-relative, modifier clicks, untrusted events, ' +
    'other buttons (image previews without data-slot), extra colons, diff titles with a button in the path or outside a header; each non-match leaves one diagnostic line');
  // B20: Alt on a diff title asks for VS Code's diff view; Alt anywhere else stays with T3, silently.
  e = click(title(' src/diff.ts '), { altKey: true, composedPath: () => [title(' src/diff.ts '), header, win] });
  assert.ok(e.prevented && e.stopped, 'Alt on a diff title not cancelled');
  assert.deepEqual(posted.map((p) => p.m), [{ type: 't3vscode:open-diff', path: 'src/diff.ts', line: undefined, column: undefined, relative: true }]);
  // Test 16: the pointer lands on an element inside the title (as in the live diff panel), the shadow root has no tag, and the header sits above it.
  e = click(el('SPAN'), { altKey: true, composedPath: () => [el('SPAN'), title('panel.js'), el('DIV'), { nodeType: 11 }, header, win] });
  assert.deepEqual([e.prevented, e.stopped, posted.map((p) => p.m.type + ' ' + p.m.path)], [true, true, ['t3vscode:open-diff panel.js']], 'Alt on a span inside a diff title');
  click(title('src/diff.ts'), { composedPath: () => [title('src/diff.ts'), header, win] });
  assert.deepEqual(posted, REL('src/diff.ts', undefined, undefined), 'a plain click on a diff title no longer opens the file');
  for (const [why, target, extra] of [['Alt on a link', chip('D:\\x\\a.ts'), { altKey: true }], ['Alt on a mention chip', CHIP('Preview src/a.ts'), { altKey: true }],
    ['Alt on a title outside a header', title('src/a.ts'), { altKey: true, composedPath: () => [title('src/a.ts'), el('DIV'), win] }], ['Alt in plain text', el('SPAN'), { altKey: true }]]) {
    e = click(target, extra);
    assert.deepEqual([e.prevented, e.stopped, posted], [false, false, []], why);
  }
  pass('INJECT B20: Alt+click on a diff title under [data-diffs-header] posts open-diff with the relative path, cancelled; a plain click still opens the file; Alt elsewhere does nothing and logs nothing');
  // B12: Alt+click on a code block's Copy code posts the block's pre text; the header between button and wrapper must not count as the wrapper.
  const COPY = el('BUTTON', { 'aria-label': 'Copy code', type: 'button' });
  const codeHeader = el('DIV', { class: 'chat-markdown-codeblock-header flex items-center' });
  const block = (code) => ({ ...el('DIV', { class: 'chat-markdown-codeblock my-[0.65rem] overflow-hidden', 'data-language': 'ts' }), querySelector: (s) => (assert.equal(s, 'pre'), code === null ? null : { textContent: code }) });
  const viaCopy = (wrapper, extra = {}) => click(COPY, { composedPath: () => [el('svg'), COPY, el('SPAN', { role: 'toolbar' }), codeHeader, wrapper, el('DIV'), win], ...extra });
  e = viaCopy(block('const a = 1;\n'), { altKey: true });
  assert.ok(e.prevented && e.stopped, 'Alt on Copy code not cancelled');
  assert.deepEqual(posted, [{ m: { type: 't3vscode:insert', text: 'const a = 1;\n' }, target: '*' }]);
  viaCopy(block('x'.repeat(70000)), { altKey: true });
  assert.equal(posted[0].m.text.length, 65536, 'insert text not capped at 64 KB');
  e = viaCopy(block('const a = 1;\n'));
  assert.ok(!e.prevented && !e.stopped && posted.every((p) => p.m.type === 't3vscode:click'), 'a plain click on Copy code was taken from T3');
  for (const [why, path] of [['no wrapper (mermaid diagram mode)', () => [COPY, codeHeader, el('DIV'), win]], ['wrapper without a pre', () => [COPY, codeHeader, block(null), win]],
    ['header only, no wrapper', () => [COPY, el('DIV', { class: 'chat-markdown-codeblock-header' }), win]], ['another label', () => [el('BUTTON', { 'aria-label': 'Copied' }), block('a'), win]],
    ['a link before the button', () => [el('A', { href: 'x' }), COPY, block('a'), win]], ['Copy code without a button', () => [el('SPAN', { 'aria-label': 'Copy code' }), block('a'), win]]]) {
    e = click(COPY, { altKey: true, composedPath: path });
    assert.deepEqual([e.prevented, e.stopped, posted], [false, false, []], why);
  }
  pass('INJECT B12: Alt+click on Copy code inside .chat-markdown-codeblock posts insert with the pre text (capped at 64 KB), cancelled; a plain click stays with T3; ' +
    'no wrapper, no pre, the header class alone, another label, a link first or a non-button: nothing');
  // B9: a plain click on a code block's Run in terminal posts run with the trimmed pre text, cancelled before T3's own listeners.
  const settingsMsg = (runInTerminal, source = win.parent) => listeners.message[2].fn({ source, data: { type: 't3vscode:settings', runInTerminal } });
  const RUN = el('BUTTON', { 'aria-label': 'Run in terminal', type: 'button' });
  const viaRun = (wrapper, extra = {}) => click(RUN, { composedPath: () => [el('svg'), RUN, el('SPAN', { role: 'toolbar' }), codeHeader, wrapper, el('DIV'), win], ...extra });
  e = viaRun(block('  npm test\n'));
  assert.ok(e.prevented && e.immediate, 'Run in terminal not cancelled with stopImmediatePropagation');
  assert.deepEqual(posted, [{ m: { type: 't3vscode:run', text: 'npm test' }, target: '*' }]);
  viaRun(block('x'.repeat(20000)));
  assert.equal(posted[0].m.text.length, 16384, 'run text not capped at 16 KB');
  const untouched = (ev, why) => assert.ok(!ev.prevented && !ev.stopped && posted.every((p) => p.m.type === 't3vscode:click'), why);
  untouched(click(RUN, { composedPath: () => [RUN, codeHeader, el('DIV'), win] }), 'Run in terminal without a wrapper');
  untouched(click(RUN, { composedPath: () => [RUN, codeHeader, block(null), win] }), 'Run in terminal without a pre');
  untouched(viaRun(block('npm test\n'), { altKey: true }), 'Alt on Run in terminal');
  untouched(viaRun(block('npm test\n'), { isTrusted: false }), 'an untrusted click on Run in terminal');
  settingsMsg('t3');
  untouched(viaRun(block('npm test\n')), 'runInTerminal t3: the click was taken');
  settingsMsg('vscode', {});
  untouched(viaRun(block('npm test\n')), 'settings from another source were applied');
  settingsMsg('vscode');
  assert.ok(viaRun(block('npm test\n')).prevented, 'runInTerminal vscode again: not taken');
  pass('INJECT B9: a plain click on Run in terminal inside .chat-markdown-codeblock posts run with the trimmed pre text (capped at 16 KB), prevented and stopped immediately; ' +
    'no wrapper, no pre, Alt or untrusted: T3 keeps it; runInTerminal t3 from the parent leaves it to T3, from another source nothing changes');
  // B11: T3's new Notification(title, {body, tag}) posts notify; the parent's notify-click calls that tag's click listeners.
  const NOTE = win.Notification;
  const onQol11 = listeners.message[2].fn;
  const clickTag = (tag, source = win.parent) => onQol11({ source, data: { type: 't3vscode:notify-click', tag } });
  let asked = null;
  const promised = NOTE.requestPermission((p) => { asked = p; });
  assert.deepEqual([NOTE.permission, asked, typeof promised.then], ['granted', 'granted', 'function']);
  posted.length = 0;
  const n1 = new NOTE('Approval needed', { body: 'Fix the parser', tag: 'env:t-1', silent: true });
  assert.deepEqual(posted.splice(0), [{ m: { type: 't3vscode:notify', title: 'Approval needed', body: 'Fix the parser', tag: 'env:t-1' }, target: '*' }]);
  assert.equal(n1.tag, 'env:t-1', 'T3 keys its pending map on tag');
  n1.close();
  const got = [];
  n1.onclick = () => got.push('onclick');
  n1.addEventListener('click', function (ev) { got.push([this === n1, ev.type]); });
  n1.addEventListener('close', () => got.push('close'));
  clickTag('env:t-1', {});
  clickTag('env:t-2');
  assert.deepEqual(got, [], 'a click from another source or for another tag');
  clickTag('env:t-1');
  assert.deepEqual(got.splice(0), ['onclick', [true, 'click']]);
  const n2 = new NOTE('Thread completed', { body: 'Fix the parser', tag: 'env:t-1' });
  n2.addEventListener('click', () => got.push('n2'));
  clickTag('env:t-1');
  assert.deepEqual(got.splice(0), ['n2'], 'a newer notification with the same tag replaces the older one');
  posted.length = 0;
  new NOTE('x'.repeat(400), { body: 'y'.repeat(400), tag: 'z'.repeat(400) });
  new NOTE('Hi');
  assert.deepEqual(posted.splice(0).map((p) => [p.m.title.length, p.m.body, p.m.tag.length].map((v) => (typeof v === 'string' ? v.length : v))), [[300, 300, 300], [2, 0, 0]], 'caps or defaults');
  for (let i = 0; i <= 20; i++) new NOTE('n', { tag: 'g' + i }).addEventListener('click', () => got.push('g' + i));
  posted.length = 0;
  ['g0', 'g1', 'g20'].forEach((t) => clickTag(t));
  assert.deepEqual([got.splice(0), posted], [['g1', 'g20'], []], 'more than the last 20 kept, or a click posted something');
  pass('INJECT B11: window.Notification is a shim with permission granted and requestPermission granted; new Notification posts notify (title, body, tag capped at 300) and keeps tag; ' +
    'notify-click from the parent calls onclick and the click listeners of the newest one with that tag; only the last 20 tags are kept');
  // B18: one handler for a trusted form submit, a click on the composer's submit button and Enter in the composer editor.
  const formEl = el('FORM', { 'data-chat-composer-form': 'true' });
  const editorEl = el('DIV', { 'data-testid': 'composer-editor' });
  const submitBtn = el('BUTTON', { type: 'submit' });
  const SENT = [{ m: { type: 't3vscode:sent' }, target: '*' }];
  const ev = (type, nodes, extra = {}) => {
    posted.length = 0;
    onSent({ type, isTrusted: true, button: 0, key: 'Enter', ctrlKey: false, shiftKey: false, altKey: false, isComposing: false, repeat: false, composedPath: () => [...nodes, win], ...extra });
    return posted.splice(0);
  };
  assert.deepEqual(ev('submit', [formEl]), SENT, 'form submit');
  assert.deepEqual(ev('click', [el('SVG'), submitBtn, el('DIV'), formEl]), SENT, 'send button');
  assert.deepEqual(ev('click', [submitBtn, formEl], { ctrlKey: true }), SENT, 'Ctrl+click on send (the alternate send)');
  assert.deepEqual(ev('keydown', [el('P'), editorEl, formEl]), SENT, 'Enter in the editor');
  assert.deepEqual(ev('keydown', [editorEl], { ctrlKey: true }), SENT, 'Ctrl+Enter in the editor');
  for (const [why, type, nodes, extra] of [['untrusted submit', 'submit', [formEl], { isTrusted: false }], ['submit of another form', 'submit', [el('FORM')]],
    ['untrusted click', 'click', [submitBtn, formEl], { isTrusted: false }], ['middle click', 'click', [submitBtn, formEl], { button: 1 }],
    ['another button in the form', 'click', [el('BUTTON', { type: 'button' }), formEl]], ['a submit button in another form', 'click', [submitBtn, el('FORM')]],
    ['a click in the form, no button', 'click', [el('DIV'), formEl]], ['a submit button outside any form', 'click', [submitBtn]],
    ['untrusted Enter', 'keydown', [editorEl], { isTrusted: false }], ['Shift+Enter', 'keydown', [editorEl], { shiftKey: true }], ['Alt+Enter', 'keydown', [editorEl], { altKey: true }],
    ['Enter while composing', 'keydown', [editorEl], { isComposing: true }], ['held Enter', 'keydown', [editorEl], { repeat: true }], ['another key', 'keydown', [editorEl], { key: 'a' }],
    ['Enter outside the editor', 'keydown', [el('TEXTAREA'), formEl]], ['no path', 'keydown', [], {}]]) assert.deepEqual(ev(type, nodes, extra), [], why);
  pass('INJECT B18: a trusted form submit, a left or Ctrl click on the composer submit button and Enter (Ctrl too) in the composer editor post t3vscode:sent; ' +
    'untrusted events, other buttons, other forms, Shift, Alt, IME composing, a held key and Enter outside the editor post nothing');

  const W = String.raw;
  const ROOT = W`D:\GIT\t3-vscode`;
  const TITLE = 't3-vscode "q"'; // a quote: a selector built from the title would throw
  const LABEL = 'New thread in ' + TITLE;
  // A palette row as T3 renders it: spans in document order; the wrapper has element children, the leaves carry the text.
  const row = (...leaves) => {
    const r = { clicks: 0, click() { r.clicks++; },
      querySelectorAll: (s) => { assert.equal(s, 'span'); return [{ textContent: leaves.join(''), children: [{}] }, ...leaves.map((t) => ({ textContent: t, children: [] }))]; } };
    return r;
  };
  const button = (label) => ({ getAttribute: (n) => (n === 'aria-label' ? label : null) });
  const target = row('t3-vscode', 'Local', '\u00b7', ` ${ROOT} `); // whitespace around the text: trimmed
  const others = [
    row('t3-vscode-old', 'Local', '\u00b7', ROOT + '-old'),
    row('sub', 'Local', '\u00b7', ROOT + W`\sub`),
    row('t3-vscode', 'Local \u00b7 Remote'), // a grouped project row shows no root
    row(ROOT, '3m'), // a thread whose title is the root, then its time
    row(ROOT), // a row whose only text is the root
    row(ROOT, 'Local', '\u00b7', ROOT), // a title equal to the root never matches, even with the path after it
  ];
  const NEW = { type: 't3vscode:new-thread', root: ROOT, title: TITLE };
  const ask = (data, source = win.parent) => onMessage({ data, source });
  posted.length = 0;
  ask(NEW, {});
  ask({ ...NEW, root: 1 });
  ask({ type: NEW.type, title: TITLE }); // the old shape
  ask({ type: NEW.type, root: ROOT });
  ask('t3vscode:new-thread');
  assert.deepEqual([tick, posted.length], [null, 0], 'a foreign or malformed message started a poll');
  const RESULT = (ok) => [{ m: { type: 't3vscode:new-thread-result', ok }, target: '*' }];
  // One result per request, and the owner-input listeners are gone afterwards (only the file chip handler stays).
  const ended = (ok, why) => {
    assert.equal(tick, null, `${why}: poll still running`);
    assert.deepEqual(posted, RESULT(ok), `${why}: result`);
    assert.deepEqual([listeners.click.length, listeners.keydown.length], [2, 2], `${why}: owner listeners left`);
    posted.length = 0;
  };
  const fire = (type, isTrusted) => listeners[type].slice().forEach((l) => l.fn({ type, isTrusted, button: 0, composedPath: () => [] }));
  const EVENT = (query) => ({ type: 't3code:open-command-palette', detail: { query } });
  const clicks = () => [target, ...others].map((r) => r.clicks);
  rows.push(...others, target);
  ask(NEW);
  assert.deepEqual([listeners.click.length, listeners.keydown.length, listeners.keydown[2].capture], [3, 3, true], 'owner listeners in capture phase while polling');
  tick();
  tick();
  assert.deepEqual(dispatched, [EVENT('t3-vscode'), EVENT('t3-vscode')], 'one dispatch per tick while the palette is missing');
  palette = true; // T3 mounted and opened it
  buttons.push(button('New thread in proj'), button(LABEL + ' 2'));
  tick();
  assert.deepEqual([clicks(), dispatched.length, posted.length], [[1, 0, 0, 0, 0, 0, 0], 2, 0], 'one click on the root row, no result before the palette closes');
  tick();
  palette = false; // T3 ran the item and closed the palette
  tick();
  assert.equal(posted.length, 0, 'success before the header names the project');
  const was = win.location.pathname;
  win.location.pathname = '/draft/d-1'; // a fresh project: T3 opened its draft, the header is not pressed (button() has no click())
  buttons.push(button(LABEL)); // the active project is ours
  tick();
  ended(true, 'click');
  win.location.pathname = was;
  assert.equal(dispatched.length, 2, 'dispatched again after the click');
  pass('INJECT new-thread: from the parent only, opens the palette with the folder name, clicks the one row whose last text is exactly the root (not a thread or a title equal to it), ok:true once the palette is gone and the header names the project');
  const run = () => { dispatched.length = 0; palette = false; ask(NEW); tick(); palette = true; }; // our dispatch opens the palette
  buttons.length = 0;
  run();
  tick(); // click
  tick(); tick(); tick();
  assert.ok(tick && posted.length === 0, 'gave up before 2 s');
  tick();
  ended(false, 'palette still open 2 s after the click');
  buttons.push(button('New thread in proj'));
  run();
  tick(); // click
  palette = false;
  tick(); // closed
  for (let i = 0; i < 5; i++) tick();
  assert.ok(tick && posted.length === 0, 'gave up before 3 s');
  tick();
  ended(false, 'no header button for the title 3 s after the palette closed');
  assert.equal(target.clicks, 3, 'a second attempt');
  pass('INJECT new-thread: the palette not closing within 2 s, or no header button with exactly the title within 3 s after, end with ok:false after one click');
  rows.length = 0;
  rows.push(...others);
  run();
  for (let i = 0; i < 18; i++) tick();
  assert.ok(tick && posted.length === 0, 'stopped before 10 s');
  tick();
  ended(false, 'no matching row');
  assert.deepEqual([palette, dispatched.length, clicks()], [true, 1, [3, 0, 0, 0, 0, 0, 0]], 'no match (grouped, thread or unmounted): the palette stays open, nothing clicked');
  rows.push(target, row('t3-vscode', 'Remote', '·', ROOT)); // the same root in two environments
  run();
  for (let i = 0; i < 20 && tick; i++) tick();
  ended(false, 'two matching rows');
  assert.equal(target.clicks, 3, 'a row clicked with two matches');
  palette = false;
  dispatched.length = 0;
  ask(NEW);
  for (let i = 0; i < 20 && tick; i++) tick();
  ended(false, 'palette never opened');
  assert.equal(dispatched.length, 19);
  palette = true; // a palette the owner opened before our first dispatch
  dispatched.length = 0;
  ask(NEW);
  tick();
  ended(false, 'palette already open');
  assert.deepEqual([dispatched.length, target.clicks], [0, 3], 'touched a palette this run did not open');
  pass('INJECT new-thread: no matching mounted row, two matching rows, no palette within 10 s, or a palette already open before our dispatch end with ok:false and no click');
  palette = false;
  ask(NEW);
  fire('click', false); // our own click or one by a page script: not the owner
  fire('keydown', false);
  assert.ok(tick && posted.length === 0, 'an untrusted event stopped the poll');
  fire('click', true); // the owner picks something first
  ended(false, 'owner click');
  ask(NEW);
  fire('keydown', true);
  ended(false, 'owner key');
  assert.deepEqual([target.clicks, dispatched.length], [3, 0], 'clicked or dispatched after the owner took over');
  pass('INJECT new-thread: a trusted click or key by the owner stops the poll with ok:false and no click; untrusted events do not');
  // T3 browses folders for a query that starts like a path (packages/client-runtime/src/state/projects.ts); a leading ">" means actions only.
  const bad = /^(\.{0,2}[\\/]|~\/|[A-Za-z]:|>)/;
  for (const [root, query] of [[ROOT, 't3-vscode'], ['/home/u/x', 'x'], ['/home/u/x/', 'x'], ['D:\\', 'D'], ['\\\\host\\share\\p', 'p'], [W`D:\GIT\..odd`, '..odd']]) {
    dispatched.length = 0;
    ask({ ...NEW, root });
    tick();
    fire('keydown', true);
    ended(false, root);
    assert.deepEqual(dispatched, [EVENT(query)], root);
    assert.ok(!bad.test(query), `${root}: path-like query ${query}`);
  }
  for (const root of ['/home/u/>x', '/', 'a/D:x', '']) {
    dispatched.length = 0;
    ask({ ...NEW, root });
    ended(false, `rejected query for ${root}`);
    assert.equal(dispatched.length, 0, root);
  }
  const head = { clicks: 0, click() { head.clicks++; }, getAttribute: (n) => (n === 'aria-label' ? LABEL : null) };
  buttons.length = 0;
  buttons.push(button('New thread in proj'), head);
  dispatched.length = 0;
  posted.length = 0;
  ask(NEW);
  assert.deepEqual([head.clicks, tick, dispatched.length, listeners.click.length, listeners.keydown.length], [1, null, 0, 2, 2], 'header path');
  ended(true, 'header button');
  pass('INJECT new-thread: the header button with exactly "New thread in <title>" present is clicked once, ok:true, no palette; absent, the palette flow runs (tests above)');
  pass('INJECT new-thread: the query is the last folder name (a drive root: its letter), never a path prefix; a query starting with ">" or a drive letter and colon, or empty, is ok:false without a dispatch');
  { // R13: a project that already has threads: the row opens its newest thread, so the header button starts the new one, once.
    const was = win.location.pathname;
    const hd = { clicks: 0, click() { hd.clicks++; }, getAttribute: (n) => (n === 'aria-label' ? LABEL : null) };
    const before = target.clicks;
    rows.length = 0;
    rows.push(...others, target);
    buttons.length = 0;
    win.location.pathname = '/env/t-9';
    run(); // dispatch; the palette opens
    tick(); // the click on the root row
    palette = false; // T3 navigated to the newest thread and closed the palette
    buttons.push(hd);
    tick();
    ended(true, 'project with threads');
    assert.deepEqual([target.clicks - before, hd.clicks], [1, 1], 'row once, then the header button once');
    win.location.pathname = was;
    pass('INJECT new-thread R13: a project with threads (palette row opens its newest thread, not a draft): the header button "New thread in <title>" is pressed once, ok:true; on /draft/ it is not pressed');
    const onThird = listeners.message[2].fn;
    buttons.length = 0;
    dispatched.length = 0;
    posted.length = 0;
    onThird({ source: win.parent, data: { type: 't3vscode:palette', query: 'x', open: 'new-thread-in' } });
    assert.deepEqual(dispatched, [{ type: 't3code:open-command-palette', detail: {} }], 'one plain open event, extra fields ignored');
    dispatched.length = 0;
    onThird({ source: {}, data: { type: 't3vscode:palette' } });
    ask(NEW); // a new-thread run polls
    onThird({ source: win.parent, data: { type: 't3vscode:palette' } });
    assert.deepEqual([dispatched, posted], [[], []], 'a foreign source or a running new-thread poll opened the palette');
    fire('keydown', true);
    ended(false, 'owner key ends the poll');
    pass('INJECT palette R13: t3vscode:palette from the parent dispatches t3code:open-command-palette with no detail (T3 opens its root palette); another source or a new-thread run in progress: nothing');
  }

  // docs/QOL.md items 7 and 1: focus-composer, mention, Ctrl+Alt+C.
  const onQol = listeners.message[2].fn;
  const MENTION = { type: 't3vscode:mention', text: '[a.ts](src/a.ts) lines 2-3' };
  const MRES = (ok) => [{ m: { type: 't3vscode:mention-result', ok }, target: '*' }];
  const drops = [];
  const formThat = (cancel) => ({ dispatchEvent: (ev) => { drops.push({ type: ev.type, bubbles: ev.bubbles, cancelable: ev.cancelable, data: { ...ev.dataTransfer.data } }); return !cancel; } });
  posted.length = 0;
  form = formThat(true);
  onQol({ source: win.parent, data: MENTION });
  assert.deepEqual([posted.splice(0), drops.splice(0)], [MRES(true), [{ type: 'drop', bubbles: true, cancelable: true, data: { 'application/x-t3code-composer-mention': MENTION.text } }]], 'mention claimed by T3');
  form = formThat(false);
  onQol({ source: win.parent, data: MENTION });
  assert.deepEqual([posted.splice(0), drops.splice(0).length], [MRES(false), 1], 'mention not canceled');
  form = null;
  onQol({ source: win.parent, data: MENTION });
  assert.deepEqual(posted.splice(0), MRES(false), 'no composer form');
  form = formThat(true);
  for (const [data, source] of [[MENTION, {}], [{ ...MENTION, text: 7 }], ['t3vscode:mention'], [{ ...MENTION, type: 't3vscode:mentions' }]]) onQol({ source: source || win.parent, data });
  assert.deepEqual([posted.length, drops.length], [0, 0], 'a foreign or malformed mention was dropped or answered');
  pass('INJECT mention: from the parent, a drop with T3\'s mention type on the composer form; ok:true only when T3 cancels it, ok:false when not canceled or no form; anything else ignored');
  // docs/QOL.md item 1: attach goes parent -> T3's file drop target as File items (bytes whole), attach-result back; nothing from another source.
  const ARES = (ok) => [{ m: { type: 't3vscode:attach-result', ok }, target: '*' }];
  const PNG = { name: 'shot.png', type: 'image/png', data: Buffer.from([137, 80, 78, 71, 0, 255]).toString('base64') };
  const fileDrops = [];
  const dropAt = { dispatchEvent: (ev) => { fileDrops.push({ type: ev.type, bubbles: ev.bubbles, cancelable: ev.cancelable, files: ev.dataTransfer.files.map((f) => ({ name: f.name, type: f.type, bytes: Array.from(f.parts[0]) })) }); return false; } };
  dropTarget = dropAt;
  posted.length = 0;
  onQol({ source: win.parent, data: { type: 't3vscode:attach', files: [PNG, { ...PNG, name: 'b.webp', type: 'image/webp' }] } });
  const SHOT = { name: 'shot.png', type: 'image/png', bytes: [137, 80, 78, 71, 0, 255] };
  assert.deepEqual([posted.splice(0), fileDrops.splice(0)], [ARES(true), [{ type: 'drop', bubbles: true, cancelable: true, files: [SHOT, { ...SHOT, name: 'b.webp', type: 'image/webp' }] }]], 'attach');
  dropTarget = null;
  onQol({ source: win.parent, data: { type: 't3vscode:attach', files: [PNG] } });
  assert.deepEqual(posted.splice(0), ARES(false), 'no drop target');
  dropTarget = dropAt;
  onQol({ source: {}, data: { type: 't3vscode:attach', files: [PNG] } });
  assert.deepEqual([posted.length, fileDrops.length], [0, 0], 'an attach from another source');
  pass('INJECT attach: from the parent, one drop with every image as a File (decoded bytes, name, type) on [data-chat-workspace-drop-target]; ok:false without that target; another source: nothing');
  dispatched.length = 0;
  const focused = [];
  editor = { contains: (x) => x === 'inside', focus: () => focused.push('editor') };
  onQol({ source: win.parent, data: { type: 't3vscode:focus-composer' } });
  assert.deepEqual([dispatched.splice(0), focused.splice(0)], [[{ type: 't3code:focus-composer', detail: {} }], ['editor']], 'event, then the editor fallback');
  win.document.activeElement = 'inside';
  onQol({ source: win.parent, data: { type: 't3vscode:focus-composer' } });
  assert.deepEqual([dispatched.splice(0).length, focused.length], [1, 0], 'the event landed: no fallback focus');
  onQol({ source: {}, data: { type: 't3vscode:focus-composer' } });
  assert.deepEqual([dispatched.length, posted.length], [0, 0], 'focus from another source');
  pass('INJECT focus-composer: from the parent, T3\'s t3code:focus-composer event; the editor is focused directly only when focus did not land in it');
  const MODE = 't3code:theme-appearance-mode';
  const STORAGE = (kind) => ({ type: 'storage', detail: { key: MODE, newValue: kind } });
  dispatched.length = 0;
  onQol({ source: win.parent, data: { type: 't3vscode:theme', kind: 'light' } });
  assert.deepEqual([store.get(MODE), dispatched.splice(0)], ['light', [STORAGE('light')]], 'light: key written, storage event');
  onQol({ source: win.parent, data: { type: 't3vscode:theme', kind: 'light' } });
  assert.equal(dispatched.length, 0, 'the same kind again fired an event');
  onQol({ source: win.parent, data: { type: 't3vscode:theme', kind: 'dark' } });
  assert.deepEqual([store.get(MODE), dispatched.splice(0)], ['dark', [STORAGE('dark')]], 'dark');
  for (const [data, source] of [[{ type: 't3vscode:theme', kind: 'light' }, {}], [{ type: 't3vscode:theme', kind: 'system' }], [{ type: 't3vscode:theme' }]]) onQol({ source: source || win.parent, data });
  assert.deepEqual([store.get(MODE), dispatched.length, posted.length], ['dark', 0, 0], 'a foreign source or another kind changed the mode');
  pass('INJECT theme: from the parent, light or dark goes into T3\'s appearance mode key plus a storage event for that key, only when it changes; another source or kind: nothing');
  const onKey = listeners.keydown[0].fn;
  const stops = [];
  const key = (x) => ({ isTrusted: true, key: 'P', ctrlKey: true, shiftKey: true, altKey: false, metaKey: false, preventDefault: () => stops.push('prevent'), stopImmediatePropagation: () => stops.push('stop'), ...x });
  const blur = (x) => key({ key: 'c', shiftKey: false, altKey: true, ...x });
  onKey(blur());
  onKey(blur({ key: 'C' })); // Caps Lock
  assert.deepEqual([posted.splice(0), stops.splice(0)], [[1, 2].map(() => ({ m: { type: 't3vscode:key', key: 'blur' }, target: '*' })), ['prevent', 'stop', 'prevent', 'stop']]);
  for (const extra of [{ ctrlKey: false }, { isTrusted: false }, { shiftKey: true }, { altKey: false }, { metaKey: true }, { key: 'v' }, { key: 'Escape', altKey: false }, { key: 'Escape', ctrlKey: false, altKey: false }]) onKey(blur(extra));
  assert.deepEqual([posted.length, stops.length], [0, 0], 'Ctrl+Esc, plain Escape, untrusted or another chord was taken');
  pass('INJECT keys: a trusted Ctrl+Alt+C posts key blur, prevented and stopped so T3 never sees it; Ctrl+Escape (Windows takes it), plain Escape, untrusted, other modifiers or another key do nothing');
  // Test 12: Ctrl+Alt+T opens our thread picker from inside T3's page; with Shift it stays T3's theme editor.
  for (const k of ['t', 'T']) onKey(blur({ key: k }));
  assert.deepEqual([posted.splice(0).map((p) => p.m), stops.splice(0).length], [[1, 2].map(() => ({ type: 't3vscode:key', key: 'switch' })), 4]);
  for (const extra of [{ shiftKey: true }, { altKey: false }, { metaKey: true }, { isTrusted: false }]) onKey(blur({ key: 'T', ...extra }));
  assert.deepEqual([posted.length, stops.length], [0, 0], 'Ctrl+Alt+Shift+T, Ctrl+T, Meta or untrusted was taken');
  pass('INJECT keys test 12: a trusted Ctrl+Alt+T posts key switch, prevented and stopped; Ctrl+Alt+Shift+T (T3 theme editor), Ctrl+T, Meta or untrusted untouched');
  onKey(key());
  onKey(key({ key: 'p' })); // Caps Lock
  assert.deepEqual([posted.splice(0).map((p) => p.m), stops.splice(0)], [[{ type: 't3vscode:key', key: 'palette' }, { type: 't3vscode:key', key: 'palette' }], ['prevent', 'stop', 'prevent', 'stop']]);
  for (const extra of [{ isTrusted: false }, { altKey: true }, { metaKey: true }, { ctrlKey: false }, { key: 'O' }, { key: 'J' }, { key: '`', code: 'Backquote' }]) onKey(key(extra));
  assert.deepEqual([posted.length, stops.length], [0, 0], 'untrusted or another chord was taken');
  pass('INJECT keys: a trusted Ctrl+Shift+P posts key palette, prevented and stopped before T3\'s own capture listeners; Ctrl+Shift with J, Backquote or another key untouched');
  // B6: Ctrl+P, Ctrl+J and Ctrl+Backquote go to VS Code as well (lead pick Q2a).
  const plain = (x) => key({ shiftKey: false, ...x });
  for (const x of [{ key: 'p' }, { key: 'P' }, { key: 'j' }, { key: '`', code: 'Backquote' }, { key: '^', code: 'Backquote' }]) onKey(plain(x)); // a German layout reports ^ on that key
  assert.deepEqual([posted.splice(0).map((p) => p.m.key), stops.splice(0).length], [['quickOpen', 'quickOpen', 'panel', 'terminal', 'terminal'], 10]);
  // Test 12: VS Code's own Ctrl+` on a German layout is the key right of L (code Semicolon); a backtick from any other key counts too.
  for (const x of [{ key: '\u00f6', code: 'Semicolon' }, { key: '\u00d6', code: 'Semicolon' }, { key: '`', code: 'Equal' }]) onKey(plain(x));
  assert.deepEqual([posted.splice(0).map((p) => p.m.key), stops.splice(0).length], [['terminal', 'terminal', 'terminal'], 6]);
  for (const x of [{ key: 'k' }, { key: 'n' }, { key: 'p', altKey: true }, { key: 'j', metaKey: true }, { key: 'j', isTrusted: false }, { key: 'p', ctrlKey: false }, { key: '`', code: 'Backquote', ctrlKey: false }, { key: 'Enter' },
    { key: ';', code: 'Semicolon' }, { key: '\u00d6', code: 'Semicolon', shiftKey: true }, { key: '\u00f6', code: 'Semicolon', ctrlKey: false },
    { key: 'm', code: 'Semicolon' }, { key: '\u00e7', code: 'Semicolon' }]) onKey(plain(x)); // review: other layouts' keys on code Semicolon (Ctrl+M on AZERTY) stay with T3
  assert.deepEqual([posted.length, stops.length], [0, 0], 'Ctrl+K, Ctrl+N, extra modifiers, untrusted, a plain key or a non-umlaut Semicolon key was taken');
  pass('INJECT keys B6: a trusted Ctrl+P posts quickOpen, Ctrl+J panel, Ctrl+Backquote (by code, by key, or the German key on code Semicolon) terminal, each prevented and stopped; T3 keeps Ctrl+K, Ctrl+N, a US Ctrl+; and the rest; plain keys and extra modifiers untouched');
  { // R24: keysToVsCode arrives with the settings message; only the listed names are relayed.
    const keysMsg = (keys, source = win.parent) => listeners.message[2].fn({ source, data: { type: 't3vscode:settings', runInTerminal: 'vscode', keys } });
    keysMsg(['palette', 'panel', 'terminal', 'switch', 'blur', 'nonsense', 7]);
    onKey(plain({ key: 'p' }));
    assert.deepEqual([posted.length, stops.length], [0, 0], 'Ctrl+P was taken with quickOpen left out');
    onKey(plain({ key: 'j' }));
    onKey(key());
    assert.deepEqual([posted.splice(0).map((p) => p.m.key), stops.splice(0).length], [['panel', 'palette'], 4], 'listed names still go to VS Code; an unknown name changes nothing');
    keysMsg(['palette', 'quickOpen'], {}); // another source
    listeners.message[2].fn({ source: win.parent, data: { type: 't3vscode:settings', runInTerminal: 'vscode' } }); // no keys: the list stays
    onKey(plain({ key: 'p' }));
    assert.deepEqual([posted.length, stops.length], [0, 0], 'a foreign source or a settings message without keys changed the list');
    keysMsg([]);
    for (const x of [{}, { key: 'j', shiftKey: false }, { key: 'c', shiftKey: false, altKey: true }]) onKey(key(x));
    assert.deepEqual([posted.length, stops.length], [0, 0], 'an empty list still relayed a key');
    keysMsg(['palette', 'quickOpen', 'panel', 'terminal', 'switch', 'blur']);
    onKey(plain({ key: 'p' }));
    assert.deepEqual([posted.splice(0).map((p) => p.m.key), stops.splice(0).length], [['quickOpen'], 2]);
    pass('INJECT keys R24: the settings message from the parent sets which names are relayed; without quickOpen Ctrl+P stays with T3; unknown names and non-strings are ignored; an empty list relays nothing; a foreign source or no keys field changes nothing; before any list all six go');
  }

  // docs/QOL.md item 1 drop: a Shift-drop from VS Code's Explorer or a tab.
  const drag = (type, data, more) => {
    const calls = [];
    const ev = { type, isTrusted: true, preventDefault: () => calls.push('prevent'), stopPropagation: () => calls.push('stop'),
      dataTransfer: { types: Object.keys(data), dropEffect: 'none', getData: (k) => data[k] || '' }, ...more };
    listeners[type][0].fn(ev);
    return [calls, ev.dataTransfer.dropEffect, JSON.parse(JSON.stringify(posted.splice(0)))]; // the uris array comes from the vm realm
  };
  const DROPPED = (uris) => [{ m: { type: 't3vscode:dropped', uris }, target: '*' }];
  const TYPES = (t) => [{ m: { type: 't3vscode:click', text: 'drop types: ' + t }, target: '*' }];
  const DRAG = (t) => [{ m: { type: 't3vscode:click', text: 'drag types: ' + t }, target: '*' }];
  posted.length = 0;
  assert.deepEqual(drag('dragover', { 'application/vnd.code.uri-list': 'x' }), [['prevent'], 'copy', DRAG('application/vnd.code.uri-list')], 'dragover with the uri list');
  assert.deepEqual(drag('dragover', { 'application/vnd.code.uri-list': 'x' }), [['prevent'], 'copy', []], 'the same drag again: one diagnostic per drag');
  assert.deepEqual(drag('dragover', { resourceurls: 'x' }), [['prevent'], 'copy', DRAG('resourceurls')], 'dragover with resourceurls');
  assert.deepEqual(drag('dragover', { ResourceURLs: 'x' }), [['prevent'], 'copy', DRAG('ResourceURLs')], 'dragover with ResourceURLs');
  assert.deepEqual(drag('dragover', { 'text/plain': 'x' }), [['prevent'], 'copy', DRAG('text/plain')], 'text/plain alone (VS Code types hidden from the frame) is accepted too');
  assert.deepEqual(drag('dragover', { 'text/plain': 'x', Files: '' }), [[], 'none', DRAG('text/plain,Files')], 'an OS file drag was touched');
  assert.deepEqual(drag('dragover', { 'application/x-t3code-composer-mention': 'x', 'text/plain': 'x' }), [[], 'none', DRAG('application/x-t3code-composer-mention,text/plain')], "T3's own tree drag was touched");
  assert.deepEqual(drag('dragover', { resourceurls: 'x' }, { isTrusted: false }), [[], 'none', []], 'an untrusted dragover was touched');
  pass('INJECT dragover: VS Code\'s drag types (any case) or text/plain alone are prevented with dropEffect copy; OS files, T3\'s tree drag or untrusted untouched; the types go to the log once per drag');
  const LIST = 'file:///d%3A/GIT/proj/src/a.ts\r\n# a comment\r\nfile:///d%3A/GIT/proj/lib\r\n';
  assert.deepEqual(drag('drop', { 'application/vnd.code.uri-list': LIST, 'text/uri-list': 'file:///other', 'text/plain': 'D:\\other' }),
    [['prevent', 'stop'], 'none', DROPPED(['file:///d%3A/GIT/proj/src/a.ts', 'file:///d%3A/GIT/proj/lib'])], 'drop with the uri list');
  assert.deepEqual(drag('drop', { resourceurls: '[]', 'text/uri-list': 'file:///d%3A/x.ts' }), [['prevent', 'stop'], 'none', DROPPED(['file:///d%3A/x.ts'])], 'text/uri-list fallback');
  assert.deepEqual(drag('drop', { ResourceURLs: '[]', 'text/plain': W`D:\GIT\proj\a.ts` + '\n' + W`D:\GIT\proj\b.ts` }),
    [['prevent', 'stop'], 'none', DROPPED([W`D:\GIT\proj\a.ts`, W`D:\GIT\proj\b.ts`])], 'text/plain lines');
  assert.deepEqual(drag('drop', { resourceurls: '[]', 'text/uri-list': 'file:///d%3A/a.ts', 'text/plain': 'D:/a.ts\nD:/b.ts' }), [['prevent', 'stop'], 'none', DROPPED(['D:/a.ts', 'D:/b.ts'])], 'text/plain (every item) beats text/uri-list (the first only)');
  assert.deepEqual(drag('drop', { 'application/x-t3code-composer-mention': '[a](a)', 'text/plain': 'x' }), [[], 'none', []], "T3's own tree drag is not logged");
  const many = Array.from({ length: 60 }, (_, i) => 'file:///' + i + 'x'.repeat(2500)).join('\n');
  const [, , capped] = drag('drop', { 'application/vnd.code.uri-list': many });
  assert.deepEqual([capped[0].m.uris.length, Math.max(...capped[0].m.uris.map((u) => u.length))], [50, 2000], 'caps');
  assert.deepEqual(drag('drop', { 'text/plain': 'hi', Files: '' }), [[], 'none', TYPES('text/plain,Files')], 'a drop without VS Code types');
  assert.deepEqual(drag('drop', { 'text/plain': W`D:\GIT\proj\a.ts` + '\nhello\n' + W`E:\b.ts` }), [['prevent', 'stop'], 'none', DROPPED([W`D:\GIT\proj\a.ts`, W`E:\b.ts`])], 'text/plain alone: only drive paths count');
  assert.deepEqual(drag('drop', { 'text/plain': 'hello' }), [[], 'none', TYPES('text/plain')], 'text/plain alone without a drive path: not taken, logged');
  assert.deepEqual(drag('drop', { resourceurls: '' }), [['prevent', 'stop'], 'none', TYPES('resourceurls')], 'VS Code types, no readable data');
  assert.deepEqual(drag('drop', { 'application/x-t3code-composer-mention': 'x' }, { isTrusted: false }), [[], 'none', []], 'our own untrusted mention drop');
  pass('INJECT drop: VS Code types are prevented and stopped, the uri list (else text/plain, else text/uri-list, comments skipped) posts dropped, at most 50 of 2000 chars; ' +
    'text/plain alone is taken when it holds drive paths; any other trusted drop (or one with no data) only posts its types as the click diagnostic; an untrusted drop (our own mention) does nothing');
  // docs/QOL.md item 1: pasted absolute Windows paths in the composer go up as dropped; anything else stays with T3.
  const inForm = { nodeType: 1, closest: (s) => (assert.equal(s, '[data-chat-composer-form]'), {}) };
  const paste = (text, more = {}) => {
    const calls = [];
    listeners.paste[0].fn({ isTrusted: true, target: inForm, clipboardData: { files: [], getData: (k) => (k === 'text/plain' ? text : '') },
      preventDefault: () => calls.push('prevent'), stopImmediatePropagation: () => calls.push('stop'), ...more });
    return [calls, JSON.parse(JSON.stringify(posted.splice(0)))];
  };
  posted.length = 0;
  assert.equal(listeners.paste[0].capture, true, 'paste listener not in the capture phase');
  assert.deepEqual(paste(W`D:\GIT\proj\a.png` + '\r\n  E:/b.ts \n'), [['prevent', 'stop'], DROPPED([W`D:\GIT\proj\a.png`, 'E:/b.ts'])], 'paths');
  assert.deepEqual(paste('D:/a.ts', { target: { nodeType: 3, parentElement: inForm } }), [['prevent', 'stop'], DROPPED(['D:/a.ts'])], 'a text node target');
  for (const [why, text, more] of [['plain text', 'hello'], ['a path and text', 'D:/a.ts\nhello'], ['empty', ''], ['relative', 'src/a.ts'], ['51 lines', Array(51).fill('D:/a.ts').join('\n')],
    ['a 2001 char line', 'D:/' + 'x'.repeat(1998)], ['files too', 'D:/a.ts', { clipboardData: { files: [{}], getData: () => 'D:/a.ts' } }], ['untrusted', 'D:/a.ts', { isTrusted: false }],
    ['outside the composer', 'D:/a.ts', { target: { nodeType: 1, closest: () => null } }]]) assert.deepEqual(paste(text, more), [[], []], why);
  pass('INJECT paste: trusted plain text in the composer form whose every line is an absolute Windows path (at most 50 of 2000 chars) is prevented, stopped and posted as dropped; ' +
    'other text, files, untrusted or outside the composer: left to T3');
}

try {
  script();
  await ports();
  await injection();
  await parsing();
  await buffered();
  await renewal();
  await binding();
  await approval();
  await offline();
  if (process.argv.includes('--live')) await live();
  console.log('ALL PASS');
} catch (e) {
  console.error('FAIL', e);
  process.exit(1);
}
