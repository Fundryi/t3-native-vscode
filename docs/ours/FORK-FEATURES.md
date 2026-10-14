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

Three ways to put files into a chat: hold Shift while dragging them from the Explorer or a tab onto the chat (VS Code blocks a webview drop without Shift and we cannot change that); select them in the Explorer, press Ctrl+C, then Ctrl+V in the chat; or drag them without Shift onto the "Drop files here" view, which adds them to the focused chat.

- Hold Shift and drag files from the VS Code Explorer or an editor tab onto a chat panel: each file goes into the composer. A gif, jpeg, png or webp up to 10 MiB becomes an attachment chip; everything else (also folders and larger images) a whole-file reference. A Windows Explorer file drop works as before (his composer handles it).
- A VS Code drag without Shift bounces off the chat (VS Code blocks it); then a hint says "Hold Shift while dragging files into T3 Code." (at most once per 5 s).
- "Drop files here" view under the T3 VSCode sidebar: takes a drag without Shift and puts the files into the focused chat panel (a new panel for the sidebar's thread when none is focused).
- Ctrl+C in the Explorer runs `t3-vscode.ours.drop.copy` (hidden from the palette): it remembers the selected paths, then runs VS Code's own copy, so the clipboard ends as before (VS Code writes only its private "CodeFiles" format, which nobody else can read). A Ctrl+V in a chat with no text and no file on the clipboard inserts the remembered files, if the copy is under 10 minutes old. If another app puts a non-text format on the clipboard after the copy, the old list can still come in.
- Settings: none. Commands: `t3-vscode.ours.drop.copy` (keybinding only). View: `t3-vscode.ours.drop.view`.
- Log: every drop on a chat panel (an OS file drop too), every view drop, every Explorer copy and every text-less paste writes one line (drag types, file count, or "nothing remembered") to the output channel "T3 VSCode (fork)".
- Files: src/webview/ours/drop.ts (capture listeners, hint, paste), src/host/ours/drop.ts (requests dropUris, dropHint and pasteCopied, the copy command, the view), src/host/ours/dropParse.ts (the parser, tested).
- Live test: hold Shift, drag README.md from the Explorer onto the chat box, release: a reference shows. Do the same with a png: an attachment chip. Drag README.md without Shift onto "Drop files here": the same reference in the focused chat. Select README.md in the Explorer, Ctrl+C, click the chat box, Ctrl+V: the same reference.

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

- What: when a file dragged from the Explorer or a tab bounces off a chat because Shift was not held, a small note "Hold Shift to drop files here" shows over the composer box for 2 s, right where the drag was. The toast from I stays (at most once per 5 s); the note shows on every bounce.
- The note takes no pointer events, so a following Shift-drag drops through it. It is a polite live region for screen readers.
- Settings and commands: none.
- Files: src/webview/ours/shiftHint.ts (the note), one call in src/webview/ours/drop.ts where the bounce is detected.
- Live test: drag README.md from the Explorer onto the chat without Shift: the note shows over the composer and disappears after 2 s. Drag again with Shift held: the reference lands.

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
