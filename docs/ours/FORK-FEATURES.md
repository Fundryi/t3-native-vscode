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

## Q9 read: Reading in VS Code marks the chat read in T3

A chat you read in VS Code no longer shows as unread in the T3 app or on your phone.

- While a chat (an editor tab, or the sidebar showing a chat, not the sessions list) has keyboard focus, the extension sends T3's `thread.visit` with the thread's `updatedAt`, the same watermark T3's own chat view sends. Focus is the proof the chat is on screen: VS Code tells a webview nothing about visibility. A chat that is only visible next to the editor is marked read once you click into it.
- Only when the server reports `capabilities.threadVisitedTracking === true` (the owner's nightly does); otherwise nothing is sent and nothing shows.
- One visit per `updatedAt`. While a turn streams, at most one visit per 10 s (T3's own throttle), trailing, so the last one carries the newest state; a finished run is marked at once. Opening another chat and coming back sends again, so a chat marked unread on the phone can be read again from VS Code.
- Settings and commands: none. A failed visit writes one line to the output channel "T3 VSCode (fork)".
- How: src/webview/ours/visit.ts reports the shown thread on every state push, on focus and on blur (request `visitShowing`); src/host/ours/visit.ts checks it is the view's own active thread, takes `updatedAt` from the host state and dispatches through his `client.dispatch`. A visit does not bump `updatedAt` (T3 ProjectionStore), so it never triggers another. No line of his changed.
- Files: src/host/ours/visit.ts, src/host/ours/visit.test.ts (dedupe, throttle, capability), src/webview/ours/visit.ts.
- Live test: let an agent finish in a chat while VS Code is in the background, see the unread dot in the T3 app, click into that chat in VS Code: the dot goes away in the T3 app. Then watch a run finish while the chat is focused and switch to the T3 app within a few seconds: no unread dot appears.

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

## Q20 contextMeter: Context left, and Implement on a plan

- Capability check: the vendored nightly contracts carry `contextUsage` on the provider thread (vendor/contracts/src/orchestrationV2.ts:981) and a live `tokenUsage` on each provider turn (:1090), so both halves are built.
- Context chip: next to the send button a small chip shows how full the chat's context window is, for example "62% context" (or "45k tokens" when the provider gives no window size); hover shows used and total tokens. From 80% it is drawn stronger. In a narrow composer (the sidebar) only the number shows. It follows T3's web app: the newest live report on a provider turn first, else the active provider thread's `contextUsage`. No report, no chip.
- Plan cards: each "Proposed plan" card gets "Implement" (switches the chat to default mode and sends "PLEASE IMPLEMENT THIS PLAN:" plus the plan, as T3's web app does) and "Open as markdown" (the plan in an untitled markdown editor). The host looks the plan up by its transcript row key; the webview sends no plan text. While the plan still streams or the chat is working, Implement only warns, as T3 offers it only for a finished plan. With text, references or attachments in the composer, Implement also only warns "Send or clear the text in the composer first": his send clears the composer draft and releases its attachments.
- Setting `t3-vscode.ours.contextMeter.show` (section "Fork: Context Meter", default on). T3's own meter switch `contextWindowMeterEnabled` is a browser-local client setting the extension cannot read, so this one replaces it.
- How: no line of his changed. The host reads the thread projection from HostState's private `threads` map by name (a guarded shortcut; if upstream renames it the chip hides and the fork log says so once). The webview adds the chip and the buttons through the DOM (a MutationObserver, his `.composer-send-controls`, `.plan-card > header` and `data-search-row`).
- Files: src/host/ours/contextMeter.ts (requests contextUsage, planImplement, planOpen), src/host/ours/contextUsage.ts (the derivation, tested), src/webview/ours/contextMeter.ts.
- Live test: open a long chat: the chip shows a percentage that rises after the next turn. Switch a chat to plan mode, ask for a plan, click "Implement" on the card: the chat leaves plan mode and starts implementing. "Open as markdown" opens the plan in an editor.
