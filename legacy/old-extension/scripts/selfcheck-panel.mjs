// Offline check of panel.js: every state renders safe, self-contained HTML.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const { render, date, sessionView } = createRequire(import.meta.url)('../panel.js');
const pass = (name) => console.log('PASS ' + name);
const EVIL = '<img src=x onerror=1> & co';
const FWD = 'http://127.0.0.1:51234';
const NOW = Date.parse('2026-10-12T12:00:00Z'); // the client's clock in the vm
const session = (scopes) => ({ label: EVIL, expiresAt: '2026-09-07T10:00:00Z', scopes });
const states = {
  connecting: { kind: 'connecting' },
  down: { kind: 'down' },
  downBusy: { kind: 'down', busy: true },
  unpaired: { kind: 'unpaired', origin: 'http://127.0.0.1:3773', error: EVIL },
  ended: { kind: 'unpaired', origin: 'http://127.0.0.1:3773', ended: true },
  error: { kind: 'error', error: EVIL },
  pairedManual: { kind: 'paired', forwarderUrl: FWD, session: session(['filesystem:write', 'terminal:operate', 'weird:<scope>']), error: EVIL },
  pairedAuto: { kind: 'paired', forwarderUrl: FWD, session: session(['access:write', 'settings:write']) },
  pairedOld: { kind: 'paired', forwarderUrl: FWD, session: { scopes: [] } }, // bearer stored before decision 8: no date, no label
  pairedBound: { kind: 'paired', forwarderUrl: FWD, session: session(['orchestration:read']), path: '/env%201/t-1', folderName: 'proj' },
  pairedNote: { kind: 'paired', forwarderUrl: FWD, session: session(['orchestration:read']), path: '/', note: `T3 is not on proj: ${EVIL}. Reload to retry.`, folderName: 'proj' },
  pairedNav: { kind: 'paired', forwarderUrl: FWD, session: session(['orchestration:read']), path: '/env/t-1', folderName: 'proj', current: 't-1',
    threads: [{ id: 't-1', title: EVIL, projectTitle: 'proj', mine: true, at: new Date(NOW - 5 * 60e3).toISOString() }, { id: 't-"2', title: 'x', projectTitle: EVIL, mine: false }] },
  pairedNavEmpty: { kind: 'paired', forwarderUrl: FWD, session: session(['orchestration:read']), path: '/', folderName: 'proj', threads: [] },
  pairedFresh: { kind: 'paired', forwarderUrl: FWD, session: session(['orchestration:read']), path: '/', folderName: 'proj', newThread: { title: `p "${EVIL}"`, root: `D:\\p ${EVIL}` } },
};
const html = Object.fromEntries(Object.entries(states).map(([k, st]) => [k, render(st)]));

for (const [k, h] of Object.entries(html)) {
  const urls = (h.match(/https?:\/\/[^\s"'<>;)]+/g) || []).filter((u) => !u.startsWith('http://127.0.0.1') && u !== 'http://www.w3.org/2000/svg');
  assert.deepEqual(urls, [], `${k}: external URLs`);
  const nonce = /script-src 'nonce-([^']+)'/.exec(h);
  assert.ok(nonce, `${k}: CSP nonce`);
  assert.ok(h.includes(`<script nonce="${nonce[1]}">`), `${k}: script nonce`);
  assert.equal((h.match(/<script/g) || []).length, 1, `${k}: one script`);
  assert.ok(!/[—–‘’“”]/.test(h), `${k}: em dash or curly quote`);
  assert.ok(!h.includes('<img src=x'), `${k}: unescaped markup`);
  assert.ok(/default-src 'none'; img-src data:; style-src 'unsafe-inline';/.test(h), `${k}: CSP base`);
  const frame = /frame-src ([^;"]+)/.exec(h);
  if (k.startsWith('paired')) assert.equal(frame && frame[1].trim(), FWD, `${k}: frame-src`);
  else assert.equal(frame, null, `${k}: frame-src outside paired`);
}
pass('all states: no external URLs, nonce on CSP and script, no em dashes or curly quotes');
pass('frame-src is the forwarder url only when paired');

for (const k of ['unpaired', 'error', 'pairedManual']) assert.ok(html[k].includes('&#60;img src=x onerror=1&#62; &#38; co'), `${k}: escaped error`);
assert.ok(html.pairedManual.includes('Paired as &#60;img src=x onerror=1&#62; &#38; co'), 'escaped label');
assert.ok(html.pairedManual.includes('weird:&#60;scope&#62;'), 'escaped raw scope');
pass('error, label and raw scopes are HTML-escaped');

assert.ok(html.pairedManual.includes('This session may edit files, run commands, weird:&#60;scope&#62;.'), 'scope words');
assert.ok(html.pairedAuto.includes('This session may manage access, change T3 settings.'), 'scope words auto');
assert.ok(!html.pairedAuto.includes('Renewal:') && !html.pairedAuto.includes('<form'), 'auto renewal, no pair form');
assert.ok(html.pairedManual.includes('Renewal: manual. Pair again before 7 Sep 2026.') && html.pairedManual.includes('>Pair again</button>'), 'manual renewal with form');
assert.ok(html.pairedAuto.includes('renews itself, until 7 Sep 2026') && html.pairedManual.includes('pair again before 7 Sep 2026'), 'bar summary');
assert.ok(html.pairedOld.includes('Paired as VS Code') && html.pairedOld.includes('an unknown date'), 'old session');
assert.ok(html.pairedManual.includes('sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-downloads"') && html.pairedManual.includes(`<iframe src="${FWD}/"`), 'frame attrs');
pass('scope words, renewal modes and frame');

assert.ok(html.pairedBound.includes(`<iframe src="${FWD}/env%201/t-1"`) && html.pairedBound.includes('<p class="strip" id="note" hidden></p>') && html.pairedBound.includes('<p>T3 is on proj.</p>'), 'bound frame path, folder in the card, empty strip');
assert.ok(html.pairedBound.includes('<section class="card" id="details" hidden><h2>Session</h2><p id="session">Paired as ') && html.pairedBound.includes('aria-expanded="false"'), 'bound card closed');
assert.ok(html.pairedNote.includes(`<iframe src="${FWD}/"`) && html.pairedNote.includes('<p class="strip" id="note">T3 is not on proj: &#60;img src=x onerror=1&#62; &#38; co. Reload to retry.</p>'), 'note line, escaped');
assert.ok(html.pairedNote.includes('id="details"><h2>') && html.pairedNote.includes('aria-expanded="true"') && !html.pairedNote.includes('T3 is on proj'), 'note opens the card, no folder line');
assert.ok(!html.pairedAuto.includes('T3 is on') && html.pairedAuto.includes('<p class="strip" id="note" hidden></p>'), 'no folder: an empty hidden note line');
assert.ok(!html.pairedBound.includes(' data-fail="') && html.pairedFresh.includes(' data-ok="" data-fail="T3 did not open the first thread of p &#34;&#60;img src=x onerror=1&#62; &#38; co&#34;. In the T3 search box, pick the project with the folder D:\\p &#60;img src=x onerror=1&#62; &#38; co."'), 'failure text only when a first thread was asked, escaped');
pass('paired: the frame opens state.path; the card names the folder, or shows the note and opens itself');

assert.equal(date('2026-11-11T12:00:00Z'), '11 Nov 2026');
assert.equal(date('2026-09-07T12:00:00Z'), '7 Sep 2026');
assert.equal(date(null), 'an unknown date');
pass('date format');

assert.ok(/<button data-cmd="start" disabled>Starting T3...<\/button>/.test(html.downBusy), 'busy start disabled');
assert.ok(/<button data-cmd="start">Start T3<\/button>/.test(html.down), 'idle start enabled');
assert.ok(html.down.includes('Check again'), 'check again');
pass('down: busy disables Start T3');

assert.ok(html.ended.includes('Your T3 session ended.') && !html.unpaired.includes('Your T3 session ended.'), 'ended notice');
assert.ok(html.unpaired.includes('Connect VS Code to T3 at 127.0.0.1:3773.') && html.unpaired.includes('placeholder="Pairing link or code"'), 'unpaired');
assert.ok(!html.unpaired.includes('type="password"'), 'plain text input');
assert.ok(render({ ...states.pairedAuto, focus: true }).includes(' data-focus>') && !html.pairedAuto.includes(' data-focus>'), 'focus flag');
assert.ok(!html.unpaired.includes('autofocus') && !html.unpaired.includes(' data-focus>'), 'no focus unless asked');
assert.ok(render({ ...states.unpaired, focus: true }).includes(' data-focus>'), 'unpaired focus on request');
pass('unpaired, session ended, focus only on request');

const BEARER = 'samplebearer0123456789abcdefXYZ';
const view = sessionView({ bearer: BEARER, expiresAt: '2026-09-07T10:00:00Z', scopes: ['access:write'], label: 'VS Code' });
assert.ok(!('bearer' in view) && view.expiresAt && view.scopes.length === 1 && view.label === 'VS Code', 'sessionView drops the bearer');
assert.ok(!render({ kind: 'paired', forwarderUrl: FWD, session: view }).includes(BEARER), 'no bearer in html');
pass('sessionView keeps the bearer out of render()');

for (const k of ['pairedManual', 'pairedAuto']) assert.equal((html[k].match(/data-cmd="forget"/g) || []).length, 1, `${k}: one Forget`);
assert.ok(html.pairedManual.includes('File links in the chat open here in VS Code.') && !html.pairedManual.includes('Open in picker'), 'file link line, no picker hint');
assert.ok(!/body {[^}]*background/.test(html.unpaired), 'no body background');
assert.ok(html.unpaired.includes('font-family: var(--vscode-editor-font-family, monospace)'), 'input font');
pass('one Forget, file link line instead of the picker hint, native background and input font');

// The page's own script in a vm with a stubbed DOM: what it posts to the extension for each incoming message. Timers and the clock are fakes.
const HOST = 'vscode-webview://x';
const un = (v) => (v === undefined ? undefined : v.replace(/&#(\d+);/g, (m, c) => String.fromCharCode(c)));
function client(h, withFrame = true) {
  const posted = [];
  const timers = [];
  const winOn = {};
  let focused = null;
  let clock = NOW; // the client's clock, moved by tick()
  const attr = (name) => (new RegExp(`id="note"[^>]*? ${name}="([^"]*)"`).exec(h) || [])[1];
  const card = { hidden: true, contains: (x) => x === note };
  const note = { textContent: '', className: '', hidden: true, dataset: attr('data-fail') === undefined ? {} : { fail: un(attr('data-fail')), ok: un(attr('data-ok')) } };
  const details = { expanded: null, setAttribute: (k, v) => { details.expanded = v; } };
  const button = { disabled: false, textContent: 'Pair again', dataset: { label: 'Pair again' } };
  const input = { value: '', on: {}, focus() {}, addEventListener(t, fn) { input.on[t] = fn; } };
  const hint = { textContent: '', hidden: true };
  const form = { querySelector: (s) => (s === 'button' ? button : input), addEventListener() {}, nextElementSibling: { textContent: '', hidden: true, nextElementSibling: hint } };
  const frame = { contentWindow: { postMessage: (m, origin) => frame.got.push({ m: { ...m }, origin }) }, src: FWD + '/env/t-1', got: [], addEventListener: (type, fn) => { if (type === 'load') frame.onload = fn; },
    focus() { focused = frame; } };
  // An element: children, attributes, listeners, parent links for contains() and closest('button[data-cmd]'); textContent clears the children.
  const el = (props = {}) => {
    const e = { children: [], attrs: {}, on: {}, dataset: {}, className: '', hidden: false, _text: '',
      appendChild(c) { e.children.push(c); c.parent = e; return c; }, setAttribute(k, v) { e.attrs[k] = String(v); }, addEventListener(t, fn) { e.on[t] = fn; },
      contains(x) { for (; x; x = x.parent) if (x === e) return true; return false; },
      closest(s) { for (let x = e; x; x = x.parent) if (s === 'button[data-cmd]' && x.dataset && x.dataset.cmd) return x; return null; },
      focus() { focused = e; }, ...props };
    Object.defineProperty(e, 'textContent', { get: () => e._text + e.children.map((c) => c.textContent).join(''), set: (v) => { e.children = []; e._text = String(v); } });
    return e;
  };
  const pick = el();
  const ttl = pick.appendChild(el({ _text: un((/<span class="ttl">([^<]*)<\/span>/.exec(h) || [])[1] || '') }));
  pick.querySelector = (s) => (s === '.ttl' ? ttl : null);
  const seed = /id="threads" data-items="([^"]*)" data-current="([^"]*)"/.exec(h);
  const pop = el({ hidden: true, dataset: seed ? { items: un(seed[1]), current: un(seed[2]) } : {} });
  const search = pop.appendChild(el({ value: '' }));
  const list = pop.appendChild(el());
  pop.querySelector = (s) => (s === 'input' ? search : s === 'ul' ? list : null);
  const on = {};
  const session = { textContent: '' };
  const document = { getElementById: (id) => ({ details: card, note, threads: seed ? pop : null, session: h.includes('id="session"') ? session : null }[id] || null), addEventListener(t, fn) { on[t] = fn; }, body: { hasAttribute: () => false },
    createElement: (tag) => el({ tag }),
    querySelector: (s) => (s === 'form' ? (h.includes('<form') ? form : null) : s === 'iframe' && withFrame ? frame : s === '[data-cmd="details"]' ? details : s === 'button.pick' && h.includes('<button class="pick"') ? pick : null) };
  vm.runInNewContext(/<script nonce="[^"]+">([\s\S]*?)<\/script>/.exec(h)[1], {
    document, URL, location: { origin: HOST }, Date: { now: () => clock, parse: Date.parse },
    setTimeout: (fn, ms) => timers.push({ fn, ms, cleared: false }), clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].cleared = true; },
    acquireVsCodeApi: () => ({ postMessage: (m) => posted.push({ ...m }) }),
    window: { addEventListener: (type, fn) => { winOn[type] = fn; } },
  });
  const send = (data, source = frame.contentWindow, origin = FWD) => { posted.length = 0; winOn.message({ data, source, origin }); return posted.slice(); };
  const click = (target) => { posted.length = 0; on.click({ target }); return posted.slice(); };
  const drag = (type, ev) => { posted.length = 0; on[type](ev); return posted.slice(); };
  const boot = posted.splice(0); // what the page posted on load (R10: the clipboard request)
  on.dragover({ dataTransfer: { types: ['text/plain', 'Files'] } });
  on.dragover({ dataTransfer: { types: ['text/plain', 'Files'] } });
  on.dragover({});
  assert.deepEqual(posted.splice(0), [{ cmd: 'clickDebug', text: 'panel drag types: text/plain,Files' }, { cmd: 'clickDebug', text: 'panel drag types: ' }]);
  pass('panel dragover diagnostic: the drag types over the toolbar go to the log once per drag');
  const tap = (cmd) => click(el({ dataset: { cmd } }));
  const key = (k) => { posted.length = 0; search.on.keydown({ key: k, preventDefault() {} }); return posted.slice(); };
  const type = (v) => { search.value = v; search.on.input(); };
  const shown = () => list.children.map((li) => (li.className === 'none' ? [li.textContent] : [li.children[0].textContent, li.children[1].textContent, li.attrs['aria-selected']]));
  return { boot, input, hint, send, drag, tick: (ms) => { clock += ms; }, button, frame, posted, card, note, details, session, tap, click, key, type, shown, pick, ttl, pop, search, list, timers, winOn, el, focused: () => focused };
}
const OPEN = { type: 't3vscode:open-file', path: 'C:/a.ts', line: 8, column: 2 };
const page = client(html.pairedManual);
assert.deepEqual(page.send({ ...OPEN, cmd: 'forget', extra: 1 }), [{ cmd: 'openFile', path: 'C:/a.ts', line: 8, column: 2, relative: false }], 'valid open-file');
assert.deepEqual(page.send({ ...OPEN, line: '8', column: [2] }), [{ cmd: 'openFile', path: 'C:/a.ts', line: undefined, column: undefined, relative: false }], 'positions not coerced');
assert.deepEqual(page.send({ ...OPEN, path: 'src/a.ts', relative: true }), [{ cmd: 'openFile', path: 'src/a.ts', line: 8, column: 2, relative: true }], 'B5 relative');
assert.deepEqual(page.send({ ...OPEN, relative: 'true' }), [{ cmd: 'openFile', path: 'C:/a.ts', line: 8, column: 2, relative: false }], 'relative not coerced');
for (const [why, data, source, origin] of [['wrong source', OPEN, {}], ['wrong origin', OPEN, undefined, 'http://127.0.0.1:1'], ['host origin, no frame source', OPEN, {}, HOST],
  ['wrong type', { ...OPEN, type: 'openFile' }], ['array path', { ...OPEN, path: ['C:/a.ts'] }], ['busy from the frame', { type: 'busy', on: true }]]) {
  assert.deepEqual(page.send(data, source, origin), [], why);
}
assert.equal(page.button.disabled, false, 'frame drove the host UI');
assert.deepEqual(client(html.pairedManual, false).send(OPEN), [], 'missing frame');
pass('open-file from the T3 frame only (its window and forwarder origin, string path), forwarded as a fresh openFile object with relative only when exactly true (B5); malformed or foreign messages ignored');
page.posted.length = 0;
page.frame.onload();
assert.deepEqual(page.posted, [{ cmd: 'frameLoaded' }], 'frame load not reported');
const NEW = { type: 't3vscode:new-thread', root: 'D:\\GIT\\proj', title: 'proj' };
assert.deepEqual(page.send({ ...NEW, extra: 1 }, undefined, HOST), [], 'new-thread went to the extension');
assert.deepEqual(page.frame.got, [{ m: NEW, origin: FWD }], 'new-thread not forwarded to the frame with its origin');
for (const [why, data, source, origin] of [['from the frame', NEW], ['foreign origin', NEW, undefined, 'http://127.0.0.1:1'], ['root not a string', { ...NEW, root: 7 }, undefined, HOST], ['title missing', { type: NEW.type, root: NEW.root }, undefined, HOST], ['the old title shape', { type: NEW.type, title: 'proj' }, undefined, HOST]]) page.send(data, source, origin);
assert.equal(page.frame.got.length, 1, 'a foreign or malformed new-thread was forwarded');
pass('frame load posts frameLoaded; a host new-thread goes to the frame as a fresh object with the forwarder origin, nothing else does');
const FAIL = { type: 't3vscode:new-thread-result', ok: false };
assert.deepEqual(client(html.pairedBound).send(FAIL), [], 'a failure with no request on the page');
const fresh = client(html.pairedFresh);
for (const [why, data, source, origin] of [['wrong source', FAIL, {}], ['host origin', FAIL, undefined, HOST], ['wrong origin', FAIL, undefined, 'http://127.0.0.1:1'], ['ok not false', { ...FAIL, ok: 0 }]]) {
  assert.deepEqual(fresh.send(data, source, origin), [], why);
}
assert.deepEqual([fresh.card.hidden, fresh.note.hidden], [true, true], 'card touched by a foreign or positive result');
assert.deepEqual(fresh.send({ ...FAIL, extra: 1 }), [{ cmd: 'newThreadFailed' }], 'failure not reported');
assert.deepEqual([fresh.note.textContent, fresh.note.hidden, fresh.note.className, fresh.card.hidden, fresh.details.expanded],
  [`T3 did not open the first thread of p "${EVIL}". In the T3 search box, pick the project with the folder D:\\p ${EVIL}.`, false, '', true, null], 'note strip shown, card left closed');
assert.deepEqual(fresh.send(FAIL), [], 'a second failure posted again');
const okc = client(html.pairedFresh);
assert.ok(/<p class="strip" id="note"[^>]*>Opening the first thread in p /.test(html.pairedFresh), 'pending text in the page before the result');
assert.deepEqual(okc.send({ ...FAIL, ok: true }), [], 'a success posts nothing to the extension');
assert.deepEqual([okc.note.dataset.ok, okc.note.textContent, okc.note.className, okc.note.hidden], ['', '', '', true], 'success hides the strip');
assert.deepEqual(okc.send(FAIL), [], 'a failure after a success is ignored');
assert.deepEqual([okc.note.textContent, okc.note.hidden], ['', true]);
pass('new-thread-result ok:true from the T3 frame: the pending strip hides, later results ignored');
pass('new-thread-result ok:false from the T3 frame only, and only when the page asked: the strip says so, newThreadFailed goes once');

assert.ok(!html.pairedBound.includes('class="pick"><') && html.pairedBound.includes('<span class="pick muted" style="padding-left:6px">proj</span>') && !html.pairedBound.includes('id="threads"'), 'bar without a thread list: the folder, no popover');
assert.ok(html.pairedAuto.includes('<span class="pick muted" style="padding-left:6px">T3 Code</span>') && !html.pairedAuto.includes('id="threads"'), 'bar without a folder');
const navBar = /<div class="bar">.*?<\/div>/.exec(html.pairedNav)[0];
assert.ok(navBar.startsWith('<div class="bar"><span class="dot" aria-hidden="true"></span><button class="pick" aria-haspopup="listbox" aria-expanded="false" aria-controls="threads" title="2 threads in this project">' +
  '<span class="ttl">&#60;img src=x onerror=1&#62; &#38; co</span><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M7.976'), 'title button');
assert.ok(!html.pairedNav.includes('<select') && !html.pairedNav.includes('<option'), 'the select is gone');
assert.deepEqual(navBar.match(/data-cmd="\w+"/g), ['data-cmd="newThread"', 'data-cmd="reload"', 'data-cmd="openDesktop"', 'data-cmd="details"'], 'icon buttons');
assert.ok(navBar.includes('<button class="icon" data-cmd="newThread" title="New thread in proj" aria-label="New thread">'), 'new thread button');
assert.ok(navBar.includes('<button class="icon" data-cmd="details" title="Paired as &#60;img src=x onerror=1&#62; &#38; co, pair again before 7 Sep 2026" aria-label="Session details" aria-expanded="false" aria-controls="details">'), 'details button');
assert.ok(html.pairedNav.includes(navBar + '<div class="pop" id="threads" data-items="[{&#34;id&#34;:&#34;t-1&#34;,&#34;title&#34;:&#34;&#60;img src=x') &&
  html.pairedNav.includes('data-current="t-1" hidden><input type="search" placeholder="Search threads by title or id" aria-label="Search threads" spellcheck="false" autocomplete="off"><ul role="listbox"></ul></div><p class="strip"'), 'hidden popover right under the bar, seed escaped');
assert.ok(html.pairedNavEmpty.includes('title="0 threads in this project"><span class="ttl">No thread</span>') && html.pairedNavEmpty.includes('data-items="[]" data-current=""'), 'empty list');
pass('thread bar: a title button (current title, else No thread) with a hidden quick pick popover under the bar, else the folder; no select; the seed list escaped; four icon buttons (new thread, reload, open in the T3 app, details)');
const nv = client(html.pairedNav);
assert.deepEqual(nv.tap('newThread'), [{ cmd: 'newThread' }]);
assert.deepEqual(nv.click(nv.ttl), [{ cmd: 'threads' }], 'open asks for threads');
assert.deepEqual([nv.pop.hidden, nv.pick.attrs['aria-expanded'], nv.focused() === nv.search], [false, 'true', true], 'open shows and focuses');
assert.deepEqual(nv.shown(), [[EVIL, '5m', 'true'], [`${EVIL} / x`, '', 'false']], 'the seeded list shows before the fresh one');
const iso = (ms) => new Date(NOW - ms).toISOString();
const ITEMS = [{ id: 'd1', title: 'Deploy abc', projectTitle: 'proj', mine: true, at: iso(30e3), extra: '<b>' }, { id: 'abc123', title: 'A', projectTitle: 'proj', mine: true, at: iso(5 * 60e3) },
  { id: 'b', title: '<i>B</i>', projectTitle: 'P', mine: false, at: iso(3 * 3600e3) }, { id: 'u', title: '', projectTitle: 'proj', mine: true, at: iso(2 * 86400e3) }, { id: 7, title: 'bad', projectTitle: 'x' }, null];
assert.deepEqual(nv.send({ type: 'threads', items: ITEMS, current: 'b' }), [], 'threads from the frame posted');
assert.equal(nv.list.children.length, 2, 'threads from the frame redrew the list');
nv.send({ type: 'threads', items: ITEMS, current: 'b' }, undefined, HOST);
assert.deepEqual(nv.shown(), [['Deploy abc', 'now', 'true'], ['A', '5m', 'false'], ['P / <i>B</i>', '3h', 'false'], ['Untitled', '2d', 'false']], 'rows as text, malformed dropped');
assert.equal(nv.ttl.textContent, 'P / <i>B</i>', 'title from the current thread');
nv.click(nv.ttl); nv.click(nv.ttl); // close and reopen
assert.deepEqual(nv.shown().map((r) => r[2]), ['false', 'false', 'true', 'false'], 'reopening highlights the thread on screen, not the first row');
pass('quick pick: the title opens it (threads posted, input focused); rows from the seed, then from a host threads message: text only, Untitled, project prefix, relative time; malformed rows dropped');
nv.type('abc');
assert.deepEqual(nv.shown().map((r) => r[0]), ['A', 'Deploy abc'], 'an id prefix ranks first');
nv.type('DEPLOY  proj');
assert.deepEqual(nv.shown().map((r) => r[0]), ['Deploy abc'], 'tokens, case-insensitive, title and project');
nv.type('untitled');
assert.deepEqual(nv.shown().map((r) => r[0]), ['Untitled']);
nv.type('deploy zzz');
assert.deepEqual(nv.shown(), [['No threads match']], 'no match row');
pass('quick pick search: every token must match title, project or id (case-insensitive); an id prefix ranks first; no match shows one row');
nv.type('abc');
assert.deepEqual(nv.key('ArrowDown'), []);
assert.deepEqual(nv.shown().map((r) => r[2]), ['false', 'true']);
assert.deepEqual(nv.key('Enter'), [{ cmd: 'openThread', id: 'd1' }], 'Enter opens the highlighted row');
assert.deepEqual([nv.pop.hidden, nv.pick.attrs['aria-expanded']], [true, 'false'], 'Enter closes');
nv.click(nv.pick);
assert.equal(nv.search.value, '', 'reopen clears the query');
nv.key('ArrowUp');
assert.deepEqual(nv.shown().map((r) => r[2]), ['false', 'false', 'false', 'true'], 'Up wraps to the last row');
assert.deepEqual(nv.key('Escape'), []);
assert.deepEqual([nv.pop.hidden, nv.focused() === nv.pick], [true, true], 'Escape closes and returns focus');
nv.click(nv.pick);
const row = nv.list.children[2];
nv.posted.length = 0;
row.on.click();
const after = nv.posted.slice();
nv.click(row.children[0]); // the same click bubbling to the document
assert.deepEqual([after, nv.posted, nv.pop.hidden], [[{ cmd: 'openThread', id: 'b' }], [], true], 'a row click opens it and closes');
nv.click(nv.pick);
assert.deepEqual([nv.click(nv.search), nv.pop.hidden], [[], false], 'a click inside keeps it open');
assert.deepEqual([nv.click(nv.el()), nv.pop.hidden], [[], true], 'a click outside closes');
nv.click(nv.pick);
nv.click(nv.pick);
assert.equal(nv.pop.hidden, true, 'the title toggles');
nv.click(nv.pick);
nv.winOn.blur();
assert.equal(nv.pop.hidden, true, 'focus into the T3 frame closes');
pass('quick pick keys and clicks: Up and Down move (wrapping), Enter and a row click post openThread and close, Escape closes, a click outside or into the frame closes, the title toggles');
// B4: T3: Switch thread opens the quick pick from the extension only.
const op = client(html.pairedNav);
for (const [why, source, origin] of [['from the frame'], ['foreign origin', undefined, 'http://127.0.0.1:1']]) assert.deepEqual([op.send({ type: 'openPicker' }, source, origin), op.pop.hidden], [[], true], why);
assert.deepEqual([op.send({ type: 'openPicker' }, undefined, HOST), op.pop.hidden, op.pick.attrs['aria-expanded'], op.focused() === op.search], [[{ cmd: 'threads' }], false, 'true', true]);
assert.deepEqual(client(html.pairedBound).send({ type: 'openPicker' }, undefined, HOST), [], 'no thread list: nothing');
pass('openPicker from the extension opens the quick pick like a click on the title (threads posted, search focused); from the frame or a foreign origin: nothing; a page without the list: nothing');
assert.deepEqual(nv.send({ type: 't3vscode:location', pathname: '/env/abc123' }), [{ cmd: 'location', pathname: '/env/abc123' }]);
assert.equal(nv.ttl.textContent, 'A');
assert.equal(nv.send({ type: 't3vscode:location', pathname: '/x'.repeat(400) })[0].pathname.length, 500);
assert.equal(nv.ttl.textContent, 'No thread', 'a page that is no listed thread');
nv.send({ type: 't3vscode:location', pathname: '/env/abc123' });
for (const [why, data, source, origin] of [['host origin', { type: 't3vscode:location', pathname: '/env/b' }, undefined, HOST], ['wrong source', { type: 't3vscode:location', pathname: '/env/b' }, {}],
  ['not a string', { type: 't3vscode:location', pathname: ['/env/b'] }]]) assert.deepEqual(nv.send(data, source, origin), [], why);
assert.equal(nv.ttl.textContent, 'A', 'a foreign location moved the title');
// Tests 11 and 17: a new thread T3 named after its first prompt; the list comes from the extension's poll while the quick pick is closed.
nv.send({ type: 't3vscode:location', pathname: '/env/n-1' });
assert.deepEqual([nv.pop.hidden, nv.ttl.textContent], [true, 'No thread'], 'a thread the list does not know yet');
nv.send({ type: 'threads', items: [...ITEMS, { id: 'n-1', title: 'Capture state', projectTitle: 'proj', mine: true }], current: 'abc123' }, undefined, HOST);
assert.deepEqual([nv.pop.hidden, nv.ttl.textContent], [true, 'Capture state'], 'a threads message with the quick pick closed left the title');
nv.send({ type: 't3vscode:location', pathname: '/env/abc123' });
pass('tests 11 and 17: a threads message with the quick pick closed updates the list and the title (a new thread named by T3)');
pass('location from the T3 frame only: the title follows the thread in the pathname, location posted (string, capped at 500)');

const sw = client(html.pairedNav);
const PATH = '/env%201/t-9';
const GO = (pathname, title) => ({ m: { type: 't3vscode:go', pathname, title }, origin: FWD });
const RESULT = (ok) => ({ type: 't3vscode:go-result', ok });
const RELOAD = [{ cmd: 'log', text: 'switch fell back to a reload' }];
sw.send({ type: 'threads', items: [{ id: 't-9', title: 'Fix the parser', projectTitle: 'proj', mine: true }], current: 't-1' }, undefined, HOST);
assert.deepEqual(sw.send({ type: 'navigate', path: PATH }, undefined, HOST), []);
assert.deepEqual([sw.frame.got.splice(0), sw.frame.src, sw.timers.map((t) => t.ms)], [[GO(PATH, 'Fix the parser')], FWD + '/env/t-1', [1500]], 'go with the title posted to the frame, no reload yet');
sw.posted.length = 0;
sw.timers[0].fn();
assert.deepEqual([sw.frame.src, sw.posted], [FWD + PATH, RELOAD], 'no go-result in 1.5 s: reload and log');
sw.frame.src = FWD + '/env/t-1';
assert.deepEqual([sw.send(RESULT(false)), sw.send(RESULT(true)), sw.frame.src], [[], [], FWD + '/env/t-1'], 'a go-result with nothing pending was not ignored');
sw.send({ type: 'navigate', path: '/env/t-7' }, undefined, HOST);
sw.send({ type: 'navigate', path: PATH }, undefined, HOST);
assert.deepEqual(sw.frame.got.splice(0), [GO('/env/t-7', ''), GO(PATH, 'Fix the parser')], 'an unknown thread goes without a title');
assert.deepEqual(sw.timers.slice(1).map((t) => t.cleared), [true, false], 'a second switch cancels the first fallback');
sw.send({ type: 't3vscode:location', pathname: PATH });
assert.equal(sw.timers[2].cleared, false, 'the location with the thread cancelled the fallback');
for (const [why, source, origin] of [['host origin', undefined, HOST], ['wrong source', {}, FWD]]) {
  assert.deepEqual(sw.send(RESULT(true), source, origin), [], why);
  assert.equal(sw.timers[2].cleared, false, why);
}
assert.deepEqual([sw.send(RESULT(true)), sw.timers[2].cleared, sw.frame.src], [[], true, FWD + '/env/t-1'], 'go-result ok:true did not clear the fallback quietly');
sw.timers[2].fn();
assert.deepEqual([sw.frame.src, sw.posted], [FWD + '/env/t-1', []], 'the fallback reloaded after ok:true');
sw.send({ type: 'navigate', path: '/env/t-7' }, undefined, HOST);
assert.deepEqual([sw.send(RESULT(false)), sw.timers[3].cleared, sw.frame.src], [RELOAD, true, FWD + '/env/t-7'], 'go-result ok:false: reload at once and log');
assert.deepEqual([sw.send(RESULT(false)), sw.frame.src], [[], FWD + '/env/t-7'], 'a second ok:false reloaded again');
const got = sw.frame.got.length;
for (const [path, source, origin] of [['/env/t-8'], ['http://evil.example/env/t', undefined, HOST], ['//evil.example/t', undefined, HOST],
  ['/a/b/c', undefined, HOST], ['/env/t 1', undefined, HOST], [['/env/t'], undefined, HOST]]) sw.send({ type: 'navigate', path }, source, origin);
assert.deepEqual([sw.frame.got.length, sw.timers.length, sw.frame.src], [got, 4, FWD + '/env/t-7'], 'an unsafe or foreign navigate reached the frame');
sw.send({ type: 'navigate', path: '/settings/general' }, undefined, HOST);
assert.deepEqual(sw.frame.got.slice(got), [GO('/settings/general', '')], 'B29: the settings path goes without a title');
assert.deepEqual([sw.send(RESULT(true)), sw.timers.length, sw.timers[4].cleared, sw.frame.src], [[], 5, true, FWD + '/env/t-7'], 'B29: ok clears the fallback, no reload');
pass('navigate B29: /settings/general (not a thread) goes to the frame with an empty title; the frame\'s ok at once clears the fallback');
pass('navigate from the extension: go with the thread title (empty when unknown) into the frame (forwarder origin) and a 1.5 s fallback; only go-result ok:true from the frame clears it, ' +
  'ok:false or the timer reloads the frame and posts log; a location with the thread no longer clears it, a newer switch replaces it; ' +
  'a go-result with nothing pending, from the host or another source, and anything unsafe or from the frame are ignored');
// docs/QOL.md items 1 and 7: focus-composer and mention go host -> frame; mention-result and key go frame -> host.
const q = client(html.pairedBound);
assert.deepEqual([q.send({ type: 't3vscode:focus-composer', extra: 1 }, undefined, HOST), q.frame.got.splice(0), q.focused() === q.frame], [[], [{ m: { type: 't3vscode:focus-composer' }, origin: FWD }], true]);
const MENTION = { type: 't3vscode:mention', text: '[a.ts](src/a.ts)' };
assert.deepEqual([q.send({ ...MENTION, extra: 1 }, undefined, HOST), q.frame.got.splice(0)], [[], [{ m: MENTION, origin: FWD }]]);
for (const [why, data, source, origin] of [['focus from the frame', { type: 't3vscode:focus-composer' }], ['mention from the frame', MENTION], ['mention, foreign origin', MENTION, undefined, 'http://127.0.0.1:1'],
  ['text not a string', { ...MENTION, text: ['x'] }, undefined, HOST]]) assert.deepEqual(q.send(data, source, origin), [], why);
assert.deepEqual([q.frame.got.length, client(html.pairedBound, false).send(MENTION, undefined, HOST)], [0, []], 'a foreign or malformed message reached the frame');
pass('focus-composer from the extension: frame.focus() and the message into the frame (forwarder origin); mention passes text on the same way; from the frame or malformed: nothing');
assert.deepEqual(q.send({ type: 't3vscode:mention-result', ok: false, extra: 1 }), [{ cmd: 'mentionResult', ok: false }]);
assert.deepEqual(q.send({ type: 't3vscode:mention-result', ok: true }), [{ cmd: 'mentionResult', ok: true }]);
assert.deepEqual(q.send({ type: 't3vscode:key', key: 'blur', extra: 1 }), [{ cmd: 'key', key: 'blur' }]);
assert.deepEqual(q.send({ type: 't3vscode:key', key: 'palette', extra: 1 }), [{ cmd: 'key', key: 'palette' }]);
for (const key of ['quickOpen', 'panel', 'terminal', 'switch']) assert.deepEqual(q.send({ type: 't3vscode:key', key }), [{ cmd: 'key', key }], key); // B6, test 12 (switch)
for (const key of ['QUICKOPEN', 'toString', '__proto__', 'workbench.action.quickOpen']) assert.deepEqual(q.send({ type: 't3vscode:key', key }), [], key);
assert.deepEqual(q.send({ type: 't3vscode:key', key: 'terminal' }, undefined, HOST), [], 'terminal from the host');
for (const [why, data, source, origin] of [['result from the host', { type: 't3vscode:mention-result', ok: false }, undefined, HOST], ['result from another source', { type: 't3vscode:mention-result', ok: false }, {}],
  ['ok not a boolean', { type: 't3vscode:mention-result', ok: 'false' }], ['key from the host', { type: 't3vscode:key', key: 'blur' }, undefined, HOST],
  ['palette from the host', { type: 't3vscode:key', key: 'palette' }, undefined, HOST], ['palette from another source', { type: 't3vscode:key', key: 'palette' }, {}],
  ['key from another source', { type: 't3vscode:key', key: 'blur' }, {}], ['another key', { type: 't3vscode:key', key: 'save' }], ['a key that is not a string', { type: 't3vscode:key', key: ['palette'] }]]) assert.deepEqual(q.send(data, source, origin), [], why);
pass('mention-result (boolean ok) and key (only blur, palette, quickOpen, panel, terminal and switch) from the T3 frame go to the extension as fresh objects; from the host, another source or malformed: dropped');
// docs/QOL.md item 8: theme goes host -> frame.
assert.deepEqual([q.send({ type: 't3vscode:theme', kind: 'light', extra: 1 }, undefined, HOST), q.frame.got.splice(0)], [[], [{ m: { type: 't3vscode:theme', kind: 'light' }, origin: FWD }]]);
assert.deepEqual([q.send({ type: 't3vscode:theme', kind: 'dark' }, undefined, HOST), q.frame.got.splice(0)], [[], [{ m: { type: 't3vscode:theme', kind: 'dark' }, origin: FWD }]]);
for (const [why, data, source, origin] of [['theme from the frame', { type: 't3vscode:theme', kind: 'dark' }], ['another kind', { type: 't3vscode:theme', kind: 'system' }, undefined, HOST],
  ['theme from a foreign origin', { type: 't3vscode:theme', kind: 'dark' }, undefined, 'http://127.0.0.1:1']]) assert.deepEqual(q.send(data, source, origin), [], why);
assert.deepEqual([q.frame.got.length, client(html.pairedBound, false).send({ type: 't3vscode:theme', kind: 'dark' }, undefined, HOST)], [0, []], 'a foreign or malformed theme reached the frame');
pass('theme (dark or light) from the extension goes into the frame (forwarder origin) as a fresh object; from the frame, a foreign origin or another kind: nothing');
// docs/QOL.md item 1 drop: dropped goes frame -> host.
const URIS = ['file:///d%3A/GIT/proj/a.ts', 'file:///d%3A/GIT/proj/lib'];
assert.deepEqual(q.send({ type: 't3vscode:dropped', uris: URIS, extra: 1 }), [{ cmd: 'dropped', uris: URIS }]);
assert.equal(q.send({ type: 't3vscode:dropped', uris: Array(60).fill('file:///x') })[0].uris.length, 50, 'more than 50 uris relayed');
for (const [why, data, source, origin] of [['from the host', { type: 't3vscode:dropped', uris: URIS }, undefined, HOST], ['from another source', { type: 't3vscode:dropped', uris: URIS }, {}],
  ['uris not an array', { type: 't3vscode:dropped', uris: 'file:///x' }], ['a non-string uri', { type: 't3vscode:dropped', uris: ['file:///x', 7] }]]) assert.deepEqual(q.send(data, source, origin), [], why);
pass('dropped (an array of strings, at most 50) from the T3 frame goes to the extension; from the host, another source or malformed: nothing');
// docs/QOL.md item 1: attach goes host -> frame with its base64 data whole (the one relay that carries bytes); attach-result goes frame -> host.
const BIG = 'iVBO' + 'A'.repeat(3 * 1024 * 1024); // a 2 MB screenshot is about 2.7 MB of base64
const ATTACH = { type: 't3vscode:attach', files: [{ name: 'shot.png', type: 'image/png', data: BIG, extra: 1 }], extra: 1 };
const relayed = () => JSON.parse(JSON.stringify(q.frame.got.splice(0))); // the files array comes from the vm realm
assert.deepEqual([q.send(ATTACH, undefined, HOST), relayed()], [[], [{ m: { type: 't3vscode:attach', files: [{ name: 'shot.png', type: 'image/png', data: BIG }] }, origin: FWD }]], 'attach relayed whole');
for (const [why, data, source, origin] of [['attach from the frame', ATTACH], ['attach, foreign origin', ATTACH, undefined, 'http://127.0.0.1:1'], ['files not an array', { ...ATTACH, files: 'x' }, undefined, HOST],
  ['data not a string', { ...ATTACH, files: [{ name: 'a.png', type: 'image/png', data: 7 }] }, undefined, HOST], ['no files', { ...ATTACH, files: [] }, undefined, HOST]]) assert.deepEqual([q.send(data, source, origin), q.frame.got.length], [[], 0], why);
assert.deepEqual(q.send({ type: 't3vscode:attach-result', ok: false, extra: 1 }), [{ cmd: 'attachResult', ok: false }]);
assert.deepEqual(q.send({ type: 't3vscode:attach-result', ok: true }), [{ cmd: 'attachResult', ok: true }]);
for (const [why, data, source, origin] of [['result from the host', { type: 't3vscode:attach-result', ok: false }, undefined, HOST], ['result from another source', { type: 't3vscode:attach-result', ok: false }, {}],
  ['ok not a boolean', { type: 't3vscode:attach-result', ok: 'false' }]]) assert.deepEqual(q.send(data, source, origin), [], why);
pass('attach from the extension goes into the frame (forwarder origin) with name, type and its data unsliced; from the frame, a foreign origin or malformed: nothing; attach-result (boolean ok) from the frame goes to the extension');
// docs/QOL.md item 1: a file drag that enters and leaves the page within 500 ms gets the Shift hint, at most once per 5 s.
const hz = client(html.pairedBound);
const enter = (types) => hz.drag('dragenter', { dataTransfer: { types } });
const leave = (relatedTarget = null) => hz.drag('dragleave', { relatedTarget });
const HINT = [{ cmd: 'hint' }];
enter(['Files']); hz.tick(200);
assert.deepEqual(leave(), HINT, 'a bounced OS file drag');
enter(['resourceurls']); hz.tick(100);
assert.deepEqual(leave(), [], 'a second hint within 5 s');
hz.tick(5000); enter(['text/plain', 'CodeEditors']); hz.tick(100);
assert.deepEqual(leave(), HINT, 'after 5 s, any case');
hz.tick(6000); enter(['Files']); hz.tick(100);
assert.deepEqual(leave(hz.frame), [], 'on into the T3 frame (a Shift-drag)');
enter(['Files']); hz.tick(600);
assert.deepEqual(leave(), [], 'a slow leave');
enter(['text/plain']); hz.tick(100);
assert.deepEqual(leave(), [], 'not a file drag');
assert.deepEqual(leave(), [], 'a leave without an enter');
pass('Shift hint: a Files, ResourceURLs or CodeEditors drag (any case) that enters and leaves the page within 500 ms posts hint, at most once per 5 s; on into the frame, slower, other types or no enter: nothing');
// B18 sent and B20 open-diff go frame -> host only.
assert.deepEqual(q.send({ type: 't3vscode:sent', extra: 1 }), [{ cmd: 'sent' }]);
assert.deepEqual(q.send({ type: 't3vscode:open-diff', path: 'src/a.ts', relative: true, line: 3, extra: 1 }), [{ cmd: 'openDiff', path: 'src/a.ts', relative: true }]);
assert.deepEqual(q.send({ type: 't3vscode:open-diff', path: 'D:/x/a.ts', relative: 'yes' }), [{ cmd: 'openDiff', path: 'D:/x/a.ts', relative: false }]);
for (const [why, data, source, origin] of [['sent from the host', { type: 't3vscode:sent' }, undefined, HOST], ['sent from another source', { type: 't3vscode:sent' }, {}],
  ['sent, foreign origin', { type: 't3vscode:sent' }, undefined, 'http://127.0.0.1:1'], ['open-diff from the host', { type: 't3vscode:open-diff', path: 'a.ts' }, undefined, HOST],
  ['open-diff from another source', { type: 't3vscode:open-diff', path: 'a.ts' }, {}], ['open-diff path not a string', { type: 't3vscode:open-diff', path: ['a.ts'] }]]) assert.deepEqual(q.send(data, source, origin), [], why);
pass('sent and open-diff (string path, relative only when exactly true) from the T3 frame go to the extension as fresh objects; from the host, another source, a foreign origin or malformed: dropped');
// B12 insert goes frame -> host only, text a string, capped at 64 KB.
assert.deepEqual(q.send({ type: 't3vscode:insert', text: 'const a = 1;\n', extra: 1 }), [{ cmd: 'insert', text: 'const a = 1;\n' }]);
assert.equal(q.send({ type: 't3vscode:insert', text: 'x'.repeat(70000) })[0].text.length, 65536, 'insert text not capped');
for (const [why, data, source, origin] of [['insert from the host', { type: 't3vscode:insert', text: 'a' }, undefined, HOST], ['insert from another source', { type: 't3vscode:insert', text: 'a' }, {}],
  ['insert, foreign origin', { type: 't3vscode:insert', text: 'a' }, undefined, 'http://127.0.0.1:1'], ['insert text not a string', { type: 't3vscode:insert', text: ['a'] }],
  ['insert without text', { type: 't3vscode:insert' }]]) assert.deepEqual(q.send(data, source, origin), [], why);
pass('insert (string text, capped at 64 KB) from the T3 frame goes to the extension as a fresh object; from the host, another source, a foreign origin or malformed: dropped');
// B9 run and B11 notify go frame -> host only; settings and notify-click go host -> frame only.
assert.deepEqual(q.send({ type: 't3vscode:run', text: 'npm test', extra: 1 }), [{ cmd: 'run', text: 'npm test' }]);
assert.equal(q.send({ type: 't3vscode:run', text: 'x'.repeat(20000) })[0].text.length, 16384, 'run text not capped');
const NOTE = { type: 't3vscode:notify', title: 'Approval needed', body: 'Fix the parser', tag: 'env:t-1' };
assert.deepEqual(q.send({ ...NOTE, extra: 1 }), [{ cmd: 'notify', title: 'Approval needed', body: 'Fix the parser', tag: 'env:t-1' }]);
assert.deepEqual(q.send({ ...NOTE, title: 'x'.repeat(400), body: 'y'.repeat(400), tag: 'z'.repeat(400) }).map((m) => [m.title.length, m.body.length, m.tag.length]), [[300, 300, 300]], 'notify strings not capped');
for (const [why, data, source, origin] of [['run from the host', { type: 't3vscode:run', text: 'a' }, undefined, HOST], ['run from another source', { type: 't3vscode:run', text: 'a' }, {}],
  ['run, foreign origin', { type: 't3vscode:run', text: 'a' }, undefined, 'http://127.0.0.1:1'], ['run text not a string', { type: 't3vscode:run', text: ['a'] }],
  ['notify from the host', NOTE, undefined, HOST], ['notify from another source', NOTE, {}], ['notify, foreign origin', NOTE, undefined, 'http://127.0.0.1:1'],
  ['notify title not a string', { ...NOTE, title: 7 }], ['notify without body', { ...NOTE, body: undefined }], ['notify tag not a string', { ...NOTE, tag: null }]]) assert.deepEqual(q.send(data, source, origin), [], why);
assert.equal(q.frame.got.length, 0, 'run or notify reached the frame');
pass('run (string text, capped at 16 KB) and notify (title, body, tag strings, each capped at 300) from the T3 frame go to the extension as fresh objects; from the host, another source, a foreign origin or malformed: dropped');
assert.deepEqual([q.send({ type: 't3vscode:settings', runInTerminal: 't3', extra: 1 }, undefined, HOST), q.frame.got.splice(0)], [[], [{ m: { type: 't3vscode:settings', runInTerminal: 't3' }, origin: FWD }]]);
assert.deepEqual([q.send({ type: 't3vscode:settings', runInTerminal: 'vscode' }, undefined, HOST), q.frame.got.splice(0)], [[], [{ m: { type: 't3vscode:settings', runInTerminal: 'vscode' }, origin: FWD }]]);
assert.deepEqual([q.send({ type: 't3vscode:notify-click', tag: 'env:t-1', extra: 1 }, undefined, HOST), q.frame.got.splice(0)], [[], [{ m: { type: 't3vscode:notify-click', tag: 'env:t-1' }, origin: FWD }]]);
for (const [why, data, source, origin] of [['settings from the frame', { type: 't3vscode:settings', runInTerminal: 't3' }], ['another value', { type: 't3vscode:settings', runInTerminal: 'both' }, undefined, HOST],
  ['settings, foreign origin', { type: 't3vscode:settings', runInTerminal: 't3' }, undefined, 'http://127.0.0.1:1'], ['notify-click from the frame', { type: 't3vscode:notify-click', tag: 'a' }],
  ['notify-click tag not a string', { type: 't3vscode:notify-click', tag: 7 }, undefined, HOST], ['notify-click, foreign origin', { type: 't3vscode:notify-click', tag: 'a' }, undefined, 'http://127.0.0.1:1']]) assert.deepEqual(q.send(data, source, origin), [], why);
assert.equal(q.frame.got.length, 0, 'a foreign or malformed settings or notify-click reached the frame');
pass('settings (runInTerminal vscode or t3) and notify-click (string tag) from the extension go into the frame (forwarder origin) as fresh objects; from the frame, a foreign origin or malformed: nothing');
// R24: keysToVsCode rides on settings, only the six names; R13: the palette message focuses the frame and goes in bare.
assert.deepEqual([q.send({ type: 't3vscode:settings', runInTerminal: 'vscode', keys: ['palette', 'nonsense', 7, 'blur', 'toString'] }, undefined, HOST), q.frame.got.splice(0)],
  [[], [{ m: { type: 't3vscode:settings', runInTerminal: 'vscode', keys: ['palette', 'blur'] }, origin: FWD }]]);
assert.deepEqual([q.send({ type: 't3vscode:settings', runInTerminal: 'vscode', keys: [] }, undefined, HOST), q.frame.got.splice(0)], [[], [{ m: { type: 't3vscode:settings', runInTerminal: 'vscode', keys: [] }, origin: FWD }]]);
assert.deepEqual([q.send({ type: 't3vscode:settings', runInTerminal: 't3', keys: 'palette' }, undefined, HOST), q.frame.got.splice(0)], [[], [{ m: { type: 't3vscode:settings', runInTerminal: 't3' }, origin: FWD }]], 'a non-array keys was passed on');
pass('R24 settings: keys passes into the frame filtered to the six key names; an unknown name or a non-string is dropped; a non-array keys is left out');
const qp = client(html.pairedBound);
assert.deepEqual([qp.send({ type: 't3vscode:palette', query: 'x' }, undefined, HOST), qp.frame.got.splice(0), qp.focused() === qp.frame], [[], [{ m: { type: 't3vscode:palette' }, origin: FWD }], true]);
for (const [why, source, origin] of [['palette from the frame'], ['palette, foreign origin', undefined, 'http://127.0.0.1:1']]) assert.deepEqual(qp.send({ type: 't3vscode:palette' }, source, origin), [], why);
assert.deepEqual([qp.frame.got.length, client(html.pairedBound, false).send({ type: 't3vscode:palette' }, undefined, HOST)], [0, []], 'a foreign palette message reached the frame');
pass('R13 palette: from the extension, frame.focus() and a bare t3vscode:palette into the frame (forwarder origin); from the frame or a foreign origin: nothing');
// R17: the down and error pages offer Show logs, posted like every other button.
for (const k of ['down', 'downBusy', 'error']) assert.ok(html[k].includes('<button class="secondary" data-cmd="showLogs">Show logs</button>'), `${k}: Show logs`);
assert.ok(!html.unpaired.includes('data-cmd="showLogs"') && !html.pairedAuto.includes('data-cmd="showLogs"'), 'Show logs only where things went wrong');
assert.deepEqual(client(html.error).tap('showLogs'), [{ cmd: 'showLogs' }]);
pass('R17: down and error pages carry a Show logs button that posts showLogs');
// R10: a page with a pairing field asks for the clipboard on load and on focus while empty; a host prefill fills it once and says so, never submits.
const up = client(html.unpaired);
assert.deepEqual([up.boot, client(html.down).boot, client(html.pairedAuto).boot, client(html.pairedManual).boot], [[{ cmd: 'clipboard' }], [], [], [{ cmd: 'clipboard' }]], 'clipboard asked on load only with a field');
const LINK = 'http://127.0.0.1:3773/pair#token=ABCDEFGHJKLM';
assert.deepEqual([up.send({ type: 'prefill', value: LINK }), up.input.value, up.hint.hidden], [[], '', true], 'a prefill from the T3 frame filled the field');
assert.deepEqual([up.send({ type: 'prefill', value: 7 }, undefined, HOST), up.input.value], [[], ''], 'a non-string prefill');
assert.deepEqual([up.send({ type: 'prefill', value: LINK }, undefined, HOST), up.input.value, up.hint.textContent, up.hint.hidden, up.button.disabled], [[], LINK, 'Pasted from the clipboard. Press Pair.', false, false], 'host prefill');
up.posted.length = 0;
up.input.value = '';
up.input.on.focus();
assert.deepEqual(up.posted, [], 'asked again after a prefill');
up.input.value = 'typed';
up.send({ type: 'prefill', value: 'ABCDEFGHJKLM' }, undefined, HOST);
assert.equal(up.input.value, 'typed', 'a prefill overwrote what the owner typed');
const up2 = client(html.unpaired);
up2.input.on.focus();
up2.input.value = 'typed';
up2.input.on.focus();
assert.deepEqual(up2.posted, [{ cmd: 'clipboard' }], 'focus asks only while the field is empty');
pass('R10: the pairing field asks for the clipboard on load and on focus while empty; only a host prefill (string) fills an empty field, with the hint; never submitted; once filled, no more asks');
// R15: the quick pick says which threads run or wait, waits first; "running", "waits" and "waiting" find them.
const rw = client(html.pairedNav);
rw.click(rw.ttl);
rw.send({ type: 'threads', current: 'a', items: [{ id: 'a', title: 'Idle', projectTitle: 'p', mine: true, at: iso(60e3) }, { id: 'b', title: 'Run', projectTitle: 'p', mine: true, at: iso(120e3), active: true, unread: true },
  { id: 'c', title: 'Ask', projectTitle: 'p', mine: true, at: iso(10e3), active: true, needsYou: true, unread: true }, { id: 'd', title: 'Odd', projectTitle: 'p', mine: true, at: iso(10e3), active: 'yes', needsYou: 1, unread: 'yes' },
  { id: 'e', title: 'Fresh', projectTitle: 'p', mine: true, at: iso(60e3), unread: true }] }, undefined, HOST);
assert.deepEqual(rw.shown().map((r) => r.slice(0, 2)), [['Idle', '1m'], ['Run', 'running 2m'], ['Ask', 'waits now'], ['Odd', 'now'], ['Fresh', 'new 1m']], 'state before the age, needsYou wins, then running, then unread; only true counts');
rw.type('new');
assert.deepEqual(rw.shown().map((r) => r[0]), ['Fresh']);
pass('R27: a finished thread not read yet says "new" before the age (running and waits win, booleans only); the search token new finds it');
rw.type('running');
assert.deepEqual(rw.shown().map((r) => r[0]), ['Run']);
rw.type('waiting');
assert.deepEqual(rw.shown().map((r) => r[0]), ['Ask']);
rw.type('waits');
assert.deepEqual(rw.shown().map((r) => r[0]), ['Ask']);
pass('R15: quick pick rows say "running" or "waits" (needsYou wins, booleans only) before the age, as text; search tokens running, waits and waiting match those states');
// R22: the card offers the thread link only with a bound project (a thread list, even empty); the button posts copyLink.
const LINKBTN = '<button class="secondary" data-cmd="copyLink">Copy link to this thread</button>';
assert.ok(html.pairedNav.includes(LINKBTN) && html.pairedNavEmpty.includes(LINKBTN) && !html.pairedBound.includes(LINKBTN) && !html.pairedAuto.includes(LINKBTN), 'copy link only with a thread list');
assert.deepEqual(client(html.pairedNav).tap('copyLink'), [{ cmd: 'copyLink' }]);
pass('R22: Copy link to this thread sits in the details card when the project is bound and posts copyLink');
// R23: a renewal that kept the page updates the session line and the details tooltip, only from the host and only with a string.
const sv = client(html.pairedAuto);
for (const [why, data, source, origin] of [['from the frame', { type: 'session', text: 'x' }], ['not a string', { type: 'session', text: 7 }, undefined, HOST], ['foreign origin', { type: 'session', text: 'x' }, undefined, 'http://127.0.0.1:1']]) {
  assert.deepEqual([sv.send(data, source, origin), sv.session.textContent, sv.details.title], [[], '', undefined], why);
}
assert.deepEqual([sv.send({ type: 'session', text: `Paired as ${EVIL}, renews itself, until 7 Oct 2026` }, undefined, HOST), sv.session.textContent, sv.details.title],
  [[], `Paired as ${EVIL}, renews itself, until 7 Oct 2026.`, `Paired as ${EVIL}, renews itself, until 7 Oct 2026`]);
assert.equal(html.pairedAuto.includes('<p id="session">Paired as &#60;img src=x onerror=1&#62; &#38; co, renews itself, until 7 Sep 2026.</p>'), true, 'rendered session line');
pass('R23: a host session message sets the card line (as text) and the details tooltip; from the frame, a foreign origin or not a string: nothing');
console.log('ALL PASS');
