# Fork features

What this fork adds on top of the original extension. One heading per feature. The design and the T3 facts behind each one are in docs/ours/PORT-MAP.md.

## A. MCP context bridge (mcp)

Every agent T3 starts (Claude Code, Codex) can ask THIS VS Code window about itself and ask it to show a file. Uses no T3 surface.

- How it works: each window runs a loopback MCP server (127.0.0.1, random port, bearer token) and publishes `~/.t3-vscode/windows/<pid>.json`. Agents start `node ~/.t3-vscode/bridge.js` (stdio); the bridge picks the window whose folder holds the agent's cwd, else the last focused one with `match: fallback` and a note. `T3VSCODE_HOME` moves `~/.t3-vscode`. Not started in a remote or virtual window.
- Tools: `workspace`, `activeFile` (the selection survives focus moving into a T3 panel; 8192 chars, then `truncated`), `openTabs`, `diagnostics`, `gitState`, `extensions`, `terminalOutput`, `openFile`, `revealInExplorer`, `showDiff`. Actions work only inside the window folders, at most one per 300 ms.
- Commands: "T3 VSCode: Set Up the VS Code Context Server" (page with the CC Switch entry, the Codex TOML and whether each harness already has it), "Add the VS Code Context Server to Claude Code" / "to Codex" (types the CLI line into a terminal named T3; you press Enter). A one-time hint appears after the first connection when no harness has the server ("Not now" is remembered).
- VS Code's own MCP list gets "T3 VS Code context" (provider id `t3-vscode.ours.mcp`, VS Code 1.101 or newer).
- Settings: none.
- Live test: in a T3 thread on this folder, "call the vscode tools workspace, openTabs, diagnostics and gitState and quote the raw results". Expected: your tabs, your Problems, branch main and the Source Control files. VS Code's MCP list may ask once to trust the provider again (its id changed from `t3vscode.mcp`).

## B. Approvals as notifications (approvals)

- What: when a thread of this window waits for an approval (T3 request kinds command, file-read, file-change, mcp-elicitation, permission), one VS Code notification says which thread, what kind and what it asks: `T3: "<title>" needs approval (<kind>[ from <app>]): <command or prompt>`, plus any warning the provider attaches to Approve or Deny. Buttons: Approve (sends `accept`), Deny (sends `decline`), Show (opens the thread). The answer goes to T3 as `runtime-request.respond`, the same command T3's own Approve sends.
- Buttons only for decisions the request offers. Show only when T3 cannot pass an answer on (`not_resumable`), when the request is no longer pending, or when a command request shows only a reason and not the command itself.
- Answered elsewhere first: "Already answered in T3". A second click while an answer is on its way: "An answer to this request is on its way to T3". Any other failure: a warning with Retry (reads the request again) and Show; never an automatic retry.
- Other request kinds (questions, `user_input`) keep upstream's "Open session" notification. Never two notifications for one request.
- Toasts always, whether VS Code is focused or not. Two windows on one folder both toast; the second click gets "Already answered in T3".
- Settings and commands: none.
- Code: src/host/ours/approvals.ts (wraps the upstream notification tracker's `update`), src/host/ours/approvalText.ts (text and buttons, tested). Log lines go to the output channel "T3 VSCode (fork)".
- Live test: in the T3 app, in this project, ask for something that needs a shell-command approval; switch away from VS Code. Expect one notification with Approve, Deny, Show. Click Deny: T3 shows the request declined, and the thread's approval badge in the T3 sidebar clears.

## C. Status bar activity (statusbar)

- Bottom right, directly left of the usage meters: "T3: running" with a spinner while a thread of this window works ("T3: N running" for more than one), "T3: needs you" on a warning background while a thread waits for an approval or an answer. Hidden when nothing runs. Waiting beats running; archived threads and provider subagents do not count; a queued thread counts as running.
- When T3 is down: "T3: not running" (click opens the T3 view). When VS Code is not paired: "T3: not paired" (click pairs).
- Hover lists each thread: "<title>: waits for you" or "<title>: running".
- Click: with exactly one waiting thread it opens that thread; otherwise it shows the thread list.
- The T3 icon in the activity bar shows a badge with the number of waiting threads, once the T3 view has been opened in this window.
- Command: `t3-vscode.ours.statusbar.open` (internal, used by the click). No settings.
- Live test: send "count to 20 slowly" in a T3 chat. Bottom right shows "T3: running" with a spinner, then disappears when done; hover names the thread.

## D. Add to prompt (prompt)

Puts things from VS Code into the T3 chat box. It never sends. The insert goes into the focused chat tab or opens one. File references bring the tab to the front; text and images into a tab still on a fresh draft (no thread yet) can stay behind other tabs; on first open the composer gets focus once the panel has loaded.

| Entry point | Where | Lands as |
|---|---|---|
| Files | Explorer right-click (multi-select, max 50), editor tab right-click, palette "Add to T3 Prompt" (active file) | gif/jpeg/png/webp up to 10 MiB: attachment chip; anything else (folders, larger images): `@file` reference |
| Selection | Alt+K, editor right-click (his `t3-vscode.insertReference`) | `@file:a-b` with snapshot |
| Terminal selection | Terminal right-click "Add Terminal Selection to T3 Prompt" | fenced block, last 4000 chars. Uses the clipboard for a moment and restores it |
| Last command | Terminal right-click or palette "Add Last Command to T3 Prompt" | fence with `$ command` and its plain output (last 4000 chars), `exit N` if not 0. Needs shell integration |
| TODO lens | "Implement with T3" above `TODO`/`FIXME` comments (max 50, files under 200 KB) | `@file:N` with the line as snapshot |
| Fix with T3 | Light bulb on a Problem (max 3) | `@file:a-b` with the lines, then the message and its source |
| Review changes | Source Control title menu (git) | "Review my uncommitted changes in this repository." |

- Commands: `t3-vscode.ours.prompt.addFiles`, `.addTerminalSelection`, `.addLastCommand`, `.reviewChanges`, `.fix` (internal, hidden from the palette).
- Setting: `t3-vscode.ours.prompt.todoLens` (default true); off removes the lenses at once.
- Code: src/host/ours/prompt.ts, src/host/ours/promptText.ts (tested in promptText.test.ts).
- Live test: right-click README.md in the Explorer, "Add to T3 Prompt": a reference shows in the chat box. Then select text in a terminal, then run 'T3 VSCode: Add Terminal Selection to T3 Prompt' from the Command Palette: a code block shows. Click one "Implement with T3" lens above a TODO: an `@file:N` reference shows in the chat box.

Note for the terminal entries: the terminal right-click menu only appears when the setting terminal.integrated.rightClickBehavior is default; the Windows default copyPaste shows no menu, so use the Command Palette instead.

## E. t3.json scripts as tasks (tasks)

- What: the scripts in each local workspace folder's `t3.json` show up in "Tasks: Run Task" under source "T3", one task per script. A task runs the script's command in a VS Code terminal at that folder, with `T3CODE_PROJECT_ROOT` set to the folder, as T3 runs it. The file is read the way T3 reads it (comments and trailing commas allowed). An invalid file, a file with more than 50 scripts, or a file over 256 KB lists nothing and logs one line in the output channel "T3 VSCode (fork)". Scripts kept only in T3's settings are not listed (T3 does not run scripts from the file; the file only feeds its import menu).
- tasks.json: `{ "type": "t3", "script": "<name>" }` refers to a listed script.
- Also: JSON validation and completion for `t3.json` from https://t3.codes/schema/t3.json.
- Settings and commands: none. Code: src/host/ours/tasks.ts.
- Live test: in a folder whose t3.json has a script, Ctrl+Shift+P, "Tasks: Run Task", "T3", pick the script. A terminal runs it in that folder.

## F. Open in the desktop app (desktop)

- What: brings the T3 desktop app to the front on the thread of the focused chat, through the link `t3code://threads/<environmentId>/<threadId>`; with no thread open, `t3code://new` (the app's new-thread page). The thread is the one of the last focused chat tab; with no chat tab, the sidebar's.
- Command: `t3-vscode.ours.desktop.open` "Open This Thread in the T3 App" (`$(link-external)`), in the T3 view title next to his globe and in the title bar of a T3 chat tab; also in the Command Palette.
- Settings: none.
- If no app takes the link (or opening it fails), a warning says "The T3 app did not take the link. Is T3 Code installed?" and the output channel "T3 VSCode (fork)" logs the link. On Windows an unregistered scheme likely shows the OS app picker instead, so the warning may never show there.
- T3 facts: `desktop-scheme`, `desktop-thread-link`, `desktop-link-receiver` in t3-facts.json.
- Live test: with a thread open in the chat, click the "open in app" icon in the T3 view title. The T3 app comes to the front on that thread (allow the t3code link if VS Code asks).

## G. Thread deep links (links)

- A link `vscode://hungtienhuang.t3-vscode/thread/<environmentId>/<threadId>` (Insiders: `vscode-insiders://`) opens that thread in a T3 chat tab, the same way his session list does.
- A cold link (VS Code or the chat closed, T3 still connecting or pairing) waits for the connection, up to 5 minutes; a newer link replaces a waiting one.
- A malformed link opens nothing and writes one line to the output channel "T3 VSCode (fork)". A link to another T3 server or to a thread this window does not show (another folder's window, or an archived thread that is not loaded) opens nothing and shows "This T3 thread is not in this window." VS Code hands a link to one window only.
- Command "Copy Link to This Thread" (`t3-vscode.ours.links.copy`), also in the T3 sidebar's "..." menu: copies the link of the thread in the last focused chat tab, else of the sidebar's current thread. No thread: "No thread open."
- Settings: none.
- Code: src/host/ours/links.ts, src/host/ours/linkParse.ts (the parse, tested).
- Live test: run "Copy Link to This Thread", switch to another thread, Win+R, paste, Enter. VS Code shows the copied thread (VS Code may ask once whether to let the extension open the link).

## H. Save on send (saveOnSend)

- What: before T3 sends a prompt (any mode: send, queue, steer) or saves an edit of a queued message, every dirty file in VS Code is saved, so the agent reads what the editors show. Untitled files stay unsaved. The save runs before T3 snapshots the files for the turn diff, so my own edits never show up as agent changes.
- A save that fails: logged in the output channel "T3 VSCode (fork)", a warning toast, and the prompt is sent anyway.
- Setting: `t3-vscode.ours.saveOnSend.enabled` (default true).
- Commands: none.
- Code: src/host/ours/saveOnSend.ts (wraps `hostState.sendMessage` and `hostState.queueAction` for `edit`).
- Live test: type one character in a file without saving, send any prompt. The dirty dot disappears before the reply starts, and the reply's diff does not list that file.

## I. Drag and drop (drop)

Two ways to put files from VS Code into a chat: select them in the Explorer, press Ctrl+C, then Ctrl+V in the chat; or drag them (no key) onto the "Drop files here" view, which adds them to the focused chat. A drag from the Explorer or a tab onto the chat box itself can never land, with or without Shift (proof below). Files from Windows Explorer (outside VS Code) drop onto the chat box with no key.

- "Drop zone" view under the T3 VSCode sidebar (2026-10-14 night: one row, icon plus "Drop files here", no description, initialSize 1, visible by default; drag the sash once to make it one line high, VS Code remembers): takes a drag (no key needed) and puts the files into the focused chat panel (a new panel for the sidebar thread when none is focused). It is the bridge while VS Code 1.140+ blocks the chat box; the webview drop code stays for when that is fixed.
- Ctrl+C in the Explorer runs `t3-vscode.ours.drop.copy` (hidden from the palette): it remembers the selected paths, then runs VS Code's own copy, so the clipboard ends as before (VS Code writes only its private "CodeFiles" format, which nobody else can read). A Ctrl+V in a chat with no text and no file on the clipboard inserts the remembered files, if the copy is under 10 minutes old. If another app puts a non-text format on the clipboard after the copy, the old list can still come in.
- A Windows Explorer file drop onto the composer box works with no key (2026-10-14, the way Codex does it); his composer attaches the files. Only when the drag enters the VS Code window straight over the chat: crossing any other part of the window first (Explorer, tab bar, status bar) makes VS Code block the chat for that drag, then Shift is needed (VS Code's rule, the same for every extension).
- A gif, jpeg, png or webp up to 10 MiB becomes an attachment chip; everything else (also folders and larger images) a whole-file reference.
- Settings: none. Commands: `t3-vscode.ours.drop.copy` (keybinding only). View: `t3-vscode.ours.drop.view`.
- Log ("T3 VSCode (fork)"): `Drag trace: <event> types=<...> shift=<bool> kinds=<kind:type,...> view=<id>` for every trusted dragenter (at most one per 500 ms) and every drop that reaches a chat webview, before any filter; plus one line per drop on a chat, per view drop, per Explorer copy and per text-less paste. The capture listeners for VS Code's own drag types stay in place for the day a VS Code build lets such a drag through.
- Files: src/webview/ours/drop.ts (capture listeners, trace, hint, paste), src/webview/ours/shiftHint.ts (the note over the composer; it can only fire for a drag that reaches the page), src/host/ours/drop.ts (requests dropUris, dragTrace, dropHint and pasteCopied, the copy command, the view), src/host/ours/dropParse.ts (the parser, tested).

Why a Shift-drag from the Explorer or a tab does not land on the chat today (facts, 2026-10-14 night):
- It worked up to VS Code 1.139.1. It is blocked since VS Code 1.140.0 (released 2026-09-30) and in 1.141.x, for every extension (Claude Code, Kilo Code, the fork), in a side bar and in an editor tab. Reports: microsoft/vscode#339278 (closed as a duplicate, no fix named), Kilo-Org/kilocode#14737, a comment on microsoft/vscode#321275 (2026-10-08, "stopped working in 1.140.0 and 1.141.0").
- The cause is the Electron update, not VS Code's own code: .npmrc target went from Electron 43.6.0 (1.139.1) to 43.7.3 (1.140.0); no VS Code commit between the two tags touches drag or webview code. Electron 43.7.0 (2026-09-10) release note: "Fixed an issue where the browser-side check that blocks drag and drop between cross-site frames of the same page was disabled." That is electron/electron#53669 (backport #53750): since 2017 an Electron patch had made Chromium's WebContentsViewDragSecurityInfo::IsValidDragTarget return true always; now it only relaxes the check across WebContents (guests). The PR's own test table: "page to a cross-site iframe in the same page: before: drop lands; after: refused, the frame never sees dragenter". There is no switch or web preference to turn it off.
- Chromium's rule (crbug.com/59081): a drag that started inside the page may only drop into a frame of the same process group (content/browser/web_contents/web_contents_view_drag_security_info.cc). The Explorer lives in the workbench frame (vscode-file://vscode-app), the chat in a vscode-webview:// iframe in another process. Shift only lifts VS Code's own pointer-events block (src/vs/workbench/contrib/webview/browser/webviewWindowDragMonitor.ts, used by webview editors and webview views alike); after that Chromium refuses the target.
- Real mouse, VS Code 1.141.1, 2026-10-14 20:27: a Shift-drag onto Claude Code 2.1.299's side bar chat set the iframe to pointer-events auto, then neither the workbench nor the webview saw a dragover or drop, only the final dragend. Same for the owner's own drags into the fork and into Claude Code. scripts/verify-drag.mjs is not a counter-proof: it drives the drag through CDP, which skips the browser-side check.
- Drags from outside VS Code (Windows Explorer) are not started by the page and are not subject to the check; Codex and the fork take those with no key.
- What an extension can do today: nothing inside the webview. VS Code hands an extension a drop target only in a tree view, in a text editor and in the terminal. The "Drop files here" tree view is that target. The webview listeners for VS Code's drag types stay in place: they are the right code for VS Code 1.139.1 and for the day Electron or VS Code lets the drag through again.

- Live test: drag README.md (no key) onto "Drop files here": a reference in the focused chat. Select README.md in the Explorer, Ctrl+C, click the chat box, Ctrl+V: the same reference. Drag a file from Windows Explorer straight onto the chat box, no key: a chip, and the log shows `Drag trace: drop types=files kinds=file:...`.

## J. Re-vendor (T3 nightly packages)

- What: vendor/ carries T3's contracts, shared and client-runtime from the nightly `v0.0.46-nightly.20261014.3093` (107f6024ea47) instead of 0.0.45, on Effect 4.0.2. Threads that contain a `secret_request` turn item load again, and turn item types newer than the vendored copy are skipped instead of breaking the thread. How it was done and how to redo it: vendor/README.md; log entry: docs/UPSTREAM.md.
- Settings and commands: none.
- Live test: open a T3 thread in which an agent asked for a secret (a `secret_request` item) and check it loads; pair on Windows once with the `t3` launcher to check the shell fix.

## K. Chat in the sidebar (layout)

A chat opens inside the T3 VSCode sidebar view, like the Claude Code and Codex extensions, instead of in a big editor tab. Opening a file from the Explorer no longer covers the chat.

- Setting `t3-vscode.ours.layout.openThreadsIn` (section "Fork: Layout"): `sidebar` (default) or `editor` (each chat in its own editor tab, as before). It applies at once.
- With `sidebar`: a click on a session in the sidebar list, the "+" in the sidebar (a new thread), the toast "Open session", a deep link, the status bar item, "Add to prompt", the Shift-drag and the Ctrl+V of Explorer files all show the chat with its composer in the sidebar. A bar above it has "Sessions" (back to the list) and a pop-out icon that opens the chat in an editor tab with the unsent text and attachments; the sidebar then goes back to the list. His header (history, new chat, web UI, thread actions) stays.
- While the sidebar counts as a chat, a click in it makes it the focused chat: inserts from the editor (his "Add selection" too) then go to the sidebar and switch it to the chat.
- How: src/host/ours/layout.ts wraps his openSession, createPanel (from the sidebar and without a draft) and createNewPanel (from the sidebar) and re-adds the sidebar to his registry as a chat view. The "layout" event makes src/webview/ours/layout.ts set body[data-surface] to "panel" (his App picks ChatView from it on every render) and re-deliver the state. No line of his changed.
- Files: src/host/ours/layout.ts, src/host/ours/layoutRoute.ts (the routing rule, tested), src/webview/ours/layout.ts; src/webview/ours/drop.ts now checks the surface per event, so drops work in the sidebar chat.
- Live test: click a session in the sidebar: the chat shows in the sidebar, send a message. Shift-drag README.md onto it: a reference shows. Click the pop-out icon with text in the composer: an editor tab opens with that text, the sidebar shows the list. Set the setting to `editor`: a session click opens a tab again.

## Q1b sidebar: Sidebar chat polish (and restore after reload)

The sidebar chat now behaves like a real chat panel.

- Pop-out moves the draft: after the pop-out icon, the new editor tab reports that the draft arrived, and only then the sidebar copy is cleared. If the thread already had a tab (his code only reveals it), nothing arrives and the sidebar keeps its text.
- Move a tab back: the editor title of a chat tab has "Move Chat to Side Panel" (`t3-vscode.ours.sidebar.moveToSidebar`, also in the palette while a chat tab is active, sidebar mode only). The tab hands its unsent text and references to the sidebar chat, its own stored draft is emptied, and the tab closes. A draft with attachments is refused with a warning: only his registerView can share an upload with another view, and the sidebar is registered already.
- "Back to <title>": in the sessions list, a bar above the list returns to the chat the sidebar showed last.
- The sessions list keeps its scroll position when a chat opens and closes.
- Narrow side bar (300 px and less): the chat header hides the project name, the Scheduled button and the Web UI button. His "+" still says "Open New Chat in Editor Tab" although in sidebar mode it opens the chat in the side panel; that string is his.
- Restore after reload: while the sidebar shows a chat, its thread id is kept in workspaceState (`t3-vscode.ours.layout.sidebarThread`); after the next connect the same chat shows again, without taking the focus. An archived or deleted thread falls back to the sessions list.
- Inserts while the list shows (Alt+K and the like) still open the newest thread in the sidebar with the reference, as before (decision kept).
- Files: src/host/ours/layout.ts, src/webview/ours/layout.ts, package.json (one command, one editor/title entry, one palette entry). No line of his changed.
- Live test: type a draft in the side panel chat and pop it out: the text is in the tab only. "Move Chat to Side Panel" on the tab: the text is back in the sidebar and the tab is gone. Go to Sessions, scroll down, open a chat, go back: same place; "Back to" returns to the chat. Narrow the side bar to 250 px: the header fits. Reload Window: the same chat shows.

## Q2 keys: Keys into T3: focus, new chat, switch chat, a safe insert key

- Ctrl+Alt+C (`t3-vscode.ours.chat.focus`, "Focus Chat Input"): shows the chat you used last and puts the caret in its composer. A chat tab is revealed in place; otherwise the sidebar's chat opens (in the sidebar or a tab, by `t3-vscode.ours.layout.openThreadsIn`). With no chat at all it only shows the T3 view. It replaces VS Code's own Ctrl+Alt+C for Copy Watch Expression (debug Watch view focused) and, on Linux, Copy Path in the Explorer and search results.
- Ctrl+Alt+Shift+N (`t3-vscode.ours.chat.new`, "New Chat"): a new empty chat, placed by the layout setting, caret in the composer. Not Ctrl+Alt+N: Code Runner (formulahendry.code-runner) binds that with no condition.
- Ctrl+Alt+S (`t3-vscode.ours.chat.switch`, "Switch Chat"): a picker of this workspace's chats, newest first, archived ones left out; type part of a title (or "working", "needs you", "pinned"), Enter opens it with the caret in the composer. It replaces VS Code's own Ctrl+Alt+S for "Share..." (`workbench.action.share`), which the built-in GitHub extension enables in any repo with a GitHub remote.
- Shift+Alt+K in an editor runs his `t3-vscode.insertReference` (add selection or file). His Alt+K stays, but Claude Code also binds Alt+K (and Ctrl+Alt+K), so which extension gets Alt+K is luck; Shift+Alt+K is ours alone.
- These keys do not fire while the terminal has focus (VS Code sends keys to the shell unless a command is in `terminal.integrated.commandsToSkipShell`, which only the user can set).
- Settings: none. Rebind any key in Keyboard Shortcuts.
- How: src/host/ours/keys.ts calls his public provider methods (createPanel for a focused tab, openSession, createNewPanel; the layout wrap routes them) and then posts the ours event "focus"; src/webview/ours/composer.ts answers it with the existing focusComposer retry.
- Live test (not yet run; for the owner): in an editor press Ctrl+Alt+C and type: the text lands in the chat box. Ctrl+Alt+Shift+N: an empty chat. Ctrl+Alt+S, type part of a title, Enter: that chat with the caret in it. Select text and press Shift+Alt+K: a reference in the chat.

## Q3 toasts: Toasts that help: turn finished, none for the chat you are reading

- When a turn of a thread of this window ends, a toast says `T3: "<title>" finished.` (or a warning `... failed.`) with a Show button that opens the chat. A turn you stopped yourself (interrupted, cancelled, rolled back) gets none, nor do provider subagents. A queued follow-up counts as still working, so a queue toasts once at its end. The end must hold for 2 s, so a thread that streams in bursts does not toast mid-way.
- Setting `t3-vscode.ours.notify.finished` (section "Fork: Notifications"): `unfocused` (default, only while VS Code does not have focus), `always` (also while you work in VS Code, but not for the chat you are reading), `off`. VS Code shows the toast inside its own window (no OS notification), so it waits there until you come back.
- No toast for the chat you are reading: when VS Code has focus and the chat view with keyboard focus shows the thread, the approval toast (B), his question toast and the finished toast are skipped. The status bar and badge still show "needs you". The request is not toasted again when you leave the chat.
- How: src/webview/ours/toasts.ts reports focus (window focus, blur, and the K layout flip of body[data-surface]) through the ours request `toastsFocus`; src/host/ours/finished.ts keeps the reading view, checks which thread it shows and listens to the host state; src/host/ours/finishedEdge.ts holds the edge rule (tested); src/host/ours/approvals.ts asks `isReading` first.
- Commands: none. Log: each finished or failed toast writes one line to "T3 VSCode (fork)".
- Live test: send a prompt, switch to another app until it ends, come back: the "finished" toast waits. Stay in the chat, let the agent ask for an approval and answer it there: no toast. Set the setting to `always`, click into an editor while a turn runs: the toast shows in VS Code.

## Q4 reconnect: Connection dead ends: auto-reconnect and buttons

Restart or update T3 and VS Code connects again by itself; where it cannot, the screen has a button.

- Auto-reconnect: while his setup screen shows a server problem (`missing-runtime`, `server-stopped`, `unreachable`, or `connection`, the error of a connect that failed while T3 was half started), the host retries when `<home>/userdata/server-runtime.json` is written, every 10 s and when the VS Code window gets focus, through his own `hostState.reconnect()`. His own retry gives up after 3 tries over 6 s.
- Guards: never on `pairing` or `cli-missing`; only after T3's own discovery answers (the server process is alive and its environment probe replies) and a stored, unexpired pairing credential belongs to that server (otherwise his connect would run `t3 pair` on every tick). The probe also keeps the setup screen from blinking to "Connecting" every 10 s while T3 is down. A server that answers but still fails to connect is retried less often, up to every 80 s; a file change or window focus retries at once.
- Buttons: the "Connecting to T3 Code" screen gets "Retry connection" and "Connection settings" (as his error screen has). The "server not found" and "server stopped" screens get "Open T3 app" (runs `t3-vscode.ours.desktop.open`, which opens `t3code://new` when nothing is connected). Not on the pairing screen.
- Settings and commands: none. Log: one line "Reconnect: T3 answers again, reconnecting." per auto attempt in "T3 VSCode (fork)".
- How: src/host/ours/reconnect.ts (watcher, poll, focus, the ours request `reconnectOpenApp`); src/webview/ours/reconnect.ts adds the buttons to his screens through the DOM, from the phase in his state events. No line of his changed.
- Live test: quit T3 with VS Code open, start it again: the chat returns within about 10 s with no click.

## Q5 escape: Escape stops a running turn

Escape in the chat box (or with focus in the transcript) stops the running turn, as in Claude Code and Codex.

- It acts only when no popup is open: the mention list, model picker, find, history, thread menu, equation menu, message navigator, quote comment, image preview and the composer "..." menu all keep their own Escape. Modifier keys, a held key and IME composition are ignored.
- How: src/webview/ours/escape.ts, two window keydown listeners. The capture one notes whether a popup (`[role=dialog]`, `[role=menu]`, the open composer overflow) was in the DOM before any handler ran; the bubble one acts only if no handler called preventDefault, then clicks his own "Stop generation" button of that chat, so his interrupt path runs. No line of his changed.
- Settings and commands: none.
- Live test: start a long prompt, press Escape in the chat box: it stops. Open the model picker and press Escape: only the picker closes. Open an image and press Escape: only the image closes, the turn keeps running.

## Q7 statusbar2: Status bar and logs tell the truth

The status bar item left of the usage meters now says what the connection is doing, and the fork's log is one click away.

- Labels: "T3: not running" (no server found), "T3: connection problem" (connect failed), "$(sync~spin) T3: pairing" (no click: a second click would queue a second pairing), "$(sync~spin) T3: connecting" (discovering and connecting, also his reconnect tries), "T3" when nothing runs, then the existing "running" and "needs you". Every label except pairing opens the T3 VSCode view on click (his error screen has Retry). The tooltip starts with his notice (the reason) and ends with a "Show Logs" link.
- Command `t3-vscode.ours.log.show` ("T3 VSCode: Show Logs"), also in the T3 view's "..." menu: opens the output channel "T3 VSCode (fork)".
- Log: every change of phase, problem kind or notice writes one line ("T3 connection: error (connection): ...").
- Ours error toasts (a failed command in prompt, approvals Show, the status bar click, a failed drop, a failed attach, save on send) log the error with its stack and carry a "Show Logs" button.
- Settings: none. Files: src/host/ours/logs.ts (command, phase log, toastWithLogs), src/host/ours/activity.ts (labels, tested), src/host/ours/statusbar.ts, src/host/ours/log.ts (log.show).
- Live test: quit T3 with VS Code open: the label goes "T3: connecting" (three reconnect tries) and then "T3: not running"; start T3 and Retry: back to "T3". Run "T3 VSCode: Show Logs": the phase lines are there.

## Q8 contexts: Commands target the chat you are in, and hide when they cannot work

Thread Actions and Copy Link act on the chat in front of you (the focused chat tab, else the sidebar), and the palette does not offer commands that would only fail.

- Context keys (src/host/ours/contexts.ts, from his onDidChangeState and the registry focus): `t3-vscode.ours.ready` (connected to T3) and `t3-vscode.ours.hasThread` (connected and the focused chat shows a thread).
- Palette: Thread Actions and Copy Link to This Thread need `hasThread`; Open Web UI and Refresh Usage Meters need `ready`.
- A chat tab has Copy Link and Thread Actions in its "..." menu (editor/title, group t3ours).
- His `t3-vscode.threadActions` read the sidebar thread; one line in src/extension.ts now reads `snapshot(registry.focusedViewId)` (no wrapper reaches a local inside his command).
- Live test: open two chats in editor tabs, focus the second, run Thread Actions from the palette, Rename: the second is renamed. Stop the T3 server: Copy Link, Thread Actions and Open Web UI leave the palette.

## Q9 read: Reading in VS Code marks the chat read in T3

A chat you read in VS Code no longer shows as unread in the T3 app or on your phone.

- While a chat (an editor tab, or the sidebar showing a chat, not the sessions list) has keyboard focus, the extension sends T3's `thread.visit` with the thread's `updatedAt`, the same watermark T3's own chat view sends. Focus is the proof the chat is on screen: VS Code tells a webview nothing about visibility. A chat that is only visible next to the editor is marked read once you click into it.
- Only when the server reports `capabilities.threadVisitedTracking === true` (the owner's nightly does); otherwise nothing is sent and nothing shows.
- One visit per `updatedAt`. While a turn streams, at most one visit per 10 s (T3's own throttle), trailing, so the last one carries the newest state; a finished run is marked at once. Opening another chat and coming back sends again, so a chat marked unread on the phone can be read again from VS Code.
- Settings and commands: none. A failed visit writes one line to the output channel "T3 VSCode (fork)".
- How: src/webview/ours/visit.ts reports the shown thread on every state push, on focus and on blur (request `visitShowing`); src/host/ours/visit.ts checks it is the view's own active thread, takes `updatedAt` from the host state and dispatches through his `client.dispatch`. A visit does not bump `updatedAt` (T3 ProjectionStore), so it never triggers another. No line of his changed.
- Files: src/host/ours/visit.ts, src/host/ours/visit.test.ts (dedupe, throttle, capability), src/webview/ours/visit.ts.
- Live test: let an agent finish in a chat while VS Code is in the background, see the unread dot in the T3 app, click into that chat in VS Code: the dot goes away in the T3 app. Then watch a run finish while the chat is focused and switch to the T3 app within a few seconds: no unread dot appears.

## Q10 latest: Latest button always there, and the agent looks alive

When you scroll up in a chat, a "Latest" button sits at the bottom right and jumps back to the newest message; a pulsing dot on it says the agent is still working. His own button showed only with two or more prompts and the message navigator on.

- The button shows whenever the transcript is scrolled up (more than 40 px from the end, his threshold). A click uses his hidden Latest button when it exists (it also resumes following new output), else scrolls the list to the end.
- His "Working" labels (the answer header and the sessions list spinner) pulse; the system "reduce motion" setting turns the pulse off (his rule in tokens.css).
- A collapsed work group that is still running shows its newest running step after the count, for example "1 running  pnpm run build".
- How: src/webview/ours/latest.ts (DOM button, scroll listener, injected CSS, no line of his changed); src/shared/ours/latest.ts picks the running step per work group from the state snapshot (tested). It relies on his class names `.transcript-container`, `.transcript-list`, `.work-group-toggle` and `data-message-key`; re-check them on each upstream merge.
- Settings and commands: none.
- Live test: send one prompt with a long answer, scroll up while it streams: Latest shows with a pulsing dot; click it and the chat follows the answer again.

## Q11 reprompt: Bring a past prompt back

- ArrowUp in an empty chat box puts my last prompt back; more ArrowUp presses walk back, ArrowDown walks forward and past the newest empties the box (T3's rules, ported from its composerPromptHistory.ts). It steps only from an empty box or from a recall I have not edited, so in a typed draft the arrows move the caret as always; in a multi-line recall they move inside it until the caret is on the first or last line. Not while the @ or / suggestions are open, not with attachments in the box.
- A "use again" icon next to Copy on each of my messages puts that prompt in the box.
- A Retry button under a turn error puts the prompt that failed back in the box; Enter sends it again (it does not send by itself).
- The recalled text is what I typed: file links stay as links, the appended editor snapshots and the "Ultrathink:" prefix go, attachments are not brought back. The old box text is replaced as a native edit, so Ctrl+Z brings it back.
- Settings and commands: none.
- How: src/webview/ours/reprompt.ts (a window capture keydown before his Composer; the two buttons are added to his rendered rows by a MutationObserver, data looked up on click through getState); src/shared/ours/reprompt.ts (recall text, history steps, the prompt before an error; tested). No line of his changed. The QOL plan named slots in his Composer.tsx and TranscriptView.tsx; once the message-actions slot lands, the buttons can move there.
- Live test: send a prompt, press ArrowUp in the empty box and see it again; press ArrowDown and the box empties. Click the "use again" icon on an older message. In a chat with an error row, click Retry and press Enter.

## Q12 composerFit: Composer fits real prompts and says what it can do

- What: the message box grows with a long paste up to 40 percent of the view (his cap was 220 px) and then scrolls; its placeholder adds "Type @ for files, / for commands."; a failed send also shows above the box ("Not sent: <reason>"), not only in the top banner. The note goes away on the next keystroke or the next send.
- Settings and commands: none.
- How: src/webview/ours/composerFit.ts only, no line of his changed. A MutationObserver lifts his inline 220 px height and appends the hint to his two placeholder strings (his text stays a prefix, scripts/verify-ui.mjs finds the box by it); a CSS rule sets the 40vh cap; an observe-only wrapper on the webview bridge's request sees a rejected sendMessage and inserts a note in his composer-attachment-error style.
- Live test: paste 100 lines into the box and see it grow, then scroll. Any send the host or server rejects shows its reason above the box and keeps the text, for example Enter in a provider-controlled subagent thread, or stop the T3 server and press Enter before the view notices.

## Q13 planMode: Plan mode, see it and switch it

- What: a "Plan" / "Build" button in the composer traits (after the permission select; in the narrow "..." popup when the composer is compact) shows the chat's interaction mode and switches it. Typing `/plan` or `/default` offers the same switch in the suggestion list next to `/model`, as T3 web does; picking one switches the mode and removes the typed token. Before the first message it sets the new chat's draft mode.
- When shown: when `t3-vscode.ours.planMode.enabled` is on and the chat's provider allows it (`showInteractionModeToggle` not false), and always while the chat is already in plan mode, so it can be switched back (owner question 4 default). The `/plan` and `/default` suggestions follow the button. T3's own `planModeEnabled` is a per-client setting (T3 web or desktop storage) the extension cannot read; our setting stands in for it, off by default as in T3.
- Settings and commands: `t3-vscode.ours.planMode.enabled` (boolean, default false); a change applies to open chats at once. No command.
- How: src/webview/ours/planMode.ts places the button with a MutationObserver into his `.composer-traits` and calls his `setModes` through the bridge (never `run`); it reads the picked suggestion label from his `#composer-suggestions` markup in capture listeners, so his handler still clears the token. src/host/ours/planMode.ts wraps `hostState.composerSuggestions` to add the two items (src/host/ours/planModeSuggestions.ts, tested) only for views that reported the toggle as allowed, and serves the first state (`planModeState`, not his `getState`, which would mark the view ready too early). No line of his changed.
- Merge risk: the slash pick depends on his ComposerSuggestions markup (`#composer-suggestions`, `role="option"`, `aria-selected`, `.suggestion-label`) and on his Enter/Tab rule in Composer.tsx onKeyDown; his compact-controls measure does not count the button.
- Live test: with the setting off, a Build chat shows no button and no `/plan`; a chat set to Plan in the T3 app shows Plan, and a click turns it to Build (then the button hides). Turn the setting on: the button shows at once; click it: Plan, and the T3 app shows plan mode. Type `/def`, press Enter: the token goes and the mode is default. In a new chat before the first message, the button sets the draft's mode.

## Q14 secrets: Secret requests show a card

When an agent asks for a secret (T3's `request_secret`, a `secret_request` turn item), the chat shows a card above the composer instead of waiting with nothing on screen.

- The card names what is asked (label and reason) and has "Enter secret..." and "Decline". "Enter secret..." opens a VS Code password box; the value goes straight from there to T3 (`secrets.answerRequest`), never through the chat webview or a log. T3 stores it and the agent only learns the status. Decline is one click, as in T3.
- The card leaves by itself once T3 reports the request saved, declined or ended. A failure (already answered, the agent stopped) shows T3's own message as an error toast.
- A request inherited from another thread (a fork) gets no card: T3 answers it only in the thread that asked.
- Capability: the paired VS Code client may call the method. The nightly server requires `orchestration:operate` for it (apps/server/src/auth/RpcAuthorization.ts), and a pairing token gets the standard client scopes, which include it (the same scope his message sending uses).
- Settings and commands: none.
- How: no line of his changed. The host reads his private `run` and `requireSession` of T3Client through element access (still type-checked). The webview card is plain DOM, placed as the first child of his `.composer-column` and put back by an observer when his Composer remounts.
- Files: src/host/ours/secrets.ts (request "secretAnswer", password box, RPC), src/webview/ours/secrets.ts (the card), src/shared/ours/secrets.ts (which requests the chat may answer, tested).
- Live test: in a chat, ask the agent to request a secret with T3's request_secret tool; the card shows; click "Enter secret...", type a value, Enter: the card goes away and the agent goes on. Ask again and click "Decline". Editor tab: set `openThreadsIn` to `editor`, close the thread's tab, let that thread reach a pending secret request, then open it from the list: the card shows with no other activity.

## Q15 fileLinks: File links open in the right place

A file link in a reply (a markdown link, a changed-file row, a search result, a message reference) opens with VS Code's own editor for that file, so an image or a pdf opens too, not only text. From a chat in an editor tab the file opens in another editor group (a new group to the right when there is only one), so the chat stays visible. From the sidebar chat it opens in the active editor group, as before.

- Links with a line or range (`file.ts:12`, `#L3-L9`) open as text with the selection, as before. Web links, missing files and bad links still go to his openLink unchanged (his error message).
- A folder link opens quick open ("Go to File") filled with that folder's path, not his reveal in the Explorer, which would replace the T3 chat in the side bar.
- Settings and commands: none.
- How: src/webview/ours/fileLinks.ts wraps the webview's `bridge.request` and sends each non-web `openLink` to the ours request `fileLinks.open` (src/host/ours/fileLinks.ts); when that fails, his `openLink` runs. No line of his changed. The host part repeats about 10 lines of his private `openLink` (src/host/bridge.ts), so a change of his there must be copied by hand on a merge.
- Live test: in a reply, click a `.ts` link and a `.png` link, once in the sidebar chat and once in a chat popped out to an editor tab: both open, the png as an image, and the editor-tab chat stays visible. Click a `file.ts:12` link: the file opens with line 12 selected. Click a folder link (such as `src/host/`) in the sidebar chat: quick open lists that folder's files and the sidebar still shows the chat.

## Q16 diffs: Show all changes, Open File and Revert from a turn diff

See every file a turn changed in one view, jump from a diff to the real file, or put one file back as it was before the turn.

- "Open diff" under a response that changed two or more files now opens one VS Code multi-diff view with all of them ("Turn N: X changed files") instead of asking for one file. A turn with one file, and a click on a single file in the tree, open his single diff as before. A binary file is left out of the view (T3 cannot show it as text; the log names it). If the view cannot open, his file picker runs as before.
- On a turn diff (his single diff or the all-changes view): "Open File" (editor title icon, and the right-click menu inside the diff) opens the real workspace file. "Revert File to Before This Turn" (editor title "..." menu and the right-click menu) puts that one file back after a modal confirm. It refuses when the file has unsaved changes, when the file on disk differs from what the turn left (line endings do not count: T3 reads git blobs, LF), and for a renamed file. A file the turn created is deleted, a file it deleted is restored; the confirm says which. The file is saved after the revert, so `git diff` shows it.
- Settings: none. Commands: `t3-vscode.ours.diffs.openFile`, `t3-vscode.ours.diffs.revert` (palette only while a turn diff is focused).
- How: a capture click listener in the webview (src/webview/ours/diffs.ts) takes his "Open diff" button when the turn's box holds two or more files and sends `diffs.openAll` with the box's checkpoint id; the host (src/host/ours/diffs.ts) finds that row in the view's snapshot and calls his public `hostState.prepareTurnDiff` and `loadTurnDiffFile`, keeps the texts under its own scheme `t3-ours-diff` (the last 10 views) and runs `vscode.changes`. A wrap of his `hostState.loadTurnDiffFile` remembers the last 100 loaded files with their turn folder and change type, so Open File and Revert on his single diff use the turn's own folder (a worktree too) and never guess; a diff not in that memory is refused ("open it again"). No line of his changed; his nativeDiff.ts QuickPick stays as the fallback. The revert rule is src/host/ours/diffsRevert.ts (tested).
- Live test: after a turn that changed several files, click "Open diff": one view lists all files. Right-click inside one file's right side, "Revert File to Before This Turn", confirm: `git diff` no longer shows that file. Edit a file the turn changed, then try Revert on it: it refuses.

## Q17 approvalKeys: Approvals and questions by keyboard

- What: while an approval card shows above the chat box, Alt+1..9 presses its Nth button (each button shows its key, for example "Approve Alt+3"). On a question card, Alt+N picks option N of the question that holds focus, else of the first unanswered question, else of the last; a card without multi-select questions sends itself once every question has an answer. After any answer (key or mouse, Dismiss too) focus goes back to the chat box, so typing goes on.
- Keys: Alt without Ctrl, Shift or Meta, on the digit row (`event.code` Digit1..9). Ctrl+Alt is AltGr on German layouts and is left alone. T3 itself uses plain 1-9 for questions (t3-facts `pending-input-digit-keys`); Alt keeps typing in the chat box safe.
- VS Code binds Alt+1..9 to "open editor N" on Windows and Linux, and a webview forwards every keydown to it. The key is swallowed only while a card is on the page and the number matches a button or option, even while that answer is sending; otherwise Alt+N still switches editors.
- Menu bar: VS Code saw the Alt keydown but not the swallowed digit, so an Alt release that reaches it first reads as a lone Alt tap and focuses the menu bar. When Alt is released before the digit, both keyups are kept from VS Code. Known limit: VS Code then believes Alt is still held until the next modifier key or window blur, so toolbars may show their Alt variant (Split Editor Down instead of Right) until then. Checked against VS Code 7baac39ec3.
- Settings and commands: none.
- How: src/webview/ours/approvalKeys.ts, window capture listeners that click his buttons and inputs (his PendingRequests.tsx) and send his `t3-focus-composer` event once the answer settled. No line of his changed.
- Live test: with a chat in approval mode, let the agent run a command; press Alt+3 (Approve) and keep typing: the text lands in the chat box. Do it twice: once releasing the digit first, once releasing Alt first. Both times the menu bar must not take focus and the typed text must land in the chat box. With no card showing, Alt+1 still switches to editor 1.

## Q18 rowCopy: Copy and time on transcript rows

- Copy: expand a command or tool row in a chat and point at its command, its output or the tool input: a copy button shows at the top right of that box. One click puts the exact text on the clipboard (through his copyText, so vscode.env.clipboard); the icon turns into a check for 1.5 s.
- Time: point at a sent message to see "Sent" with the date and time in its tooltip; point at the "Assistant" header of a response to see "Started" and, once the run is done, "Finished", each with its time. A run the server still reports as active (also one waiting on an approval) shows no "Finished". Local date and time format.
- Settings and commands: none.
- How: no line of his changed. src/webview/ours/rowCopy.ts uses window listeners: one shared floating button (his boxes scroll and React rewrites their text while output streams, so a button inside them would not stay) and a title set on hover from the newest state snapshot. The row keys come from his DOM (data-search-row, data-run-header); a key not yet in the snapshot asks the host for the state once. The title text is src/shared/ours/rowTime.ts (tested).
- Files: src/webview/ours/rowCopy.ts, src/shared/ours/rowTime.ts, src/shared/ours/rowTime.test.ts.
- Live test: hover a message you sent and see the time; hover the Assistant header of a finished answer and see Started and Finished, and of a run waiting on an approval and see only Started; expand a command, hover its output, click the copy button, paste into an editor.

## Q19 threadActions: Snooze, regenerate title, mark unread, copy branch or ID, stop a subagent

The thread menu (right-click a session, or the chevron in a chat header) gets the T3 app's missing thread actions, below his own rows and above Delete.

- Snooze...: a QuickPick of T3's own presets (in 1 hour, in 3 hours, this evening, tomorrow, next week), then `thread.snooze`; when the chat is already snoozed, "Wake thread" (`thread.unsnooze`) comes first. Hidden when the server lacks `threadSnooze` or the chat is archived.
- Regenerate title: `thread.metadata.update` with `regenerateTitle`; the new title arrives through the normal thread list. Hidden without `threadTitleRegeneration`.
- Mark unread: `thread.mark-unread`. Hidden without `threadVisitedTracking`. The effect shows in the T3 app; this extension shows no unread marks and never sends `thread.visit`.
- Copy branch (only when the chat has one) and Copy thread ID: to the clipboard, with a status bar note.
- Stop subagent: on a subagent chat that is working (its own header menu, or its row under "Subagents" in Sessions). As T3: a provider-native subagent stops through `subagent.stop` on its parent run, any other by interrupting its own run.
- Command "T3 VSCode: More Thread Actions" (`t3-vscode.ours.threadActions.more`, also in the T3 view's "..." menu): the same entries as a QuickPick for the focused chat. His "Thread Actions" QuickPick is unchanged.
- How: src/webview/ours/threadActions.ts notes which thread the menu opens for (capture listeners on the row and the header button), watches for his `.thread-actions-popup` portal and inserts the rows; the host (src/host/ours/threadActions.ts, requests `threadActions.list` and `threadActions.run`) decides which apply from the server flags (src/host/ours/threadActionsList.ts, tested) and runs them. No line of his changed.
- Settings: none.
- Live test: right-click a chat in Sessions, Snooze..., "In 1 hour": the chat moves to Snoozed in the T3 app; right-click again, Snooze...: "Wake thread" is offered. Regenerate title on a chat: its title changes after a few seconds. Copy thread ID and paste it somewhere.

## Q20 contextMeter: Context left, and Implement on a plan

- Capability check: the vendored nightly contracts carry `contextUsage` on the provider thread (vendor/contracts/src/orchestrationV2.ts:981) and a live `tokenUsage` on each provider turn (:1090), so both halves are built.
- Context chip: next to the send button a small chip shows how full the chat's context window is, for example "62% context" (or "45k tokens" when the provider gives no window size); hover shows used and total tokens. From 80% it is drawn stronger. In a narrow composer (the sidebar) only the number shows. It follows T3's web app: the newest live report on a provider turn first, else the active provider thread's `contextUsage`. No report, no chip.
- Plan cards: each "Proposed plan" card gets "Implement" (switches the chat to default mode and sends "PLEASE IMPLEMENT THIS PLAN:" plus the plan, as T3's web app does) and "Open as markdown" (the plan in an untitled markdown editor). The host looks the plan up by its transcript row key; the webview sends no plan text. While the plan still streams or the chat is working, Implement only warns, as T3 offers it only for a finished plan. With text, references or attachments in the composer, Implement also only warns "Send or clear the text in the composer first": his send clears the composer draft and releases its attachments.
- Setting `t3-vscode.ours.contextMeter.show` (section "Fork: Context Meter", default on). T3's own meter switch `contextWindowMeterEnabled` is a browser-local client setting the extension cannot read, so this one replaces it.
- How: no line of his changed. The host reads the thread projection from HostState's private `threads` map by name (a guarded shortcut; if upstream renames it the chip hides and the fork log says so once). The webview adds the chip and the buttons through the DOM (a MutationObserver, his `.composer-send-controls`, `.plan-card > header` and `data-search-row`).
- Files: src/host/ours/contextMeter.ts (requests contextUsage, planImplement, planOpen), src/host/ours/contextUsage.ts (the derivation, tested), src/webview/ours/contextMeter.ts.
- Live test: open a long chat: the chip shows a percentage that rises after the next turn. Switch a chat to plan mode, ask for a plan, click "Implement" on the card: the chat leaves plan mode and starts implementing. "Open as markdown" opens the plan in an editor.

## Q21 shiftHint: Hold Shift to drop, shown over the composer

- What: when a file dragged from the Explorer or a tab bounces off a chat (detected as a dragenter followed by a dragleave within 500 ms; see section I for why this cannot happen today), a small note "Drop on \"Drop files here\", or Ctrl+C then Ctrl+V" shows over the composer box for 2 s, right where the drag was. The toast from I stays (at most once per 5 s); the note shows on every bounce.
- The note takes no pointer events, so a following Shift-drag drops through it. It is a polite live region for screen readers.
- Settings and commands: none.
- Files: src/webview/ours/shiftHint.ts (the note), one call in src/webview/ours/drop.ts where the bounce is detected.
- Live test: none possible today. A VS Code drag never reaches the chat page (section I, proof), so the bounce is never detected and the note never shows. It stays for a VS Code build that lets such drags through.

## X1 models: The model picker lists what T3 lists

- Root cause: T3 keeps favorites, hidden models and model order in its server settings, shared by every client of the environment, and its picker hides what is hidden there. His picker kept its own copy in VS Code (defaulting to "hide legacy" only) and never read T3's, so every model hidden in T3 (hundreds of OpenCode routes, old Claude and GPT versions) still showed.
- What: the picker now uses T3's shared preferences, live: hide or reorder a model in T3 and the VS Code picker follows without a reload. Stars, the Manage models checkboxes and drag-to-reorder in VS Code write back to T3 (setModelFavorites, setModelsHidden, setProviderModelOrder: only the change, applied under T3's settings lock), so T3's own picker follows too.
- Fallback: while T3 has not yet migrated the preferences to the server (both fields null), or no server is connected, his VS Code store runs as before. A failed write to T3 is logged in "T3 VSCode (fork)" and lands in his VS Code store instead (the picker then still shows T3's list).
- How: no line of his changed. wrap() replaces `modelPreferences` and `saveModelPreferences` on HostState's private options object (read on every call). T3 answers a write with the new settings before its settingsUpdated event arrives; that answer is used until the event lands, so a checkbox does not flicker back.
- Not copied from T3: T3 also hides the models of a provider that is enabled but not ready (not installed, unavailable, needs sign-in); his picker shows those rows greyed with "Not installed" or "Unavailable". An instance T3 has preferences for shows its legacy models inline (his rule for any instance with saved preferences), where T3 folds them under "Legacy".
- Settings and commands: none.
- Files: src/host/ours/modelSync.ts, src/host/ours/modelSyncRules.ts (the mapping and the delta rules, tested).
- Live test: open the model picker: the OpenCode count matches T3's picker. Hide a model in T3's settings: it disappears from the VS Code picker. Untick one in Manage models: it disappears from T3's picker.

## X2 chatlook: Who wrote what, at a glance

- What: the chat tells your messages from the assistant's replies the way the Claude Code and Codex chats do. Your message is a tinted bubble on the right (the theme's link color at low strength, a thin border, a squared bottom-right corner) under a small "You" label. The assistant's turn runs full width behind a quiet left rule that starts at his "Assistant" header with the T3 mark and ends at the turn's last row. A new message from you opens with extra space. Tool and command rows ("Worked for", "Ran ...", "Edited ...") are smaller and muted, their opened output stays in full color.
- Colors come only from VS Code theme variables, so light, dark and high contrast follow the theme (high contrast draws the bubble with the active contrast border and the rule with the contrast border). Narrow sidebar: the rule moves in and the bubble keeps his width rule.
- Setting: `t3-vscode.ours.chatlook.style`, `bubbles` (default) or `plain` (the original look). Changes apply at once to every open chat.
- How: one stylesheet scoped under `html[data-ours-chatlook="bubbles"]`, injected by the webview module; no edit in his components. The "You" label is CSS content, so copy and search keep the plain message text.
- Files: src/webview/ours/chatlook.ts (the look and the attribute), src/host/ours/chatlook.ts (the setting: asked once per view through the ours channel, pushed on change), package.json (section "Fork: Chat look").
- Anchors: his class names .timeline-row, .user-message, .user-bubble, .message-author, .work-group-toggle, .work-entry and the ported WorkLog's text-sm/text-secondary-label. Re-check them after an upstream merge (typecheck cannot).
- Live test: open a chat with a few turns in the sidebar and in an editor tab: your messages sit right in a tinted bubble under "You", each reply has the T3 header and a left rule down to its end, tool rows are grey. Switch the setting to `plain`: the original look comes back without a reload. Try a dark, a light and a high contrast theme.

## X3 titlebtn: Regenerate title from the chat header

- What: a small sparkle button right after the thread title in the chat header, tooltip "Regenerate title". A click asks T3 for a new AI title; the button spins (and is disabled) until the new title replaces the old one in place, at most 45 s. Shown only when the server sets `threadTitleRegeneration` (the same rule as Q19's menu entry).
- Also "Regenerate Title" in the T3 view's "..." menu (last group, next to "More Thread Actions") and in the Command Palette (`t3-vscode.ours.threadActions.regenerateTitle`), both when the chat in front shows a thread. On a server without the flag the command says so.
- How: no second code path. The button sends Q19's `threadActions.run` request with `regenerateTitle`; the command calls Q19's own `run` in src/host/ours/threadActions.ts. The webview module src/webview/ours/titleButton.ts asks `threadActions.list` once per thread, appends the button to his `.chat-heading` and puts it back when his header remounts. No line of his changed.
- T3 itself shows this action in its thread menu (threadActionMenu.logic.ts, "Regenerate title"); the header button is the fork's shortcut to it.
- Settings: none.
- Live test: open a chat, click the sparkle next to its title: it spins and a few seconds later the title changes. The T3 view's "..." menu has "Regenerate Title" in its last group, after "More Thread Actions".

## R1 theme: The chat uses VS Code's own colours

- What: in the side bar the chat and the sessions list take the side bar colour (his tokens used the editor colour everywhere), chips, change cards and the plain-look user bubble get a 7% foreground tint so they stay visible there, and only one line runs under the "Back to" bar. Everywhere: icon buttons hover with the toolbar hover colour, buttons are VS Code's secondary buttons (a primary button now darkens on hover with the button hover colour; before it did not change), the "..." and thread action menus use the menu colours, the @ and / suggestions use the list selection colour, scrollbars use the scrollbar slider colours, the composer border and focus ring use the focus border (1 px, inside, so nothing clips it), the connection dot uses the test-passed green and every popup shadow uses the widget shadow. High contrast draws a dashed contrast outline on hovered buttons and menu rows.
- Text floor: every 9 and 10 px text of his (model picker notes, footnotes, list meta, find counts, composer shortcuts and so on) is raised to .6875rem, 11 px at the default interface size; fixed px sizes (Latest, message rail, shift hint) are now rem, so they follow the interface size. X2's .75rem work rows are untouched.
- Also: Copy and "use again" on your messages show on hover or keyboard focus, like the assistant's; the plan card wraps its actions under the title and is tighter below 420 px.
- How: one stylesheet in src/webview/ours/polish.ts, appended after his, so a rule that copies his selector wins on order; `body[data-ours-surface="sidebar"]` is set once from the host's own `data-surface` at load (layout.ts later flips `data-surface` to "panel" for a chat in the side bar). No line of his changed; the editor-tab chat keeps the editor colour.
- Settings and commands: none.
- Files: src/webview/ours/polish.ts, src/webview/ours/shiftHint.ts (12 px to .75rem).
- Anchors: his class names and selectors in src/webview/styles/tokens.css (the small-text list is copied from there). Re-check them after an upstream merge.
- Live test: Dark Modern, Light Modern and HC Dark, chatlook bubbles and plain: side bar chat and list show no colour seam, user bubble and chips visible; hover each button kind and menu row; Tab into the composer; narrow the side bar to 300 px with a plan card (actions wrap to a second line), then open a plan card in a wide editor tab (Copy sits right next to Implement); check the Latest button now uses the secondary button colour.

## R2 defaults: A new chat starts with my T3 model

- What: a new chat in VS Code starts with the model picked as default in T3 (Settings, New threads; a project override in T3 wins), as T3 web does. Before, his draft took the model of the chat in front or the first provider's model. A model you pick in the draft stays; changing the default in T3 moves an untouched draft at once (T3's settingsUpdated reaches client.config, his onConfig re-emits).
- Never picked: a T3 default that the picker hides (X1's shared list, legacy models included) or whose provider is off, missing or unavailable. Then his fallback runs, minus hidden models: if it lands on a model the picker hides (the chat in front's model, or a provider's default), the draft takes the first provider's default model if shown, else its first shown model. While his project record names a default model (hostState.ts conversationDraft), that one stays, because his createThread prefers it.
- Permission mode: stays "auto" (owner question 1 of QOL-ROUND-2: T3's environment mode decodes to full-access when never set, so following it would silently widen). Only a project override of the mode in T3 is followed, and only until you pick a mode in that draft.
- Tooltips: the permission picker shows T3's one-line meaning of each mode on hover (from T3's docs/user/permission-modes.md).
- How: no line of his changed. wrap() replaces HostState's private conversationDraft (every draft caller goes through it) and setModes (to note a picked mode); both are read by name, and an upstream rename turns the feature off with one line in "T3 VSCode (fork)". The rule is resolveProjectSettings from the vendored @t3tools/shared, checked against visibleProviderModels (src/host/ours/defaultsRules.ts).
- Settings and commands: none.
- Files: src/host/ours/defaults.ts, src/host/ours/defaultsRules.ts (+ test), src/webview/ours/defaults.ts.
- Live test: set Claude as the default model in T3, open a new chat in VS Code: it shows Claude. Pick another model in the draft: it stays. Hide the default model in T3: the new chat falls back to another model, never the hidden one. Hover the permission picker: the mode's meaning shows.

## R3 viewbar: Native view title buttons, one header row

- What: the T3 side panel uses real VS Code view title buttons. In the sessions list the title bar has "+" (New Chat); in a chat it has a back arrow (Sessions) and a pop-out (open this chat in an editor tab), and our slim "Sessions / pop-out" bar and his duplicate History button are gone, so a chat has one header row. The view title says "Sessions" in the list and the chat title in a chat, with the project name beside it, instead of "T3 VSCODE" twice. Every editor title bar has a T3 button (Focus Chat Input), as in the Claude Code and Codex extensions.
- Thread buttons in the view title (Open in the T3 App, Copy Link, Thread Actions, Regenerate Title) show only while a chat is on screen (or in editor-tab mode with a chat focused), not over the sessions list.
- In sidebar mode his "+" buttons are titled "New chat" (they open the chat in the side panel); his list "+" keeps its aria-label "New thread".
- How: src/host/ours/layout.ts sets the context `t3-vscode.ours.sidebarChat` wherever the K layout flips list and chat, wraps his public `updateTitles` (he resets the sidebar title on every state change) to set the view title and description, posts `layoutMode` for the tooltips, and registers `t3-vscode.ours.viewbar.sessions` (runs his showThreads) and `t3-vscode.ours.viewbar.popOut` (the webview runs his openInTab path, draft included). src/webview/ours/layout.ts holds the hide CSS and the tooltip observer. package.json: view/title and editor/title entries, icons on chat.new and chat.focus. No line of his changed.
- Settings: none.
- Live test: the side panel list shows "+" in its title bar; open a chat: the title bar shows the chat name, the back arrow and the pop-out, and inside the panel only his chat header row is left. Any text editor shows the T3 icon top right.
- Limit: VS Code shows view title buttons always only while T3 is the only view in its container; with the drop view turned on they appear on hover.

## R4 working: Live "what and how long", and "done" is announced

- While T3 works, his "Working" label in the chat header (also the sticky copy at the top and the footer one) is followed by the time since the run started and the step it is on, for example "Working 1m 12s - npm test". It counts once a second. The step is the newest running step of the active run, with the same label his rows show.
- At the end of a finished response, "Worked 2m 14s" stands in front of Copy and Fork: the run's first start to its last finish.
- While his stop button shows, the composer hint reads "Enter to queue - Esc to stop" (Q5 makes Escape stop the turn).
- A screen reader hears "Response finished" (or "Response failed", "Response stopped") when the shown chat stops working, after 2 s without new work, as the finished toast waits. A chat switch is never announced.
- Status bar: one running chat reads "T3: running 3m"; the hover lists each running chat with its minutes. It repaints every 30 s while something runs.
- How: no line of his changed. src/webview/ours/working.ts adds a sibling span after his `.working-label` (that label is a live region; a ticking clock inside it would be read out every second), a span in `.response-end`, one CSS rule on `.composer-shortcuts` and a hidden polite live region. The pure parts (clock, run total, current step, end phrase) are in src/shared/ours/working.ts (tested). src/host/ours/activity.ts and statusbar.ts add the minutes. A new webview file instead of latest.ts, so R5 and R9 merge without conflicts there.
- Settings and commands: none.
- Live test: send a prompt that runs a command: the header counts up and names the command; at the end "Worked ..." shows next to Copy; with NVDA on, it says "Response finished". The status bar shows "T3: running 1m" during a long turn.

## R5 scroll: Sending jumps down, switching chats keeps my place

- Send: when this chat starts sending while the agent is idle, a chat scrolled up jumps to the latest message at once (through Latest, so his "follow the end" resumes). While the agent works, a steer jumps down when the new message lands in the conversation; a queued message does not move the view, because it shows next to the composer anyway.
- Switch: each chat's scroll place (the first visible row and its offset) is remembered per tab while you read. Going back to a chat in the same tab, or Sessions then the chat again in the side panel, puts it back over about one second instead of his jump to the end. A chat left at the end still opens at the end. Wheel, click or a key during that second hands control back to you; a search or citation jump that moves the list stops the restore.
- The list is virtual, so the restored place is approximate when the remembered row is far from the rendered part. The memory lives in the webview: closing the tab or reloading the window forgets it.
- Settings and commands: none. No line of his changed.
- Files: src/webview/ours/scroll.ts.
- Live test: scroll up in a chat, send: the view jumps down. Open chat A, scroll up, switch to chat B, back to A: A is where you left it.

## R7 diffcard: A changes card for every turn that edited files

- What: his "N changed files / Open diff" card needs a snapshot taken right before the turn, which he only takes for a fresh send from VS Code. Queued, steered, T3-app and older turns showed no card. Now they show one from the turn's checkpoint range (the previous turn's checkpoint to this one), with the note "May include your own edits" (owner default). Open diff and the all-changes view (Q16) use the same range.
- How: no line of his changed. A wrap of `hostState.prepareTurnDiff` catches only his "Agent-only diff unavailable" error, builds the range with his `turnCheckpointRange` and `turnDiffFiles` and `client.getSavedTurnDiff`, and posts `diffcard.mixed` with the checkpoint id; the webview appends the note to that `.turn-changes` card. Any other failure gives his original error back (logged at info in the fork log).
- Not built: interrupted runs. His `turnCheckpointRange` (turnDiff.ts) and `TurnChanges.tsx` both require a completed run; relaxing that needs his files.
- Settings and commands: none.
- Files: src/host/ours/diffcard.ts, src/webview/ours/diffcard.ts.
- Live test: while a turn runs, queue a second message that edits a file; when it finishes, its card shows "N changed files", Open diff, and "May include your own edits".

## R8 errors: Errors I can read

- What: a turn error gets a heading line above it: the kind of failure ("Connection error", "Usage limit reached", "Provider error", "Permission denied", "Invalid request", else "Error"), then the retry state and the code: "Retrying 2/5 in 4s" (a live countdown) while the run still waits on that retry, "Attempt 2/5" on an older error, "Will not retry" when the provider says so, and "resets 14:05" for a usage limit with a reset time. On the right: "Show more" (only when the text is longer than 4 lines; the error is clamped to 4 lines and keeps its line breaks), "Copy error" (heading, state and message to the clipboard) and "Show Logs" (writes the error into the "T3 VSCode (fork)" log, then opens it). His Retry button under the error (Q11) stays.
- "N failed" on a collapsed group of steps is a link now: a click opens the group (it never closes it) and every failed step in it.
- A session row (sessions list, History) whose last run failed gets a red dot before its title (`thread.status === "failed"`).
- How: no line of his changed. The webview adds the heading as the sibling before his `.turn-error` (reprompt.ts owns the sibling after it) and only data-ours-* attributes on his elements; failure class and retry come from the newest state snapshot by row key. A window capture click handles "N failed".
- Settings and commands: none. RPC kind `errors.showLogs` (runs `t3-vscode.ours.log.show`).
- Files: src/webview/ours/errors.ts, src/host/ours/errors.ts, src/shared/ours/errors.ts (the wording, tested).
- Live test: make a command fail on purpose (ask the agent to run a command that exits with 1; if T3 does not mark that step failed, any step T3 marks failed works): its group shows "1 failed"; a click opens the group and the failed row. Make a turn fail (stop the T3 server mid-turn, or hit a usage limit): the error has a heading, Copy error copies it, Show Logs opens the fork log with the error in it. The chat's row in Sessions shows a red dot.

## R9 openline: Open the edited file at the change

A click on an edited file's name in a chat opens the file at its first changed line, not at the top. While the agent is editing a file, the "Editing X" step on a collapsed work group is a link that opens X.

- File names: his file row sends the bare name; ours adds `:N`, where N is the first added or removed line of the row's diff (the hunk header's start plus its leading context lines). A diff without a hunk header opens at the top as before. Only Codex threads carry a unified diff with a hunk header (CodexAdapterV2.ts: `diffStr: firstChange.diff`); a Claude thread's edit carries the tool's result text instead (ClaudeAdapterV2.ts: `diffStr: outputText`), so in a Claude thread every file opens at the top. His request, thread and error banner stay his.
- "Editing X": the Q10 label for a running file edit becomes a real span; a click opens X (at the change when the diff is already known) and does not fold the group open. Other running steps keep the Q10 text.
- How: src/webview/ours/openline.ts (a capture click listener notes the line, a bridge.request wrapper puts it on his openLink; the span on the work group header); src/shared/ours/openline.ts finds the line (tested); src/shared/ours/latest.ts exports `runningSteps` for it. Relies on his class names `.file-change`, `.file-change-heading .text-button`, `pre.diff`, `.work-group-toggle` and `data-message-key`; re-check them on each upstream merge.
- Settings and commands: none.
- Live test: in a finished turn of a Codex thread open a work group, expand an "Edited x.ts" row and click the file name: the editor opens at the first changed line. During a turn that edits a file, click "Editing x.ts" on the collapsed group: the file opens.

## R10 dropview: The "Drop files here" view is hidden unless you turn it on

- What: the empty "Drop files here" view (from I) no longer sits under the side panel chat. It shows only with the setting `t3-vscode.ours.drop.showView` (section "Fork: Drop files view", default off). Turn it on and it comes back, collapsed on a profile that never showed it; a drag without Shift onto it still adds the files to the focused chat.
- Who loses something: a user who dropped files on that view must turn the setting on. Without it, hold Shift while dragging onto the chat (Q21 shows a hint) or select files in the Explorer, Ctrl+C, then Ctrl+V in the chat.
- How: package.json only. The view entry gets `"when": "config.t3-vscode.ours.drop.showView"` (a `"visibility": "collapsed"` alone would not help a profile that already showed the view expanded) and `"visibility": "collapsed"`. src/host/ours/drop.ts still creates the tree view; VS Code keeps it registered while hidden. No line of his changed.
- Settings: `t3-vscode.ours.drop.showView`. Commands: none new.
- Live test: on the existing profile the view is gone under the T3 sidebar. Set `t3-vscode.ours.drop.showView` to true: the view comes back; drag README.md from the Explorer onto it without Shift: a reference lands in the focused chat.

## R11 actions: One Thread Actions list, and Archive can be undone

- What: one "Thread Actions" QuickPick (`t3-vscode.ours.threadActions.more`, formerly titled "More Thread Actions") has every action for the chat in front: his five rows (Rename, Pin or Unpin, Settle or Unsettle, Archive or Restore, Delete) then, under a separator, Q19's rows (Stop subagent, Snooze, Regenerate title, Mark unread, Copy branch, Copy thread ID). The T3 view's "..." menu, the chat tab's "..." menu and the Command Palette all open this list, each only while the chat in front shows a thread. His "Thread Actions" command stays registered but is hidden from the view menu and the palette.
- Rename asks in an input box (an empty title is refused) and Delete asks in a modal, as his own prompts do; after the prompt the thread and the view are checked again before the action runs.
- Undo: after any Archive (his thread menu in the chat, this list, his hidden command) a toast "T3: archived "<title>"." offers Undo, which restores the thread.
- How: no line of his code changed. The rows and prompts are rebuilt in src/host/ours/threadActions.ts and run through the public `hostState.threadAction`; wrap() on `hostState.threadAction` shows the Undo toast after an archive succeeds. package.json: our menu and palette entries point at the full list; his view/title entry for `t3-vscode.threadActions` has `"when": "false"` (the one changed token on one of his lines; drop it on a merge conflict and the "..." shows both lists).
- Regenerate Title keeps its own entry in the view "..." menu (X3).
- Settings: none.
- Live test: open a chat in the side panel and in a tab: both "..." menus show "Thread Actions" with the same rows. Archive a chat from any menu, click Undo in the toast: the chat is back in the list.

## R12 setup: Pairing works with only the T3 app, and connects by itself the first time

- What: a Windows user with only the T3 desktop app (no `t3` on PATH) pairs anyway, also when the 30-day token runs out: when `t3` is not found, pairing runs the app's own launcher `<T3 home>/bin/t3.cmd` (`bin/t3` on macOS and Linux), which the installed app keeps up to date on every start (T3's DesktopCliShim.ts). If neither exists, the "t3 command could not be found" screen stays as before.
- First run without a click: with nothing paired yet and VS Code started before T3, the reconnect watcher (Q4) now pairs once as soon as T3 writes its server-runtime.json and answers, or when the VS Code window gets focus while T3 runs. At most one such pairing until a connection succeeds; a failed pairing ends on his pairing screen (Pair again), so it never loops. The 10 s poll still never runs the CLI.
- Wording: "Pairing with T3 Code..." gets a line "can take up to 45 seconds". On Windows his setup screen also says: install and open the T3 Code app (`winget install T3Tools.T3Code`), the app keeps the server running and VS Code connects by itself, the t3 command line is the alternative (missing or stopped server, not with a custom startup hint); on "t3 command could not be found": T3 Settings -> General -> About, Install the t3 command, then quit VS Code fully. The Q4 button reads "Open T3 app (new chat)".
- His file touched: src/host/pairing.ts `runPairingCommand` (an optional `command` parameter and three lines in its catch; upstream candidate). Everything else is ours: src/host/ours/reconnect.ts, src/webview/ours/reconnect.ts (DOM notes inside his setup heading and status card), test src/host/ours/pairingLauncher.test.ts.
- Settings and commands: none.
- Live test: isolated T3 home with no `t3` on PATH but `<home>/bin/t3.cmd`: pairing succeeds. Start VS Code first, then the T3 app: the view connects without a click.

## R13 focus: Focus never drops to the page

- Sidebar: opening a chat from Sessions puts the caret in its composer (his own focus path, so the remembered caret comes back). "Sessions" puts focus on the row of the chat just left, else the active row, else "Search threads"; the restored list scroll is kept.
- Removing an attachment or reference chip moves focus to the next chip's X, or to the message box after the last one.
- Tabbing out of a popup (model picker, history, thread menu, composer options, quote comment, find filters, equation menu, image preview) closes it, and focus stays where Tab put it, so Escape stops a running turn again.
- Rule: a popup closes only when Tab leaves from inside it (or focus comes from the body or VS Code). A popup that opens without taking focus (find filters, portaled to the end of the page) stays open until Tab reaches into it.
- Only acts while the webview has focus and only when focus was lost (body, a removed or hidden element); it never moves focus the user or his code already placed.
- How: no line of his changed. src/webview/ours/focus.ts: a MutationObserver on body[data-ours-chat] (set by layout.ts), a capture click listener on the chip X buttons and a window focusin listener that sends the popup a synthetic Escape (the popup list is the one escape.ts exports). That listener ignores focus moved by the pointer (from a pointerdown until the next key press): a click on the popup's own button must toggle it closed, and his outside-click handlers cover the rest.
- Settings and commands: none.
- Live test: keyboard only in the side panel: Enter on a session row, type at once; Tab to "Sessions", Enter: focus is on that chat's row (Enter reopens it); add two files, Tab to the first X, Enter, Enter: both go and the caret is in the message box; open the model picker, Shift+Tab: it closes; in Find, Enter on "Search filters", then Tab until focus is inside the filters popover: it stays open and the filters are reachable, Tab out of it: it closes; start a turn, Escape stops it. With the mouse: open the model picker, click its button again: it closes.

## R14 keys2: Keys inside T3

- What: keys that work while a T3 chat or the sessions list has focus.
  - Ctrl+Alt+C toggles: in an editor it jumps into the T3 chat (Q2), inside T3 it jumps back to the editor: from the side panel `workbench.action.focusActiveEditorGroup`, from a chat tab `workbench.action.openPreviousRecentlyUsedEditorInGroup` (the tab shares the code's group, so focusing the group would land on the chat again; context `t3-vscode.ours.inT3Tab`).
  - Ctrl+N (Cmd+N) inside T3 starts a new chat (`t3-vscode.ours.chat.new`); everywhere else it stays VS Code's New File.
  - Ctrl+Alt+W, "Go to Next Chat That Needs You" (`t3-vscode.ours.chat.nextWaiting`, in the palette while connected): opens the next chat waiting for an approval or an answer, cycling from the chat in front. "Open the Session That Needs You" without an argument now does the same.
  - Sessions list (side panel list and his History popup): Up, Down, Home, End move over the rows; Down in "Search threads" goes to the first row; F2 renames (his prompt); Delete archives the row (the R11 toast offers Undo) and keeps focus on the next row; an archived row ignores Delete. Ctrl+F in the list focuses "Search threads"; in a chat Ctrl+F stays his find.
  - F2 in a chat renames it (his header rename was double-click only).
- How: the webview (src/webview/ours/listKeys.ts) reports window focus and blur through the ours RPC `keys.focus`; the host (src/host/ours/keys.ts) sets the context `t3-vscode.ours.inT3` while any T3 webview has focus, and a wrap() on `registry.remove` clears a view closed while focused. If the context goes stale anyway (a view hidden while focused), the bindings also check `editorTextFocus` (and `listFocus` for Ctrl+N), so Ctrl+Alt+C from a text editor still jumps into T3 and Ctrl+N in the Explorer stays New File. Own key instead of `focusedView`, as Claude Code does with its `sideBarActive`: `focusedView` is not proven to match inside a webview. Delete runs the ours RPC `keys.archive`, which calls `hostState.threadAction(id, "archive")`, so R11's Undo wrapper applies. F2 calls his `threadAction` bridge method with `rename`, so his own input box asks. No line of his changed.
- Settings: none. Rebind or remove any of the keys in Keyboard Shortcuts.
- Live test: in a chat tab and in the side panel: Ctrl+Alt+C out and back (in a chat tab, Ctrl+Alt+C brings back the code tab; in the side panel it must not switch editor tabs); Ctrl+N while typing in the composer; Ctrl+Alt+W with two waiting chats (it cycles); in the sessions list Down, End, Home, F2, Delete (Undo toast, focus on the next row), Ctrl+F. Check Keyboard Shortcuts for conflicts on Ctrl+Alt+W.

## R15 announce: Screen readers hear new cards, and Alt+1 hits the right one

- What: when an approval, question or secret card appears, a hidden polite status line says what it is and which keys answer it, for example "Approval needed: Command approval, pnpm run test. Alt+1 Decline, Alt+2 Allow this session, Alt+3 Approve." A question says its first question (and how many there are) and its options; a secret request says its label. A card is announced once, by its text: an unchanged card that re-renders (his "1/N" count, "Sending...") stays quiet. The line empties after 7 s. No Alt hints on macOS, where Alt+N does not exist.
- Alt+N fix: the secret card sits first in the composer column and also carries `.pending-requests .approval-card`, so Alt+1 used to press its Decline while an approval showed. Now Alt+N goes to his approval card, else his question card, and only then to the first secret card; the "Alt+N" hints on the secret buttons hide while one of his cards shows, and those on question options hide while his approval shows. A card that Alt+N does not reach is announced without keys; when its reachability changes it is announced again: with its keys once the approval was answered, and without keys when an approval arrives over a question or one of his cards over a secret card.
- Also: the secret container is a region named "Secret request"; the context chip is a `meter` named "Context used" (value 0 to 100, focusable, warning colour from 80%, error colour from 95%; a tokens-only label gets no meter role); the Plan/Build toggle has the fixed name "Plan mode" with `aria-pressed`; the plan card's "Implement" is a primary button.
- Settings and commands: none.
- Files: src/webview/ours/approvalKeys.ts (routing, live region), src/shared/ours/announce.ts (the sentence, tested), src/webview/ours/secrets.ts, contextMeter.ts, planMode.ts. No line of his changed.
- Live test: NVDA on, trigger an approval and a secret request together: both are read with their keys; Alt+1 answers the approval (Decline), not the secret card. With only the secret card, Alt+2 opens the password box. Also an approval and a question together: the question is read without keys, Alt+1 answers the approval, and then the question is read again with its keys.

## R16 output: Long output opens in an editor, and copy works by keyboard

- Open in editor: next to the Copy button on a command box or an output box (Q18) a second button opens the whole box in a new untitled editor tab, output as `log`, the command as plain text. Search, scroll and save it like any file.
- Keyboard: the command and output boxes are focusable (Tab). Focus shows the two buttons and the row times as hover does. Enter on a focused box opens it in an editor; Ctrl+C on a focused box with no selection inside it copies the whole box (the button shows the check mark). With a selection inside the box Ctrl+C copies the selection as before. The box has a focus ring and a screen reader label that names both keys.
- Settings and commands: none.
- How: no line of his changed. The webview code is in src/webview/ours/rowCopy.ts (one floating bar for both buttons, a focusin listener next to the mouseover one, a capture keydown listener, a MutationObserver that sets tabindex, role and aria-label on his `pre.command-input` and `pre.tool-output`). The host request `outputOpen` (src/host/ours/output.ts) takes the box text from the webview, as his copyText does; it only opens an untitled document.
- Live test: run a long `npm test` in a chat, hover its output: "Open output in editor" shows all of it in a tab. Tab to the output box, press Ctrl+C, paste somewhere: the whole output arrives.

## R17 hunks: Undo one hunk with VS Code's own revert arrow

Undo a single change of a turn, not the whole file, and edit right inside the diff.

- All changes view ("Open diff" with two or more files): a file whose text (open buffer included) is still exactly what the turn left (line endings do not count) is shown with the real file on the right. VS Code then shows its own revert arrow on each hunk, and the right side can be edited in place. The file is changed in the editor, not saved: Ctrl+Z undoes, Save keeps it. A file that changed after the turn, is missing, or was deleted by the turn stays read-only, as before (owner default).
- His single file diff: a new editor title button "Compare with Current File" opens the same diff with the real file on the right, under the same rule; if the file changed after the turn it says so and opens nothing.
- Open File and "Revert File to Before This Turn" keep working on such a live side (right-click inside the diff); the whole-file revert then refuses once a hunk was undone, because the file no longer matches the turn.
- A file the turn created: the arrow empties it, it does not delete it (Revert File deletes it).
- Settings: none. Command: `t3-vscode.ours.diffs.compare` (palette only while his turn diff is focused).
- How: src/host/ours/diffs.ts `rightSide` swaps the right URI of each `vscode.changes` triple (and of the compare diff) for the `file:` URI when `lf(buffer) === lf(after)`, and keeps a map from that file URI to the virtual after side, so `pairOf` still finds the turn (the latest diff of a file wins). The arrow is VS Code's `DiffEditorHunkToolbar` revert, shown when the modified side is writable (checked in the VS Code 7baac39ec3 bundle). No line of his changed.
- Live test: after a turn that changed several files, click "Open diff", hover a hunk of an unchanged file and click its arrow: the file changes, Ctrl+Z restores it. Edit a file the turn changed and open the view again: that file has no arrows. On a one-file turn, click "Compare with Current File" in his diff's title: the arrows show.

## R18 substop: Stop a running subagent from its card

- What: a subagent card in the parent chat gets a square Stop button (before its Details chevron) while the subagent works. Stop runs Q19's "Stop subagent" on the child: a provider-native child stops through its parent run (`subagent.stop`), any other by interrupting its own run, as T3's web app does. The button greys out after the click and leaves once the child reads as idle.
- Shown only where Q19's thread menu offers "Stop subagent": the child thread is in this workspace's list, is a subagent with a parent, and works (`threadIsWorking`). A card whose child is not listed (its Open button is disabled too) gets no Stop.
- Settings and commands: none. Host: none (reuses the `threadActions.run` request).
- How: no line of his changed. His card carries no child thread id, so the webview reads its row key (`data-search-row`, TranscriptView.tsx) and finds the subagent item's `childThreadId` in the last state snapshot; an editor tab whose first snapshot was a reply asks for the state once.
- Files: src/webview/ours/substop.ts.
- Live test: start a subagent from a chat; its card shows Stop next to the chevron; click it: the card turns to stopped or interrupted and the button goes away.

## R19 emptylist: The empty sessions list explains itself

- What: when the sessions list has no active chat for this folder, under "No active conversations in this workspace." it shows a "Start a chat" button (same as Ctrl+Alt+Shift+N), the line "T3 has N chats in other folders." with Show (only when N is above 0), and "Alt+K adds the selection, Ctrl+Alt+C focuses the chat."
- Show opens Switch Chat over those chats (title, folder name, full path). They stay outside the workspace filter (owner default: they do not count as this workspace), so picking one does not open it here: a message offers "Open Folder in New Window" for the chat's folder.
- Footer: with no folder open his filter shows every T3 project, so "Current workspace only" reads "All T3 folders (no folder open)".
- Counted: live top-level chats (not archived, not deleted, not subagents) of T3 projects whose folder is not one of this window's folders. A sub or parent folder counts as another folder, as in his exact-root filter.
- How: host src/host/ours/emptyList.ts (RPCs emptyList.info and emptyList.run; reads his private HostState.shell and visibleProjects() by name, logs once if renamed), rule in emptyListRules.ts (+ test), Switch Chat takes an optional "other" argument (src/host/ours/keys.ts). Webview src/webview/ours/emptyList.ts adds the block after his empty line in the full sessions list only (not the compact history of a chat tab). No line of his changed.
- Settings: none.
- Live test: open a parent or sub folder of a T3 project (for example D:\GIT) as the folder: the list shows the block with the count; Show lists those chats, picking one offers its folder; Start a chat opens a new chat. Open an empty window: the footer reads "All T3 folders (no folder open)".

## R20 longmsg: Long pasted prompts fold

- What: a long message of yours (a big paste, a log, a file) shows only its first lines in the bubble, fading out, with a "Show full message" link under it. A click unfolds it; "Show less" folds it back and keeps the bubble in view. So a 300-line paste no longer pushes the answer off screen. Short messages, and messages only a few lines over the limit, are never folded.
- The limit is about ten lines (16.5em of message text), never more than 40% of the view height. Works with both chat looks (`bubbles` and `plain`).
- An unfolded message stays unfolded while the chat is open, also after scrolling it out of view and back (the list remounts rows).
- How: part of X2's module src/webview/ours/chatlook.ts (one stylesheet): CSS clips the bubble's message text (not the bubble, whose "You" label sits outside it), and a MutationObserver adds the toggle button to bubbles whose text overflows. No line of his changed. Copy and search still use the full text.
- Settings: none.
- Live test: paste 300 lines into the box and send: the bubble shows about ten lines and "Show full message"; click it, then "Show less". Try a fenced code block paste too.

## C1 contnative: Continue a T3 chat in Claude Code or Codex

- What: the thread menu (right-click a chat row, the chevron in the chat header, Thread Actions) of a Claude Code or Codex chat gets "Continue in Claude Code..." (or "Continue in Codex...") and "Copy session ID". Other providers get neither.
- Continue in: a pick offers "Open in the Claude Code extension" (or Codex; only when that extension is installed) and "Type the resume command in a terminal" (`claude --resume <id>` or `codex resume <id>`, in a new terminal at the chat's folder, typed but never run). Escape in the pick changes nothing. Then T3 lets go of the session (provider-session.detach, only when T3 still holds it live) and the chat opens in the other tool on the same session.
- A running chat is never handed over quietly: a modal says two tools writing one chat can split it, with "Stop and continue" and Cancel. Only "Stop and continue" stops the T3 run (run.interrupt with the queue held, as the Stop button), waits up to 10 s for it to end, then hands over. If the run does not end, nothing is handed over and an error says so. Messages queued in T3 stay held.
- Copy session ID: copies the Claude session id or Codex thread id (from the active provider thread's nativeThreadRef). A chat that never ran has none; a message says so.
- Opening: Claude Code through its own `claude-vscode.primaryEditor.open` command (what its `/open?session=` link runs, so VS Code asks no "Allow URI" question), falling back to `<scheme>://anthropic.claude-code/open?session=<id>`. Codex through `<scheme>://openai.chatgpt/local/<id>` (VS Code may ask once to allow the link).
- How: host src/host/ours/continueNative.ts (new), two entries in threadActionsList.ts (gated on the driver of the chat's model instance from the server config, + test), two cases in threadActions.ts, two icons in src/webview/ours/threadActions.ts. No line of his changed. T3's `thread.stop` is an internal command (not dispatchable by a client), so the stop is `run.interrupt`.
- Settings: none.
- Live test: in a Claude chat that has run once, pick Continue in Claude Code, Open in the extension: the Claude Code panel opens on the same conversation with its memory; it does not say "still open somewhere else". Send one message there: the .jsonl under ~/.claude/projects grows. Repeat while a T3 run is going: the modal appears; Cancel leaves it running; "Stop and continue" stops it and opens. Same for a Codex chat (the Codex view opens on the thread). Terminal path: the line is typed in a terminal at the chat folder, Enter is yours.
## C3 onewriter: Ask before sending on a chat used elsewhere

- What: you send a message in a T3 Claude Code or Codex chat that was continued in another tool since T3 last wrote to it (the Claude Code panel or CLI, Claude Desktop, the Codex extension or CLI). A modal asks "This chat was used elsewhere. Continue here?" and names the tool and the time. Continue sends as usual; Cancel sends nothing and keeps your text in the box (the chat shows "Not sent: this chat was used elsewhere."). Two tools writing one session can split it; this catches it when it happens by accident.
- Not asked: a new chat, a queued or steered message while T3 is running, a chat of another provider, a session file that is not found, and history written before T3 took the session (a chat imported into T3). Once T3 has written a turn after the other tool, the question stops.
- How it decides (reads the session file on disk, never writes): Claude `~/.claude/projects/*/<session id>.jsonl` (or `CLAUDE_CONFIG_DIR`), the newest record with an `entrypoint`: T3's Agent SDK writes `sdk-ts`, anything else (`claude-vscode`, `cli`, ...) is another tool. Codex `~/.codex/sessions/YYYY/MM/DD/rollout-*-<thread id>.jsonl` (or `CODEX_HOME`, date from the UUIDv7 id), the newest `turn_context`: its `turn_id` must be one of T3's `providerTurns[].nativeTurnRef.nativeId`. Either must also be newer than the provider thread's `createdAt`. Reads the last 1 MiB, the whole file only if needed.
- Hook: wraps `hostState.sendMessage`, like H (save on send); features activate in namespace order, so H may save files before the question, also on Cancel (harmless). Cancel throws `Declined` (new in src/host/ours/wrap.ts: a wrapper's deliberate no passes through and his method does not run). Any failure of the check is logged and the message goes out as before.
- Files: src/host/ours/oneWriter.ts, oneWriterRules.ts (+ test), wrap.ts (Declined). Settings and commands: none. No line of his changed.
- Limits: a T3 provider `homePath` (own CLAUDE_CONFIG_DIR or CODEX_HOME) is not read; Codex ids that are not UUIDv7 are not looked up; another SDK client (`sdk-*`) on the same Claude session is not detected. If you press Continue while the other tool still holds a Claude session, T3's turn can fail with "already in use"; the next send asks again.
- The running-chat side (stop T3 before handing a chat over, with a modal) is C1 contnative.
- Live test: in a T3 Claude chat, note its session id ("Copy session id" of C1, or the projection), open the same session in the Claude Code panel (`vscode://anthropic.claude-code/open?session=<id>`) and send one message there. Close it, send in T3: the modal names "Claude Code in VS Code". Cancel: text stays. Send again, Continue: it sends, and the next send does not ask.

## C2 importchat: Continue a Claude Code or Codex chat in T3

- What: "T3 VSCode: Continue a Claude Code or Codex Chat" (command palette, and the "..." menu of the T3 sessions view) lists the chats of the open folder(s), newest first, titled by the chat's name (Codex session_index, Claude ai-title or custom-title) or its first prompt. Picking one opens it as a T3 chat on the same native session: the agent keeps its whole memory, the T3 view starts empty (earlier messages stay in the other tool). A chat already in T3 (continued here before, or imported by T3's own first-run wizard, thread id import:<instance id>:<native id>) is marked "already in T3" and simply opens that T3 chat; no second thread on one session. One whose T3 chat is archived is marked "archived in T3" and is not imported again: restore it in T3. Archived threads come from his archive snapshot (the shell snapshot never lists them).
- Listed: Codex rollouts of the last 30 days whose session cwd is the folder, interactive only (source vscode or cli). Not listed: chats T3 started (Codex originator "T3 Code", Claude entrypoint sdk-*), Codex jobs the Codex plugin ran for Claude (originator "Claude Code"), exec runs and subagents. At most 50 per tool.
- Claude Code chats: listed only with the setting below on. Off by default because, by reading T3 (ClaudeAdapterV2 resume rule, CONTINUITY-SCOPE facts 3 and 15), the first T3 message on an imported Claude chat sends sessionId instead of resume and may start a NEW Claude session. The live test has not run yet.
- Running elsewhere (owner, 2026-10-15): a chat that is open in the other tool asks first, as a modal: "Two tools writing one chat can split it. Stop it and close it in <tool> first." Open means: Codex holds ~/.codex/thread-writer-locks/<thread id>.lock, or Claude Code has a ~/.claude/sessions/<pid>.json with that session id whose pid is alive (Claude keeps it while the chat is open, also during a long tool call that writes nothing to the .jsonl, and removes it on exit; a file left by a crashed Claude, dead pid, does not count). Second signal: the chat file changed in the last 2 minutes ("may still be running"), kept for Claude or Codex builds and runs that write no session file or lock; it only adds a question. The only way on is "I closed it there, continue"; Esc cancels. That answer is checked for both tools: if the lock or the live session file is still there, it says "still open in <tool>" and stops. Known limit: a crashed Claude's pid reused by another process reads as open (blocks until that file is gone). The fork cannot stop the other tool itself.
- How: src/host/ours/importChat.ts (command, modal, thread.create with importedNativeThread {driver, nativeId, strength: "strong"} as T3's own ACP import, then waits for the thread in his host state and opens it with his openSession), src/host/ours/importChatScan.ts (reads ~/.claude/projects/<slug>/*.jsonl and ~/.codex/sessions, read only, bounded head and tail reads), src/host/ours/importChatParse.ts (rules, + test). The T3 thread id is derived from the native id (UUID-shaped), which is how "already in T3" is found. Model: the first available instance of that driver with its default model, approval-required, as T3's import does. CLAUDE_CONFIG_DIR and CODEX_HOME are honored; a T3 provider homePath is not. No line of his changed.
- Settings: t3-vscode.ours.importchat.claude (default false): also list Claude Code chats.
- Live test (Codex): in Codex, start a chat in this folder and close it; in T3 VS Code run the command, pick it, send "what did I ask you first?": the answer knows the Codex chat. Pick it again: it says "already in T3" and opens the same chat. With a Codex chat still open in Codex: the modal appears, and "I closed it there, continue" without closing it says "still open in Codex". Archive the T3 chat and pick it again: "archived in T3", nothing is created.
- Live test (Claude running): with the setting on, keep a Claude Code chat of this folder open in Claude Code (best during a long tool call), pick it: the modal says "is open in Claude Code right now"; "I closed it there, continue" without closing it says "still open in Claude Code". Close the chat (end that Claude process), pick it again: no modal once the file is older than 2 minutes.
- Live test (Claude, gates the setting): in an isolated T3 home, turn the setting on, pick a Claude Code chat, send one message, then read providerThreads[active].nativeThreadRef.nativeId of the thread: it must equal the picked .jsonl name and that file must have grown. If the id changed, keep the setting off and report it upstream.

## P1 idectx: The file and lines I am looking at go with my prompt

- What: as in Claude Code and Codex, every prompt sent from a T3 composer carries the last file editor of the window: its selection (a reference card in the bubble, `file.ts#L12-20` with the selected text as a snapshot, unsaved edits included) or, with nothing selected, the file alone (a link). The editor is remembered while focus sits in the chat. A chip "IDE: foo.ts:12-20" next to the context chip shows what will go; click it to leave it out of the next message only (struck through), it comes back after that send.
- Not sent: slash commands (text starting with "/"), a prompt that already links that file (@ mention, Add selection), a prompt that names the file when nothing is selected, a file whose tab is closed, files outside the workspace folders, and sends that do not come from the composer (Q20 Implement, "/goal resume"). A selection over 20000 characters goes as its line range only ("File reference from the editor."), and the agent reads the lines itself.
- How: the webview patches `bridge.request` for `sendMessage` (as composerFit and fileLinks do) and asks the host (`ideContextText`, at most 3 s) for the text with the reference appended after a blank line, formatted by his `formatComposerMessage` from his `editorReference`, so his transcript splits it into a reference card. Any failure or a slow host sends the text as typed. Host sends never pass the webview, so they never carry it (the plan's sendMessage wrap could not tell them apart). The editor tracker of A's activeFile tool moved to src/host/ours/editorTracker.ts and is shared.
- Files: src/host/ours/ideContext.ts, ideContextText.ts (+ test), editorTracker.ts (from mcp/tools.ts), src/webview/ours/ideContext.ts. No line of his changed.
- Settings: t3-vscode.ours.ideContext.enabled (default true).
- Live test: select lines 10-20 of README.md, click into the chat: the chip says "IDE: README.md:10-20". Send "what do these lines say?": the bubble shows the README.md:10-20 reference card and the answer quotes them. Click the chip (struck through), send again: no reference, and the chip is back on. "/goal clear" and Implement on a plan carry no reference. Close the README tab: the chip goes away.

## P2 bgwork: See and stop work the agent left running

- What: a turn ended but the agent left work running (a background command such as `npm run dev`, a monitor, subagents). A one-line banner right above the composer says what, in T3's own words ("Running: npm run dev", "Waiting on 2 subagents and 1 command: ..."), with a Stop button. The dot pulses only for work that will wake the agent (subagents, monitors), not for a dev server. The banner goes by itself once the server reports the work ended; it is hidden while the chat itself is working (the server roster is empty then).
- Stop: a modal first ("Like the T3 Stop button, this also holds the queued messages of the chat, ends its pull request watches and stops its delegated tasks"). Then, on a fresh projection, `run.interrupt` with `holdQueue: true` on the active run, else on the latest run when it still has background work, exactly as T3's interruptThreadTurn picks it. With no such run (only a pull request watch is left), Stop ends the chat's pull request watches (`thread.pull-request.watch` with `watching: false`), as T3 does. "Nothing is left running" when none of these applies. Accepted is not ended: the button comes back for a retry.
- Status bar (C): an idle chat with work left running gets a hover line "TITLE: Running: npm run dev". Only work that wakes the agent changes the text, to "T3: waiting on background work" (as T3's sidebar "Waiting" pill, which ignores commands); a click opens that chat (or the sessions list for several). Never a badge or the warning colour: it does not need you.
- How: src/host/ours/background.ts (new: requests background.tasks and background.stop, reads his private HostState.shell by name as emptyList.ts does), src/webview/ours/background.ts (new: the banner, a DOM node before his .composer-box), src/host/ours/activity.ts and statusbar.ts (the hover and text), activity.test.ts (one case). T3's presentPendingBackgroundWork and derivePendingBackgroundWork come from the vendored packages. No line of his changed. Settings and commands: none.
- Limits: Codex may report no tasks; then nothing shows. The roster comes from the shell row of the chat, so a server older than the field shows nothing.
- Live test: ask Claude to run `ping -n 120 127.0.0.1` in the background and end its turn. The banner shows "Running: ..." with Stop, and the status bar hover lists it. Stop, confirm: the banner goes and the ping process is gone in Task Manager. Cancel in the modal leaves it running.

## P3 allchanges: One multi-diff shows every file this chat changed across all turns

- What: "Show All Changes in This Chat" opens one VS Code multi-diff with every file the chat changed, from before its first turn to its latest saved turn (as the Codex "Changes" panel). Q16 and R7 stay per turn. Where: the diff icon in the chat tab title, the command palette (T3 VSCode: Show All Changes in This Chat), and "Show all changes" in the thread menu (right-click a chat row, the chevron in the chat header, Thread Actions).
- Each file works as in Q16: Open File, Revert (here "Put X back as it was before this chat?", only when the file still matches what the chat left), and the hunk arrows when the file on disk still matches.
- The view title says "may include your own edits" (as the R7 card): the saved range also holds edits you made between turns and files a pull or merge brought in (T3's own full-thread diff leaves pulled files out; this local git diff does not).
- How: the range is the ordinal-0 checkpoint of the root_run scope to its latest READY checkpoint (also after an interrupted turn), one range per folder the chat ran in (src/host/ours/allChangesRange.ts, + test). Files and contents are read with his getSavedTurnDiff and getDiffFileContents (git on the saved refs on this machine), so any chat works, also one not open in a view. Q16's opener in src/host/ours/diffs.ts is shared (now loads at most 8 files at a time); the menu entry is in threadActionsList.ts and threadActions.ts, one icon in src/webview/ours/threadActions.ts. No line of his changed.
- A chat with no saved change (or whose last turn is still being saved) says so instead of opening an empty view. Binary files are left out.
- Settings: none.
- Live test: a 3-turn chat that edits 4 files. Click the diff icon in the chat tab title: one view lists all 4. Revert one there, then `git diff`: that file is gone from it.

## P4 undoturn: Undo turn puts back every file a turn changed

- What: an "Undo" button on every turn changes card (left of his "Open diff") puts back every file that turn changed, as Codex's "Revert all". The chat is not touched (no rollback; T3 keeps every message). A modal lists first what goes back ("delete: this turn created it", "restore: this turn deleted it"), what is skipped and why, and which later turns touched the same files ("turn 5 (a.ts)"), then "Undo Turn" or Cancel. All files change in one WorkspaceEdit, saved at once: Ctrl+Z in one of those files brings all of them back.
- Rules: per file the Q16 revert rule (src/host/ours/diffsRevert.ts): a file with unsaved changes, a file that changed after this turn (by you or a later turn), a renamed file, a file gone from disk and a file T3 cannot show as text are skipped. After the modal everything is decided again; if anything moved meanwhile nothing is written. The turn's files come from his prepareTurnDiff, so R7's checkpoint fallback (queued, steered, older turns) applies too.
- Also in the Q16 all-changes view: "T3 VSCode: Undo Turn (Put Back Every File)" in the right-click menu of a file inside that view (and in the editor title and command palette of a t3-ours-diff side). The multi-diff view's own title bar has no handle to the turn, so the entry is not there.
- Later turns are named best effort: up to 30 later turn cards, one checkpoint diff each (projection plus getSavedTurnDiff, as R7). A failure there only drops the line.
- How: src/host/ours/undoTurn.ts (RPC undoturn.run, command t3-vscode.ours.undoturn.run), src/webview/ours/undoturn.ts (the button), src/host/ours/diffs.ts (exports locate and turnSourceOf; a Q16 view remembers the card it came from). No line of his changed.
- Live test: a turn edits 3 files; hand-edit one and save; click Undo on that turn's card. The modal says put back 2 of 3 files, the hand-edited one skipped (changed after this turn). Undo Turn: git diff shows only the hand edit. Open one of the 2 files, Ctrl+Z, confirm undo in all files: both come back.

## P5 planready: Plan ready toast with Implement, Open as Markdown and Show

- What: a turn settles with a plan ready in a chat you are not reading (T3's own "Plan Ready": plan mode, an actionable proposed plan, no active run). One toast `T3: Plan ready: "TITLE"` with Implement, Open as Markdown and Show. It replaces the Q3 "turn finished" toast for that turn, so one toast shows. It shows also while VS Code has focus (you are in another chat or file); no toast for the chat you are reading.
- Implement: checks again that the plan is still ready, leaves plan mode and sends "PLEASE IMPLEMENT THIS PLAN:" plus the plan (the Q20 handler, now shared from contextMeter.ts), then opens the chat. If the chat started working or left plan mode meanwhile, or the sidebar composer holds a draft for that chat (sending would clear it), it warns and opens the chat instead of sending. Open as Markdown: the plan as an untitled markdown document. Show: opens the chat.
- How: src/host/ours/planReady.ts. No own edge tracker: Q3 (finished.ts) already waits 2 s after a turn stops working, so a plan flag that flickers while streaming never toasts; Q3 asks the P5 hook (setPlanReadyHook) before its own toast. The row is read from his private HostState.shell (as R19 emptyList), the plan markdown on click from getThreadProjection (the latest active proposed_plan), so it works for a chat that is not open in any view. Webview: none. No line of his changed.
- Settings: t3-vscode.ours.planReady.toast (default true). Off: the Q3 toast shows as before. Independent of t3-vscode.ours.notify.finished.
- Limits: the toast comes after every plan-mode turn that ends with a plan still waiting, also a turn that only answered a question about the plan (T3's sidebar shows "Plan Ready" then too). Only chats of this window's folders (as Q3). A draft check that cannot read his draft store refuses to send (opens the chat).
- Live test: in plan mode ask for a plan, switch to another chat. One toast "Plan ready"; Implement leaves plan mode and starts building, and the chat opens.

## P6 goal: A bar that shows the /goal and its state

- What: while the open chat has a native goal (set with `/goal <objective>` in a Codex or Claude chat), one line sits right above the composer box: the status and usage ("Pursuing goal", "Goal set", "Goal paused", "Goal blocked", "Goal hit a usage limit", "Goal reached its token budget", "Goal complete", then for example "12k / 50k tokens, 4m" for Codex or "2 checks" for Claude) and the objective (cut with an ellipsis; hover shows it whole). Wording and usage are T3's own (client-runtime presentProviderGoal), as in T3 web's goal row.
- Buttons, only while the chat is idle and not archived: Resume (only for a goal that stopped short: paused, blocked, usage or budget limited) sends `/goal resume`; Clear sends `/goal clear`. Both go through his sendMessage, so the C3 one-writer question and H save-on-send apply. If the composer holds text or attachments, a warning asks to send or clear it first (sending clears the composer). While the chat works the buttons are hidden and a click that races the start gets a warning: T3 would queue a /goal behind the run, never steer it.
- Gone when there is no goal: a cleared goal, another chat, or a server without goals (the field is absent).
- How: host src/host/ours/goal.ts reads the goal from his live shell row (private `shell`, by name, as R19 emptyList) and answers the ours requests `goal` and `goal.run`; webview src/webview/ours/goal.ts asks after each quiet 400 ms of state pushes and once at load, and keeps the bar before his `.composer-box`. No line of his changed; no setting, no command.
- Live test: Codex chat, send "/goal make README one line shorter". The bar reads "Pursuing goal" with the objective while it works, then "Goal complete" with tokens and time. Click Clear: the bar goes, and the T3 app shows no goal on that chat. Set a goal again, press Stop while it works: "Goal paused" with Resume; Resume starts it again.

## P7 unread: A dot on chats that finished while I was away

- What: a session row (sessions list and the chat tab's history) gets a small dot when its chat finished a run since you last looked at it, as the T3 app marks it. Opening the chat (Q9 read) clears the dot; Q19 "Mark unread" brings it back. Switch Chat (Ctrl+Alt+S) shows the same chats with a filled circle and "unread". Screen readers hear "Unread" on the row (aria-description).
- Rule: T3's own hasUnseenCompletion: the latest run's completedAt is later than the server's lastVisitedAt. A chat never visited, or a server without visited tracking, counts as read, so a first start does not light up every old chat. Archived chats get no dot.
- How: host src/host/ours/unread.ts reads his live shell rows (private HostState.shell by name, as R19 does) and answers the webview request unread.ids; src/webview/ours/unread.ts asks on each state push while session rows show and sets data-ours-unread on his `button.thread[data-thread-id]` rows (dot on .thread-title-line; R8's failed dot stays on .thread-title). keys.ts marks Switch Chat. Q9 (visit.ts) now visits a chat again when it is unread: Mark unread rewinds lastVisitedAt but keeps updatedAt, which Q9 deduplicated on. No line of his changed.
- Settings: none.
- Live test: start a turn in chat A, switch to chat B before it ends: A's row gets a dot. Open A: the dot goes. Mark unread on A from its row menu: the dot is back; click into A's tab: it goes again.

## P8 scope: a window on a T3 worktree or a subfolder lists that repo's chats

- What: his host shows only the T3 projects whose root IS a window folder, so a window opened by T3 "Open in VS Code" on a worktree chat, or a window on a subfolder such as repo/src, listed no chats. Now such a window also shows the chats of: (a) the main checkout of a folder that is a git worktree (the folder's .git file points to <main>/.git/worktrees/<name>; T3 puts worktrees under <T3 home>/worktrees), (b) the project of any T3 chat whose worktreePath is a window folder, (c) the deepest T3 project root that holds a window folder. The whole repo's chats appear, not only the worktree's.
- How: wraps his `options.workspaceRoots` (as X1 wraps options). His folders come first, so roots[0], the default folder for a new chat, stays the real first folder. Non-file folders (virtual workspaces) are dropped while a file folder remains; with none left his list is kept, because an empty list would show every project. The extras are recomputed only when the folders, the shell or the archive object changes (his visibility check calls the list once per project); the output channel logs the extra roots when they change. Any failure logs and leaves only the window folders.
- Files: src/host/ours/scope.ts, scopeRules.ts (+ test; mainCheckout ported from the bridge, R19). Settings and commands: none. No line of his changed.
- Limits: the extra roots also show in his project picker (and enable the Composer project button). "New chat" in a worktree window still makes a second T3 project for the worktree folder (P14 is the real fix). A git worktree made outside T3 also scopes in its main checkout.
- Live test: start a worktree chat in T3, Open in > VS Code: the new window lists it and a send works. Open D:/GIT/t3-native-vscode/src alone: the repo's chats appear.

## P9 lsp: The agent asks VS Code for references and workspace symbols

- What: two more read-only tools on the context server (feature A), in src/host/ours/mcp/lsp.ts, listed after `diagnostics`. `references` {path, line, column} runs Find All References (vscode.executeReferenceProvider, declaration included). `workspaceSymbols` {query} runs Go to Symbol in Workspace (vscode.executeWorkspaceSymbolProvider): name, kind, container. Both: line and column 1-based, at most 200 items with total and truncated, 10 s timeout (an error result that names the language server).
- Paths in results are relative to the window folder that holds the agent's cwd, absolute outside it (the other tools stay absolute).
- Not ready: `references` loads the file first (that starts its language extension) and retries once after 1.5 s when the answer is empty. An empty list carries a note ("not on a symbol, or the language server is not ready yet"). While TypeScript still loads the project it answers from the file alone (seen live: only the declaration); then the note says "every reference is in this file ... try again". `workspaceSymbols` answers only after a file of that language was opened in the window; its empty note says so.
- No setting, no command, no webview part, no T3 surface.
- Checked live in an isolated VS Code (own user data, extensions dir, T3CODE_HOME and T3VSCODE_HOME): references on src/host/hostState.ts 636:3 (sendMessage) first gave only the declaration with the note, 15 s later 45 references including src/host/bridge.ts:190 and src/host/ours/contextMeter.ts:64; workspaceSymbols "activateMcp" gave src/host/ours/mcp/index.ts:14 (Function); a missing file and an empty query give error results.
- Live test: in a T3 chat, "call the vscode tool references on src/host/hostState.ts line 636 column 3 and quote the raw result": bridge.ts:190 and contextMeter.ts:64 are listed. Then "call workspaceSymbols with query activateMcp": src/host/ours/mcp/index.ts line 14.

## P10 quiet: toasts that repeat stop repeating

- What: three toasts stop coming back on every window, drag and send. The information stays in the fork log ("T3 VSCode (fork)").
- MCP nudge (A): new text "Let Claude Code and Codex in T3 see this VS Code window (open files, selection, problems)?" with Set up / Later / Don't ask again. Only "Don't ask again" turns it off for good (the old "Not now" answer stays off, same key). Otherwise it is shown at most once in 7 days across all windows: the time is stored when the toast appears, so Later, a dismiss and a Set up left undone all wait 7 days. Replaces the "Not now" line in section A.
- Drop hint (I): the toast that says a drop into a chat is blocked shows once per install; later bounces only log a line. The chat's own in-page hint is unchanged. The toast no longer says "(Electron 43.7)".
- Save warning (H): the "could not save all files" toast shows only when its reason changes; a repeat with the same reason only logs. A successful save resets it, so the problem coming back later toasts once again.
- How: src/host/ours/mcp/setup.ts (globalState t3-vscode.ours.mcp.nudgeShownAt), src/host/ours/drop.ts (globalState t3-vscode.ours.drop.hinted), src/host/ours/saveOnSend.ts (in memory, per window). No line of his changed.
- Settings: none.
- Limits: two windows reaching their first ready connection at the same instant can both show the nudge once.
- Live test: open 2 windows, pick Later in the first: no nudge in the second. Drag a file over the chat twice, reload, drag again: one toast in total. Mark a dirty file read-only and send 3 prompts: one toast, three log lines.

## P11 snapmemo: Long streaming chats stop rebuilding the full snapshot many times per emit

- What: on every state change (every 32 ms while a chat streams) his host built the full state snapshot once per listener and then again for every open view (his pushState, updateTitles, usage meters) and for ours (contexts, toasts, layout, logs, reconnect, status bar). Now each view's snapshot is built once per change and shared by everyone in that pass. Nothing visible changes; the view still updates every token.
- How: src/host/ours/snapshotMemo.ts wraps the public `hostState.snapshot` with a memo keyed on (his private `revision`, view id). A memo starts only at a revision not seen before: his emit bumps the revision and calls snapshot right away, so that first call is always inside his emit loop (the feature adds one empty state listener so the loop never skips snapshot). A call at a revision already seen, with no live memo, builds fresh and uncached. A microtask clears the memo, so it lasts for the emit's synchronous pass and for continuations queued before that microtask. A memo hit for a closed tab still runs his snapshot, so callers that use snapshot(viewId) as the "tab has been closed" check still get his error.
- Shared object: every listener of one emit now receives the same snapshot object. Nobody mutates it in place (checked his host and ours; postMessage clones it).
- Files: src/host/ours/snapshotMemo.ts, snapshotMemo.test.ts. Settings and commands: none. No line of his changed.
- Why only inside the emit: bridge.ts handle() calls snapshot(viewId) first, then e.g. cancelSessionSearch (hostState.ts:920) changes state without any emit, and the reply snapshots again (bridge.ts:245). A memo started there returned the cancelled search and the find bar showed stale matches. With the emit-only rule that reply is built fresh.
- Limit: a state change WITHOUT an emit, made later in the same synchronous pass as an emit (or in a continuation queued before the clearing microtask), is read stale until his next emit (at most 32 ms for streamed events). Re-check his emit listeners and bridge handlers on each upstream merge.
- Live test: Developer: Start Extension Host Profile while a long chat streams, stop after ~10 s, before (feature commented out) and after; HostState.snapshot self-time drops by roughly the number of listeners. The chat still streams token by token, and closing a chat tab mid-stream logs no fork error. In an idle chat: open Find, search, close Find, reopen it with the same query; no "Search this conversation again." error and no old matches appear.

## P12 rewind: Edit from here rewinds the chat (and the files if chosen) and puts the prompt back

- What: each of my messages gets an "Edit from here" pencil (beside Q11's "use again"). A modal asks "Rewind the chat to before this message?" with "Rewind chat and files" and "Rewind chat only" (Esc cancels). The message and everything after it leave the chat and the agent forgets them (T3 rolls the provider conversation back); the message text comes back in that chat's box, after any text already there, as T3 web does.
- Files: T3 restores files only for a chat in its own worktree (CheckpointRestoreSafety: a checkpoint snapshots the whole checkout). For any other chat the modal offers "Rewind chat only" and says why. In a worktree chat the files button is left out when an open file under the checkout has unsaved changes (named in the modal); otherwise the modal says every file there goes back, your own later edits included.
- Refused with a message: while a turn runs or a send is in flight (re-checked after the modal), a provider with supportsConversationRollback false, a steer (no turn of its own), a turn without a ready checkpoint, a message inherited from the chat this one was forked from. Attachments are not put back (the modal says so).
- Checkpoint rule (src/shared/ours/rewind.ts, + test): T3 web's, the ready checkpoint of the message's own run gives N = appRunOrdinal - 1; the target is the newest checkpoint with appRunOrdinal N, or the scope baseline (ordinalWithinScope 0, appRunOrdinal null) for 0. Stricter than T3: same scope and ready, else refuse. Then `checkpoint.rollback` {threadId, scopeId, checkpointId, restoreFiles} with restoreFiles always explicit (T3 restores when it is left out).
- How: host src/host/ours/rewind.ts (ours RPC kind "rewind", the modal, the dispatch), webview src/webview/ours/rewind.ts (button by MutationObserver, prompt into his draft store). Settings and commands: none. No line of his changed.
- Limits: the prompt goes back as soon as T3 accepts the command, before the turns vanish from the view. If T3 fails the rollback after accepting it, the prompt is in the box but the chat is unchanged (T3 records checkpoint.rollback.fail; nothing of ours reports it). A chat also open in Claude Code or Codex diverges (C3 asks on the next send).
- Live test (files): in a worktree chat, 3 turns that each edit a.txt. Edit from here on turn 2, "Rewind chat and files": a.txt matches the end of turn 1, turns 2 and 3 are gone, turn 2's prompt is in the box. Again with "Rewind chat only": the file stays. In a normal (non-worktree) chat the modal offers only "Rewind chat only".

## P13 review: /review against my changes, a branch or a commit

- What: type /review in the composer (or click "Review Changes with T3" in the Source Control title) and pick what to review: uncommitted changes, against a base branch (local and remote branches, main/master/develop first), a commit (the last 50), or custom instructions. The prompt names the exact git command (`git status --porcelain` + `git diff HEAD`, `git diff <base>...HEAD`, `git show <sha>`) and asks for findings ordered P0 to P3, each with file:line, a fix, and a one-line verdict; it tells the agent not to change files. With several repositories open, a second pick chooses one and the prompt names its root.
- Delivery (setting t3-vscode.ours.review.delivery): thisChat (default) sends in the chat where /review ran; newChat opens a new chat and sends there. His send clears the composer, so if the composer still holds text or a chip, it asks first and offers "Review in a New Chat". From Source Control with thisChat the prompt is only put into the focused chat's composer (the host cannot see that draft); press Enter to send.
- Next to a provider /review (Claude's built-in), ours shows as "/review (VS Code)" and theirs stays. Offered only at the start of the prompt, in every chat (its own composerSuggestions wrap; Q13's wrap only runs where the plan toggle shows). With a query it matches its label only: first when the label starts with the query ("/re"), else last, so Enter on "/st" still runs /status.
- Files: src/host/ours/review.ts (picker, delivery, suggestion wrap, RPC reviewOpen), src/shared/ours/review.ts (suggestion and prompt text, + test), src/webview/ours/review.ts (reads the pick from his suggestion list by its description, as Q13 does), src/host/ours/prompt.ts (the Source Control command now opens the picker). No line of his changed.
- Limits: a written prompt, not Codex's trained review mode; without the git extension (git.enabled off) only Uncommitted and Custom are offered.
- Live test: on a branch 2 commits ahead of main, type /review, Enter, "Against a base branch", main: the agent runs `git diff main...HEAD` and the findings cite only files from those 2 commits. Attach a file, then type /review: the warning offers a new chat. Type "/st" and Enter in a Codex chat: /status runs, not the review picker.

## P14 worktree: Start a chat on a fresh worktree and branch

- What: "T3 VSCode: New Chat in a Worktree..." (command palette, and the "..." menu of the T3 sessions view) starts a chat in its own git worktree on a new branch, so a parallel agent never touches the open checkout (Claude Code createWorktree, Codex /worktree). Three steps: pick the base branch (local branches of the folder, current first, then the default; a branch already checked out elsewhere says where), type a branch name or leave it empty (T3 then names it from the prompt), type the first prompt. The chat opens at once; T3 makes the worktree in the background and the agent starts there when it is ready.
- Thread Actions (the R11 list and the thread menu of the view) gets "Open Worktree in New Window" for a chat that runs in a worktree: opens that folder in a new VS Code window.
- How: src/host/ours/worktree.ts (new): branches from the raw RPC vcs.listRefs {cwd, refKind local, limit 200}; then one raw orchestration.launchThread with workspaceStrategy {type worktree, baseRef, branch?} and initialMessage, as the T3 client itself does (client-runtime operations/commands.ts startThreadTurn). Project, model, runtime and interaction mode are the new-chat draft of the view in front (his snapshot draft); a folder without a T3 project gets one (his client.createProject). Then it waits until his host state lists the thread and opens it with his openSession. The worktree entry: threadActionsList.ts (+ test), threadActions.ts and its icon in src/webview/ours/threadActions.ts; a thread is in a worktree when his workspaceForThread differs from its project root. No line of his changed.
- Settings: none.
- Limits: the first prompt goes in through launchThread, not his sendMessage, so it skips his turn baseline and the fork wraps on sendMessage (save on send, one-writer); the worktree does not exist yet at that point. No free-typed base ref, no remote branches, no "start from origin". No setup progress card (subscribeWorktreeSetup unused): a failed preparation shows as an error in the chat. Worktrees pile up; removal is manual (git worktree remove). The new window from "Open Worktree in New Window" lists its chats only with P8 scope.
- Live test: in a git folder, New Chat in a Worktree..., base main, empty branch, prompt "create hello.txt with the word hi". The chat opens and runs. `git worktree list` shows a new worktree on a t3 branch, hello.txt is there and not in the open folder, the T3 app shows the branch. Thread Actions > Open Worktree in New Window opens that folder.

## P15 modelopts: 1M context or fast mode from the composer

- What: the composer shows every model option T3 sends besides effort, next to his effort and permission selects: a select per select option and a toggle per on/off option. On this nightly that is Claude "Context Window" (200k or 1M, on the models that offer it) and "Fast Mode" (on/off), and Codex "Service Tier" (Standard or the tiers the Codex CLI reports, for example Fast). Inline the select shows only the value (hover names it); in the "..." popup of a narrow composer each control carries its name. A change applies to the open chat, or to the next new chat when none is open, like the effort select.
- How: src/webview/ours/modelOptions.ts reads the model's descriptors with T3's getProviderOptionDescriptors (as his effortDescriptor does), drops the effort one, and appends its controls into his `.composer-traits` with a MutationObserver (Q13 planMode pattern). When his composer goes compact, that div moves into his "..." popup and ours with it. Writes go through his existing setModelOption request (thread or draft); a refused change snaps back to the host's value. No host part, no setting, no line of his changed.
- Limits: inline, his width measure does not count our controls, so in a narrow band before his "..." appears our controls shrink (text clipped) rather than overflow. A refused change is logged to the webview console only (his run() banner is not used, so his App state is not replaced).
- Live test: in a Claude chat on a model with Context Window (for example Opus 4.6), the composer shows "1M" and "Fast Mode". Pick 200k: the T3 app shows 200k for the same chat. Toggle Fast Mode: it turns blue. On a Codex model with tiers, pick Fast in the tier select and send one turn: it runs.

## R10 dropview: The "Drop zone" view can be turned off

- What: the "Drop zone" view (from I) sits under the side panel chat while the setting `t3-vscode.ours.drop.showView` (section "Fork: Drop files view") is on, the default since 6f60b99 (it began as off; then the view became the only way to drag from VS Code into a chat). Turn the setting off and the view is gone; a drag without Shift onto it adds the files to the focused chat.
- Who loses something: nobody by default. A user who turns the setting off selects files in the Explorer, presses Ctrl+C, then Ctrl+V in the chat (a drag from the Explorer onto the chat never lands, see I).
- How: package.json only. The view entry gets `"when": "config.t3-vscode.ours.drop.showView"` (a `"visibility"` value alone would not hide a view a profile already shows), `"visibility": "visible"` and `"initialSize": 1`. src/host/ours/drop.ts still creates the tree view; VS Code keeps it registered while hidden. No line of his changed.
- Settings: `t3-vscode.ours.drop.showView`. Commands: none new.
- Live test: the Drop zone row shows under the T3 sidebar. Set `t3-vscode.ours.drop.showView` to false: the view is gone; set it back to true: it comes back; drag README.md from the Explorer onto it without Shift: a reference lands in the focused chat.

## P16 tidy: manifest and doc defects

- What: Settings (`@ext:hungtienhuang.t3-vscode`) shows "Fork: Drop files view" once (a JSON merge had left a second identical block in package.json). The README link to this file is absolute (Fundryi's repo): vsce rewrites relative README links against the manifest `repository`, which is busFred's repo, where this file does not exist.
- Docs now match the code: R10 and I (the drop view is on by default, the setting turns it off, the view is named "Drop zone"), J (vendor pin 3145, Effect 4.0.4), C2 and CONTINUITY-SCOPE (the first T3 message on an imported Claude chat fails with "Session ID ... is already in use"; a new session starts silently only when the cwd slug differs), CONTINUITY-SCOPE section 4 row 5 (T3 has a background task list). The setting descriptions of drop.showView and importchat.claude say the same.
- Files: package.json, README.md (fork section), docs/ours/FORK-FEATURES.md, docs/ours/CONTINUITY-SCOPE.md. No code; no line of his changed.
- Live test: Settings, `@ext:hungtienhuang.t3-vscode`: each "Fork: ..." title once. Package, unzip extension/readme.md: the FORK-FEATURES link points at github.com/Fundryi/t3-native-vscode.

## P17 logs: The log names the versions; drag traces go to Debug

- What: the first line of "T3 VSCode (fork)" (Show Logs) is `T3 VSCode <version>, VS Code <version>, <platform>-<arch>.`; once per T3 server or version change it logs `T3 server <serverVersion> (environment <id>)`. The per-drag "Drag trace" line and "Paste ... without text" now log at Debug, so at the default Info level they no longer bury errors. "Developer: Set Log Level..." > T3 VSCode (fork) > Debug brings them back.
- How: src/host/ours/index.ts (activation line, before any feature), src/host/ours/logs.ts (server line in the existing connection listener; serverVersion from his snapshot `environment`, filled from the T3 environment descriptor), src/host/ours/log.ts (`log.debug`), src/host/ours/drop.ts (two lines moved to debug). No paths, labels or tokens are logged. No line of his changed; no settings or commands.
- Live test: reload the window, Show Logs: the versions are the first lines. Drag a file over a chat: no line; set the log level to Debug and drag again: the "Drag trace" line appears.

## P18 help: One Help entry for docs, keys, settings, logs and setup

- What: "T3 VSCode: Help and Settings" (command palette, and "Help and Settings" in the "..." menu of the T3 view) opens one pick: Fork features (this file on GitHub), Keyboard Shortcuts (filtered to t3-vscode), All Settings (@ext: filter, his font sizes included), Show Logs (Q7), Let Agents See VS Code (A's MCP setup), Open Web UI (his command), Report an Issue (Fundryi issues).
- His "Font Settings" row in the view "..." menu is hidden: it opened all settings, not fonts, and All Settings in Help does the same. His command `t3-vscode.fontSettings` stays registered and in the palette.
- How: src/host/ours/help.ts (new), package.json: the command, the view/title row (group t3ours), and one of his lines: the Font Settings view/title row's `when` is "false" (same precedent as his Thread Actions row in round 2; a wrapper cannot hide a menu row). On a merge conflict on that line, take his line and drop the edit.
- Settings: none.
- Live test: palette "T3 VSCode: Help", pick each row: it opens its target. The view "..." menu shows Help and Settings, and no Font Settings.

## P19 mergeback: Bring a fork's result back into its parent chat

- What: a forked chat (fork from a response) gets "Merge back into parent..." in its thread menu (right-click the chat row, the chevron in the chat header, Thread Actions). A modal names the fork and the parent and says only context moves: files on disk are not touched and the fork stays. "Merge back" sends the fork's conversation up to its latest finished turn to the parent as a context transfer, then opens the parent chat. Its next answer knows what the fork found.
- Not offered: a chat that is not a fork (subagents included). A fork with no finished turn, or with a newer turn still running, gets T3's own message "Complete a run in this fork before merging it back." A parent outside this workspace's list is merged but not opened; a message says to open it in T3.
- How: thread.merge_back {sourceThreadId, targetThreadId, sourcePoint {type: "run", runId}} as T3 web's merge button (ThreadRelationshipsControl.tsx). The target and the run come from T3's own resolvers (resolveMergeBackTargetThreadId, resolveLatestMergeBackRun) on a fresh projection. Files: one entry in src/host/ours/threadActionsList.ts (+ test), one case in src/host/ours/threadActions.ts, one icon in src/webview/ours/threadActions.ts. No line of his changed. Settings and commands: none.
- Live test: fork a chat at turn 2, send one turn in the fork ("pick a name for X"), then Merge back into parent: the parent opens and shows the context transfer; ask it "what name did we pick?" and it knows.

## P20 deeplink: A thread link that lands in the wrong window offers the right folder

- What: a `vscode://` thread link (G, "Copy Link") that VS Code hands to a window without that chat used to say "This T3 thread is not in this window." and stop. Now, when the link's T3 environment is this window's and T3 has the chat in another folder, it says `"<title>" belongs to <folder>, not to this window.` with the button "Open Its Window". VS Code focuses the window that already has that folder open (its folder open path reuses an existing window even with forceNewWindow; checked in the installed VS Code main process code), else opens the folder in a new window. The link itself is not re-opened there; open it again or pick the chat in that window's list.
- Unchanged: a link of another T3 environment, a chat T3 does not have, and an archived or subagent chat of another folder still get the old warning (the folder lookup is R19's otherFolderChats, which skips those).
- Folder: the chat's project root. A chat in a T3 worktree also opens its project root, because without P8 scope a window on the worktree path lists no chats; once P8 is in, preferring the thread's worktreePath is a one-line change in links.ts.
- How: src/host/ours/links.ts (G) only; T3 facts are R19's (project-shell-workspace-root, thread-lineage-subagent). Settings and commands: none. No line of his changed.
- Live test: window A on folder X, open a chat, "Copy Link". Focus window B on folder Y, paste the link in a browser or Win+R: B offers "Open Its Window"; click it: A comes to the front. Close A and repeat: a new window opens on X.
- Owner 2026-10-15 evening: Claude chats are listed by default (setting on). An open but idle Claude Code chat (its sessions file says status idle) only warns, with "Continue here anyway"; only a chat whose turn runs there (status busy) blocks until it is stopped. Codex has no idle signal, so an open Codex chat still blocks.

## C4 carryover: Carry a Claude Code or Codex conversation into a new T3 chat

- Story (owner 2026-10-15 evening): his T3 runs Claude through OpenCode with an API key, so T3 can be remote-controlled; T3's own Claude Code provider (driver claudeAgent) is off on purpose. C2 continues the native session, which only that provider can do, so it failed with "T3 has no Claude Code provider enabled". The session itself cannot move to another engine and format; the conversation text can.
- What: in "Continue a Claude Code or Codex Chat" (C2), after a chat is picked: without an enabled T3 provider of that chat's tool, the picker goes straight to the carry-over. With one, a second QuickPick asks "Continue on the same Claude Code / Codex session" (C2 as before) or "Start a new T3 chat with this conversation as context (works with any model)".
- Carry-over: reads the chat file (Claude ~/.claude/projects/<slug>/<id>.jsonl, Codex rollout), keeps the user and assistant text in order and leaves out tool calls, tool results, thinking, system records, meta and sidechain records, Codex developer prompts and AGENTS.md, and injected tag blocks (<command-...>, <system-reminder>, <environment_context>, <ide_...>, <task-notification>). Prompts typed while Claude was busy (queued_command) count as user turns; a compact summary stays (it is the context of what came before). Consecutive turns of one role are merged.
- The message: "Earlier conversation carried over from Claude Code (session <id>, <date>) for context. Read it, answer with one short line that you are caught up, then wait for my next message.", then "User: ..." / "Assistant: ..." blocks separated by blank lines, plain text. Budget about 60000 characters, filled newest first; when something is dropped, "(earlier part left out)" follows the heading (a single newest turn over the budget keeps its end).
- The chat: one orchestration.launchThread call with workspaceStrategy root and the message as initialMessage (as T3's own client starts a plain chat), in the T3 project of the chat's folder, on the model, runtime mode and interaction mode of the new-chat composer (his snapshot draft, as P14). Title "From Claude Code: <first prompt, 60 chars>" (or "From Codex: ..."). The new chat opens; the log says "Carry-over: <driver> <session id> -> thread <id>, <n> turns, <chars> chars".
- Not applied: the one-writer and idle/busy modals of C2. The carry-over only reads the file, so nothing can split; a chat still running there is carried up to its last saved message.
- Files: src/host/ours/importChat.ts (the branch and carryOver), src/host/ours/importChatCarry.ts (transcript to message, pure, + importChatCarry.test.ts), importChatParse.ts (records exported), worktree.ts (failure exported). T3 facts: launch-thread-input and launch-thread-worktree-strategy name the new use. Settings and commands: none new. No line of his changed.
- Live test: with T3's Claude Code provider off, in this folder run "T3 VSCode: Continue a Claude Code or Codex Chat" and pick an idle Claude Code chat: no modal, a new T3 chat "From Claude Code: ..." opens on the normal model, its first message is the carried text, and the reply is one short "caught up" line. Ask "what did we decide last?": the answer knows. The output channel "T3 VSCode (fork)" has the Carry-over line. With a Codex chat and a Codex provider on: the two-choice QuickPick appears.
- Limits: images, attachments and tool output are not carried (the new model sees what was said, not what the tools returned). Text that really contains a <word_word> or <word-word> tag block loses that block. Over the budget the oldest part is gone. The new chat is a new session: nothing flows back to Claude Code or Codex.
