// The panel's webview page (decision 9). Pure: state in, HTML out. No vscode, no T3.
// Webview -> extension: {cmd:'pair', value}, {cmd:'start'}, {cmd:'check'}, {cmd:'reload'}, {cmd:'forget'}, {cmd:'openFile', path, line, column, relative?} (B5), {cmd:'frameLoaded'}, {cmd:'newThreadFailed'},
//   {cmd:'newThread'}, {cmd:'threads'}, {cmd:'openThread', id}, {cmd:'location', pathname} (NAV.md), {cmd:'mentionResult', ok}, {cmd:'key', key:'blur'|'palette'|'quickOpen'|'panel'|'terminal'|'switch'} (B6), {cmd:'dropped', uris}, {cmd:'attachResult', ok}, {cmd:'hint'}, {cmd:'openDesktop'} (QOL.md items 1, 6, 7 and 8),
//   {cmd:'sent'} (B18), {cmd:'openDiff', path, relative} (B20), {cmd:'insert', text} (B12), {cmd:'run', text} (B9), {cmd:'notify', title, body, tag} (B11), {cmd:'showLogs'} (R17), {cmd:'clipboard'} (R10), {cmd:'copyLink'} (R22).
// Extension -> webview: {type:'error', text}, {type:'focusInput'}, {type:'t3vscode:new-thread', root, title} (passed on to the T3 frame),
//   {type:'threads', items, current}, {type:'navigate', path}, {type:'openPicker'} (B4), {type:'t3vscode:focus-composer'}, {type:'t3vscode:mention', text}, {type:'t3vscode:attach', files:[{name, type, data}]} (QOL.md item 1, base64 data)
//   and {type:'t3vscode:theme', kind:'dark'|'light'} (all four passed on), {type:'t3vscode:settings', runInTerminal:'vscode'|'t3', keys?:[key names]} (B9, R24), {type:'t3vscode:notify-click', tag} (B11) and {type:'t3vscode:palette'} (R13) (all passed on), {type:'prefill', value} (R10), {type:'session', text} (R23); anything else is a new html.
// T3 frame -> webview: {type:'t3vscode:open-file', path, line, column, relative?}, {type:'t3vscode:new-thread-result', ok}, {type:'t3vscode:location', pathname}, {type:'t3vscode:go-result', ok},
//   {type:'t3vscode:mention-result', ok}, {type:'t3vscode:key', key:<one of the six above>}, {type:'t3vscode:dropped', uris}, {type:'t3vscode:attach-result', ok}, {type:'t3vscode:sent'} (B18),
//   {type:'t3vscode:open-diff', path, relative?} (B20), {type:'t3vscode:insert', text} (B12), {type:'t3vscode:run', text} (B9), {type:'t3vscode:notify', title, body, tag} (B11) (INJECT in t3.js).
// state: {kind:'connecting'|'down'|'unpaired'|'paired'|'error', origin?, error?, ended?, session?, forwarderUrl?, path?, note?, folderName?, newThread?: {root, title}, busy?, focus?,
//   threads?: [{id, title, projectTitle, mine, at, active?, needsYou?}] (only with a bound project), current?}
// Webview -> extension also: {cmd:'log', text} (NAV.md section 5: a thread switch fell back to a reload). Webview -> T3 frame: {type:'t3vscode:go', pathname}.
const crypto = require('crypto');

const FRAME_ATTRS = 'allow="clipboard-read; clipboard-write" sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-downloads"';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SCOPE_WORDS = {
  'filesystem:write': 'edit files', 'filesystem:read': 'read files', 'terminal:operate': 'run commands', 'terminal:read': 'read terminals',
  'orchestration:operate': 'start and steer threads', 'orchestration:read': 'read threads', 'settings:write': 'change T3 settings',
  'providers:manage': 'manage providers', 'source-control:write': 'commit and branch', 'preview:operate': 'use previews',
  'diagnostics:read': 'read diagnostics', 'environment:maintain': 'update T3', 'access:write': 'manage access',
  'access:read': 'see who has access', 'relay:read': 'read through the relay', 'relay:write': 'write through the relay',
};
const MARK = '<svg class="mark" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h8M7 6v12"/><path d="M14 6h6l-3.5 5a3.5 3.5 0 1 1-3 5.5"/></svg>';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
// Hand-rolled: en-GB short months print "Sept" on current ICU.
function date(iso) {
  const d = new Date(iso);
  return iso && !isNaN(d) ? `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` : 'an unknown date';
}
const scopeWords = (scopes) => (scopes || []).map((s) => SCOPE_WORDS[s] || s);
// What the page may know of a stored session: never the bearer.
const sessionView = (s) => ({ expiresAt: s.expiresAt, scopes: s.scopes, label: s.label });
// The session line of the card and the details button (plain text); R23 posts it again after a renewal that kept the page.
const sessionStatus = (s) => `Paired as ${s.label || 'VS Code'}, ${(s.scopes || []).includes('access:write') ? `renews itself, until ${date(s.expiresAt)}` : `pair again before ${date(s.expiresAt)}`}`;

const CSS = `
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; }
body { color: var(--vscode-foreground); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size, 13px); line-height: 1.5; }
p { margin: 0; }
.wrap { max-width: 420px; margin: 0 auto; padding: max(16px, 10vh) 16px 16px; }
.title { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
.title h1 { margin: 0; font-size: 1.25em; font-weight: 600; }
.mark { flex: none; color: var(--vscode-foreground); }
.lead { margin-bottom: 4px; }
.muted { color: var(--vscode-descriptionForeground); }
.notice { margin-bottom: 16px; padding: 6px 10px; border-radius: 2px; background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-widget-border, transparent); }
ol { margin: 12px 0; padding-left: 20px; } li { margin: 2px 0; }
.row { display: flex; gap: 8px; margin-top: 16px; flex-wrap: wrap; }
form.row { flex-wrap: nowrap; margin-top: 12px; }
input { flex: 1; min-width: 0; height: 28px; padding: 0 8px; border-radius: 2px; font-family: var(--vscode-editor-font-family, monospace); font-size: inherit; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); outline: none; }
input::placeholder { color: var(--vscode-input-placeholderForeground); }
input:focus { border-color: var(--vscode-focusBorder); }
button { height: 28px; padding: 0 14px; border: 0; border-radius: 2px; font: inherit; cursor: pointer; color: var(--vscode-button-foreground); background: var(--vscode-button-background); white-space: nowrap; }
button:hover { background: var(--vscode-button-hoverBackground); }
button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-secondaryBackground)); }
button.link { height: 22px; padding: 0 4px; color: var(--vscode-textLink-foreground); background: none; }
button.link:hover { background: none; text-decoration: underline; }
button:disabled { opacity: 0.5; cursor: default; }
button:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
.err { margin-top: 6px; color: var(--vscode-errorForeground); word-break: break-word; }
.tip { margin-top: 20px; }
body.paired { position: relative; display: flex; flex-direction: column; overflow: hidden; } /* relative: the quick pick is placed against the panel, not the viewport */
/* The paired header: one toolbar like VS Code's own view headers (Claude Code, Codex): the thread picker left, icon actions right. */
.bar { flex: none; display: flex; align-items: center; gap: 2px; height: 35px; padding: 0 6px 0 10px; border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, var(--vscode-widget-border, transparent)); white-space: nowrap; }
.dot { flex: none; width: 6px; height: 6px; margin-right: 6px; border-radius: 50%; background: var(--vscode-testing-iconPassed, var(--vscode-charts-green, #89d185)); }
.dot.off { background: var(--vscode-descriptionForeground); }
.pick { flex: 0 1 auto; min-width: 0; max-width: calc(100% - 84px); display: flex; align-items: center; height: 24px; border-radius: 3px; }
button.pick { gap: 2px; padding: 0 2px 0 6px; font-weight: 600; color: var(--vscode-foreground); background: none; }
.pick:hover, .pick[aria-expanded="true"] { background: var(--vscode-toolbar-hoverBackground, rgba(90, 93, 94, 0.31)); }
.pick .ttl { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.pick svg { flex: none; width: 16px; height: 16px; fill: var(--vscode-icon-foreground, var(--vscode-foreground)); }
.icon[data-cmd="newThread"] { margin-left: auto; }
/* NAV.md section 5: the thread list as a quick pick under the toolbar. */
.pop { position: absolute; z-index: 10; top: 36px; left: 8px; width: calc(100% - 16px); max-height: 50vh; overflow: auto; padding: 4px; font-size: 12px; color: var(--vscode-quickInput-foreground, var(--vscode-foreground)); background: var(--vscode-quickInput-background, var(--vscode-editorWidget-background)); border: 1px solid var(--vscode-widget-border, transparent); border-radius: 6px; box-shadow: 0 0 8px 2px var(--vscode-widget-shadow, transparent); }
.pop[hidden] { display: none; }
.pop input { width: 100%; height: 24px; font-family: inherit; }
.pop ul { margin: 4px 0 0; padding: 0; list-style: none; }
.pop li { display: flex; align-items: center; gap: 8px; height: 24px; margin: 0; padding: 0 6px; border-radius: 3px; white-space: nowrap; cursor: pointer; }
.pop li span:first-child { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.pop li:hover { background: var(--vscode-list-hoverBackground); }
.pop li[aria-selected="true"] { color: var(--vscode-list-activeSelectionForeground); background: var(--vscode-list-activeSelectionBackground); }
.pop li[aria-selected="true"] .muted { color: inherit; }
.pop li.none { cursor: default; color: var(--vscode-descriptionForeground); background: none; }
.icon { flex: none; width: 22px; height: 22px; padding: 0; margin-left: 2px; border: 0; border-radius: 5px; color: var(--vscode-icon-foreground, var(--vscode-foreground)); background: none; display: inline-flex; align-items: center; justify-content: center; }
.icon:hover { background: var(--vscode-toolbar-hoverBackground, rgba(90, 93, 94, 0.31)); }
.icon svg { width: 16px; height: 16px; fill: currentColor; }
.icon[aria-expanded="true"] { background: var(--vscode-toolbar-hoverBackground, rgba(90, 93, 94, 0.31)); }
.strip[hidden] { display: none; }
.strip { flex: none; display: flex; align-items: center; gap: 6px; padding: 4px 10px; font-size: 12px; color: var(--vscode-descriptionForeground); background: var(--vscode-editorWidget-background); border-bottom: 1px solid var(--vscode-widget-border, transparent); }
.card { flex: none; max-height: 50vh; overflow: auto; padding: 10px 12px 12px; font-size: 12px; background: var(--vscode-editorWidget-background); border-bottom: 1px solid var(--vscode-widget-border, transparent); }
.card p + p { margin-top: 6px; }
.card .row { margin-top: 10px; }
.card h2 { margin: 0 0 6px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--vscode-descriptionForeground); }
.card .link { margin: 8px 0 0 -4px; }
iframe { flex: 1; width: 100%; border: 0; display: block; }
`;

// Runs in the webview. A plain function so `node --check` covers it too.
function client() {
  const api = acquireVsCodeApi();
  const card = document.getElementById('details');
  const form = document.querySelector('form');
  const input = form && form.querySelector('input');
  const err = form && form.nextElementSibling;
  const hint = err && err.nextElementSibling;
  // R10: ask for a pairing link on the clipboard while the field is empty; once one came, never again on this page.
  let filled = false;
  const ask = () => { if (input && !filled && !input.value) api.postMessage({ cmd: 'clipboard' }); };
  const setBusy = (on) => {
    if (!form) return;
    const b = form.querySelector('button');
    b.disabled = on;
    b.textContent = on ? 'Pairing...' : b.dataset.label;
  };
  const showError = (text) => { if (err) { err.textContent = text; err.hidden = !text; } };
  const focus = () => {
    if (card) openCard(true); // with automatic renewal there is no input, so the card is what the owner sees
    if (input) input.focus();
  };
  const openCard = (open) => {
    card.hidden = !open;
    document.querySelector('[data-cmd="details"]').setAttribute('aria-expanded', String(open));
  };
  // NAV.md section 5: the thread list is a quick pick under the toolbar, rows text only. Seeded from the render, refreshed on every open.
  const pickBtn = document.querySelector('button.pick');
  const ttl = pickBtn && pickBtn.querySelector('.ttl');
  const pop = document.getElementById('threads');
  const search = pop && pop.querySelector('input');
  const list = pop && pop.querySelector('ul');
  // Text only, never HTML; a malformed row is dropped.
  const ok = (t) => t && typeof t.id === 'string' && typeof t.title === 'string' && typeof t.projectTitle === 'string';
  let items = [];
  try { items = JSON.parse(pop.dataset.items).filter(ok); } catch (e) {}
  let current = pop ? pop.dataset.current : '';
  let here = ''; // the frame's last pathname
  let rows = []; // the rows on screen
  let hi = 0; // the highlighted row
  let want = ''; // the thread a switch in place waits for
  let waiting;
  const name = (t) => (t.mine ? '' : `${t.projectTitle} / `) + (t.title || 'Untitled');
  // R15: waits beats running, as in the status bar; search finds "running", "waits" and "waiting". R27: "new" for a finished thread not read yet.
  const state = (t) => (t.needsYou === true ? 'waits' : t.active === true ? 'running' : t.unread === true ? 'new' : '');
  const ago = (iso) => { const m = Math.floor((Date.now() - Date.parse(iso)) / 60000); return isNaN(m) ? '' : m < 1 ? 'now' : m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 1440)}d`; };
  // The frame's pathname names the thread; before the first location the extension's current one.
  const curId = () => { const t = items.find((x) => (here ? here.split('/').includes(x.id) : x.id === current)); return t ? t.id : ''; };
  const setTitle = () => { if (!ttl) return; const t = items.find((x) => x.id === curId()); ttl.textContent = t ? name(t) : 'No thread'; };
  // Every token must match the title, the project or the id; a token that starts an id ranks that thread first; otherwise T3's order.
  const match = (text) => {
    const toks = text.toLowerCase().split(/\s+/).filter(Boolean);
    const hits = items.filter((t) => toks.every((k) => [t.title || 'Untitled', t.projectTitle, t.id, state(t) === 'waits' ? 'waits waiting' : state(t)].some((f) => f.toLowerCase().includes(k))));
    const first = hits.filter((t) => toks.some((k) => t.id.toLowerCase().startsWith(k)));
    return first.concat(hits.filter((t) => !first.includes(t)));
  };
  const draw = () => {
    rows = match(search.value);
    hi = Math.max(0, Math.min(hi, rows.length - 1));
    list.textContent = '';
    if (!rows.length) { const li = document.createElement('li'); li.className = 'none'; li.textContent = 'No threads match'; list.appendChild(li); return; }
    rows.forEach((t, i) => {
      const li = document.createElement('li');
      const title = document.createElement('span');
      const when = document.createElement('span');
      title.textContent = name(t);
      when.className = 'muted';
      when.textContent = [state(t), ago(t.at)].filter(Boolean).join(' ');
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(i === hi));
      li.appendChild(title);
      li.appendChild(when);
      li.addEventListener('click', () => choose(t.id));
      list.appendChild(li);
      if (i === hi && li.scrollIntoView) li.scrollIntoView({ block: 'nearest' });
    });
  };
  const show = (open) => {
    if (!pop) return;
    pop.hidden = !open;
    pickBtn.setAttribute('aria-expanded', String(open));
    if (!open) return;
    search.value = '';
    hi = Math.max(0, match('').findIndex((t) => t.id === curId())); // the row of the thread on screen, not the first row
    draw();
    search.focus();
    api.postMessage({ cmd: 'threads' });
  };
  const choose = (id) => { current = id; show(false); api.postMessage({ cmd: 'openThread', id }); };
  if (pop) {
    search.addEventListener('input', () => { hi = 0; draw(); });
    search.addEventListener('keydown', (e) => {
      const n = rows.length;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (n) { hi = (hi + (e.key === 'ArrowDown' ? 1 : n - 1)) % n; draw(); } }
      else if (e.key === 'Enter') { e.preventDefault(); if (rows[hi]) choose(rows[hi].id); }
      else if (e.key === 'Escape') { e.preventDefault(); show(false); pickBtn.focus(); }
    });
    window.addEventListener('blur', () => show(false)); // a click into the T3 frame never reaches this document
  }
  // Diagnostic only: a drag over the toolbar proves the drag reached the webview at all (VS Code blocks drags over webviews unless Shift is held).
  let dragSeen = '';
  document.addEventListener('dragover', (e) => {
    const key = Array.from(e.dataTransfer ? e.dataTransfer.types : []).join(',');
    if (key !== dragSeen) { dragSeen = key; api.postMessage({ cmd: 'clickDebug', text: 'panel drag types: ' + key }); }
  }, true);
  // QOL.md item 1: a file drag that enters and leaves within 500 ms bounced off VS Code's block; say Shift, at most once per 5 s.
  // VS Code lifts its block only for Shift, so this fires only when a dragenter gets through at all (OS file drags do, Explorer drags may not).
  let entered = 0;
  let hinted = 0;
  document.addEventListener('dragenter', (e) => {
    const types = Array.from(e.dataTransfer ? e.dataTransfer.types : []).map((t) => String(t).toLowerCase());
    if (['files', 'resourceurls', 'codeeditors'].some((t) => types.includes(t))) entered = Date.now();
  }, true);
  document.addEventListener('dragleave', (e) => {
    if (e.relatedTarget) return; // into the T3 frame or another element of this page: the drag goes on (a Shift-drag does exactly that)
    const now = Date.now();
    if (entered && now - entered < 500 && now - hinted >= 5000) { hinted = now; api.postMessage({ cmd: 'hint' }); }
    entered = 0;
  }, true);
  document.addEventListener('click', (e) => {
    if (pop && !pop.hidden && !pop.contains(e.target) && !pickBtn.contains(e.target)) show(false);
    if (pickBtn && pickBtn.contains(e.target)) return show(pop.hidden);
    const b = e.target.closest('button[data-cmd]');
    if (!b) return;
    if (b.dataset.cmd === 'details') return openCard(card.hidden);
    if (b.dataset.cmd === 'start') { b.disabled = true; b.textContent = 'Starting T3...'; }
    api.postMessage({ cmd: b.dataset.cmd });
  });
  if (input) input.addEventListener('focus', ask);
  if (form) form.addEventListener('submit', (e) => {
    e.preventDefault();
    const value = input.value.trim();
    if (!value) return showError('Paste the pairing link or the code first.');
    showError('');
    if (hint) hint.hidden = true;
    setBusy(true);
    api.postMessage({ cmd: 'pair', value });
  });
  // Only the extension speaks here. Its messages carry this page's own origin (checked live: VS Code's preload sets window.parent = window,
  // so a sender check cannot work); the T3 frame posts from its http origin and must not drive this UI.
  const frame = document.querySelector('iframe');
  const KEYS = ['blur', 'palette', 'quickOpen', 'panel', 'terminal', 'switch']; // B6 and test 12 (switch): the chords the frame relays to VS Code
  const note = document.getElementById('note');
  let failed = false;
  window.addEventListener('message', (e) => {
    const m = e.data;
    const fromFrame = frame && m && typeof m === 'object' && e.source === frame.contentWindow && e.origin === new URL(frame.src).origin;
    // The two messages the T3 frame may send (INJECT in t3.js): a fresh object, nothing else from that source; the extension validates the path.
    // Typed, not coerced: a non-string path is ignored, a non-number position is left out (the extension clamps it to 1).
    if (fromFrame && m.type === 't3vscode:click' && typeof m.text === 'string') return api.postMessage({ cmd: 'clickDebug', text: m.text.slice(0, 500) }); // diagnostic, log only
    if (fromFrame && m.type === 't3vscode:open-file' && typeof m.path === 'string') {
      const num = (v) => (typeof v === 'number' ? v : undefined);
      return api.postMessage({ cmd: 'openFile', path: m.path, line: num(m.line), column: num(m.column), relative: m.relative === true });
    }
    // The first thread opened: the line becomes the bound text. Not opened: the card says so (data-fail). Both only when this page asked, once per page.
    if (fromFrame && m.type === 't3vscode:new-thread-result' && m.ok === true && note && note.dataset.fail && !failed) {
      failed = true; // settled: later results are ignored
      note.textContent = note.dataset.ok || '';
      note.hidden = !note.textContent;
      return;
    }
    if (fromFrame && m.type === 't3vscode:new-thread-result' && m.ok === false && note && note.dataset.fail && !failed) {
      failed = true;
      note.textContent = note.dataset.fail;
      note.hidden = false;
      return api.postMessage({ cmd: 'newThreadFailed' });
    }
    if (fromFrame && m.type === 't3vscode:location' && typeof m.pathname === 'string') {
      here = m.pathname.slice(0, 500);
      setTitle();
      return api.postMessage({ cmd: 'location', pathname: here });
    }
    // The frame proved (or failed) the in-place switch: only this clears the fallback; a failure reloads right away.
    if (fromFrame && m.type === 't3vscode:go-result' && want) {
      clearTimeout(waiting);
      if (m.ok === true) { want = ''; return; }
      const path = want; want = '';
      frame.src = new URL(frame.src).origin + path;
      return api.postMessage({ cmd: 'log', text: 'switch fell back to a reload' });
    }
    if (fromFrame && m.type === 't3vscode:mention-result' && typeof m.ok === 'boolean') return api.postMessage({ cmd: 'mentionResult', ok: m.ok });
    if (fromFrame && m.type === 't3vscode:attach-result' && typeof m.ok === 'boolean') return api.postMessage({ cmd: 'attachResult', ok: m.ok }); // QOL.md item 1
    if (fromFrame && m.type === 't3vscode:sent') return api.postMessage({ cmd: 'sent' }); // B18
    if (fromFrame && m.type === 't3vscode:open-diff' && typeof m.path === 'string') return api.postMessage({ cmd: 'openDiff', path: m.path, relative: m.relative === true }); // B20
    if (fromFrame && m.type === 't3vscode:insert' && typeof m.text === 'string') return api.postMessage({ cmd: 'insert', text: m.text.slice(0, 65536) }); // B12
    if (fromFrame && m.type === 't3vscode:run' && typeof m.text === 'string') return api.postMessage({ cmd: 'run', text: m.text.slice(0, 16384) }); // B9
    if (fromFrame && m.type === 't3vscode:notify' && [m.title, m.body, m.tag].every((x) => typeof x === 'string')) return api.postMessage({ cmd: 'notify', title: m.title.slice(0, 300), body: m.body.slice(0, 300), tag: m.tag.slice(0, 300) }); // B11
    if (fromFrame && m.type === 't3vscode:dropped' && Array.isArray(m.uris) && m.uris.every((u) => typeof u === 'string')) return api.postMessage({ cmd: 'dropped', uris: m.uris.slice(0, 50) });
    if (fromFrame && m.type === 't3vscode:key' && KEYS.includes(m.key)) return api.postMessage({ cmd: 'key', key: m.key }); // the six key names, nothing else
    if (e.origin !== location.origin || !m || !['error', 'focusInput', 't3vscode:new-thread', 'threads', 'navigate', 't3vscode:focus-composer', 't3vscode:mention', 't3vscode:attach', 't3vscode:theme', 't3vscode:settings', 't3vscode:notify-click', 't3vscode:palette', 'openPicker', 'prefill', 'session'].includes(m.type)) return;
    if (m.type === 'threads') {
      if (pop && Array.isArray(m.items)) {
        items = m.items.filter(ok);
        current = typeof m.current === 'string' ? m.current : '';
        setTitle();
        if (!pop.hidden) draw();
      }
    } else if (m.type === 'navigate') {
      // Only /<environment>/<thread> (or /settings/general, B29: no thread, no title) on the forwarder: never another origin or a scheme. NAV.md section 5: switched in place by T3's
      // router; no location with the thread within 1.5 s (a nightly changed the router) falls back to loading the page.
      if (frame && typeof m.path === 'string' && /^\/[A-Za-z0-9._~%-]{1,200}\/[A-Za-z0-9_-]{1,80}$/.test(m.path)) {
        const origin = new URL(frame.src).origin;
        clearTimeout(waiting);
        want = m.path; // the whole path: go-result or the timer resolves it
        const id = m.path.split('/')[2];
        const target = items.find((t) => t.id === id);
        frame.contentWindow.postMessage({ type: 't3vscode:go', pathname: m.path, title: target ? target.title : '' }, origin);
        waiting = setTimeout(() => { if (want !== m.path) return; want = ''; frame.src = origin + m.path; api.postMessage({ cmd: 'log', text: 'switch fell back to a reload' }); }, 1500);
      }
    } else if (m.type === 't3vscode:new-thread') { if (frame && typeof m.root === 'string' && typeof m.title === 'string') frame.contentWindow.postMessage({ type: m.type, root: m.root, title: m.title }, new URL(frame.src).origin); }
    else if (m.type === 't3vscode:focus-composer') { if (frame) { frame.focus(); frame.contentWindow.postMessage({ type: m.type }, new URL(frame.src).origin); } }
    else if (m.type === 't3vscode:mention') { if (frame && typeof m.text === 'string') frame.contentWindow.postMessage({ type: m.type, text: m.text }, new URL(frame.src).origin); }
    // QOL.md item 1: the one relay that carries bytes (base64 images up to 10 MiB each): data passes whole, never sliced.
    else if (m.type === 't3vscode:attach') {
      const files = Array.isArray(m.files) ? m.files.filter((f) => f && typeof f.name === 'string' && typeof f.type === 'string' && typeof f.data === 'string') : [];
      if (frame && files.length) frame.contentWindow.postMessage({ type: m.type, files: files.map((f) => ({ name: f.name, type: f.type, data: f.data })) }, new URL(frame.src).origin);
    }
    else if (m.type === 't3vscode:theme') { if (frame && (m.kind === 'dark' || m.kind === 'light')) frame.contentWindow.postMessage({ type: m.type, kind: m.kind }, new URL(frame.src).origin); }
    else if (m.type === 't3vscode:settings') { if (frame && (m.runInTerminal === 'vscode' || m.runInTerminal === 't3')) frame.contentWindow.postMessage({ type: m.type, runInTerminal: m.runInTerminal, ...(Array.isArray(m.keys) ? { keys: m.keys.filter((k) => KEYS.includes(k)) } : {}) }, new URL(frame.src).origin); } // R24: only the six names
    else if (m.type === 't3vscode:palette') { if (frame) { frame.focus(); frame.contentWindow.postMessage({ type: m.type }, new URL(frame.src).origin); } } // R13: the palette input needs the frame focused
    else if (m.type === 't3vscode:notify-click') { if (frame && typeof m.tag === 'string') frame.contentWindow.postMessage({ type: m.type, tag: m.tag }, new URL(frame.src).origin); }
    else if (m.type === 'error') { setBusy(false); showError(m.text); if (input) input.focus(); }
    else if (m.type === 'openPicker') show(true); // B4: T3: Switch thread, the same as a click on the title
    else if (m.type === 'prefill') { // R10: into the field only, never submitted; what the owner typed meanwhile wins
      if (input && !input.value && typeof m.value === 'string') { input.value = m.value.slice(0, 2000); filled = true; if (hint) { hint.textContent = 'Pasted from the clipboard. Press Pair.'; hint.hidden = false; } }
    }
    else if (m.type === 'focusInput') focus();
    else if (m.type === 'session' && typeof m.text === 'string') { // R23: a renewal kept the page; only the date changes
      const p = document.getElementById('session');
      if (p) p.textContent = m.text + '.';
      const d = document.querySelector('[data-cmd="details"]');
      if (d) d.title = m.text;
    }
  });
  if (frame) frame.addEventListener('load', () => api.postMessage({ cmd: 'frameLoaded' }));
  // Only on request: the pair command, or a click (Check again, Forget) that led here. Not when T3 comes back by itself.
  if (document.body.hasAttribute('data-focus')) focus();
  ask();
}

const title = `<header class="title">${MARK}<h1>T3 Code</h1></header>`;

function pairForm(label, error) {
  return '<form class="row"><input type="text" placeholder="Pairing link or code" aria-label="Pairing link or code" spellcheck="false" autocomplete="off">' +
    `<button type="submit" data-label="${label}">${label}</button></form><p class="err" role="alert"${error ? '' : ' hidden'}>${esc(error || '')}</p><p class="muted" hidden></p>`;
}

// NAV.md section 1: the bound project's threads; another project's carry its name. client() names rows the same way.
const label = (t) => (t.mine ? '' : `${t.projectTitle} / `) + (t.title || 'Untitled');
const count = (n) => `${n} thread${n === 1 ? '' : 's'}`;
const ICONS = {
  plus: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M14 7v1H8v6H7V8H1V7h6V1h1v6h6z"/></svg>',
  refresh: '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill-rule="evenodd" d="M5.563 2.516A6 6 0 0 0 2.5 7.5h1a5 5 0 0 1 8.36-3.702L10.5 5.5v-4h4L13.223 2.77A6 6 0 0 0 5.563 2.516zM10.437 13.484A6 6 0 0 0 13.5 8.5h-1a5 5 0 0 1-8.36 3.702L5.5 10.5v4h-4l1.277-1.27a6 6 0 0 0 7.66.254z"/></svg>',
  more: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="3" cy="8" r="1.5"/><circle cx="8" cy="8" r="1.5"/><circle cx="13" cy="8" r="1.5"/></svg>',
  chevron: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M7.976 10.072l4.357-4.357.62.618L8.284 11h-.618L3 6.333l.619-.618 4.357 4.357z"/></svg>',
  external: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 1h6v1H2v12h12V8.5h1v6l-.5.5h-13l-.5-.5v-13l.5-.5z"/><path d="M15 1v5.5h-1V2.707L7.854 8.854l-.708-.708L13.293 2H9.5V1H15z"/></svg>',
};
// NAV.md section 5: the title opens the quick pick; the list rides along as escaped JSON, so the first open shows it before the fresh one lands.
function nav(threads, current) {
  const cur = threads.find((t) => t.id === current);
  return `<button class="pick" aria-haspopup="listbox" aria-expanded="false" aria-controls="threads" title="${esc(count(threads.length))} in this project"><span class="ttl">${esc(cur ? label(cur) : 'No thread')}</span>${ICONS.chevron}</button>`;
}
const popover = (threads, current) => `<div class="pop" id="threads" data-items="${esc(JSON.stringify(threads))}" data-current="${esc(current || '')}" hidden>` +
  '<input type="search" placeholder="Search threads by title or id" aria-label="Search threads" spellcheck="false" autocomplete="off"><ul role="listbox"></ul></div>';

function paired(st) {
  const s = st.session || {};
  const end = date(s.expiresAt);
  const auto = (s.scopes || []).includes('access:write');
  const may = scopeWords(s.scopes).map(esc).join(', ') || 'nothing T3 reported';
  // One note line in the paired state: a routing note, else the project T3 is on; the client overwrites it if the first thread does not open.
  // While a first thread is being opened the line says so; the client swaps it for the bound text (data-ok) or the failure text (data-fail).
  const bound = st.folderName && !st.note ? `T3 is on ${st.folderName}` : ''; // a note means T3 is not on the folder
  const line = st.note || (st.newThread ? `Opening the first thread in ${st.newThread.title}` : ''); // the strip is for notes only; the bound folder lives in the card
  const fail = st.newThread ? ` data-ok="" data-fail="${esc(`T3 did not open the first thread of ${st.newThread.title}. In the T3 search box, pick the project with the folder ${st.newThread.root}.`)}"` : '';
  const status = esc(sessionStatus(s));
  return `<div class="bar"><span class="dot" aria-hidden="true"></span>` +
    (st.threads ? nav(st.threads, st.current) : `<span class="pick muted" style="padding-left:6px">${esc(st.folderName || 'T3 Code')}</span>`) +
    `<button class="icon" data-cmd="newThread" title="New thread in ${esc(st.folderName || 'this project')}" aria-label="New thread">${ICONS.plus}</button>` +
    `<button class="icon" data-cmd="reload" title="Reload" aria-label="Reload">${ICONS.refresh}</button>` +
    `<button class="icon" data-cmd="openDesktop" title="Open in the T3 app" aria-label="Open in the T3 app">${ICONS.external}</button>` +
    `<button class="icon" data-cmd="details" title="${status}" aria-label="Session details" aria-expanded="${!!st.note}" aria-controls="details">${ICONS.more}</button></div>` +
    (st.threads ? popover(st.threads, st.current) : '') +
    // The note line is always there (the client swaps its text); it shows as a strip only while it has text.
    `<p class="strip" id="note"${fail}${line ? '' : ' hidden'}>${esc(line)}</p>` +
    `<section class="card" id="details"${st.note ? '' : ' hidden'}><h2>Session</h2>` +
    `<p id="session">${status}.</p>${bound ? `<p>${esc(bound)}.</p>` : ''}<p>This session may ${may}.</p>` +
    (auto ? '' : `<p>Renewal: manual. Pair again before ${end}.</p>${pairForm('Pair again', st.error)}`) +
    '<p class="muted">File links in the chat open here in VS Code.</p>' +
    '<div class="row"><button class="secondary" data-cmd="forget">Forget this pairing</button>' +
    (st.threads ? '<button class="secondary" data-cmd="copyLink">Copy link to this thread</button>' : '') + '</div></section>' + // R22: only with a bound project
    `<iframe src="${esc(st.forwarderUrl)}${esc(st.path || '/')}" title="T3 Code" ${FRAME_ATTRS}></iframe>`;
}

function centred(st) {
  if (st.kind === 'down') {
    return '<p class="lead">T3 is not running on this PC.</p><p class="muted">The panel reconnects by itself once T3 is up.</p>' +
      `<div class="row"><button data-cmd="start"${st.busy ? ' disabled' : ''}>${st.busy ? 'Starting T3...' : 'Start T3'}</button>` +
      '<button class="secondary" data-cmd="check">Check again</button><button class="secondary" data-cmd="showLogs">Show logs</button></div>';
  }
  if (st.kind === 'unpaired') {
    let host = st.origin;
    try { host = new URL(st.origin).host; } catch {}
    return (st.ended ? '<p class="notice">Your T3 session ended.</p>' : '') +
      `<p class="lead">Connect VS Code to T3 at ${esc(host)}.</p>` +
      '<ol><li>In T3 open Settings, Connections, Create link. Label it VS Code.</li><li>Paste the link or the code here.</li></ol>' +
      pairForm('Pair', st.error) +
      '<p class="tip muted">Tip: tick Manage access when you create the link, then this panel renews the session by itself. Otherwise you pair again every 30 days.</p>';
  }
  if (st.kind === 'error') {
    return `<p class="lead">Something went wrong talking to T3.</p><p class="err">${esc(st.error)}</p>` +
      '<p class="muted">The T3 Code output has the details.</p><div class="row"><button data-cmd="check">Check again</button><button class="secondary" data-cmd="showLogs">Show logs</button></div>';
  }
  return '<p class="muted">Connecting to T3...</p>';
}

function render(st) {
  const nonce = crypto.randomBytes(16).toString('base64');
  const frame = st.kind === 'paired' ? ` frame-src ${st.forwarderUrl};` : '';
  const main = st.kind === 'paired' ? paired(st) : `<main class="wrap">${title}${centred(st)}</main>`;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline';${frame} script-src 'nonce-${nonce}'">
<style>${CSS}</style></head><body class="${esc(st.kind)}"${st.focus ? ' data-focus' : ''}>${main}
<script nonce="${nonce}">(${client})();</script></body></html>`;
}

module.exports = { render, date, scopeWords, sessionView, sessionStatus };
