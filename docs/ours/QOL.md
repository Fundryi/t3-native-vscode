# Quality of life: the small things the Claude Code and Codex extensions have

Owner, 2026-10-12 evening: scope the "small quality-of-life things" in detail. Research only, no code. One section per item, the ordered list at the end.

Sources. T3 source: `reference/t3code` at `7b6d9075` (tag `v0.0.46-nightly.20261012.3021`); paths below are under it. The live server reports `0.0.46-nightly.20261012.3010` (GET of the bundles, 2026-10-12); the T3 selectors the designs act on were found in the live bundles too (`PanelLayoutControls-*.js`, `_chat-*.js`, `main-*.js`, `ComposerPromptEditor-*.js`). VS Code facts: read from the installed VS Code 1.141.0 build (minified `out/vs/workbench/workbench.desktop.main.js` and `out/vs/workbench/contrib/webview/browser/pre/index.html`), so they are certain for that version and may move with VS Code updates. Claude Code 2.1.296 and Codex 26.51007 facts: their `package.json`.

Every new message below must reach all the places the existing ones do: the injected script (t3.js `injected()`), the panel's `fromFrame` branches and its extension-type whitelist (panel.js, the `e.origin !== location.origin` line), the panel.js header comment, and `onDidReceiveMessage` in extension.js. Every T3 surface gets a `t3-facts.json` entry in the same commit.

## 1. Drag a file or folder from VS Code into T3's composer as a reference

**What the owner sees.** Shift+drag a file or folder from the Explorer or an editor tab onto the T3 panel: a T3 mention chip (the same chip T3's own file tree drag makes) appears in the composer. Also, without dragging: right-click a file in the Explorer or an editor tab, "T3: Add to prompt" (Codex has `addToThread` in `editor/context` and `addFileToThread` in `editor/title/context`).

**VS Code facts (certain for 1.141.0).**
- During any workbench drag VS Code sets `pointer-events: none` on every webview; on `drag`/`dragover` with Shift held it sets them back to `auto` (class registering DRAG_START/DRAG_OVER that calls `windowDidDragStart`/`windowDidDragEnd`, `_startBlockingIframeDragEvents`). So without Shift the drop never reaches the panel; VS Code's editor area takes it. Shift is the same rule Claude Code documents.
- **Correction 2026-10-14, final (night).** A Shift-drag from the Explorer or a tab into any webview worked up to VS Code 1.139.1 and is blocked since 1.140.0 (2026-09-30): Electron 43.7.0 re-enabled Chromium's rule against drags between cross-site frames of one page (electron/electron#53669, crbug.com/59081; Electron had patched it out since 2017). Shift only lifts VS Code's `pointer-events: none` on the webview iframe (webviewWindowDragMonitor.ts); then Chromium refuses the drop. Every extension is hit (microsoft/vscode#339278, Kilo-Org/kilocode#14737); no switch exists. Confirmed by a real-mouse drag on 2026-10-14 (Claude Code's side bar: iframe unblocked, zero events) and by the owner. `scripts/verify-drag.mjs` skips the browser-side check (CDP). Drags from outside VS Code (Windows Explorer) still land; Codex takes those with no key. So the ways in are the "Drop files here" tree view and Ctrl+C then Ctrl+V, until Electron or VS Code change it. Sources: FORK-FEATURES I.
- What a drag from the Explorer or a tab carries (`fillEditorsDragData`, minified `GS`): `text/plain` = the resources' path labels joined by newlines (absolute paths); `DownloadURL` = `application/octet-stream:<name>:<file uri>` for the first file; `ResourceURLs` = JSON array of file URIs, files only; `CodeEditors` = editor inputs; `text/uri-list` = the first resource only; `application/vnd.code.uri-list` = all resources, folders included. No `Files` type (no OS file drag), so T3's upload drop (`apps/web/src/components/chat/workspaceFileDrop.ts:25-27`, wired at `components/ChatView.tsx:11460`) ignores it. Browsers lowercase type names (`resourceurls`).
- The webview's pre page listens for drag events only on its own window and on our panel document (`pre/index.html` 913-916, 1219-1222). A drop over the T3 iframe is an event of the T3 document only; the panel page never sees it.
- **Live check (still open):** whether the cross-origin T3 frame can read `application/vnd.code.uri-list` on drop (Chromium may hide custom types across origins; `text/plain` is then the fallback source), and which `dropEffect` the drag accepts (T3's comment at `composerMentionDrag.ts:79-80`: a wrong effect makes the browser cancel the drop).
- **Zero-code behaviour today (live check):** a Shift-drop exactly on the editor likely inserts the `text/plain` absolute path as plain text (ProseMirror's default drop; T3's Tiptap editor sets no `handleDrop`, only `handlePaste` at `components/ComposerPromptEditorTiptap.tsx:1391`).

**T3 facts.**
- T3 already has a mention drag type: `COMPOSER_MENTION_DRAG_TYPE = "application/x-t3code-composer-mention"` (`components/chat/composerMentionDrag.ts:8`). Its handlers claim the event in the capture phase and call `insertMentionAtEnd(mention + " ")` (:55-96). They are wired on the composer form with `onDropCapture` (`components/chat/ChatComposer.tsx:6742-6745`, form has `data-chat-composer-form="true"`, :6747) to `insertComposerTextAtEnd(text, { ensureLeadingBoundary: true })` (:6273-6274, :6240). React handlers do not check `isTrusted`, so a script-dispatched `drop` with a constructed `DataTransfer` takes T3's own flow.
- The payload is a markdown file link: `serializeComposerFileLink(path)` = `[<basename>](<encodeURI(path) with ( ) # ? \ escaped>)` (`packages/shared/src/composerTrigger.ts:34-37`, encoding :26-32). The parser accepts relative and Windows absolute paths and requires label === basename (`packages/shared/src/composerInlineTokens.ts:52-90`, drive rule :57). T3's tree emits relative paths and strips a trailing slash for folders (`composerMentionDrag.ts:10-16`).
- The chip renders as `span[data-composer-mention]` with a button `aria-label="Preview <path>"`, `data-composer-mention-chip="true"` (`ComposerPromptEditorTiptap.tsx:239-273`).
- Why not the `@` trigger: it means typing into ProseMirror and picking a row in T3's autocomplete popup (`detectComposerTrigger`, `packages/shared/src/composerTrigger.ts:55`), the same fragility as the palette flow in PROJECT.md, while `application/x-t3code-composer-mention` is a contract T3 made for drops from outside the editor.
- Paste also builds chips: `handlePaste` runs the same token parser and inserts chips at the caret (:1391-1460). A trusted Ctrl+V of a mention string always works.

**Design (smallest).** One message, three producers.
1. The extension builds the mention text, never the page: `localFilePath` check, then a path relative to the shown thread's root (its worktree when it has one, else its project root) with `/` when inside it (matches T3's tree), else absolute, so a main-checkout file mentioned in a worktree thread is read as that exact file (Codex review 2026-10-13); then T3's link format. Folders allowed.
2. `{type:'t3vscode:mention', text}` extension -> panel -> frame. The script dispatches `new DragEvent('drop', {bubbles:true, cancelable:true, dataTransfer})` with `dataTransfer.setData('application/x-t3code-composer-mention', text)` on `[data-chat-composer-form]`. Canceled (T3 claimed it) = ok. Not canceled or no form: reply `{type:'t3vscode:mention-result', ok:false}`; the extension then puts the text on the clipboard and says "Press Ctrl+V in T3's composer" (fallback, T3's paste makes the chip). Last resort shown in the same note: the relative path as plain text.
3. Producers: command `t3vscode.addToPrompt` in `explorer/context` and `editor/title/context` (certain, first slice); item 4's selection command; and the drop: the script adds window capture listeners for `dragover` and `drop` that act only when the types include `application/vnd.code.uri-list` or `resourceurls`: `preventDefault` on dragover anywhere in the page (else only drops exactly on the editor are accepted), and on drop `preventDefault` + `stopPropagation`, read `application/vnd.code.uri-list` (else `text/uri-list`, else `text/plain` lines), post `{type:'t3vscode:dropped', uris}` up. The extension validates and answers with step 2.

**Effort.** Base (command, menus, relay, script insert): M (about 80 lines). Drop on top: S (about 25). **Risks.** Untrusted drop path depends on T3 not adding an `isTrusted` check; mention inserted at the end, not at the caret (T3's choice); Chromium cross-origin drag data. **Recommendation:** build the command first (certain), drop second after one live check that logs `e.dataTransfer.types` in the frame on a Shift-drop.

**Images, pasted paths and the Shift rule (built 2026-10-13).** A dropped, pasted or "Add to prompt" local gif, jpeg, png or webp of at most 10 MiB goes in as a T3 image attachment, not a link: the extension reads the bytes and sends `{type:'t3vscode:attach', files:[{name, type, data}]}` (base64; the panel relays it whole), and the script dispatches a `drop` whose `DataTransfer` holds the `File`s on `[data-chat-workspace-drop-target]`, T3's own OS file drop (`workspaceFileDrop.ts` checks only the `Files` type, `addDroppedFiles` attaches). T3 attaches nothing on a page without a thread (a fresh New thread draft), so there, and for a larger image, the file goes in as a link with one log line. Pasting text in the composer whose every line is an absolute Windows path (VS Code's Copy Path, Shift+Alt+C) makes chips the same way instead of raw text; anything else is T3's paste. VS Code blocks every drag over a webview unless Shift is held, and a Ctrl+C of an Explorer file writes only VS Code's private clipboard; both hold for every extension, so plain drag without Shift and Ctrl+V of a copied Explorer file can never reach T3. When a file drag enters the panel and leaves it within 500 ms (it bounced off that block), a note says to hold Shift, at most once per 5 s; it can only fire when the drag reaches the panel at all (OS file drags do, Explorer drags may not).

## 2. Hide T3 chrome that makes no sense inside VS Code

**What the owner sees.** No terminal button at T3's top right. Nothing else changes until the owner asks.

**Candidates (by meaning, all live in the bundles).**
| Control | Element | Hide? |
|---|---|---|
| Terminal drawer toggle | `[data-panel-layout-controls]` > tooltip `span` > Toggle `aria-label="Toggle terminal drawer"` (`components/chat/PanelLayoutControls.tsx:88-93`) | **Yes.** The drawer still opens with T3's `mod+j` (`packages/shared/src/keybindings.ts:127`); nothing we use needs the button |
| Right panel toggle | `aria-label="Toggle right panel"` (:110-115) | No: it holds the diff panel (SYNC row 12) and T3's file and browser previews |
| Thread details toggle | `aria-label="Toggle thread details panel"` (:54) | No: branch, worktree, PR info |
| Main sidebar toggle | `aria-label="Toggle main sidebar"` (`components/AppSidebarLayout.tsx:160`, `components/sidebar/SidebarChrome.tsx:65`) | No: T3's settings and other projects live there; our quick pick only covers this project |
| "Open in" editor group | `role="group" aria-label="Open in editor"` (`components/chat/OpenInPicker.tsx:391`, used in `ThreadDetailsPanel.tsx:125`, `files/FilePreviewPanel.tsx:1276`) | Candidate, owner decides: with editor `vscode` it runs `code <path>` and lands in VS Code anyway (INJECT.md); redundant, not broken |
| "Open in system browser" (preview) | `aria-label="Open in system browser"` (`components/preview/PreviewChromeRow.tsx:221`) | No |

**How.** The script appends one `<style>` to `document.head` (no CSP for styles; the forwarder adds only `frame-ancestors`, t3.js `startForwarder`). One allow list, one rule, no MutationObserver (CSS applies to future nodes): `var HIDE = ['Toggle terminal drawer'];`, and for each label L the rule `span:has(> [aria-label="L"]), [aria-label="L"] { display: none !important; }`. The `:has` part removes the empty tooltip wrapper so no gap is left (the wrapper is a `span.flex`, :88). Labels are fixed strings in our code, never page data.

**Facts for t3-facts.json:** `{ "id": "hide-terminal-toggle", "used": "inject: hidden by aria-label", "path": "apps/web/src/components/chat/PanelLayoutControls.tsx", "grep": "aria-label=\"Toggle terminal drawer\"" }` and `{ "id": "hide-terminal-wrapper", "used": "inject: wrapper span removed with :has", "path": "apps/web/src/components/chat/PanelLayoutControls.tsx", "grep": "render={<span className=\"flex shrink-0\" />}" }`. A renamed label only makes the button reappear.

**Effort** S (about 8 lines). **Risk** none beyond the button showing again after a rename. **Recommendation:** build now; keep the list to the terminal toggle.

## 3. Remember where the owner was across restarts

Read from the code (t3.js `latestThread` :224-228, `ensureProject` :264-307; extension.js `remember` :142-145, `location` handler :126-131, `refresh` :253-266):
- **VS Code restart, Reload, folder change:** covered. `refresh` reads `workspaceState` key `t3vscode.thread.<normalized root>` and passes it as `preferThread`; the iframe opens on that thread.
- **T3 restart while the panel is open:** covered. Three dead upstream answers close the forwarder and call `refresh` (extension.js `upstream`), which uses the stored thread; while T3 is down the poll refreshes when it is back. A quick restart keeps the page and T3's own socket reconnects.
- **Hide and show the panel:** covered by `retainContextWhenHidden: true` (extension.js :384).
- **A thread of another project picked (quick pick or T3's sidebar): not covered.** The `location` handler stores any thread of the same environment under the bound key, but `latestThread` keeps only threads with `projectId === projectId`, so a restart lands on the newest thread of the bound project instead.
- **Also missing:** `remember` is skipped while `bind.env` is null (when `threadsFor` failed in `refresh`), so locations are lost for that render.

**Fix (S, about 6 lines).** Accept `preferThread` when it is one of this window's threads as NAV.md section 2 defines them (bound project, projects inside the folders, worktrees inside the folders), not any open thread: SYNC.md "Follow, do not fight" says the panel sets T3's project when it opens, so a restart must not land in an unrelated project; and the quick pick offers exactly that set, so a thread outside it would make the toolbar title read "No thread". Smallest shape: in `refresh`, run `threadsFor` before `ensureProject` (its `project` is the normalized folder, the same value `bind.root` normalizes to) and pass the ids it returns; `latestThread` takes `preferThread` when it is in that set, else falls back to the bound project as today. New thread still targets the bound project (its header label check fails, the palette path takes over, NAV.md section 1). For the env gap: return the environment id from `ensureProject` (it already fetches it for the path) and set `b.env` from it.

## 4. Selection into the prompt (SYNC row 4)

**What the owner sees.** Select lines, press Alt+K (Claude Code's `insertAtMention`, when `editorTextFocus`): the T3 panel shows, the composer gets a chip for the file followed by `lines 12-30`, focus lands in the composer. No selection: the file chip alone.

**How.** Command `t3vscode.addSelection` builds `[a.ts](src/a.ts) lines 12-30` (1-based, one line = `line 12`) and sends it through item 1's `t3vscode:mention` flow, then item 7's focus. **T3 fact:** T3 has no line-range mention: chip paths are plain paths, and a `path:12-30` chip would fail its own preview. Line-scoped references in T3 are context references `[label](t3-context://v1/<kind>/<id>)` (`packages/shared/src/composerContextReferences.ts:11, 26-59`) that need a record in T3's draft store, which the page keeps private. So: chip plus plain text. Optional (owner decides): the selected text as a fenced block after it (long selections bloat the prompt; agents can read the file).

**Effort** S on top of item 1 (about 25 lines plus a keybinding). **Risk:** that `insertComposerTextAtEnd` keeps the trailing words as text (live check). **Recommendation:** with item 1; on a command (SYNC open question, lead: command first).

## 5. Thread status in VS Code

**What the owner sees.** The existing `T3` status bar item reads `T3: running` (spinner), `T3: needs you` (warning colour) or `T3` when idle; the tooltip names the threads. When a thread of this project needs the owner and the panel is hidden or the window unfocused: one notification "T3: <title> waits for approval" with "Show", which focuses the panel on that thread. Optional: "done" and "failed" notifications under the same rule.

**T3 facts.** `GET /api/orchestration/shell` (same call as `threadsFor`, bearer and `x-t3-orchestration-protocol: 2`). Per thread (`packages/contracts/src/orchestrationV2.ts`, shell thread :1927-1995, JSON variant around :2506-2508): `status` = `idle` or a run status `preparing|queued|starting|running|waiting|completed|interrupted|failed|cancelled|rolled_back` (:1904-1907, :455-466); `activeRunId` (:1951); `activityRunStatus` (:1957); `pendingRuntimeRequest` = `{id, kind, createdAt}` or null, kind `command|file-read|file-change|mcp-elicitation|permission|dynamic_tool_call|user_input|auth_refresh` (:1964, :1910-1914, :1119-1122, `providerPolicy.ts:38-44`); `lastError` (:1961); `hasActionableProposedPlan` (:1972). No push feed over HTTP.

**Design.** Reuse the `threadsFor` filter (this window's threads). One timer in the extension: 4 s while any of them is active (status in the active five, or `activeRunId`, or a pending request), 30 s otherwise; also one fetch right after a `location` message (the owner just acted). Edge detection per thread id: `pendingRuntimeRequest` going from null to set fires the notification once per request id; active to `completed` or `failed` fires done or failed. Notify only when the view is not visible or `vscode.window.state.focused` is false. "Show" = `t3vscode.panel.focus` plus the existing `navigate` path. Badge on the view (`WebviewView.badge`) with the count of waiting threads: two lines.

**Effort** M (about 120 lines). **Risks:** the shell response holds every thread, so a 30 s idle poll costs one full list; field names churn with nightlies (`t3-facts.json` entries for `status`, `pendingRuntimeRequest`, `activeRunId`). **Recommendation:** build after items 1 to 4.

## 6. Open the current thread in the T3 desktop app

**Facts.** The desktop app handles `t3code://threads/<environmentId>/<threadId>` and `t3code://new?...` (`packages/shared/src/promptLinks.ts:1-14, 215-243`, scheme `t3code` or `t3code-<suffix>`, :215); it receives them at start and through `second-instance` (`apps/desktop/src/app/DesktopClerk.ts:192-233`). On this PC `HKCU\Software\Classes\t3code\shell\open\command` points at `T3 Code (Nightly).exe "%1"` (registry, read 2026-10-12), so the nightly owns the scheme. The panel already knows environment id and thread id (`bind.env`, `this.current`).

**Design.** Command `t3vscode.openInDesktop` plus an icon in the panel toolbar: `vscode.env.openExternal(Uri.parse('t3code://threads/' + encodeURIComponent(env) + '/' + id))`. No thread: `t3code://new`. Not running: Windows starts it. The `t3 app` CLI is not needed (and was off limits for this research).

**Effort** S (about 15 lines). **Risk:** live check that a running app routes the link (second-instance path) and that its environment id equals the server's (the app runs the same server). **Recommendation:** cheap, low value while the panel shows everything; build when convenient.

## 7. Keyboard: focus the panel, focus the composer, back to the editor

**Hard fact.** With focus inside the T3 frame no VS Code keybinding fires. Key events stay in the frame that has focus; the pre page forwards keys only from its own window and our panel document (`pre/index.html` 911-912, 1052-1053), and the workbench drops re-dispatched (untrusted) key events unless the internal option `forwardUntrustedKeypressEvents` is set (`shouldForwardKeyEvent` in the workbench bundle), which extensions cannot set. So keys from inside T3 reach VS Code only as script, then message, then command, for a short fixed list.

**Design (mirrors Claude Code: `ctrl+escape` focus when `editorTextFocus`, blur otherwise).**
- `t3vscode.focusComposer`, key `ctrl+escape` when `editorTextFocus`: `t3vscode.panel.focus`, then post `{type:'t3vscode:focus-composer'}`; the panel calls `frame.focus()` and passes it on; the script runs `window.dispatchEvent(new Event('t3code:focus-composer'))`, which T3's chat view already listens for (`apps/web/src/lib/desktopSnapShot.ts:3-14`, `components/ChatView.tsx:4612`). The editor element is `[data-testid="composer-editor"]` (`ComposerPromptEditorTiptap.tsx:1019`) if a direct `.focus()` is needed.
- Back to the editor: the script's keydown capture listener sees Ctrl+Alt+C (was Ctrl+Esc: Windows takes it)ape (T3 binds nothing to it; its defaults are `packages/shared/src/keybindings.ts:120-200`) and posts `{type:'t3vscode:key', key:'blur'}`; the extension runs `workbench.action.focusActiveEditorGroup`. Plain Escape stays T3's (closes menus and the palette).
- `t3vscode.open` gets a keybinding too (Claude uses `ctrl+shift+escape` for its editor tab); the owner picks the chord.

**Effort** S (about 40 lines). **Risk:** `frame.focus()` from the panel into the cross-origin frame (live check); Windows can reserve Ctrl+Alt+C (was Ctrl+Esc: Windows takes it) for Start (Claude Code ships it on win, so it reaches VS Code on a normal setup). **Recommendation:** build with item 4 (Alt+K then lands in the composer).

## 8. Other things a Claude Code or Codex user would miss (no design)

- **Key collisions inside the frame:** T3 owns `mod+shift+p` = pin thread (keybindings.ts:191), `mod+p` = T3 file picker (:146), `mod+b` sidebar (:124), `mod+j` terminal (:127), `mod+k` T3 palette (:145), `mod+n` new chat, `mod+w` close right panel. Ctrl+Shift+P in the panel pins a thread instead of opening VS Code's palette. Item 7's message route can map a few (Ctrl+Shift+P, Ctrl+P) to VS Code commands; the owner decides which side wins.
- Theme: T3 does not follow VS Code's light or dark; the script could seed T3's theme key from the panel's theme kind.
- "T3: New thread" as a palette command, and Ctrl+N while the panel has focus (the toolbar button exists).
- "Run in terminal" on code blocks (`ChatMarkdown.tsx:993`) runs in T3's drawer, not in a VS Code terminal.
- Show a changed file in VS Code's diff view (SYNC row 12), and "Fix with T3" on a Problems entry (diagnostic as mention plus text).
- Open on startup setting; the panel in an editor tab; font size following VS Code's zoom.

## Order by value for effort

1. **Item 3**, keep the last thread of this window's threads, other projects included (S, 6 lines, fixes a visible annoyance).
2. **Item 2**, hide the terminal toggle (S, 8 lines, the owner asked).
3. **Item 7**, Ctrl+Alt+C (was Ctrl+Esc: Windows takes it) into the composer and back (S, 40 lines, daily use).
4. **Item 1 base plus item 4**, "Add to prompt" from Explorer, tabs and Alt+K selection through T3's own mention drop (M, about 105 lines, the biggest parity gain).
5. **Item 1 drop**, Shift-drag onto the panel (S on top of 4, after one live check of the drop types).
6. **Item 5**, status bar, badge and "needs you" notification (M, 120 lines, high value but the most code and polling).
7. **Item 6**, open in the desktop app (S, 15 lines, low value while the panel shows everything).
