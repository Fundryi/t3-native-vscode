# QoL round 1: ranked build list

Written 2026-10-14 from five read-only scouts (chat UI, host UX, competitors, our notes, T3 parity) and the owner's message of the same day, then corrected after a critic's check against the code. Q1 is built (0cb9d9f); the rest is not. Builders take one id each, same method as phase 3 (worktree, ours files first, one-line hooks in his files). Line numbers are from main at 0cb9d9f and the T3 reference v0.0.46-nightly.20261014.3093; re-check before editing.

Each buildable item has a feature name in its heading (`### Q2 keys`) and a reserved slot line with that name at the end of src/host/ours/features.ts and of src/webview/ours/index.ts (`// Q2 keys`). The builder replaces only its own slot lines (an export, an import, or nothing); nobody else touches them.

Owner's message (summary, it outranks the scouts): Ctrl+C then Ctrl+V works. Drag and drop does not. A click on a chat should open it in the T3 panel on the right, like every other AI extension, not as a big editor tab. Keep an option for the tab. Today a chat tab cannot be moved back into the small view, and drag and drop cannot work because a click on an Explorer item opens that file in the editor area, on top of the chat tab.

Evidence for the drop cause: the owner's exthost log of "T3 VSCode (fork)" has "Drop on the Drop files here view" and three "Paste on panel_..." lines, but no "Drop on panel_..." line and no "Drag left the chat at once" hint line. Every drop into a chat is logged (9467d15), so no drag ever reached the chat tab. A plain drag still needs Shift in the side panel too: VS Code lets a drop into a webview through only while Shift is held (STATUS, drop.ts header).

## 1. Already there (do not rebuild)

- Chats open in the T3 side panel by default (Q1, built in 0cb9d9f, FORK-FEATURES K): setting `t3-vscode.ours.layout.openThreadsIn` (`sidebar` default, `editor`); src/host/ours/layout.ts wraps `openSession`, `createPanel` and `createNewPanel` and re-adds the sidebar as a chat view; src/host/ours/layoutRoute.ts decides the route; src/webview/ours/layout.ts flips `body[data-surface]` so his App renders ChatView, with a slim bar ("Sessions" back, pop-out to an editor tab through his `openInTab` path, which carries the draft). Shift-drag and Ctrl+V work in the side panel chat. Leftovers are Q1b.
- Add file or selection to the prompt: Explorer menu, Alt+K, editor menu, terminal selection, last command, TODO lens, Fix with T3, Review changes (FORK-FEATURES D, H; his `t3-vscode.insertReference`, src/extension.ts:103).
- Explorer Ctrl+C then Ctrl+V into a chat (FORK-FEATURES I, `t3-vscode.ours.drop.copy`); the owner confirmed it works.
- Shift-drag capture, the "Drop files here" view, every drop logged (FORK-FEATURES I, src/webview/ours/drop.ts, src/host/ours/drop.ts).
- Paste of clipboard files and images in the composer (his Composer.tsx:321).
- Running and needs-you status bar plus badge (FORK-FEATURES C, src/host/ours/statusbar.ts, activity.ts).
- Approval and question toasts with Approve, Deny, Show (FORK-FEATURES B, src/host/ours/approvals.ts over his src/extension.ts:66-77).
- Open in the T3 desktop app (F), thread deep links and Copy Link (G), save on send (H), t3.json scripts as tasks (E), MCP context bridge with 10 tools (A).
- Turn diffs in the VS Code diff editor (his TurnChanges.tsx, src/host/nativeDiff.ts).
- Queue with edit, steer, reorder, cancel, resume; docked todo progress; fork from response; find in session (Ctrl+F, ChatView.tsx:64); message navigator; file and thread mentions; slash commands and skills; model favorites (his webview, parity scout).
- Relative and worktree file links (src/host/bridge.ts:251), `#L` ranges (src/host/fileLinks.ts:23).
- Only this workspace's threads (hostState.ts:436-438). Font size settings (`t3-vscode.fontSize*`).
- Usage status bar and account usage (his usageStatusBar.ts, AccountUsage).
- Retry connection and Connection settings on his error screen (ServerSetup.tsx:75).
- Windows EPERM fix in server discovery (src/host/serverDiscovery.ts).

## 2. Build list, ranked

Sizes: S under 30 lines, M under 150, L more. "His" means a file from upstream; each change there gets a line in docs/UPSTREAM.md and is a candidate to send upstream.

"Needs capability check first" means the item depends on a server flag or a protocol method a paired VS Code client has not used yet. Read flags as `client.config?.environment.capabilities?.<flag>` (`OursDeps.client` is his T3Client; public getter at t3Client.ts:44, same pattern as `attachmentUploads` at t3Client.ts:209; the flags are defined in vendor/contracts/src/environment.ts:98-222, and T3 says older servers lack them, so hide the action when the flag is absent). Add each relied-on flag to t3-facts.json. These items are parked: no slot, no builder, until the check passes on the owner's nightly.

### Q1b sidebar: Sidebar chat polish (and restore after reload)
- Story: As a user the chat in the side panel behaves like a real chat: a pop-out moves my draft instead of copying it, an editor tab can move back into the panel, I can return to the chat I just left, the sessions list keeps its place, the header fits, and a reload brings my chat back.
- Build:
  - Pop-out keeps the draft once. His App `openInTab` handler (App.tsx:47-50) settles attachments and sends the draft, and the layout route `his-then-list` opens his panel and sends the sidebar back to the list, but the sidebar's own draft for that thread stays, so the text then lives in two places. Clear the sidebar copy once the pop-out succeeded. Drafts are claimed per `[owner=viewId, scope, threadId]` (src/host/composerDraftStore.ts:75-83); look for an existing clear path in hostState before writing a new one.
  - Move an editor tab back into the side panel (the owner's complaint): an ours command in `editor/title` (when `activeWebviewPanelId == 't3Panel'`) that takes the tab's draft through the same webview path (settle attachments, read the draft), selects the thread on `SIDEBAR_VIEW_ID`, hands the draft over with `Events.initializeDraft` (his App.tsx:58), shows the chat and closes the tab. Do not use his `t3-vscode.openExistingChatInTab` for moves: it calls `createPanel(viewId)` with no draft transfer (extension.ts:85), and in sidebar mode with the sidebar focused it routes back to the sidebar and opens no tab.
  - Back to the chat: after "Sessions", nothing returns to the chat just left except a click on it in the list. Keep the last shown thread id in the webview and, in list mode, show the slim bar with one "Back to <title>" button.
  - The sessions list loses its scroll position when a chat opens (his SidebarView unmounts). In src/webview/ours/layout.ts save the list's `scrollTop` before `setChat(true)` and restore it after `setChat(false)` on the next frame.
  - Narrow-width header: his ChatView header (ChatView.tsx:66-77) has six or more buttons, untested at side-bar width. A CSS rule in the ours style block under `body[data-ours-chat]` (wrap the title, hide the least useful buttons below about 300 px). His "+" button still says "Open New Chat in Editor Tab" (ChatView.tsx:75) although in sidebar mode it opens the chat in the panel; that string is his, so it stays and goes upstream as a mode-aware label.
  - Inserts while the list shows: after connect `reconcileViews(true)` always gives the sidebar the newest thread (hostState.ts:451-457). Checked in layout.ts: the `createPanel` wrap routes an Alt+K, a drop or a composer helper from the sidebar to `show()`, which posts `chat=true` first, so the insert lands in the newest thread and that chat becomes visible; it is not silent. Decision: keep (Claude Code also inserts into the chat it shows); the live test checks it.
  - Restore after reload (was Q6): store the sidebar's active thread id in `workspaceState` while the chat is showing (`chatShown` in layout.ts; the host snapshot cannot tell list from chat, `chatActive` only means "is a chat view"); once ready after startup, call the wrapped `provider.openSession(threadId)`. An archived or deleted thread falls back to the sessions list.
- Files: src/host/ours/layout.ts, src/webview/ours/layout.ts, package.json (one command, one `editor/title` entry). His App.tsx only through events it already handles.
- Size: M.
- Live test: type a draft in the side panel chat, pop it out: the text is in the tab only; Move to side panel: the text comes back; go to Sessions, scroll down, open a chat, go back: same place; "Back to" returns to the chat; narrow the side bar to 250 px; Reload Window: the same chat shows; with the list showing, press Alt+K in an editor and see the newest chat open with the reference.
- Risk: the draft clear must run only after the tab got the draft, or a failed pop-out loses text. `registry.add` clears his `ready` flag (see the shortcut comment in layout.ts); do not add another re-add path.

### Q2 keys: Keys into T3: focus, new chat, switch chat, a safe insert key
- Story: As a user I press one key to type into T3, one to start a new chat, one to switch chats by typing a name, and my insert key always reaches T3.
- Build:
  - Ours command `t3-vscode.ours.chat.focus` on Ctrl+Alt+C (Ctrl+Esc is the Windows Start menu): reveal T3 through the wrapped `provider.openSession(threadId)` or `t3.webview.focus` plus `registry.focus`, as layout.ts `show()` does (it is a local closure; do not export it), then post OURS_EVENT `{kind:"focus"}`; the webview calls the existing `focusComposer` (src/webview/ours/composer.ts:13).
  - Ctrl+Alt+N runs `provider.createNewPanel(SIDEBAR_VIEW_ID)`, which the layout wrap already routes by the setting. An ours palette command "New Chat" (his `t3-vscode.newThread` is hidden, package.json commandPalette `when false`).
  - "Switch Chat" (moved up from Later): a QuickPick with type-to-filter over `hostState.snapshot().threads`, then `provider.openSession(id)`. With one chat at a time in the side panel, switching is the most frequent move and takes two clicks today.
  - Alt+K (moved up from Later): his `t3-vscode.insertReference` on `alt+k` with `when: editorTextFocus` (package.json:207-212) collides with Claude Code's `claude-vscode.insertAtMention` (both installed here); which one wins is unpredictable. An extension cannot remove another extension's keybinding and the `when` is his line, so add an ours binding for `t3-vscode.insertReference` beside it (default Shift+Alt+K; not Ctrl+Alt+K, which Claude Code also binds to `claude-code.insertAtMentioned`; owner question 5).
- Files: new src/host/ours/keys.ts, src/webview/ours/composer.ts (one event), package.json keybindings and commands.
- Size: S to M.
- Live test: press Ctrl+Alt+C in an editor and type; Ctrl+Alt+N gives an empty chat; Switch Chat, type part of a title, Enter; select text and press Shift+Alt+K.
- Risk: a key may not reach VS Code on this PC or may be taken by another extension; check each in Keyboard Shortcuts first.

### Q3 toasts: Toasts that help: turn finished, none for the chat you are reading
- Story: As a user I switch to another app during a long turn and get told when it finished or failed, and I am not toasted about a request I am already looking at.
- Build: ours listener on `hostState.onDidChangeState`, edge working to idle per thread (`ThreadSummary.status`, `activeRunId`, src/shared/bridge.ts:60-76). Toast "<title> finished" (or "failed") with Show (`provider.openSession`). Setting `t3-vscode.ours.notify.finished`: `unfocused` (default), `always`, `off`. In the existing `wrap(deps.notifications, "update")` (src/host/ours/approvals.ts:53), skip a thread when the window is focused and the focused view shows that thread.
- Files: new src/host/ours/finished.ts, approvals.ts, package.json setting.
- Size: S to M.
- Live test: send a prompt, switch to another app, see the toast; answer an approval in the chat and see no toast for it.
- Risk: a thread that streams in bursts may flap between working and idle; debounce about 2 s.

### Q4 reconnect: Connection dead ends: auto-reconnect and buttons
- Story: As a user I restart or update T3 and VS Code reconnects by itself; when it cannot, I get a button, not a dead screen.
- Build: new src/host/ours/reconnect.ts. While not ready AND `connectionSetup.problem.kind` is `missing-runtime`, `server-stopped`, `unreachable` or `connection` (the error kind of a connect that failed while T3 was half started, hostState.ts:373-374): watch the folder of `<home>/userdata/server-runtime.json`, poll every 10 s, retry on window focus; call `hostState.reconnect()`. His retry is 3 tries over 6 s (hostState.ts:378-386), then nothing. His error screen already has Retry and Connection settings (ServerSetup.tsx:75); only the "Connecting to T3 Code..." screen (App.tsx:75-78; StatusView already takes `actions`) is bare, so give it the same two actions. An "Open T3 app" button on the stopped screen (ServerSetup.tsx) that uses the desktop feature's `t3code://new`.
- Files: ours reconnect.ts; his App.tsx:76 (one prop), ServerSetup.tsx (one-line slot for an ours button).
- Size: S to M.
- Live test: quit T3 with VS Code open, start it again, and see the chat return within 10 s with no click.
- Risk: never fire on `pairing` or `cli-missing`. `connect(false)` falls through to `pairWithServer` (hostState.ts:355-361), which runs `t3 pair` (pairing.ts:71); a careless poll would run the CLI every tick.

### Q5 escape: Escape stops a running turn
- Story: As a user I press Escape in the chat box and the agent stops, as in Claude Code and Codex.
- Build: new src/webview/ours/escape.ts, a window keydown listener in the bubble phase (a capture listener on window runs before React's root handlers, so `defaultPrevented` would always be false there; a React `stopPropagation` also keeps the event from reaching a bubble listener on window). Act only when `!event.defaultPrevented`, focus is in the composer textarea or the transcript, no popup is open, `.chat-main[data-thread-id]` is set (ChatView.tsx:65) and a `.stop-button` is present. Then `bridge.request(Methods.interrupt, { threadId })` (src/shared/bridge.ts:28). Popups that use Escape: Composer.tsx:340, ModelPicker.tsx:72, SessionFind.tsx:99 and :115, ThreadActionsMenu.tsx:29, CitationCommentEditor.tsx:25, MathContextMenu.tsx:34, MessageNavigator.tsx:55, SessionHistory.tsx:34, and ChatMedia.tsx:36 (VisualDialog, a document listener without preventDefault, so check the DOM for the open dialog).
- Files: src/webview/ours/escape.ts, src/webview/ours/index.ts (its slot).
- Size: S.
- Live test: start a long prompt, press Escape in the chat box: it stops; open the model picker and press Escape: only the picker closes; open an image and press Escape: only the image closes.
- Risk: a loose guard stops a turn when the user only meant to close a popup.

### Q6. Merged into Q1b
Restore after reload needs layout.ts's `chatShown`, the same file as Q1b, so one builder does both. No slot.

### Q7 statusbar2: Status bar and logs tell the truth
- Story: As a user I can see from the status bar whether T3 is connecting, pairing or broken, and open the logs in one click.
- Build: in src/host/ours/activity.ts: `error` reads "T3: connection problem" (today "T3: not running", activity.ts:31); `pairing` reads "$(sync~spin) T3: pairing" with no command (a click today queues a second pairing); `connecting` and `discovering` show "$(sync~spin) T3: connecting" (hidden today, activity.ts:33); idle shows a plain "T3" that opens the chat. New command `t3-vscode.ours.log.show` (channel at src/host/ours/index.ts:30), also in the view "..." menu; log each phase change; ours error toasts get "Show Logs".
- Files: activity.ts and activity.test.ts, statusbar.ts, log.ts, package.json.
- Size: S.
- Live test: stop T3 and watch the label change; run "T3 VSCode: Show Logs".
- Risk: none beyond the test update.

### Q8 contexts: Commands target the chat you are in, and hide when they cannot work
- Story: As a user "Thread Actions" and "Copy Link" act on the chat in front of me, and the palette does not offer commands that would only fail.
- Build: ours sets contexts `t3-vscode.ours.ready` and `t3-vscode.ours.hasThread` from `onDidChangeState` (no `setContext` in src today); `when` clauses on our commandPalette entries; `editor/title` (secondary group) entries for `t3-vscode.ours.links.copy` and `t3-vscode.threadActions` when `activeWebviewPanelId == 't3Panel'`.
- Files: new src/host/ours/contexts.ts, package.json. His src/extension.ts:113: `hostState?.snapshot()` defaults to the sidebar, so a palette Delete hits the sidebar's thread, not the focused tab; change it to `snapshot(registry.focusedViewId)`. One line; no wrapper reaches a local inside his command callback.
- Size: S.
- Live test: in a chat tab run Thread Actions, Rename: that tab's chat is renamed; disconnect and see Copy Link gone from the palette.
- Risk: low; with Q1 the focused view is often the sidebar, which is then correct.

### Q9. Reading in VS Code marks the chat read in T3 (needs capability check first)
- Capability: `threadVisitedTracking` (environment.ts:172-176: thread.visit, thread.mark-unread, lastVisitedAt). Without it, do nothing.
- Story: As a user a chat I read in VS Code no longer shows as unread in the T3 app or on my phone.
- Build: ours host feature: when a view's active thread is shown and focused, dispatch `thread.visit {threadId, visitedAt: updatedAt}` through `deps.client.dispatch`, throttled while a turn streams. T3 does this at ChatView.tsx:2952-2967 (reference); command at vendor/contracts/src/orchestrationV2.ts:2816, field at :417.
- Files: new src/host/ours/visit.ts, a t3-facts.json entry.
- Size: S to M.
- Live test: open an unread chat in VS Code and see its dot vanish in the T3 app.
- Risk: the paired session may lack permission for the command; test that first.

### Q10 latest: "Latest" button always there, and the agent looks alive
- Story: As a user I scroll up during a long answer and can always jump back down, and I can see the agent is still working.
- Build: move the Latest button out of MessageNavigator (it returns null at MessageNavigator.tsx:31 with fewer than 2 exchanges or the setting off, before line 68 renders the button) into TranscriptView.tsx:255, shown when `!atEnd`, with a dot while working and not following. A pulse keyframe on `.working-label` and `.thread-working svg` (tokens.css has no @keyframes; the reduced-motion rule at tokens.css:237 turns it off). Show the newest running tool label after the count in a collapsed work group (TranscriptView.tsx:91 has it only in `title`).
- Files: his MessageNavigator.tsx, TranscriptView.tsx, styles/tokens.css. The button sits inside his component tree; no ours slot reaches it.
- Size: S.
- Live test: send one prompt with a long answer, scroll up, click Latest.
- Risk: none; send upstream.

### Q11 reprompt: Bring a past prompt back: ArrowUp, "use again", Retry
- Story: As a user I press ArrowUp in an empty chat box to get my last prompt, reuse any earlier prompt, and retry after an error.
- Build: one helper in new src/webview/ours/reprompt.ts puts a text into the draft (`updateDraft`) and focuses the composer. Callers: ArrowUp and ArrowDown when the text is empty or the caret is on the first line, walking the thread's `user_message` rows (trimmed port of T3's chat/composerPromptHistory.ts); an icon next to Copy on the user bubble (TranscriptView.tsx:108); a Retry button on `case "error"` (TranscriptView.tsx:128, today only the message text) that puts the previous prompt back.
- Files: ours reprompt.ts; his Composer.tsx:334 onKeyDown (one hook line), TranscriptView.tsx:108 and :128 (one slot each).
- Size: M.
- Live test: send a prompt, press ArrowUp in the empty box and see it again.
- Risk: ArrowUp in a multi-line draft must still move the caret.

### Q12 composerFit: Composer fits real prompts and says what it can do
- Story: As a user I paste a long log and see it, I learn about @ and /, and a failed send shows next to the box.
- Build: height cap from 220 px to 40 percent of the window (Composer.tsx:199); placeholder "Ask anything. @ to add files, / for commands" (Composer.tsx:313); a failed `sendMessage` shows in the existing `composer-attachment-error` style above the box (Composer.tsx:312), not only in the top banner (App.tsx:85).
- Files: his Composer.tsx (three small edits).
- Size: S.
- Live test: paste 100 lines and see the box grow; send while disconnected and see the error by the box.
- Risk: none.

### Q13 planMode: Plan mode: see it and switch it
- Story: As a user I see when a chat is in Plan mode and can switch between Plan and Build.
- Build: a Plan/Build toggle in the composer traits that calls `run("setModes", {...target, interactionMode})` (the host already takes it, hostState.ts:776-794). The webview already has `interactionMode` on `ThreadSummary` (src/shared/bridge.ts:63) and on the draft (:58); only the UI is missing. `/plan` and `/default` as composer suggestions next to `/model` and `/usage-limits` (src/shared/composerSuggestions.ts:17-18); a `command` suggestion would only insert text, so they need a new kind in the `kind` union (src/shared/bridge.ts:80) and a branch next to the `model`/`usage` handling at Composer.tsx:169-172. Show the toggle when the provider allows it (`showInteractionModeToggle !== false`, T3 ChatView.logic.ts:626-639) and T3's `planModeEnabled` setting is on (vendor/contracts/src/settings.ts:442-447), or when the thread is already in plan mode.
- Files: one slot in his Composer.tsx:270-283 for an ours component and the branch at :169-172; his composerSuggestions.ts; his shared/bridge.ts:80.
- Size: S.
- Live test: set a thread to Plan in the T3 app, open it in VS Code, see Plan, switch to Build.
- Risk: reading the T3 setting may need a snapshot field.

### Q14. Secret requests show a card (needs capability check first)
- Capability: no flag in environment.ts. Probe `secrets.answerRequest` (`WS_METHODS.secretsAnswerRequest`, vendor/contracts/src/rpc.ts:522 and :1824) once from the paired client: the nightly server requires the orchestration-operate scope for it (reference apps/server/src/auth/RpcAuthorization.ts:118).
- Story: As a user, when an agent asks for a secret, I see a card and can answer it in VS Code (today such a thread waits forever with nothing on screen, STATUS known gaps).
- Build: an ours card using the vendored helpers (vendor/client-runtime/src/secretRequest.ts:47-87), one `case "secret_request"` line in TranscriptView.tsx:107-135, an ours RPC kind, and `T3Client.answerSecretRequest`. `run` and `requireSession` are private (t3Client.ts:91, :95), so the method has to live in his file.
- Files: ours card and rpc; his TranscriptView.tsx (one case), t3Client.ts (about 3 lines).
- Size: M.
- Live test: trigger a secret request from an agent and answer it in VS Code.
- Risk: the server may refuse the method for a paired VS Code client; that is the check above.

### Q15 fileLinks: File links open in the right place
- Story: As a user a file link in a reply opens as a normal editor next to the chat, and images open too.
- Build: in his private `openLink` (src/host/bridge.ts:248-262): `vscode.open` for non-text files (line 257 calls `openTextDocument`, which throws on a .png); a `viewColumn` that is not the chat's own group when the source is a chat tab (line 258 has none). No `revealInExplorer`: it focuses the Explorer view, and his container is in the activity bar (package.json viewsContainers), so for a default install, or anyone who keeps T3 in the primary side bar, a link click would replace the T3 chat with the Explorer. With the side panel chat the group part matters only in editor mode.
- Files: his bridge.ts (private method, no wrapper reaches it), about 5 lines.
- Size: S.
- Live test: click a .ts link and a .png link in a reply, in the side panel and in an editor tab.
- Risk: none; send upstream.

### Q16 diffs: One-click "all changes" and actions on a diff
- Story: As a user I see every file a turn changed in one view, and from a diff I can open the real file or put it back.
- Build: "Show all changes": in his `registerNativeDiff` (nativeDiff.ts:17-18), when no path is given and the turn has more than one file, call `vscode.changes` with `[uri, before, after]` triples instead of the QuickPick (about 6 lines). This has to be in his file: `contents` is a local inside `registerNativeDiff` (nativeDiff.ts:8) and `openDiff` is a private field of BridgeHandler (bridge.ts:50), so ours code can neither feed `t3-turn-diff` URIs nor take over that branch. Ours `editor/title` entries when `resourceScheme == t3-turn-diff`: "Open File" (map the `/after/<path>` URI to the workspace file) and "Revert File to Before This Turn" (reads the open left document, writes with a WorkspaceEdit, modal confirm).
- Files: his nativeDiff.ts (about 6 lines), new src/host/ours/diffs.ts, package.json.
- Size: M.
- Live test: after a multi-file turn, open Show all changes; revert one file and check `git diff`.
- Risk: the revert writes the user's files: confirm first, never touch a file the turn did not change, and refuse when the file on disk differs from the turn's "after" content.

### Q17 approvalKeys: Approvals and questions by keyboard
- Story: As a user I answer an approval or a question with a key, and focus returns to the chat box after.
- Build: refocus the textarea after `respondToRequest` resolves (PendingRequests.tsx:52-55 drops focus to the page body); Alt+1..9 picks an option on the card (T3 uses plain 1-9 for questions, ComposerPendingUserInputPanel.tsx:179-189; Alt keeps typing safe).
- Files: his PendingRequests.tsx.
- Size: S.
- Live test: on an approval, press Alt+1 and keep typing.
- Risk: Alt+digit may be taken by another extension; check.

### Q18 rowCopy: Copy and time on transcript rows
- Story: As a user I copy a command's output with one click and see when a message was sent.
- Build: reuse `CopyButton` (TranscriptView.tsx:29) in the command input, command output and tool output bodies (:81, :117); a `title` with the local date and time from `startedAt`/`completedAt` on the user bubble and AssistantHeader (:108, :139).
- Files: his TranscriptView.tsx (or the message-actions slot from Q11).
- Size: S.
- Live test: hover a message and see the time; copy a command output.
- Risk: none.

### Q19. Missing thread and subagent actions (needs capability check first)
- Capability: `threadSnooze` (environment.ts:143-145) for Snooze, `threadTitleRegeneration` (:169-171) for Regenerate title, `threadVisitedTracking` (:172-176) for Mark unread. Hide each action whose flag is absent. Stop subagent, Copy branch and Copy id have no flag; they can go first if the item is split.
- Story: As a user I can snooze a chat, regenerate its title, mark it unread, copy its branch or id, and stop a subagent, as in the T3 app.
- Build: one ours slot in ThreadActionsMenu.tsx:39 (before the `<hr/>`) with Snooze (QuickPick of presets, `thread.snooze`/`thread.unsnooze`), Regenerate title (`thread.metadata.update` with `regenerateTitle`), Mark unread (`thread.mark-unread`), Copy branch and Copy id; the same entries in his Thread Actions QuickPick (extension.ts:116-122); Stop subagent in SubagentCard.tsx:30-33 (`subagent.stop {runId, subagentId}`, orchestrationV2.ts:3005). Sent through an ours RPC and `client.dispatch` (vendor/client-runtime/src/operations/commands.ts:521-797).
- Files: ours menu component and rpc; his ThreadActionsMenu.tsx, extension.ts:116-122 and SubagentCard.tsx (one slot each).
- Size: S to M.
- Live test: snooze a chat for 1 hour and see it move in the T3 app.
- Risk: the paired session's permission for each command; test one first.

### Q20. Context left, and Implement on a plan (needs capability check first)
- Capability: no flag in environment.ts. Check that the nightly projection fills `contextUsage` on the provider thread (`OrchestrationV2ProviderThread`, vendor/contracts/src/orchestrationV2.ts:957, field at :981) for the owner's providers, and read T3's `contextWindowMeterEnabled` setting (settings.ts:449; T3 hides its own meter by default).
- Story: As a user I see how full the context is, and I implement a proposed plan with one click.
- Build: a "62% context" chip in the composer traits slot from `contextUsage` (the host reads `projection.providerThreads`, hostState.ts:856, so one getter in his hostState.ts). Plan card slot (TranscriptView.tsx:115): Implement (`setModes` default, then send "PLEASE IMPLEMENT THIS PLAN:" plus the plan, per T3 apps/web/src/proposedPlan.ts:55-95) and Open as markdown (`openTextDocument({language:"markdown", content})`).
- Files: ours chip, plan actions and one host kind; his Composer.tsx slot (shared with Q13), TranscriptView.tsx:115 slot, hostState.ts getter.
- Size: M.
- Live test: a long chat shows a rising percentage; a plan turn shows Implement and it runs.
- Risk: follow `contextWindowMeterEnabled` if the snapshot carries it.

### Q21 shiftHint: Show the Shift hint inside the chat
- Story: As a user who drags a file onto the chat without Shift, I see "Hold Shift to drop" right where I dropped, not only in a toast I miss.
- Build: the webview already detects the bounce (src/webview/ours/drop.ts:44-50, `dragenter` then `dragleave` within 500 ms) and asks the host for the toast (src/host/ours/drop.ts:81). Add a short note over the composer for about 2 s at the same moment; keep the toast.
- Files: src/webview/ours/drop.ts (about 15 lines).
- Size: S.
- Live test: drag a file from the Explorer onto the chat without Shift and see the note; with Shift the file lands.
- Risk: none; the note must not block the drop target.

Build order: Q1 is built. Q1b, Q2, Q3, Q4, Q5, Q7, Q8, Q15, Q16 and Q21 can run in parallel now, each in its own files plus its slot lines; package.json merges as JSON, as in phase 3. The slot lines protect only features.ts and the webview index.ts: items that edit the same file of his run one after another, Composer.tsx (Q11, Q12, Q13) and TranscriptView.tsx (Q10, Q11, Q18). The webview slots (composer traits, message actions, plan card, thread menu) land once in one small slice before Q11, Q13 and Q18, as slice 0 did for phase 3. Q9, Q14, Q19 and Q20 wait for their capability check.

## 3. Later

- Chat tabs restore after Reload Window: `registerWebviewPanelSerializer` for `t3Panel` plus a hook in his private `mountPanel` (src/extension.ts:274). Matters only in editor mode.
- Reopen a closed chat tab (Ctrl+Shift+T style), via `tabGroups.onDidChangeTabs` or his `panel.onDidDispose` (extension.ts:288).
- Chat tab icon or prefix for running and waiting (needs his private `panels` map).
- Unread dot for chats finished in the background (needs `lastVisitedAt` in his ThreadSummary mapping, bridge.ts:60-76, and `threadVisitedTracking`).
- Edit from here: rewind with `checkpoint.rollback` and restore files (commands.ts:889-920); revert a turn from TurnChanges.
- Usage-limit recovery banner (Resume at reset, Snooze until reset).
- Provider status banner (sign-in needed, not installed, broken CLI) instead of "No models available".
- Collapse long pasted user messages with "Show full message".
- Model options beyond effort (fast mode, thinking, context window, agent) from `getProviderOptionDescriptors`.
- Prompt stash (T3's Ctrl+S).
- Send in background (Ctrl+Alt+Enter: send and stay on a fresh draft).
- T3's other keys: model picker, effort, mode, previous and next chat, pin, settle.
- Choice of send key (Enter or Ctrl+Enter) through an ours capture listener.
- Arrow-key navigation in the sessions list (roving tabindex, as SessionHistory.tsx:33-42).
- Empty-chat screen with key hints and the three newest chats.
- Archive with undo.
- "Drop files here" view as `visibility: collapsed` (first check a collapsed view still accepts a drop); with the side panel chat taking Shift-drops, the view may not be needed.
- Open T3 on startup setting (`t3.webview.focus` after activation).
- One "T3 menu" QuickPick of all T3 commands, maybe as the status bar click when nothing waits.
- Forget pairing (sign out) command.
- Open T3's own settings page (web UI `/settings`).
- First-run walkthrough (`contributes.walkthroughs`; steps complete on state, not on a command).
- Run in terminal and Insert at cursor on code blocks (his CodeBlock.tsx:26; never press Enter for the user).
- Remote windows (WSL, SSH): at least say "local windows only" when `vscode.env.remoteName` is set.
- Multi-root new chat: preselect the active editor's folder (src/extension.ts:155-163).
- Show diff button on file-change approval toasts (first check whether the request carries the patch).
- Review into a separate chat (Codex reviewDelivery).
- Branch and worktree picker for new chats (needs VCS RPCs).
- Small fixes in his files: chevron tooltip (ChatView.tsx:77), `openWebUi` failure as an error toast (extension.ts:100), dead "not connected yet" message (extension.ts:93), Ctrl+B and Ctrl+I in the composer (Composer.tsx:353), a mode-aware label on the "+" button (ChatView.tsx:75).
- Not doable: VS Code's own Chat sessions view (proposed APIs). Not relevant: CLI path, terminal mode, worktree creation, Marketplace update.

## 4. Owner questions

Each has the default a builder takes if no answer comes.

1. New installs: should T3 land in the right (secondary) side bar? That needs a `viewsContainers.secondarySidebar` entry next to his `activitybar` one and moving his views. Default: no; your install is already on the right, and FORK-FEATURES gets a tip on how to drag it there.
2. His Ctrl+K (insert selection) breaks VS Code's Ctrl+K chords (Ctrl+K Ctrl+C comment, Ctrl+K Ctrl+F format) while text is selected; only his entry can change it. Default: leave it, document the user keybindings.json line `-t3-vscode.insertReference`, and suggest the change upstream.
3. Words: the UI says thread, session, conversation and chat for one thing. Default: our new text says "chat"; his strings stay until upstream agrees.
4. Plan/Build toggle (Q13) when T3's beta flag `planModeEnabled` is off. Default: hidden then, shown only for a thread already in plan mode.
5. Alt+K is bound by both T3 (his entry) and Claude Code. Which one should own it? Default: both stay, and Q2 adds Shift+Alt+K for T3 so T3 always has a working key; to give Alt+K to one of them, remove the other in your keybindings.json (`-claude-vscode.insertAtMention` or `-t3-vscode.insertReference` on `alt+k`).
