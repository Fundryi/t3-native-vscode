# Injected script: open files in VS Code, quiet the nightly popup

Design for the one small script the forwarder injects into T3's HTML (owner decision 2026-10-12). Research only; no code yet.
Source facts are from `reference/t3code` at `d83929ad` (tag `v0.0.46-nightly.20261012.3010`). The live nightly reports the same version
(`main-*.js` contains `0.0.46-nightly.20261012.3010`), and every selector below was also found in the live bundles. Paths below are under `reference/t3code/`.

## What T3 does today

- **Chat file chips** (assistant markdown links and inline-code paths): `MarkdownFileLink`, `apps/web/src/components/ChatMarkdown.tsx:1934`.
  It renders `<a href="{targetPath}" data-slot="context-chip" class="... chat-markdown-file-link" data-markdown-copy="...">` (:2222-2226, class const :1221,
  `data-slot` from `components/ContextChip.tsx:95`). `href` is a raw host path, not a URL: `fileLinkMeta.targetPath` (:2661), absolute when the thread cwd
  is known, with an optional `:line` or `:line:column` suffix (`packages/shared/src/fileLinks.ts:8` regex, :41-58 split and format; `apps/web/src/markdown-links.ts:87-97`).
  Inline code becomes the same chip (ChatMarkdown.tsx:3191-3206). The full path is also in a tooltip, rendered only on hover (not usable).
  Click handler :2227-2238: `preventDefault` + `stopPropagation`; Ctrl+click (Cmd on Mac, `apps/web/src/terminal-links.ts:153-161`) opens in the editor;
  a plain click opens the right-hand file panel, media preview or browser preview (`handleOpenInFilePreview` :1992-2002).
  A chip without any primary action is a `<button aria-label="File options for ...">` that only opens a menu (:2244-2252); leave it alone.
- **File mentions in the user's own messages**: `UserMessageMentionChip`, `apps/web/src/components/chat/MessagesTimeline.tsx:4329-4346`:
  `<button data-slot="context-chip" aria-label="Preview {path}">`, path workspace-relative, plain click opens the file panel. No Ctrl+click path.
- **Diff panel file headers**: `apps/web/src/components/DiffPanel.tsx:1101-1130`, an `onClickCapture` that walks `composedPath()` for an element with
  `data-title` (its `textContent` is the repo-relative path) and calls `openDiffFile` (:632-659 -> `apps/web/src/diffFileActions.ts:80-100`), which opens
  the file panel when a thread is selected, else the editor. Clicks on a button or anchor in the header are skipped (:1107-1110).
  The diff itself is @pierre/diffs inside an **open** shadow root (live `Virtualizer-*.js`: `attachShadow({mode:"open"})`); the header carries
  `data-diffs-header`, code rows `data-line="{n}"` and `data-line-type`, gutter cells `data-column-number="{n}"` (live `getDiffFileInput-*.js`).
- **Not catchable**: the turn summary file tree (`apps/web/src/components/chat/ChangedFilesTree.tsx:212-218`) has the path only in a React key and a
  truncated basename; tool-call "changed files" are plain text (`MessagesTimeline.tsx:5342-5352`). Tool output reaches chips only through ChatMarkdown.
- **Open in editor**: `useOpenInPreferredEditor`, `apps/web/src/editorPreferences.ts:68-131`; editor choice from localStorage `t3code:last-editor` (:22, :59-66),
  default is the first available of `EDITORS` (`packages/contracts/src/editor.ts:28`; `vscode` = CLI `code`, :40-46). It sends WS RPC `shell.openInEditor`
  (`packages/contracts/src/rpc.ts:387`, server `apps/server/src/ws.ts:2701`) with `{cwd: targetPath, editor}`; the server runs `code --goto path:line:col`
  (`apps/server/src/process/externalLauncher.ts:163-164`). It needs the `operate` scope (editorPreferences.ts:98).
  All of this lives in React closures; nothing is on `window`. Calling it from outside is not possible, so postMessage to our panel is the clean way.
  Side benefit only: with `t3code:last-editor` = `"vscode"` Ctrl+click already lands in VS Code through the `code` CLI (window chosen by VS Code).
- **Nightly popup**: `NightlyMobileBetaNotice`, `apps/web/src/components/NightlyMobileBeta.tsx:55-84`, mounted in `apps/web/src/routes/__root.tsx:269`.
  A toast, `timeout: 0`, shown when the build is nightly (:22-23) and localStorage `t3code:nightly-mobile-beta-notice-dismissed:v1` (:30) is not `true`.
  Any close (Dismiss, X, swipe, "Get the beta app") stores it (`onClose: dismissNotice`, :66, :43-49). Once per origin, forever, until the key's `:v1` is bumped.
- **localStorage format**: values are JSON (`Schema.fromJsonString`, `apps/web/src/hooks/useLocalStorage.ts:43-71`), so the dismissed value is the string `true`
  and the editor is `"vscode"` with quotes. Same-tab writes fire window event `t3code:local_storage_change` (:81).
  Keys found in the live bundles that a port change would lose: `t3code:client-settings:v1` (web build keeps client settings here, `apps/web/src/localApi.ts:65-72`),
  `t3code:last-editor`, `t3code:theme*`, `t3code:themes:v1`, `t3code:composer-drafts:v1`, `t3code:prompt-stash:v2`, `t3code:right-panel-state:v2`,
  `t3code:diff-panel-state:v1`, `t3code:ui-state:v1`, `t3code:renderer-state:v8`, `t3code:terminal-state:v1`, `t3code:closed-views:v2`,
  `t3code:provider-update-dismissals:v1`, `t3code:version-mismatch-dismissals:v1`, `t3code:connect-onboarding-opt-out:v1`, the nightly key.
- **Window hooks**: only `window.desktopBridge` (`apps/web/src/vite-env.d.ts:25`), set by Electron, absent in our frame. Custom window events exist
  (`t3code:open-command-palette` `apps/web/src/commandPaletteBus.ts:10`, `t3code:preview-action` `apps/web/src/components/preview/previewActionBus.ts:16`,
  `t3code:focus-composer` `apps/web/src/lib/desktopSnapShot.ts:3`), none for opening files. So the script reads the DOM.
- **Window messages**: T3 listens in `apps/web/src/components/files/BrowserDocumentFrame.tsx:105,119` and `apps/web/src/components/chat/McpAppFrame.tsx:445`,
  and posts to its own child frames (:81,:103; McpAppFrame.tsx:324). Every listener checks `event.source` against its own child frame, and nothing posts to
  `window.parent`. Our message goes up to the panel, so no collision; a distinct `type` keeps it that way.
- **Served HTML (live `/`, 2026-10-12)**: 418 lines, 19493 bytes. Headers: `content-type: text/html; charset=utf-8`, `cache-control: no-cache`,
  `content-encoding: gzip`, chunked, `access-control-allow-origin: *`, **no CSP header**. No CSP meta, no nonce. `<head>` skeleton:
  `<meta charset>`, viewport meta, `theme-color` meta, 3 `<link>` (favicon, apple-touch-icon, manifest), then an inline `<script>` (theme boot,
  source `apps/web/index.html:13`, ends at byte 18153), an inline `<style>`, `<title>T3 Code (Alpha)</title>`,
  `<script type="module" crossorigin src="/assets/index-DG_PEzRo.js">`, `</head>` at byte 19220. Bundle names carry a content hash and change per build.

## Design

**Forwarder (t3.js `startForwarder`, the response handler of the `request` event, one place):**
- On the upstream request, when `sec-fetch-dest` is `iframe` (`badFetch` already refuses `document`), delete `accept-encoding` so T3 answers the page uncompressed. Everything else keeps it.
- In the response: only when `content-type` starts with `text/html` **and** there is no `content-encoding` (or `identity`): buffer the body (cap it, for example 2 MB,
  else pass through), insert `<script>...</script>` right after the first `/<head[^>]*>/i` match, drop `content-length` and `transfer-encoding`, set the new
  `content-length`. No `<head>` match, an encoded body or a cap hit: send the original bytes unchanged. Every other response keeps streaming with `pipe`.
- Inline is fine today (no script CSP). The script is a constant string in t3.js, no template values in it.

**The script (plain IIFE, every step in try/catch, does nothing when unsure):**
1. Guard: run once (`window.__t3vscode`). Stop if `window.parent === window`, if `window.parent.location.origin` is readable (same-origin parent), or if
   touching `localStorage` throws. T3's own HTML previews are served through the forwarder too and get the script, but they run in
   `sandbox` frames without `allow-same-origin` (BrowserDocumentFrame.tsx:58, :128): opaque origin, so `localStorage` throws and the script stops there.
2. Seed localStorage, only if the key is absent: `t3code:nightly-mobile-beta-notice-dismissed:v1` = `true`. Runs before the module bundle, so the toast never shows.
   No DOM fallback: if T3 bumps the key, the toast shows once and the stable origin keeps the owner's Dismiss.
3. Add a window click listener in the capture phase. A window capture listener runs before every element-level listener, native or React (React listens
   at `#root`), so `stopPropagation` there is enough. Act only when `button === 0` and no Ctrl, Meta, Shift or Alt: Ctrl+click stays T3's own behaviour.
4. Walk `event.composedPath()` (reaches into the open diff shadow root) for the first match, by meaning, not by styling class:
   a. `a[data-slot="context-chip"][href]`: path = `getAttribute("href")` (raw, never `.href`).
   b. `button[data-slot="context-chip"][aria-label^="Preview "]`: path = aria-label minus `Preview `. This also matches the mention chips in the
      composer (`apps/web/src/components/ComposerPromptEditorTiptap.tsx:266-273`), which T3 previews the same way; image previews have no `data-slot`.
   c. `[data-title]` with a `[data-diffs-header]` ancestor in the path, and no `button` or `a` before it in the path: path = `textContent.trim()`.
   Stop the walk at the first `button` or `a` that is none of these. Nothing matched: return, T3 handles the click.
5. Split `:line[:column]` with T3's own regex `/:(\d+)(?::(\d+))?$/` (the href is always in suffix form, fileLinks.ts:107). Then `preventDefault()`, `stopPropagation()`,
   `window.parent.postMessage({type: "t3vscode:open-file", path, line, column}, "*")`. Target `"*"` is fine: the data is a path the panel validates.

**Message shape:** `{type: "t3vscode:open-file", path: string, line?: number, column?: number}`. Line and column are 1-based, as T3 shows them.

**Panel (panel.js):** the listener at :105 drops everything not from `location.origin`. Add one branch before that check: `m.type === "t3vscode:open-file"`
and `e.source === iframe.contentWindow` and `e.origin === forwarder origin` -> `api.postMessage({cmd: "openFile", path, line, column})` with types checked.

**Extension (extension.js `onDidReceiveMessage`):** `cmd === "openFile"`: path must be a non-empty string, line and column positive integers or absent (absent = 1).
Absolute -> `Uri.file`. Relative -> first workspace folder where `workspace.fs.stat` of folder + path succeeds. Then `window.showTextDocument(uri,
{selection: new Range(line-1, col-1, line-1, col-1), preview: false})` and the command `revealInExplorer` with the uri.
Not found: one `showWarningMessage` naming the path. A directory: only `revealInExplorer`.

**Stable port:** `startForwarder` takes an optional `port`. extension.js reads it from `globalState` (key `t3vscode.forwarderPort`) and listens on it at
127.0.0.1; on `EADDRINUSE` it falls back to port 0. Store the port only when none is stored yet (first run). Do not overwrite on fallback: `globalState` is
shared by all VS Code windows, and a second window must not steal the first window's origin. Same port = same origin = T3 keeps its localStorage.

## T3 facts this depends on (re-check after a nightly bump)

| Fact | Where |
|---|---|
| File chip is `<a data-slot="context-chip" href=raw path>` | ChatMarkdown.tsx:2222-2226, :2661; ContextChip.tsx:95 |
| Path suffix `:line:col` | packages/shared/src/fileLinks.ts:8, :55-58 |
| Plain click = preview, Ctrl/Cmd = editor | ChatMarkdown.tsx:2227-2238; terminal-links.ts:153-161 |
| Mention chip `aria-label="Preview {path}"` | MessagesTimeline.tsx:4338-4346 |
| Diff header `data-title` in `data-diffs-header`, open shadow root | DiffPanel.tsx:1101-1130; live `getDiffFileInput-*.js`, `Virtualizer-*.js` |
| Popup key `t3code:nightly-mobile-beta-notice-dismissed:v1`, JSON `true` | NightlyMobileBeta.tsx:30, :35-49; useLocalStorage.ts:43-71 |
| Editor key `t3code:last-editor` | editorPreferences.ts:22 |
| No script CSP, `<head>` present, page gzip-encoded | live `/` headers and HTML |
| Mention chips `button[data-slot="context-chip"][aria-label^="Preview "]` | MessagesTimeline.tsx:4338-4346; ComposerPromptEditorTiptap.tsx:266-273 |
| Previews run in sandbox frames without `allow-same-origin` | BrowserDocumentFrame.tsx:58, :128 |

## Open

- Open: diff line numbers. Rows carry `data-line` and the gutter `data-column-number`, so "open at line" is possible, but a plain click on a line may be
  T3's line selection for review comments. Proposal: do not intercept lines in the first slice; only the header title.
- Open: relative paths (mentions, diffs) resolve against the thread cwd, which may be a worktree not open in VS Code. First slice: workspace folders only, warn otherwise.
- Open: whether the iframe's localStorage survives a VS Code restart (third-party storage inside the webview may be partitioned). Check live before relying on it.
- Open: `stopPropagation` at window capture also hides the click from any document-level "click outside" handler in T3 (menus, popovers). Only on matched
  chips, so low risk; check that an open menu still closes.
- Open: if another app holds the stored port for good, every start falls back to a random port and T3's prefs reset each time. Fix by hand: clear the key.
- Open: media and HTML files. Today a plain click previews them in T3; this design sends them to VS Code too. Owner to decide whether to exclude them.
- Open: the first 60 lines of the live HTML are not pasted here to stay under the size cap; they are almost all the theme boot script.
  Re-fetch with a GET of `/` (`Authorization: Bearer invalid` is enough, the page is public).

## Review (Codex), 2026-10-12

Reviewed the design, HANDOFF decisions 1, 5 and 10, `t3.js`, `panel.js` and `extension.js`. `git -C reference/t3code rev-parse --short HEAD` returned `d83929ad`; all upstream file:line citations below refer to that commit and paths under `reference/t3code/`. Reference tracked status was clean. Live checks used Node HTTP GET only against port 3773, without a real bearer. Bundle observations confirm shipped strings and dependency markup, not browser behavior.

1. **Must change: the anchor selector also catches thread navigation.** `a[data-slot="context-chip"][href]` is not a file identity. `apps/web/src/components/ThreadContextChip.tsx:24-29` renders that exact shape through a router Link, with `aria-label="Thread, ..."`; `components/ContextChip.tsx:92-102` supplies the shared slot. The proposed capture handler would cancel the thread switch and send its app route to VS Code. The file anchors themselves are correct at `components/ChatMarkdown.tsx:2222-2238,2661`. **Fix:** validate that the raw href is a supported filesystem path before cancelling anything, explicitly exclude thread/navigation chips by their semantics, and keep the stop-at-unmatched-button-or-anchor rule. Never use `.href`, which turns relative paths into HTTP URLs. Do not invent a `data-kind` selector: ContextChip does not expose one. Include a thread-chip click in the real acceptance check.

2. **Must change: non-empty path validation permits network and device access.** A legitimate Markdown destination can supply the path; arbitrary injected HTML is unnecessary. `packages/shared/src/fileLinks.ts:12-29` converts `file://host/share/file.txt` into a UNC path, `packages/shared/src/path.ts:5-10` treats UNC paths as absolute, and `packages/shared/src/markdownLinks.ts:291-306` accepts them. `components/ChatMarkdown.tsx:2956-2960,2661` then puts the resolved destination in the chip href. Opening or even statting such a path can contact a remote share using the owner's Windows identity. Device paths, reserved device names and alternate data streams also must not reach filesystem calls. This review did not contact any share or device. **Fix:** enforce the policy in extension.js before stat/open/reveal: accept ordinary local host paths only; reject UNC/network authorities, Windows device namespaces and reserved device components, drive-relative paths, URI schemes, NUL/control characters and extra Windows colons after the drive prefix. Normalize relative paths and reject escapes from their bound root; account for resolved symlink targets when enforcing that boundary. Require a regular file or directory, use text-document opening for files, and never launch a shell, openExternal, a custom editor or a caller-supplied command. Ordinary local absolute files outside the workspace are already intentional T3 behavior (`ChatMarkdown.tsx:2652-2656`); opening them is not by itself proof of code execution or disclosure to the page. Use safe integers with a practical bound for line/column and catch open/reveal failures.

3. **Must change: first existing workspace folder is not the thread's root.** Mentions carry relative paths (`components/chat/MessagesTimeline.tsx:4341-4345`; `components/ComposerPromptEditorTiptap.tsx:264-273`). A different project or worktree can contain the same filename, so a successful stat can silently open the wrong file, even with just one VS Code workspace folder. Diff titles are repository-relative; T3 converts them relative to activeCwd and repositoryRoot before opening (`components/DiffPanel.tsx:632-658`; `diffFileActions.ts:55-77,87-99`). That conversion is missing here. Absolute Markdown hrefs can also name a guessed root basename: T3's plain-click preview performs a separate basename lookup (`ChatMarkdown.tsx:2612-2630`) that this interceptor bypasses. **Fix:** never select the first successful stat as proof of identity. Bind relative clicks to a known local thread/repository root and disambiguate before opening; otherwise warn without opening an unrelated file. Do not add a recursive basename search. Open: the design includes relative mentions and diff titles, but the smallest reliable first slice is absolute file-chip targets only, with unresolved targets reported. Recommend that slice until a thread-root binding is available. HANDOFF decision 10 is agent/MCP routing, not a reason to route an interactive panel click into the last-focused unrelated window.

4. **Must tighten: a preferred port is not a stable origin for every window.** The current forwarder binds port 0 (`t3.js:262-269`), and panel refresh starts/closes it around asynchronous work (`extension.js:142-152,263-271`). Sharing one preferred globalState port means only its current holder keeps that origin. A second window uses a random port, and recreating its forwarder on renewal/restart can lose its preferences again. Two cold-start windows can both read an absent key and both store their different successful port; "store only when absent" without coordination is not atomic. **Fix:** validate the persisted port, retry only EADDRINUSE, and close a superseded candidate before any state write. Use a common deterministic initial preferred candidate, so the cold-start winner stores it and the loser never stores a random fallback. Keep a window's successfully bound fallback in memory for recreation rather than choosing a fresh port each time. Never adopt another window's existing listener, because messages must return to this panel's extension host. Document persistent occupation and simultaneous-window fallback as limits. Do not build a shared authenticated proxy or port broker for this slice.

5. **Compression approach passes the live check; narrow which HTML is rewritten.** Live GET `/` with `Accept-Encoding: gzip` and dest iframe returned 200, gzip, 5028 wire bytes and 19493 decoded bytes. Omitting Accept-Encoding returned 200, no content-encoding and Content-Length 19493. Dest empty GETs of `/` and `/__codex_inject_review_missing__.html` returned the same gzip HTML (decoded SHA-256 prefix `479572775bce`). T3 applies compression at `apps/server/src/http.ts:257`, and falls back to index.html for missing static paths at `http.ts:629-635`. HTML assets also exist (`http.ts:122-135`), so HTML is not synonymous with the app shell. **Fix:** retain byte-for-byte streaming of encoded responses; no decompressor is needed for this slice. Restrict injection to successful iframe shell navigations, excluding API/assets/downloads, ranges/206, HEAD and bodyless responses. Do not mutate arbitrary uncompressed HTML fetches or downloaded HTML. Buffer before writeHead, cap accumulated bytes, and on cap/no-head fallback replay every held chunk followed by the untouched remainder, preserving original headers. For a rewrite calculate Content-Length with Buffer.byteLength, drop stale body validators as well as framing headers, and preserve upstream CSP and existing cancellation/error handling (`t3.js:178-195`). Encoded non-iframe fetches are safe under the proposed pass-through rule, not something we need to decode.

6. **Keep the exact message gate; there is no observed T3 listener collision.** T3's HTML-render listeners check their own child window (`components/files/BrowserDocumentFrame.tsx:90-105,113-120`); MCP apps do likewise (`components/chat/McpAppFrame.tsx:441-445`). The proposed upward message does not meet those source checks. HTML/MCP content is sandboxed without allow-same-origin (`BrowserDocumentFrame.tsx:58,127-128`; `McpAppFrame.tsx:535-536`), so it must not pass the panel's source/origin gate. `panel.js:103-111` currently accepts only same-origin extension messages, and acquireVsCodeApi remains local to client (`panel.js:67-68`). **Fix:** before reading m.type check that data is an object, then require the exact open-file type, the current top T3 iframe's contentWindow and its exact forwarder origin. Build a fresh `{cmd:'openFile', path, line, column}` object; never forward/spread arbitrary page data or accept a generic cmd. Return after this branch and preserve the existing origin/type whitelist for error/busy/focusInput. Validate again in the extension. Add `event.isTrusted` to the script's click gate so synthetic clicks cannot trigger it. Source/origin checks identify the whole T3 document, not this IIFE alone; an XSS in that document could send this one message directly, making extension path validation essential. Do not expose the VS Code API or add a reverse command channel. Target `"*"` is acceptable for this upward, non-secret notification with the receiving gate intact.

7. **Click interception is plausible, but the menu risk needs more precise evidence.** The mention selector matches both timeline and composer chips (`MessagesTimeline.tsx:4338-4346`; `ComposerPromptEditorTiptap.tsx:266-273`). The diff title rule matches T3's own composedPath title handling, while header controls must remain excluded (`DiffPanel.tsx:1103-1132`). Live GET bundles `getDiffFileInput-DTkwTMDZ.js` and `Virtualizer-TMCB_Niz.js` contain data-title/data-diffs-header and attachShadow({mode:`open`}); composer bundle `ComposerPromptEditor-CT6JeJkN.js` contains Preview and data-composer-mention-chip. The non-Electron context menu dismisses on document pointerdown capture (`contextMenuFallback.ts:265-269,493-495`), before the proposed click interception, so stopPropagation on click does not inherently strand that menu. Menu item buttons and File options buttons do not match and must retain their actions (`ChatMarkdown.tsx:2125-2159,2250-2258`). Other popovers are Base UI components (`components/ui/popover.tsx:3-9`; `components/ui/menu.tsx:3-10`); GET bundle presence cannot prove their dismissal or Tiptap selection behavior. **Fix:** intercept click only, not pointerdown/contextmenu; validate before preventDefault; preserve modifiers, header chevrons, menu items, composer editing and keyboard activation. Real checks must cover a chip while a menu/popover is open, a composer mention with a draft, Enter/Space, thread links and diff collapse. Do not add broad popup-closing clicks or DOM observers in advance.

8. **Stable TCP port alone does not prove storage persistence.** The localStorage keys and JSON format are correct (`hooks/useLocalStorage.ts:43-67`); the panel is a sandboxed third-party iframe (`panel.js:7,135`), and refresh replaces the outer webview HTML (`extension.js:125`). A GET cannot establish how VS Code/Electron partitions that iframe's storage across panel recreation, windows, extension-host restart or VS Code restart. **Fix:** state persistence as an acceptance gate, not a guaranteed consequence of the port. After implementation, set a harmless T3 preference and check panel Reload, forwarder recreation and VS Code restart in the same window; separately check the fallback window. If partitioning defeats persistence, investigate that observed behavior before adding a settings synchronization service. This run did not set storage or open a browser.

9. **The toast key and early insertion are correct; isolate their failures.** `components/NightlyMobileBeta.tsx:30,35-45,58-66` reads the exact v1 key as Boolean true before adding the toast. Live `main-CgmjZ_f_.js` reports version `0.0.46-nightly.20261012.3010` and contains that key. Live HTML has a head and no CSP header or CSP meta, so insertion before the module can seed it. **Fix:** keep this one key, with the string `true`, and keep the no-DOM-fallback plan. Catch the expected cross-origin exception when inspecting parent.location and continue; catch the storage seed separately so its failure does not disable safe file clicks. A readable same-origin parent should still stop the script. Existing opaque preview sandboxes explain why their storage access fails, but do not use storage availability as the security boundary. No editor-choice seeding or desktopBridge emulation is needed.

10. **Keep scope small and make the remaining UI consistent.** HANDOFF `docs/HANDOFF.md:47-48` authorizes plain file-chip clicks and removes dependence on the editor picker; `panel.js:134` still tells the owner to choose VS Code. Ctrl/Cmd-click and right-click Open in editor intentionally remain T3's closures and selected CLI (`ChatMarkdown.tsx:2230-2232,2143-2145`), so they do not gain the new panel-local routing. **Fix:** remove the stale picker hint as part of this slice and say exactly which interactions it changes. Keep media/HTML file targets under the same validated plain-click rule already decided, with text opening rather than a new custom preview. Keep diff line clicks, changed-file trees without a recoverable path, menu rewriting, cross-window dispatch and a generalized injection framework out of this slice. Add focused checks for the security boundary and streamed-body fallback, plus the real interaction/storage checks above; source and GET evidence alone cannot close those gates.

Verdict: change the thread-chip selector, extension path validation, relative-root handling, HTML rewrite scope and cold-start/fallback port rules before building; the one-script approach, message direction and iframe gzip strategy remain sound.

## Lead decisions after the review (2026-10-12)

Slice 1 builds the design with these changes. Numbers refer to the Codex findings above.

1. The script acts only when the raw href is a local absolute path (`^[A-Za-z]:[\\/]` with no second colon except the line suffix, or a POSIX `/` path) and the chip's aria-label does not start with "Thread". Everything else, including relative paths, stays with T3.
2. The extension accepts only local absolute paths: a drive letter prefix, no UNC (`\\server\share`), no device namespace (`\\.\` and `\\?\` prefixes), no control characters, no reserved device names (CON, PRN, AUX, NUL, COM1 to COM9, LPT1 to LPT9) as a path component, no colon after the drive. Line and column are safe integers from 1 to 1,000,000, else 1. It stats the path: a file opens as a text document with the selection and reveals in the Explorer; a directory only reveals; anything else warns once. No shell, no openExternal, no command from the page.
3. Relative paths (mentions, diff titles) are out of slice 1. The script does not intercept them, so T3's preview still handles them. They come back when the panel knows the thread root (Piece 3).
4. Port: the extension tries the stored port, else the fixed default 47730, at 127.0.0.1. On EADDRINUSE it binds port 0 and keeps that port in memory for this window (reused when the forwarder is recreated), never stored. The port is stored only when the window bound the default or the stored one. A window that lost the race keeps a random origin for its lifetime; documented limit.
5. Injection only for: GET, `sec-fetch-dest: iframe`, status 200, `content-type` text/html, no content-encoding. Buffer up to 2 MB; on cap or no `<head>` replay the held chunks and stream the rest unchanged with the original headers. Content-Length via Buffer.byteLength; drop transfer-encoding, content-length, etag and last-modified on a rewrite.
6. Script click gate adds `event.isTrusted`. The panel accepts exactly `{type: 't3vscode:open-file'}` from the T3 iframe's contentWindow with the forwarder origin and builds a fresh `{cmd: 'openFile', path, line, column}`; nothing else from that source.
8. Persistence across Reload, forwarder recreation and VS Code restart is an owner acceptance check; the isolated probe (HANDOFF 5.2) already showed restart persistence for an http iframe in a webview.
10. The picker hint leaves the panel. The session card says instead: "File links in the chat open here in VS Code."

## Verification (lead's verifier), 2026-10-12

Commit `e4340c4`. Own probes in `%LOCALAPPDATA%\Temp\t3probe\verify1\` (p1 to p6), live nightly `.3010` on :3773, GETs only with `Bearer invalid`.
Existing selfchecks rerun: 42 + 29 + 11 + 13 PASS.

Failures first:
- FAIL decision conflict, t3.js:168 vs extension.js:23-26: the script accepts any `/`-rooted href (probe: `/etc/passwd` and `//server/share/f.txt` are posted and the click is cancelled), the extension accepts drive-letter paths only. On this Windows host every `/`-rooted chip (WSL thread, Linux remote environment) loses T3's own preview and only gets a warning. Lead decisions 1 and 2 disagree; both are implemented as written. Fix: drop `|\/.*` from the script regex, or accept POSIX in the extension on non-Windows hosts.

1. Live forwarder (port 47731, `Bearer invalid`):
- PASS iframe GET `/` with gzip accepted: 200, `<script>(function injected()` directly after `<head>`, content-length 21316 = bytes, no content-encoding, no transfer-encoding, no etag or last-modified.
- PASS frame-ancestors CSP header present on the rewritten page.
- PASS rewritten body minus the script equals a direct upstream GET byte for byte (sha256 prefix 479572775bce).
- PASS same GET without sec-fetch-dest: gzip passed through, decoded body equals upstream, no script.
- PASS `/assets/index-DG_PEzRo.js` with dest script: same encoding and same wire bytes as upstream (953188899a21).
2. Script in vm (own stubbed window):
- PASS `D:\x\a.ts:12:3` posts `{type, path, line 12, column 3}` to parent with `*`, preventDefault and stopPropagation called; listener is capture phase.
- PASS `C:/x/y.js` posts; `D:\x\a.ts` posts line and column undefined.
- PASS ignored, not cancelled: stream `D:\x\a:b.ts` (also with `:4`), thread chip (also with a drive-path href), relative `src/a.ts`, ctrl, meta, shift, alt, middle button, isTrusted false.
- PASS composedPath missing: no throw, nothing posted.
- PASS nesting: the nearest `a` or `button` in the composed path decides (chip inside a button: chip wins; button inside the chip: button wins, ignored). Matches T3 at d83929ad: the chip is the `a` itself (ChatMarkdown.tsx:2222-2248, ContextChip render prop) and FileTagChip.tsx has no nested `a` or `button`.
- PASS key seeded only when absent; an existing `false` stays `false`. Run-once guard, top window and same-origin parent install nothing. INJECT contains no closing script tag or `<!--`.
3. Extension `localFilePath` and openFile (stubbed vscode):
- PASS rejected: `\\server\share\f.txt`, `\\.\COM1`, `\\?\C:\x`, `C:\x\NUL`, `C:\x\nul.txt`, `C:\x\COM1 ` (trailing space), `C:x\y`, `C:\a:b\c`, a NUL byte, `src/a.ts`, `/etc/passwd`, `//server/share/f.txt`.
- PASS accepted: `D:\GIT\t3-vscode\t3.js`; `d:/git/x/y.js` normalised to backslashes; `D:\..\..\x` clamps to `D:\x`; a 5000-character path passes through to stat.
- PASS directory reveals only; file shows at 0-based (11, 2), preview false, then revealed; line 0, 1e9, 'x', NaN, -3, 2.5 become line 1.
- PASS missing file: exactly one warning, nothing opened or revealed; UNC paths are never statted.
4. Port rules (stubbed globalState and a port-aware forwarder stub, plus the real forwarder):
- PASS fresh state binds 47730 and stores it; a second window gets a random port, stores nothing, reuses that port on recreation.
- PASS stored 0, 'x', 70000, 80, 1.5 treated as absent (47730 bound and stored); a stored valid port that is taken falls back and is kept.
- PASS real forwarder on Windows: rebinding the same port right after close() works, with TIME_WAIT rows and an open keep-alive socket.
5. Panel gate (client script extracted from page.render of a paired state, run in vm):
- PASS right type, frame contentWindow and forwarder origin posts a fresh `{cmd:'openFile', path, line, column}`; extra fields and `cmd` from the page are dropped.
- PASS ignored: other source, other origin, host origin without the frame source, unknown types from the frame, `error` from the frame. Host `busy` and `error` still work.
6. Hold path (fake upstream, not T3) and code reading:
- PASS upstream cut while held: client gets a socket error in about 120 ms, no hang. Client abort while held closes the upstream request.
- PASS HTML over 2 MB streamed unchanged; no `<head>`: original body and etag kept. HEAD is never rewritten (code reading, t3.js:232 requires GET).
- PASS lean: no extra layers or options; the diff is what decisions 1 to 10 ask for. Selfcheck additions cover the security and stream paths only.
- PASS page reach: the T3 frame can only send the one openFile message; it cannot reach acquireVsCodeApi or the host-origin branch.

Risks, not failures:
- t3.js:249: an upstream that never ends while held sends the client no headers at all (probe: hung until the client's own 3 s timeout). Same hang class as a stalled stream; no forwarder timeout exists.
- SPA fallback and T3's HTML previews served through the forwarder also get the script (probe: iframe GET `/assets/nope.js` is rewritten). Harmless there (parent is T3's page, panel gate rejects), but user HTML previews are modified.
- localStorage throwing does not stop the listener (matches Codex 9; design step 1 text says otherwise).
- `CONIN$`, `CONOUT$` and `COM` with a superscript digit pass `localFilePath`; outside lead decision 2's list, low risk.
- stat follows symlinks and junctions: a local link to a UNC target still reaches the share (Codex 2, not in decision 2).
- No rate limit on openFile: a hostile page can open many tabs or warnings.
- A chip from a remote Windows environment with the same drive path opens the local file of that name; waits for the thread-root work in Piece 3.
- stopPropagation at window capture does not stop T3 listeners on window itself (would need stopImmediatePropagation); none seen that act on chips.

## Code review (Codex), 2026-10-12

Target: `e4340c4`, with the Lead decisions above controlling slice 1. At review time HEAD was `126a347`; the six reviewed code/selfcheck files had no difference from the target. Upstream reference remained `d83929ad`, tracked status clean, and T3-UPDATES had no unreviewed block. Assumed load: one owner's Windows VS Code, including simultaneous windows. The lead verifier's section was re-read and preserved before this append.

### Closure of the 10 design findings

| Original finding | Status | Evidence and remaining scope |
|---|---|---|
| 1. Thread-chip selector collision | fixed | `t3.js:160-168` requires the nearest link/button to be a context-chip anchor, excludes Thread labels, and checks the raw path. Buttons and inner non-chip anchors win over an outer chip. |
| 2. Extension path boundary | partly | `extension.js:23-28,31-48` rejects direct UNC/device namespaces, drive-relative paths, streams, controls and ordinary reserved names, clamps positions and uses text opening plus one fixed reveal command. Windows device aliases and resolved-link locality remain incomplete; findings 2 and 9 below. |
| 3. Relative roots and basename guessing | fixed for the revised slice | `t3.js:163-168` leaves relative mentions/diff titles alone. No first-existing-workspace or recursive basename lookup was added. Absolute targets that do not exist warn (`extension.js:34-38`). Remote absolute paths still need provenance when Piece 3 is built. |
| 4. Shared preferred port and fallback | fixed | `extension.js:183-190` validates the shared value, chooses fixed default 47730, retains this window's fallback and stores no fallback. `t3.js:322-335` retries only EADDRINUSE. Invalid values and simultaneous real binds were probed. |
| 5. HTML compression, buffering and headers | partly | `t3.js:209,227-249` implements the revised GET/iframe/200/unencoded gate, capped replay and byte length. CSP survives. Delayed multi-chunk replay and abort/error probes passed. Attachment mutation and a stalled held response remain; findings 4 and 5. |
| 6. One upward message with source/origin checks | partly | `panel.js:105-112` gates on this frame's window and exact URL origin, builds a fresh object and preserves the host-message whitelist. Executed negative probes passed. It coerces malformed fields instead of checking their types; finding 3. |
| 7. Menus, composer and diff interaction | partly | The nearest link/button rule and trusted/plain-click gate work in executable VM probes (`t3.js:156-173`). Relative composer mentions and diff titles stay with T3 by lead decision 3. Real menu/popover, draft selection and keyboard behavior were not exercised. |
| 8. Storage persistence proof | partly | Lead decision 8 correctly keeps this as an owner gate. Port code is present, and prior isolated evidence is recorded above; this run did not test panel Reload, forwarder recreation or VS Code restart in a real webview. |
| 9. Toast seed and isolated failure handling | fixed | `t3.js:148-154` catches the expected parent-origin exception separately and isolates localStorage failure from listener installation. Only the absent v1 key is seeded with JSON true. The seed is before the module in the rewritten live HTML. |
| 10. Small scope and picker hint | partly | `panel.js:139` removes the picker instruction; no bridge emulation, relative resolver, popup closer or diff-line interceptor was added. Text-open failures are silent outside the log, and the new panel selfcheck overstates behavioral proof; findings 6 and 7. |

### Findings

1. **blocks: the script cancels paths that the extension cannot handle.** `t3.js:168-171` accepts every slash-rooted path, while `extension.js:24` accepts drive-letter paths only. Executing INJECT with `/home/u/a.ts:2` cancels the click and posts `/home/u/a.ts`; localFilePath returns null. `//host/share/a.txt` is also cancelled and refused. A Linux/WSL thread loses its working T3 preview and gets a warning instead. This is the conflict between lead decisions 1 and 2, independently reproduced here and by the lead verifier. **Fix:** for this Windows slice, remove the POSIX alternative from the injection regex, leaving unsupported paths untouched. Do not add POSIX resolution to Windows or reinterpret a remote path as a local one. Change the current POSIX-post assertion at `scripts/selfcheck.mjs:545-547` to assert no post and no cancellation, and include a double-slash case.

2. **should fix: the device-name filter misses Windows superscript aliases.** `extension.js:26` rejects COM/LPT followed by ASCII digits only. Probes returned a normalized path for `C:/x/COM¹.txt` and `C:/x/LPT².txt`, allowing them to reach stat at `extension.js:34`. Windows reserves COM/LPT with superscript 1, 2 and 3, including when followed by an extension; see [Microsoft's file naming rules](https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file). No device was statted or opened in this run; the observed defect is the pre-I/O guard. **Fix:** extend these two digit classes with `\u00b9`, `\u00b2`, `\u00b3` and extend the existing bad-path list at `scripts/selfcheck-ext.mjs:296-301`. Ordinary `NUL.txt`, `CON .txt` and `nul... ` are already refused. Do not add arbitrary rejection of all short names or all long paths.

3. **should fix: the panel converts malformed input into valid paths and positions.** `panel.js:110` uses String and Number. An executed message with `path: ['C:/a.ts']` and `line: ['8']` passes the correct source/origin gate and becomes a valid string path and line 8. This does not add a second command channel, but it defeats the declared typed message boundary. **Fix:** require a string path; copy optional numeric position fields without coercion and let the extension's existing position clamp apply. Keep constructing the fixed openFile object and returning from that branch. Executed probes rejected wrong origin, source and type, and a missing frame safely ignored the message. The iframe is parsed before the bottom-of-body client script (`panel.js:140,169-172`), so capturing it once is correct for these static renders. A fake invalid frame.src made new URL throw, but no production path creates such a src; this is not a demonstrated browser bug or a reason for a frame observer.

4. **should fix: an upstream that stalls below the cap leaves the shell navigation pending indefinitely.** `t3.js:234-249` sends headers only on end or when the byte cap is crossed; this request path has no timeout. A fake upstream sent headers and 12 bytes, then remained open. The client received no headers and settled only at the probe's own timeout. Socket truncation is different: destroying the upstream after partial HTML produced ECONNRESET promptly, and client abort closed the upstream request. **Fix:** bound the hold phase for eligible HTML navigations only. On timeout, cancel the upstream and finish with a controlled pre-header failure; clear the timer on end, cap fallback, error and client close. Do not impose this timer on ordinary streaming responses or WebSockets.

5. **should fix: an iframe HTML attachment is rewritten instead of passed through.** `t3.js:232` does not exclude Content-Disposition attachment. A real fake-upstream GET carrying `attachment; filename="a.html"` returned an altered downloaded body containing INJECT while retaining the attachment header. The revised lead gate is implemented, but it is broader than the app shell. **Fix:** exclude attachments from the rewrite condition and add that one passthrough case to `scripts/selfcheck.mjs:461-490`. Preserve the existing sandbox/CSP headers for preview responses. Current T3 normally gives HTML downloads a non-HTML type (`reference/t3code/apps/server/src/http.ts:111-118` at `d83929ad`), so the attachment defect was observed against a controlled upstream, not a current nightly download. Non-iframe gzip fetches already remain untouched.

6. **should fix: a failed text open or reveal has no visible result.** `extension.js:48` only logs caught errors. In an executable extension probe, stat returned File and showTextDocument threw a text-open error; the warning count stayed zero. The injection has already prevented T3's preview, so the user sees a dead click. This matters for binary/media files and files removed between stat and open. **Fix:** keep the log and show one plain warning from the catch. Continue using text opening and the fixed reveal command; do not add a custom media viewer. Extend `scripts/selfcheck-ext.mjs:304-325` with a failing open/reveal case instead of treating a successful stub as proof that every media file opens.

7. **should fix: the new panel test checks spelling, not the security behavior it reports.** `scripts/selfcheck-panel.mjs:83-87` searches the generated HTML for literal source strings and then reports that only the correct frame can send openFile. It never invokes the listener. The transport tests at `scripts/selfcheck.mjs:461-490` do exercise real HTTP, and the injection test at `:517-553` executes INJECT, but neither closes this panel gap. **Fix:** run the extracted client in a VM in the existing panel selfcheck and drive valid, wrong-source, wrong-origin, wrong-type, malformed-field and absent-frame messages. Retain useful HTML escaping/CSP assertions. Add held no-head, upstream-cut and client-abort probes to the existing forwarder check; its get helper at `:23-31` must settle on response error/aborted as well as end before adding those cases, otherwise a truncated response after headers can hang the test. No new test file is needed. The real interaction/storage checks remain separate acceptance gates.

8. **should fix: the new thread-chip dependency is absent from the drift registry.** The script depends on the `Thread` accessible-label prefix at `t3.js:165`; its upstream owner is `reference/t3code/apps/web/src/components/ThreadContextChip.tsx:24-27` at `d83929ad`. `t3-facts.json:9-23` registers generic chip shape, file links, mentions and other injection surfaces but contains no ThreadContextChip entry. A nightly label change in that file can therefore escape the required targeted review. **Fix:** add one fact for that path and a fixed source string such as `aria-label={\`Thread, ${title}\`}` with the fix commit. Existing entries for deferred mentions/diffs can remain until Piece 3; do not invent a generalized DOM compatibility layer.

9. **note: localFilePath is a lexical filter, not proof that the resolved target is local.** `path.win32.normalize` at `extension.js:25` does not inspect links or mapped drives. The stat/open sequence at `:34-45` follows the OS target and accepts File | SymbolicLink: a stub returning type 65 was opened and revealed. A benign, real temporary junction had a symbolic-link parent but a regular-file child, confirming that checking only the final File flag cannot detect that ancestor. No UNC target, mapped drive or real network share was probed. **Fix:** document this residual limit explicitly; if the promise remains "never contact a share", reject remote drive roots and inspect reparse prefixes before following them or calling stat on the final target. A realpath call alone is not a pre-I/O network barrier. This is outside the lead's enumerated string checks and should not be called fixed by the existing UNC-string test. Root `C:\` is a valid directory under the chosen reveal-only rule; `C:` is refused. The probe also found no validation-level reason to reject an ordinary 8.3 alias or a long local path. Temporary trailing-dot/space lookups returned ENOENT on this Node/filesystem, so no device bypass or incorrect open through those variants was established.

10. **note: the held-body transition, CSP and port lifecycle survived the focused probes.** `t3.js:236` removes hold/done listeners and immediately pipes synchronously; there is no asynchronous gap between off(data) and pipe. A delayed 2,300,043-byte response, sent in many 7301-byte chunks, arrived exactly with its final tail. No-head replay retained bytes and etag. Rewrites drop transfer-encoding, old content-length, etag and last-modified, set the new byte length, retain Content-Type and upstream CSP and add the frame-ancestor restriction (`t3.js:221-245`). Client abort and upstream truncation while held did not hang or double-send headers. Live iframe GET `/` on .3010 changed 19493 bytes to 21316 with the script and CSP; a non-iframe GET retained gzip and its 5028 wire bytes. Invalid globalState values, valid boundary ports, and simultaneous real binds behaved as intended; fallbackPort is module memory for this extension-host lifetime, never globalState (`extension.js:19,183-190`). **Fix:** retain this simple implementation, subject to findings 4 and 5, and keep these observed cases in the existing checks. Do not add a decompressor, shared proxy broker or cross-window file dispatcher.

Checks: all four offline selfchecks passed with T3VSCODE_HOME pointing to fresh temporary directories: selfcheck 42, MCP 29, panel 11, extension 13. Offline suites used their own fake servers/stubbed credentials; no POST, CLI call, real token or write was made against T3. Own probes used Node stdin, controlled local servers/VMs and harmless temporary files; live nightly probes were GET only with invalid authorization. The first combined script/panel probe failed to parse and ran no probe body; corrected extraction passed. `git show e4340c4:README.md` failed because the file does not exist; the caller search after that command did not run in that invocation and was subsequently run separately. Real VS Code clicks, keyboard/menu behavior, binary text-opening behavior and storage persistence were not verified in this run.

Verdict: fix finding 1 before calling slice 1 ready; address findings 2 to 8 in the narrow fix pass, retain the documented limits in 9, then run the real click and storage acceptance checks.

## Code review 2 (Codex), 2026-10-12

Re-reviewed `fcca65e`. The reviewed files on HEAD `7cfa039` match that commit. Reference remains `d83929ad` with clean tracked files; no unreviewed nightly block. Re-read this file immediately before appending and preserved both earlier reviews and the verifier's section.

1. **fixed:** POSIX `/home/u/a.ts:2`, double-slash `//host/share/a.txt` and relative hrefs are neither cancelled nor posted. A Windows drive path still posts the correct line/column. Own executable INJECT probe passed (`t3.js:166-172`).
2. **fixed:** all three superscript digits in COM/LPT names, including extensions and lowercase variants, are refused. CONIN$, CONOUT$ and their extension forms are also refused. Own validator probes passed without touching devices (`extension.js:25-28`; `scripts/selfcheck-ext.mjs:294-302`).
3. **fixed:** the executed panel client ignores array paths, copies numeric positions unchanged, omits string/array positions, drops extra fields, and rejects wrong source/origin. No coercion remains (`panel.js:105-114`).
4. **fixed:** a real controlled upstream stalled while held; with holdMs 120 the forwarder returned a complete 504 and its plain text message, then closed the upstream. Own probes also confirmed that upstream truncation and client abort settle promptly, and cap fallback cancels the timer so a tail delayed beyond holdMs still arrives (`t3.js:242-265`). The production default remains 15000 ms (`t3.js:181,186`).
5. **fixed:** an iframe HTML attachment passes through with identical bytes, disposition and etag. Ordinary shell HTML is still injected, with the new byte length, old validators removed, upstream CSP retained and frame-ancestors added. Own HTTP probes passed (`t3.js:232-237,250-260`).
6. **fixed:** own executable extension probes made text opening and Explorer reveal fail independently. Each failure logged and showed one warning; failed text opening did not reveal anything (`extension.js:45-55`).
7. **fixed:** the panel selfcheck now executes the generated client in a VM and drives valid, foreign, malformed and missing-frame messages, rather than asserting source spelling. The expanded forwarder selfcheck exercises real attachment, no-head, truncation, abort and timeout paths (`scripts/selfcheck-panel.mjs:85-116`; `scripts/selfcheck.mjs:463-525`). Own independent client/HTTP probes passed too.
8. **fixed:** the thread-chip fact exists and its exact string matches ThreadContextChip.tsx in reference commit `d83929ad`; verified directly (`t3-facts.json:11`).
9. **partly, intentionally documented:** the code now states that localFilePath is lexical and not a network barrier (`extension.js:23-24`). Link/junction/mapped-drive target resolution remains unchanged, as accepted for this slice. No real share, device or remote target was accessed; this limit is not a claim of network isolation.
10. **fixed, verifier extra:** own controlled-clock probes confirmed that requests within 300 ms are dropped before stat/open/warning, and a request at exactly 300 ms is admitted (`extension.js:33-36`). This also limits failure warnings. Rapid legitimate clicks can still be dropped by the chosen rule.

Checks: all four offline commands passed with T3VSCODE_HOME set to fresh temporary directories: `node scripts/selfcheck.mjs` 47, `node scripts/selfcheck-mcp.mjs` 29, `node scripts/selfcheck-panel.mjs` 11, `node scripts/selfcheck-ext.mjs` 14. No WARN output or failed commands. Independent probes used Node stdin, VM stubs and controlled local servers. Live nightly GET `/` through the forwarder returned 200, INJECT, exact Content-Length 21435 and frame-ancestors; the non-iframe GET kept gzip and 5028 wire bytes. No POST, CLI call, real token or write was made against T3; no code or reference files were edited. Real VS Code clicks, menus, keyboard behavior and storage persistence remain owner acceptance checks.

Verdict: ready for the owner's real click test; no remaining blocker in the reviewed slice, with the documented locality and rapid-click limits retained.
