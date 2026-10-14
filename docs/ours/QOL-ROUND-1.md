# QoL round 1: ranked build list

Written 2026-10-14 from five read-only scouts (chat UI, host UX, competitors, our notes, T3 parity) and the owner's message of the same day. Nothing here is built yet. Builders take one id each, same method as phase 3 (worktree, ours files first, one-line hooks in his files). Line numbers are from main at 9467d15 and the T3 reference v0.0.46-nightly.20261014.3093; re-check before editing.

Owner's message (summary, it outranks the scouts): Ctrl+C then Ctrl+V works. Drag and drop does not. A click on a chat should open it in the T3 panel on the right, like every other AI extension, not as a big editor tab. Keep an option for the tab. Today a chat tab cannot be moved back into the small view, and drag and drop cannot work because a click on an Explorer item opens that file in the editor area, on top of the chat tab.

Evidence for the drop cause: the newest exthost log of "T3 VSCode (fork)" has "Drop on the Drop files here view" and three "Paste on panel_..." lines, but no "Drop on panel_..." line. Every drop into a chat is logged (9467d15), so no drag ever reached the chat tab.

## 1. Already there (do not rebuild)

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
- Windows EPERM fix in server discovery (src/host/serverDiscovery.ts).

## 2. Build list, ranked

Sizes: S under 30 lines, M under 150, L more. "His" means a file from upstream; each change there gets a line in docs/UPSTREAM.md and is a candidate to send upstream.

### Q1. Chats open in the T3 side panel by default (fixes drag and drop)
- Story: As a user I click a chat in the T3 panel and it opens right there, next to my code, and I can drag Explorer files into it.
- Build:
  - Setting `t3-vscode.ours.chat.openIn`: `sidebar` (default) or `tab`.
  - Host, ours only (new src/host/ours/sidebarChat.ts): `wrap(provider, "createPanel")` and `wrap(provider, "createNewPanel")`. In sidebar mode, with source view `SIDEBAR_VIEW_ID`: select the thread (or `hostState.newThread(undefined, SIDEBAR_VIEW_ID)`) on the sidebar view, post OURS_EVENT `{kind:"showChat"}` to the sidebar, run `t3.webview.focus`, return `SIDEBAR_VIEW_ID`. The `createPanel` wrap also covers `openSession` (toasts, deep links) and `insertReference`, which call `this.createPanel` (src/extension.ts:246-261), and our own prompt.ts:30, composer.ts:30 and drop.ts:102, which call `createPanel(SIDEBAR_VIEW_ID)`. `insertReference` reveals only panels, so the wrapper runs `t3.webview.focus` itself.
  - The sidebar must count as a chat view: his resolveWebviewView registers it with `acceptsChatFocus=false` (src/extension.ts:203), so `registry.focusedViewId` can never be the sidebar. Re-add it with `true` inside the existing statusbar wrapper of `resolveWebviewView` (src/host/ours/statusbar.ts:21), right after the original runs.
  - Webview: new src/webview/ours/SidebarChat.tsx shows his `ChatView` when the mode is chat and `state.activeThreadId` is set, else his `SidebarView`; a slim bar on top with "Sessions" (back) and "Open in editor tab". Drafts are keyed per thread, so they carry over.
  - Moving: "Open in editor tab" is an ours command that sets a one-shot bypass flag, then runs his `t3-vscode.openExistingChatInTab` for the sidebar. "Move to side panel" is an ours command in `editor/title` (when `activeWebviewPanelId == 't3Panel'`): select that thread on the sidebar, show chat, close the tab.
  - src/webview/ours/drop.ts:19 skips the sidebar surface ("the sidebar has no composer"); key the guard on a mounted composer instead, so Shift-drag and Ctrl+V work in the side panel.
- Files: src/host/ours/sidebarChat.ts, features.ts slot, types.ts (`createNewPanel` on `OursProvider`), statusbar.ts, src/webview/ours/SidebarChat.tsx, src/webview/ours/drop.ts, package.json (setting, two commands, editor/title entry). His src/webview/App.tsx:73 and :82 (the retained-sidebar branch) both render `SidebarView`: replace each with `<SidebarChat ...>` (or one shared const). No wrapper reaches a JSX choice inside his render, so this is the one hook.
- Size: L (host M, webview M).
- Live test: with T3 in the right side bar, click a session: it opens in the panel; Shift-drag a file from the Explorer into it and see the chip; then Open in editor tab and Move to side panel once each.
- Risk: his ChatView header has six or more buttons and is untested at side-bar width; a CSS rule may be needed. Re-adding the sidebar to the registry clears its `ready` flag; check no queued event is lost. A single click in the Explorer still opens a preview, but now beside the chat, not over it.

### Q2. Keys into T3: focus the chat, new chat, palette entry
- Story: As a user I press one key to type into T3 and another to start a new chat, without the mouse.
- Build: ours command `t3-vscode.ours.chat.focus` on Ctrl+Alt+C (Ctrl+Esc is the Windows Start menu): reveal the side panel or the last focused chat tab, post OURS_EVENT `{kind:"focus"}`; the webview calls the existing `focusComposer` (src/webview/ours/composer.ts:13). Ctrl+Alt+N for a new chat through Q1's wrapper, so it follows the setting. An ours palette command "New Chat" (his `t3-vscode.newThread` is hidden, package.json commandPalette `when false`).
- Files: new src/host/ours/keys.ts, src/webview/ours/composer.ts (one event), package.json keybindings and commands.
- Size: S.
- Live test: press Ctrl+Alt+C in an editor and type; press Ctrl+Alt+N and see an empty chat.
- Risk: a key may not reach VS Code on this PC; check before settling on it.

### Q3. Toasts that help: turn finished, none for the chat you are reading
- Story: As a user I switch to another app during a long turn and get told when it finished or failed, and I am not toasted about a request I am already looking at.
- Build: ours listener on `hostState.onDidChangeState`, edge working to idle per thread (`ThreadSummary.status`, `activeRunId`, src/shared/bridge.ts:60-76). Toast "<title> finished" (or "failed") with Show (`provider.openSession`). Setting `t3-vscode.ours.notify.finished`: `unfocused` (default), `always`, `off`. In the existing `wrap(deps.notifications, "update")` (src/host/ours/approvals.ts:63-72), skip a thread when the window is focused and the focused view shows that thread.
- Files: new src/host/ours/finished.ts, approvals.ts, package.json setting.
- Size: S to M.
- Live test: send a prompt, switch to another app, see the toast; answer an approval in the chat and see no toast for it.
- Risk: a thread that streams in bursts may flap between working and idle; debounce about 2 s.

### Q4. Connection dead ends: auto-reconnect and buttons
- Story: As a user I restart or update T3 and VS Code reconnects by itself; when it cannot, I get a button, not a dead screen.
- Build: new src/host/ours/reconnect.ts. While not ready AND `connectionSetup.problem.kind` is `missing-runtime`, `server-stopped` or `unreachable`: watch the folder of `<home>/userdata/server-runtime.json`, poll every 10 s, retry on window focus; call `hostState.reconnect()`. His retry is 3 tries over 6 s (hostState.ts:377-385), then nothing. Also Retry and Connection settings on his "Connecting to T3 Code..." screen (App.tsx:75-78; StatusView already takes `actions`), and an "Open T3 app" button on the stopped screen (ServerSetup.tsx) that uses the desktop feature's `t3code://new`.
- Files: ours reconnect.ts, features.ts slot; his App.tsx:75 (one prop), ServerSetup.tsx (one-line slot for an ours button).
- Size: M.
- Live test: quit T3 with VS Code open, start it again, and see the chat return within 10 s with no click.
- Risk: never fire on `pairing` or `cli-missing`. `connect(false)` falls through to `pairWithServer` (hostState.ts:355-361), which runs `t3 pair` (pairing.ts:71); a careless poll would run the CLI every tick.

### Q5. Escape stops a running turn
- Story: As a user I press Escape in the chat box and the agent stops, as in Claude Code and Codex.
- Build: new src/webview/ours/escape.ts, a window keydown capture listener. Act only when `!event.defaultPrevented`, focus is in the composer textarea or the transcript, no popup is open (ModelPicker, SessionFind, suggestions and menus all use Escape: Composer.tsx:340, ModelPicker.tsx:72, SessionFind.tsx:115, ThreadActionsMenu.tsx:29), `.chat-main[data-thread-id]` is set (ChatView.tsx:65) and a `.stop-button` is present. Then `bridge.request(Methods.interrupt, { threadId })` (src/shared/bridge.ts:28).
- Files: src/webview/ours/escape.ts, src/webview/ours/index.ts.
- Size: S.
- Live test: start a long prompt, press Escape in the chat box: it stops; open the model picker and press Escape: only the picker closes.
- Risk: a loose guard stops a turn when the user only meant to close a popup.

### Q6. The side panel remembers its chat after a reload
- Story: As a user I reload VS Code and the T3 panel still shows the chat I had open.
- Build: store the sidebar's active thread id and mode in `workspaceState` on change; once ready after startup, select it on `SIDEBAR_VIEW_ID` and show chat mode. Chat tabs (tab mode) restore later via a serializer (see Later).
- Files: src/host/ours/sidebarChat.ts.
- Size: S. Depends on Q1.
- Live test: open a chat in the panel, Reload Window, see the same chat.
- Risk: an archived or deleted thread; fall back to the sessions list.

### Q7. Status bar and logs tell the truth
- Story: As a user I can see from the status bar whether T3 is connecting, pairing or broken, and open the logs in one click.
- Build: in src/host/ours/activity.ts: `error` reads "T3: connection problem" (today "T3: not running", activity.ts:31); `pairing` reads "$(sync~spin) T3: pairing" with no command (a click today queues a second pairing); `connecting` and `discovering` show "$(sync~spin) T3: connecting" (hidden today, activity.ts:33); idle shows a plain "T3" that opens the chat. New command `t3-vscode.ours.log.show` (channel at src/host/ours/index.ts:30), also in the view "..." menu; log each phase change; ours error toasts get "Show Logs".
- Files: activity.ts and activity.test.ts, statusbar.ts, log.ts, package.json.
- Size: S.
- Live test: stop T3 and watch the label change; run "T3 VSCode: Show Logs".
- Risk: none beyond the test update.

### Q8. Commands target the chat you are in, and hide when they cannot work
- Story: As a user "Thread Actions" and "Copy Link" act on the chat in front of me, and the palette does not offer commands that would only fail.
- Build: ours sets contexts `t3-vscode.ours.ready` and `t3-vscode.ours.hasThread` from `onDidChangeState` (no `setContext` in src today); `when` clauses on our commandPalette entries; `editor/title` (secondary group) entries for `t3-vscode.ours.links.copy` and `t3-vscode.threadActions` when `activeWebviewPanelId == 't3Panel'`.
- Files: new src/host/ours/contexts.ts, package.json. His src/extension.ts:113: `hostState?.snapshot()` defaults to the sidebar, so a palette Delete hits the sidebar's thread, not the focused tab; change it to `snapshot(registry.focusedViewId)`. One line; no wrapper reaches a local inside his command callback.
- Size: S.
- Live test: in a chat tab run Thread Actions, Rename: that tab's chat is renamed; disconnect and see Copy Link gone from the palette.
- Risk: low; after Q1 the focused view is often the sidebar, which is then correct.

### Q9. Reading in VS Code marks the chat read in T3
- Story: As a user a chat I read in VS Code no longer shows as unread in the T3 app or on my phone.
- Build: ours host feature: when a view's active thread is shown and focused, dispatch `thread.visit {threadId, visitedAt: updatedAt}` through `deps.client.dispatch`, throttled while a turn streams. T3 does this at ChatView.tsx:2952-2967 (reference); field at vendor/contracts/src/orchestrationV2.ts:417.
- Files: new src/host/ours/visit.ts, a t3-facts.json entry.
- Size: S to M.
- Live test: open an unread chat in VS Code and see its dot vanish in the T3 app.
- Risk: the paired session may lack permission for the command; test that first.

### Q10. "Latest" button always there, and the agent looks alive
- Story: As a user I scroll up during a long answer and can always jump back down, and I can see the agent is still working.
- Build: move the Latest button out of MessageNavigator (it returns null at MessageNavigator.tsx:31 with fewer than 2 exchanges or the setting off, before line 68 renders the button) into TranscriptView.tsx:255, shown when `!atEnd`, with a dot while working and not following. A pulse keyframe on `.working-label` and `.thread-working svg` (tokens.css has no @keyframes; the reduced-motion rule at tokens.css:237 turns it off). Show the newest running tool label after the count in a collapsed work group (TranscriptView.tsx:91 has it only in `title`).
- Files: his MessageNavigator.tsx, TranscriptView.tsx, styles/tokens.css. The button sits inside his component tree; no ours slot reaches it.
- Size: S.
- Live test: send one prompt with a long answer, scroll up, click Latest.
- Risk: none; send upstream.

### Q11. Bring a past prompt back: ArrowUp, "use again", Retry
- Story: As a user I press ArrowUp in an empty chat box to get my last prompt, reuse any earlier prompt, and retry after an error.
- Build: one helper in new src/webview/ours/reprompt.ts puts a text into the draft (`updateDraft`) and focuses the composer. Callers: ArrowUp and ArrowDown when the text is empty or the caret is on the first line, walking the thread's `user_message` rows (trimmed port of T3's chat/composerPromptHistory.ts); an icon next to Copy on the user bubble (TranscriptView.tsx:108); a Retry button on `case "error"` (TranscriptView.tsx:128, today only the message text) that puts the previous prompt back.
- Files: ours reprompt.ts; his Composer.tsx:334 onKeyDown (one hook line), TranscriptView.tsx:108 and :128 (one slot each).
- Size: M.
- Live test: send a prompt, press ArrowUp in the empty box and see it again.
- Risk: ArrowUp in a multi-line draft must still move the caret.

### Q12. Composer fits real prompts and says what it can do
- Story: As a user I paste a long log and see it, I learn about @ and /, and a failed send shows next to the box.
- Build: height cap from 220 px to 40 percent of the window (Composer.tsx:199); placeholder "Ask anything. @ to add files, / for commands" (Composer.tsx:313); a failed `sendMessage` shows in the existing `composer-attachment-error` style above the box (Composer.tsx:312), not only in the top banner (App.tsx:85).
- Files: his Composer.tsx (three small edits).
- Size: S.
- Live test: paste 100 lines and see the box grow; send while disconnected and see the error by the box.
- Risk: none.

### Q13. Plan mode: see it and switch it
- Story: As a user I see when a chat is in Plan mode and can switch between Plan and Build.
- Build: a Plan/Build toggle in the composer traits that calls `run("setModes", {...target, interactionMode})` (the host already takes it, hostState.ts:776-794; the webview has no `interactionMode` today); `/plan` and `/default` in shared/composerSuggestions.ts:264-266, handled at Composer.tsx:170-172. Show it when the provider allows it (`showInteractionModeToggle !== false`, T3 ChatView.logic.ts:626-639) and T3's `planModeEnabled` is on (vendor/contracts/src/settings.ts:442-447), or when the thread is already in plan mode.
- Files: one slot in his Composer.tsx:270-283 for an ours component; his composerSuggestions.ts.
- Size: S.
- Live test: set a thread to Plan in the T3 app, open it in VS Code, see Plan, switch to Build.
- Risk: reading the T3 flag may need a snapshot field.

### Q14. Secret requests show a card (the thread no longer hangs)
- Story: As a user, when an agent asks for a secret, I see a card and can answer it in VS Code.
- Build: an ours card using the vendored helpers (vendor/client-runtime/src/secretRequest.ts:47-87), one `case "secret_request"` line in TranscriptView.tsx:107-135, an ours RPC kind, and `T3Client.answerSecretRequest` over `WS_METHODS.secretsAnswerRequest` (vendor/contracts/src/rpc.ts:1824). The only item that needs a new client method; it is in the list because today such a thread waits forever with nothing on screen (STATUS known gaps).
- Files: ours card and rpc; his TranscriptView.tsx (one case), t3Client.ts (about 3 lines).
- Size: M.
- Live test: trigger a secret request from an agent and answer it in VS Code.
- Risk: the server may refuse the method for a paired VS Code client; test before building the card.

### Q15. File links open in the right place
- Story: As a user a file link in a reply opens as a normal editor next to the chat, images open too, and the Explorer selects the file.
- Build: in his private `openLink` (src/host/bridge.ts:248-262): `vscode.open` for non-text files (line 257 calls `openTextDocument`, which throws on a .png); a `viewColumn` that is not the chat's own group when the source is a chat tab (line 258 has none); an explicit `revealInExplorer` after it, so it does not depend on `explorer.autoReveal`. After Q1 the group part matters only in tab mode.
- Files: his bridge.ts (private method, no wrapper reaches it), about 5 lines.
- Size: S.
- Live test: click a .ts link and a .png link in a reply.
- Risk: none; send upstream.

### Q16. One-click "all changes" and actions on a diff
- Story: As a user I see every file a turn changed in one view, and from a diff I can open the real file or put it back.
- Build: "Show all changes" through `vscode.changes` with `[uri, before, after]` triples from his `t3-turn-diff` provider (today a QuickPick then one file, nativeDiff.ts:17-41). `editor/title` entries when `resourceScheme == t3-turn-diff`: "Open File" and "Revert File to Before This Turn" (reads the left document, writes with a WorkspaceEdit, modal confirm).
- Files: new src/host/ours/diffs.ts if `prepareTurnDiff` and `loadTurnDiffFile` are reachable through `hostState`, else a one-line export from his nativeDiff.ts; package.json.
- Size: M.
- Live test: after a multi-file turn, open Show all changes; revert one file and check `git diff`.
- Risk: the revert writes the user's files; confirm first and never touch a file the turn did not change.

### Q17. Approvals and questions by keyboard
- Story: As a user I answer an approval or a question with a key, and focus returns to the chat box after.
- Build: refocus the textarea after `respondToRequest` resolves (PendingRequests.tsx:55 drops focus to the page body); Alt+1..9 picks an option on the card (T3 uses plain 1-9 for questions, ComposerPendingUserInputPanel.tsx:179-189; Alt keeps typing safe).
- Files: his PendingRequests.tsx.
- Size: S.
- Live test: on an approval, press Alt+1 and keep typing.
- Risk: Alt+digit may be taken by another extension; check.

### Q18. Copy and time on transcript rows
- Story: As a user I copy a command's output with one click and see when a message was sent.
- Build: reuse `CopyButton` (TranscriptView.tsx:29) in the command input, command output and tool output bodies (:81, :117); a `title` with the local date and time from `startedAt`/`completedAt` on the user bubble and AssistantHeader (:108, :139).
- Files: his TranscriptView.tsx (or the message-actions slot from Q11).
- Size: S.
- Live test: hover a message and see the time; copy a command output.
- Risk: none.

### Q19. Missing thread and subagent actions
- Story: As a user I can snooze a chat, regenerate its title, mark it unread, copy its branch or id, and stop a subagent, as in the T3 app.
- Build: one ours slot in ThreadActionsMenu.tsx:39 (before the `<hr/>`) with Snooze (QuickPick of presets, `thread.snooze`/`thread.unsnooze`), Regenerate title (`thread.metadata.update` with `regenerateTitle`), Mark unread (`thread.mark-unread`), Copy branch and Copy id; Stop subagent in SubagentCard.tsx:30-33 (`subagent.stop {runId, subagentId}`). Sent through an ours RPC and `client.dispatch` (vendor/client-runtime/src/operations/commands.ts:521-797).
- Files: ours menu component and rpc; his ThreadActionsMenu.tsx and SubagentCard.tsx (one slot each).
- Size: S to M.
- Live test: snooze a chat for 1 hour and see it move in the T3 app.
- Risk: the paired session's permission for each command; test one first.

### Q20. Context left, and Implement on a plan
- Story: As a user I see how full the context is, and I implement a proposed plan with one click.
- Build: a "62% context" chip in the composer traits slot from `contextUsage` on the provider thread (vendor/contracts/src/providerRuntime.ts:263; the host reads `projection.providerThreads`, hostState.ts:856, so one getter in his hostState.ts). Plan card slot (TranscriptView.tsx:115): Implement (`setModes` default, then send "PLEASE IMPLEMENT THIS PLAN:" plus the plan, per T3 apps/web/src/proposedPlan.ts:55-95) and Open as markdown (`openTextDocument({language:"markdown", content})`).
- Files: ours chip, plan actions and one host kind; his Composer.tsx slot (shared with Q13), TranscriptView.tsx:115 slot, hostState.ts getter.
- Size: M.
- Live test: a long chat shows a rising percentage; a plan turn shows Implement and it runs.
- Risk: T3 hides its own meter by default (`contextWindowMeterEnabled`, settings.ts:449); follow that setting if the snapshot carries it.

Build order: Q1 first and alone (it changes where every later item shows). Then Q2 to Q9 in parallel (mostly ours). The webview slots (composer traits, message actions, plan card, thread menu) land once in one small slice before Q11, Q13, Q18, Q19 and Q20, as slice 0 did for phase 3.

## 3. Later

- Chat tabs restore after Reload Window: `registerWebviewPanelSerializer` for `t3Panel` plus a hook in his private `mountPanel` (src/extension.ts:274). Matters only in tab mode after Q1.
- Reopen a closed chat tab (Ctrl+Shift+T style), via `tabGroups.onDidChangeTabs` or his `panel.onDidDispose` (extension.ts:288).
- Chat tab icon or prefix for running and waiting (needs his private `panels` map).
- Native "switch chat" QuickPick with type-to-filter over `hostState.snapshot().threads`.
- Unread dot for chats finished in the background (needs `lastVisitedAt` in his ThreadSummary mapping, bridge.ts:60-76).
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
- "Drop files here" view as `visibility: collapsed` (first check a collapsed view still accepts a drop); after Q1 the chat itself takes drops, so the view may not be needed.
- Alt+K collides with Claude Code's `claude-vscode.insertAtMention` (both installed here); an ours key or a `when` on a T3 context.
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
- Small fixes in his files: chevron tooltip (ChatView.tsx:77), `openWebUi` failure as an error toast (extension.ts:100), dead "not connected yet" message (extension.ts:93), Ctrl+B and Ctrl+I in the composer (Composer.tsx:353).
- Not doable: VS Code's own Chat sessions view (proposed APIs). Not relevant: CLI path, terminal mode, worktree creation, Marketplace update.

## 4. Owner questions

Each has the default a builder takes if no answer comes.

1. New installs: should T3 land in the right (secondary) side bar? That needs a `viewsContainers.secondarySidebar` entry next to his `activitybar` one and moving his views. Default: no; your install is already on the right, and FORK-FEATURES gets a tip on how to drag it there.
2. His Ctrl+K (insert selection) breaks VS Code's Ctrl+K chords (Ctrl+K Ctrl+C comment, Ctrl+K Ctrl+F format) while text is selected; only his entry can change it. Default: leave it, document the user keybindings.json line `-t3-vscode.insertReference`, and suggest the change upstream.
3. Words: the UI says thread, session, conversation and chat for one thing. Default: our new text says "chat"; his strings stay until upstream agrees.
4. Plan/Build toggle (Q13) when T3's beta flag `planModeEnabled` is off. Default: hidden then, shown only for a thread already in plan mode.
