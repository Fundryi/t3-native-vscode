# Fork features

What this fork adds on top of the original extension. One heading per feature. The design and the T3 facts behind each one are in docs/ours/PORT-MAP.md.

## Status bar activity (C)

- Bottom right, directly left of the usage meters: "T3: running" with a spinner while a thread of this window works ("T3: N running" for more than one), "T3: needs you" on a warning background while a thread waits for an approval or an answer. Hidden when nothing runs. Waiting beats running; archived threads and provider subagents do not count; a queued thread counts as running.
- When T3 is down: "T3: not running" (click opens the T3 view). When VS Code is not paired: "T3: not paired" (click pairs).
- Hover lists each thread: "<title>: waits for you" or "<title>: running".
- Click: with exactly one waiting thread it opens that thread; otherwise it shows the thread list.
- The T3 icon in the activity bar shows a badge with the number of waiting threads, once the T3 view has been opened in this window.
- Command: `t3-vscode.ours.statusbar.open` (internal, used by the click). No settings.
- Live test: send "count to 20 slowly" in a T3 chat. Bottom right shows "T3: running" with a spinner, then disappears when done; hover names the thread.

## Save on send (H)

- What: before T3 sends a prompt (any mode: send, queue, steer) or saves an edit of a queued message, every dirty file in VS Code is saved, so the agent reads what the editors show. Untitled files stay unsaved. The save runs before T3 snapshots the files for the turn diff, so my own edits never show up as agent changes.
- A save that fails: logged in the output channel "T3 VSCode (fork)", a warning toast, and the prompt is sent anyway.
- Setting: `t3-vscode.ours.saveOnSend.enabled` (default true).
- Commands: none.
- Code: src/host/ours/saveOnSend.ts (wraps `hostState.sendMessage` and `hostState.queueAction` for `edit`).
- Live test: type one character in a file without saving, send any prompt. The dirty dot disappears before the reply starts, and the reply's diff does not list that file.

## G. Thread deep links

- A link `vscode://hungtienhuang.t3-vscode/thread/<environmentId>/<threadId>` (Insiders: `vscode-insiders://`) opens that thread in a T3 chat tab, the same way his session list does.
- A cold link (VS Code or the chat closed, T3 still connecting or pairing) waits for the connection, up to 5 minutes; a newer link replaces a waiting one.
- A malformed link opens nothing and writes one line to the output channel "T3 VSCode (fork)". A link to another T3 server or to a thread this window does not show (another folder's window, or an archived thread that is not loaded) opens nothing and shows "This T3 thread is not in this window." VS Code hands a link to one window only.
- Command "Copy Link to This Thread" (`t3-vscode.ours.links.copy`), also in the T3 sidebar's "..." menu: copies the link of the thread in the last focused chat tab, else of the sidebar's current thread. No thread: "No thread open."
- Settings: none.
- Code: src/host/ours/links.ts, src/host/ours/linkParse.ts (the parse, tested).
- Live test: run "Copy Link to This Thread", switch to another thread, Win+R, paste, Enter. VS Code shows the copied thread (VS Code may ask once whether to let the extension open the link).

## Desktop app (F)

- What: brings the T3 desktop app to the front on the thread of the focused chat, through the link `t3code://threads/<environmentId>/<threadId>`; with no thread open, `t3code://new` (the app's new-thread page). The thread is the one of the last focused chat tab; with no chat tab, the sidebar's.
- Command: `t3-vscode.ours.desktop.open` "Open This Thread in the T3 App" (`$(link-external)`), in the T3 view title next to his globe and in the title bar of a T3 chat tab; also in the Command Palette.
- Settings: none.
- If no app takes the link (or opening it fails), a warning says "The T3 app did not take the link. Is T3 Code installed?" and the output channel "T3 VSCode (fork)" logs the link. On Windows an unregistered scheme likely shows the OS app picker instead, so the warning may never show there.
- T3 facts: `desktop-scheme`, `desktop-thread-link`, `desktop-link-receiver` in t3-facts.json.
- Live test: with a thread open in the chat, click the "open in app" icon in the T3 view title. The T3 app comes to the front on that thread (allow the t3code link if VS Code asks).

Note for the terminal entries: the terminal right-click menu only appears when the setting terminal.integrated.rightClickBehavior is default; the Windows default copyPaste shows no menu, so use the Command Palette instead.

## E. tasks

- What: the scripts in each local workspace folder's `t3.json` show up in "Tasks: Run Task" under source "T3", one task per script. A task runs the script's command in a VS Code terminal at that folder, with `T3CODE_PROJECT_ROOT` set to the folder, as T3 runs it. The file is read the way T3 reads it (comments and trailing commas allowed). An invalid file, a file with more than 50 scripts, or a file over 256 KB lists nothing and logs one line in the output channel "T3 VSCode (fork)". Scripts kept only in T3's settings are not listed (T3 does not run scripts from the file; the file only feeds its import menu).
- tasks.json: `{ "type": "t3", "script": "<name>" }` refers to a listed script.
- Also: JSON validation and completion for `t3.json` from https://t3.codes/schema/t3.json.
- Settings and commands: none. Code: src/host/ours/tasks.ts.
- Live test: in a folder whose t3.json has a script, Ctrl+Shift+P, "Tasks: Run Task", "T3", pick the script. A terminal runs it in that folder.

## B. Approvals as notifications

- What: when a thread of this window waits for an approval (T3 request kinds command, file-read, file-change, mcp-elicitation, permission), one VS Code notification says which thread, what kind and what it asks: `T3: "<title>" needs approval (<kind>[ from <app>]): <command or prompt>`, plus any warning the provider attaches to Approve or Deny. Buttons: Approve (sends `accept`), Deny (sends `decline`), Show (opens the thread). The answer goes to T3 as `runtime-request.respond`, the same command T3's own Approve sends.
- Buttons only for decisions the request offers. Show only when T3 cannot pass an answer on (`not_resumable`), when the request is no longer pending, or when a command request shows only a reason and not the command itself.
- Answered elsewhere first: "Already answered in T3". A second click while an answer is on its way: "An answer to this request is on its way to T3". Any other failure: a warning with Retry (reads the request again) and Show; never an automatic retry.
- Other request kinds (questions, `user_input`) keep upstream's "Open session" notification. Never two notifications for one request.
- Toasts always, whether VS Code is focused or not. Two windows on one folder both toast; the second click gets "Already answered in T3".
- Settings and commands: none.
- Code: src/host/ours/approvals.ts (wraps the upstream notification tracker's `update`), src/host/ours/approvalText.ts (text and buttons, tested). Log lines go to the output channel "T3 VSCode (fork)".
- Live test: in the T3 app, in this project, ask for something that needs a shell-command approval; switch away from VS Code. Expect one notification with Approve, Deny, Show. Click Deny: T3 shows the request declined, and the thread's approval badge in the T3 sidebar clears.

## Add to prompt (D)

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
- Live test: right-click README.md in the Explorer, "Add to T3 Prompt": a reference shows in the chat box. Then select text in a terminal, right-click, "Add Terminal Selection to T3 Prompt": a code block shows. Click one "Implement with T3" lens above a TODO: an `@file:N` reference shows in the chat box.

## I. Drag and drop (drop)

- Hold Shift and drag files from the VS Code Explorer or an editor tab onto a chat panel: each file goes into the composer. A gif, jpeg, png or webp up to 10 MiB becomes an attachment chip; everything else (also folders and larger images) a whole-file reference. A Windows Explorer file drop works as before (his composer handles it).
- A VS Code drag without Shift bounces off the chat (VS Code blocks it); then a hint says "Hold Shift while dragging files into T3 Code." (at most once per 5 s).
- "Drop files here" view under the T3 VSCode sidebar: takes a drag without Shift and puts the files into the focused chat panel (a new panel for the sidebar's thread when none is focused).
- Settings: none. Commands: none. View: `t3-vscode.ours.drop.view`.
- Log: every drop on a chat panel, and every view drop, writes one line with the drag types and the file count to the output channel "T3 VSCode (fork)".
- Files: src/webview/ours/drop.ts (capture listeners, hint), src/host/ours/drop.ts (requests dropUris and dropHint, the view), src/host/ours/dropParse.ts (the parser, tested).
- Live test: hold Shift, drag README.md from the Explorer onto the chat box, release: a reference shows. Do the same with a png: an attachment chip. Drag README.md without Shift onto "Drop files here": the same reference in the focused chat.

## A. VS Code context server (mcp)

Every agent T3 starts (Claude Code, Codex) can ask THIS VS Code window about itself and ask it to show a file. Uses no T3 surface.

- How it works: each window runs a loopback MCP server (127.0.0.1, random port, bearer token) and publishes `~/.t3-vscode/windows/<pid>.json`. Agents start `node ~/.t3-vscode/bridge.js` (stdio); the bridge picks the window whose folder holds the agent's cwd, else the last focused one with `match: fallback` and a note. `T3VSCODE_HOME` moves `~/.t3-vscode`. Not started in a remote or virtual window.
- Tools: `workspace`, `activeFile` (the selection survives focus moving into a T3 panel; 8192 chars, then `truncated`), `openTabs`, `diagnostics`, `gitState`, `extensions`, `terminalOutput`, `openFile`, `revealInExplorer`, `showDiff`. Actions work only inside the window folders, at most one per 300 ms.
- Commands: "T3 VSCode: Set Up the VS Code Context Server" (page with the CC Switch entry, the Codex TOML and whether each harness already has it), "Add the VS Code Context Server to Claude Code" / "to Codex" (types the CLI line into a terminal named T3; you press Enter). A one-time hint appears after the first connection when no harness has the server ("Not now" is remembered).
- VS Code's own MCP list gets "T3 VS Code context" (provider id `t3-vscode.ours.mcp`, VS Code 1.101 or newer).
- Settings: none.
- Live test: in a T3 thread on this folder, "call the vscode tools workspace, openTabs, diagnostics and gitState and quote the raw results". Expected: your tabs, your Problems, branch main and the Source Control files. VS Code's MCP list may ask once to trust the provider again (its id changed from `t3vscode.mcp`).

## Re-vendor (T3 nightly packages)

- What: vendor/ carries T3's contracts, shared and client-runtime from the nightly `v0.0.46-nightly.20261014.3093` (107f6024ea47) instead of 0.0.45, on Effect 4.0.2. Threads that contain a `secret_request` turn item load again, and turn item types newer than the vendored copy are skipped instead of breaking the thread. How it was done and how to redo it: vendor/README.md; log entry: docs/UPSTREAM.md.
- Settings and commands: none.
- Live test: open a T3 thread in which an agent asked for a secret (a `secret_request` item) and check it loads; pair on Windows once with the `t3` launcher to check the shell fix.
