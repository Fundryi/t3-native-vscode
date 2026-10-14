# QoL round 2: ranked build list

Written 2026-10-14 from five read-only scouts (first five minutes, daily loop, visual polish, keyboard and accessibility, round 1 leftovers), merged and spot-checked against the code by the writer. Line numbers are from main at 87189f0 and the T3 reference v0.0.46-nightly.20261014.3105; re-check before editing. Nothing here was run live; pixel and focus claims come from reading code.

Same method as round 1 (docs/ours/QOL-ROUND-1.md): one builder per group, worktree, ours files first, one-line hooks in his files, each his-file change gets a line in docs/UPSTREAM.md. The lead adds a slot line `// Rn name` at the end of src/host/ours/features.ts and of src/webview/ours/index.ts; a builder replaces only its own slot lines. package.json is merged as JSON (phase 3 method), so it never forces a group.

"Check first" means: verify the named fact live before building; if it fails, the item drops to Later. "Promoted" means the item was in round 1 "Later".

## 1. Already there (do not rebuild)

- Round 1 Q1b..Q21 as listed in FORK-FEATURES.md (sidebar chat, keys, toasts, reconnect, Escape, status bar, contexts, Latest, reprompt, composer fit, plan mode, secret card, file links, all-changes diffs with revert, approval keys, row copy and times, Shift hint).
- `t3-vscode.ours.ready` and `t3-vscode.ours.hasThread` contexts (src/host/ours/contexts.ts:22-24).
- `ThreadSummary.workingStartedAt` (src/shared/bridge.ts:67) and `runningStepLabels` (src/shared/ours/latest.ts): data for a live timer.
- `turnCheckpointRange`, `client.getThreadProjection`, `client.getSavedTurnDiff` (t3Client.ts:123, :196): data for a diff without a baseline.
- `:line` in file links (src/host/fileLinks.ts:23); `lf` helper in diffsRevert.ts.
- The project-settings resolver is vendored (vendor/shared/src/projectSettings.ts) and `client.config.settings` arrives on connect (vendor/contracts/src/server.ts:699).
- T3's desktop launcher exists on this PC: `~/.t3/bin/t3.cmd` (written by DesktopCliShim.ts:148-153).
- Approval wording (PendingRequests.tsx:52) and the "N changed files / Open diff" card (TurnChanges.tsx:42-43) read well; no change.
- Icons: lucide in the webview, codicons in package.json; keep that split. Reduced motion (tokens.css:237) also stops our pulse.
- BACKLOG.md rows Q1, Q2, Q5-Q14, R26, R29 are already in his code or built; B24 is owner question 1 of round 1; B26, R30, R31 are old architecture.

## 2. Build list, ranked

Sizes: S under 30 lines, M under 150, L more. Groups (one builder each, in this order inside the group):
- G-polish: R1 then R6 (new src/webview/ours/polish.ts, one injected style block instead of one per feature).
- G-latest: R4, R5, R9 (src/webview/ours/latest.ts).
- G-diffs: R7 then R17 (src/host/ours/diffs.ts).
- G-actions: R11 then R18 (src/host/ours/threadActions.ts, src/webview/ours/threadActions.ts).
- G-a11y: R13 then R15 (approvalKeys.ts, secrets.ts, layout.ts).
Every other item is its own builder.

### R1 surface: The side panel chat has the side bar colour
- Story: As a user the chat in the side panel looks like part of the side bar, with no lighter or darker box and no seam under the "Back to" bar.
- Build: in src/webview/ours/layout.ts set `body[data-ours-surface="sidebar"]` once on a sidebar webview (never flipped; `data-surface` flips to "panel" in chat, layout.ts:89). New polish.ts: under that attribute set `--background: var(--vscode-sideBar-background)` (tokens.css:31 uses the editor colour). Also override `--muted` and the `--message-surface` fallback with `color-mix(in srgb, var(--foreground) 7%, transparent)`, or chips, `.turn-changes`, code spans and the user bubble vanish (in Light Modern the side bar and those surfaces are both #f8f8f8).
- Files: new src/webview/ours/polish.ts, src/webview/ours/layout.ts (one attribute).
- Size: S.
- Live test: Dark Modern and Light Modern, side panel chat and list: no colour seam, user bubble and chips still visible.
- Risk: low; the editor-tab chat must keep the editor colour.

### R2 defaults: A new chat starts with my T3 model
- Story: As a user who picked a default model in T3, a new chat in VS Code starts with that model, like T3 web does.
- Build: in `conversationDraft` (hostState.ts:552-565) seed `draftModelSelection` from `resolveProjectSettings(settings, projectId).settings.defaultModelSelection` (as T3 web, reference ChatView.tsx:2114, :2207) before the `availableModel` fallback (hostState.ts:533-541). Keep a "user picked" flag so a choice made in the draft stays. Permission mode: see owner question 1 (default keeps "auto", hostState.ts:98). Add a `title` per permission option with the one-line meanings from T3's docs/user/permission-modes.md, from src/webview/ours/composer.ts (DOM, no his line).
- Files: src/webview/ours/composer.ts; his src/host/hostState.ts (the draft is built there and is private; no public method to wrap sees the project id before the model is picked).
- Size: S to M.
- Live test: set Claude as default in T3, new chat in VS Code shows Claude; pick another model in the draft, it stays.
- Risk: an unknown model in the setting must fall back to `availableModel`, not to nothing. Upstream candidate.

### R3 viewbar: Native view title buttons, one header row
- Story: As a user the side panel has New Chat and Sessions as real view buttons, one header row in a chat, a title that says what I see, and a T3 button in every editor title bar.
- Build:
  - Context `t3-vscode.ours.sidebarChat` set from src/host/ours/layout.ts while the chat shows.
  - package.json view/title `navigation@1`: `t3-vscode.ours.chat.new` (give it the icon `$(add)`; ours is routed by the layout wrap) when `!t3-vscode.ours.sidebarChat`; in chat mode Sessions (`$(arrow-left)`) and pop-out (`$(empty-window)`; `$(link-external)` is taken by desktop.open). Gate desktop.open (`navigation@5`), links.copy, threadActions and threadActions.more with `&& t3-vscode.ours.hasThread` (today only `view == t3.webview`).
  - In chat mode hide our slim bar and `body[data-ours-chat] .chat-header [aria-label="History"]` (duplicates Sessions).
  - Wrap `provider.updateTitles` (public, extension.ts:210-212; it resets the title to "T3 VSCode" on every change): after it, set the sidebar view `title` to "Sessions" or the chat title and `description` to the project name. Fixes the "T3 VSCODE / T3 VSCODE" double header and makes truncated chat titles readable.
  - "+" tooltip: rewrite `title` and `aria-label` of ChatView.tsx:75 and ThreadList.tsx:79 to "New chat" when `openThreadsIn` is `sidebar` (DOM observer). Supersedes round 1 Q1b ("his string stays").
  - editor/title `navigation` entry for `t3-vscode.ours.chat.focus` with a T3 icon and no `when` (as Claude Code and Codex).
- Files: src/host/ours/layout.ts, src/webview/ours/layout.ts, package.json.
- Size: M.
- Live test: list mode shows "+" in the view title; open a chat: one header row, the view title shows the chat name; any editor shows the T3 icon top right.
- Risk: `registry.add` clears his `ready` flag; do not add another re-add path.

### R4 working: Live "what and how long", and "done" is announced
- Story: As a user I see "Working 1m 12s - npm test" while T3 runs, the total time when it ends, and a screen reader hears "Response finished".
- Build: in latest.ts fill `.working-label` and the `.sticky-working` copy once a second from `workingStartedAt` and `runningStepLabels` (his header says only "Working", TranscriptView.tsx:138-139). Add "Worked 2m 14s" to `.response-end` (TranscriptView.tsx:244) from the run's first `startedAt` to last `completedAt` (rowCopy.ts pattern; today only per work group, transcriptRows.ts:51-58). activity.ts: "T3: running 3m", per-chat times in the hover. CSS "- Esc to stop" after `.composer-shortcuts` while `.stop-button` exists. A polite live region announces "Response finished" or "failed" on the working-to-idle edge latest.ts already computes (keyboard G2).
- Files: src/webview/ours/latest.ts, src/host/ours/activity.ts.
- Size: S.
- Live test: run a turn: the label counts up and names the step; at the end "Worked ..." shows; NVDA says "Response finished".
- Risk: the 1 s timer must stop when nothing runs.

### R5 scroll: Sending jumps down, switching chats keeps my place
- Story: As a user my own new message is always on screen, and going back to a chat lands where I left it.
- Build: in latest.ts, when `acknowledgedWorking.messageId` changes (bridge.ts:110), click Latest (`followEnd` stays false after scrolling up, TranscriptView.tsx:258-260). Per-thread memory of `.transcript-list` scrollTop keyed by `.chat-main[data-thread-id]`: save before the id changes, restore over a few frames (layout.ts:81-89 pattern), because `key={id}` remounts and `initialScrollAtEnd` jumps to the end (TranscriptView.tsx:171, :256).
- Files: src/webview/ours/latest.ts.
- Size: S to M.
- Live test: scroll up, send: the view jumps down; switch chat A to B to A: A is where it was.
- Risk: the list is virtual, so the restored place is approximate.

### R6 theme: VS Code's own colours for hover, focus, scrollbars, buttons
- Story: As a user hover, focus and buttons look like the rest of VS Code in every theme, high contrast included, and no text is below 11 px.
- Build (all CSS in polish.ts, no his line; line numbers are tokens.css):
  - Hover: `.icon-button`, `.btn` to `--vscode-toolbar-hoverBackground`; `.menu-popup` and `.thread-actions-popup` rows to `--vscode-menu-selectionBackground/Foreground`; `.composer-suggestions [aria-selected]` to `--vscode-list-activeSelectionBackground`. Today all use `--muted`, identical to the side bar (73, 75, 128, 151, 326); his `.math-context-menu` (486-488) already does it right.
  - High contrast: `body.vscode-high-contrast :is(.icon-button, .btn, [role=menuitem]):hover { outline: 1px dashed var(--vscode-contrastActiveBorder) }`.
  - Scrollbar: `scrollbar-color: var(--vscode-scrollbarSlider-background) transparent` (66-68). Check first which rule wins in the running webview.
  - Focus: `.composer-box:focus-within` to `--vscode-focusBorder` (201); focus ring 1 px, offset -1 px (64; overflow parents clip it today).
  - Buttons: `.btn.primary:hover` to `--vscode-button-hoverBackground`; `.btn` to `--vscode-button-secondary*` (fixes our secret and reconnect buttons).
  - Hard colours: `.connection-dot` #22c55e (111) to `--vscode-testing-iconPassed`; `#0003`/`#0005` shadows (126, 151, 205, 210, 225, 324, 450, 486) to `--vscode-widget-shadow`.
  - Text floor (owner question 4): `.5625rem` and `.625rem` selectors (628, 376, 345-348, 313, find count, streaming label) to `.6875rem`. Our Latest button (fixed 11 px, 456) and shiftHint (12 px, shiftHint.ts:10) to rem.
  - User message icons (his Copy plus our "use again") hidden until `:hover` or `:focus-within`, like his assistant actions (637-638).
  - Plan card at side bar width: `.plan-card > header { flex-wrap: wrap }`, `.ours-plan-actions { margin-left: auto }`, "Implement" as `btn primary`, `@container (max-width: 420px)` with smaller padding and radius.
- Files: src/webview/ours/polish.ts, src/webview/ours/contextMeter.ts (Implement class), src/webview/ours/shiftHint.ts.
- Size: M.
- Live test: Dark Modern, Light Modern, HC Dark: hover each button kind, Tab to the composer, narrow the side bar to 300 px with a plan card.
- Risk: low; CSS only, his tokens untouched.

### R7 diffcard: A changes card for every turn that edited files
- Story: As a user every turn that changed files shows "N changed files / Open diff", also queued, steered and T3-app turns.
- Build: in src/host/ours/diffs.ts `wrap(hostState, "prepareTurnDiff")`. On "Agent-only diff unavailable" (hostState.ts:1032-1033; the baseline is only taken for a fresh auto send, :659-661) fall back to the checkpoint range with `getSavedTurnDiff`, and mark the result so the card shows "May include your own edits" (owner question 2). Interrupted runs also need the completed-run check relaxed at turnDiff.ts:54 and TurnChanges.tsx:22 (his, one condition each); check first that T3 writes a ready checkpoint for an interrupted run, else leave that half out.
- Files: src/host/ours/diffs.ts, a small ours webview note; his turnDiff.ts:54 and TurnChanges.tsx:22 only for interrupted runs.
- Size: M.
- Live test: queue a second message while a turn runs; when it edits a file, a card with the note appears.
- Risk: weakens his deliberate agent-only guarantee; the note is the point.

### R8 errors: Errors I can read
- Story: As a user a failed step says what kind of failure it is, whether it is retrying, and lets me copy it or open the logs.
- Build: MutationObserver (rowCopy pattern) on `.turn-error` (TranscriptView.tsx:128): heading from `failure.class`, "Retrying 2/5 in 4s" from `retry` (orchestrationV2.ts:1372-1391, :1585-1588), clamp to 4 lines with "Show more", "Copy error", "Show Logs" (`t3-vscode.ours.log.show`). A click on `.work-group-failures` (TranscriptView.tsx:83-93) opens the group and each `.work-entry.failed`. A red marker on a session row whose last run failed (`thread.status === "failed"`, finishedEdge.ts:20-23) via `[data-thread-id]`.
- Files: new src/webview/ours/errors.ts.
- Size: S to M.
- Live test: make a command fail on purpose: the error has a heading, Copy and Show Logs; "1 failed" opens the failed row.
- Risk: low.

### R9 openline: Open the edited file at the change
- Story: As a user a click on an edited file name lands on the first changed line, and the running "Editing X" label opens X.
- Build: capture listener in src/webview/ours/fileLinks.ts reads the first `@@ ... +N` from the row's `.diff-hunk` and sends `fileName:N` (TranscriptView.tsx:61-66 sends no line). Turn the Q10 CSS `::after` "Editing X" (latest.ts:92) into a real span that opens the file.
- Files: src/webview/ours/fileLinks.ts, src/webview/ours/latest.ts.
- Size: S.
- Live test: click an edited file in a finished turn: the editor opens at the hunk.
- Risk: low.

### R10 dropview: "Drop files here" stops taking space (promoted)
- Story: As a user the empty "Drop files here" view no longer sits under the side panel chat.
- Build: `"visibility": "collapsed"` on `t3-vscode.ours.drop.view` (package.json:41). Check first that a drop on a collapsed view header still works; if not, a setting `t3-vscode.ours.drop.showView` (default false) as its `when`.
- Files: package.json (src/host/ours/drop.ts only for the fallback).
- Size: S.
- Live test: fresh profile: the view is collapsed; drag a file onto its header.
- Risk: low.

### R11 actions: One thread-action list, and Archive can be undone (promoted)
- Story: As a user one "Thread Actions" list has every action in the view and the tab, and a misclicked Archive has an Undo.
- Build: make `t3-vscode.ours.threadActions.more` the full list: his five rows through the public `hostState.threadAction`, rename input box and modal delete confirm as bridge.ts:51-55, plus our rows (merges keyboard G17 and leftovers 1b). Point view/title and editor/title at it, palette `when: false` for `t3-vscode.threadActions`, gate ours with `hasThread`. Wrap `hostState.threadAction`: after `archive`, a toast "Archived <title>" with Undo that runs `unarchive`.
- Files: src/host/ours/threadActions.ts, package.json.
- Size: M.
- Live test: the tab and the side panel "..." show the same list; Archive then Undo brings the chat back.
- Risk: his command stays registered, only hidden.

### R12 setup: Pairing works with only the T3 app, and connects by itself the first time
- Story: As a Windows user with only the T3 desktop app, VS Code pairs (also when the 30-day token runs out) and connects as soon as T3 starts, without Retry.
- Build:
  - runPairingCommand (pairing.ts:56-73): on ENOENT retry with `join(home, "bin", win32 ? "t3.cmd" : "t3")` if it exists, through `runtime.resolve` (a .cmd needs the shell path, vendor/shared/src/shell.ts:778-789). Record the launcher in t3-facts.json.
  - reconnect.ts:31-33: allow one attempt without a stored credential when the watcher fires (`force`) and the kind is `missing-runtime` or `server-stopped`, guarded by a once-flag (the watcher fires twice, reconnect.ts:47). A failed pairing ends in `pairing` or `cli-missing`, outside AUTO_KINDS, so no loop.
  - Setup wording on win32 (ServerSetup.tsx:55-58, 68-70; inject from ours like src/webview/ours/reconnect.ts:38-42): "Install and open the T3 Code app (winget install T3Tools.T3Code)" with the CLI as the alternative; cli-missing says "Using the T3 app? Settings -> General -> About -> Install t3 command, then quit VS Code fully"; "the T3 app keeps the server running" where the service step is hidden (serverDiscovery.ts:37); one line under "Pairing with T3 Code..." (up to 45 s); Q4 button label "Open T3 app (new chat)" (it sends `t3code://new`, desktop.ts:10).
- Files: src/host/ours/reconnect.ts, src/webview/ours/reconnect.ts, t3-facts.json; his src/host/pairing.ts (the fallback sits inside its catch; no seam outside).
- Size: S to M.
- Live test: isolated T3 home with no `t3` on PATH but `<home>/bin/t3.cmd`: pairing succeeds; start VS Code first, then T3: it connects without a click.
- Risk: without the once-flag one watcher event queues two `t3 pair` runs. Upstream candidate.

### R13 focus: Focus never drops to the page
- Story: As a keyboard user focus stays somewhere useful after opening a chat from the list, going back to Sessions, removing a chip, or tabbing out of a popup.
- Build: layout.ts setChat (:87-98): after the flip, if focus is on body or a hidden element, chat goes to `t3-focus-composer`, list to `.thread.active` or the search box (G3). Capture click on `.remove-attachment` and `.context-chip .icon-button`: next frame, focus the next X or the textarea (G4). Window focusin: an open dialog or menu that does not contain the new target gets an Escape (threadActions.ts:115 pattern), so Escape stops the turn again (G6, escape.ts:12).
- Files: src/webview/ours/layout.ts, new src/webview/ours/focus.ts.
- Size: S.
- Live test: keyboard only: Enter on a session row, type; Sessions, arrow; remove a chip, Tab; open the model picker, Tab out, Escape stops a turn.
- Risk: low.

### R14 keys2: Keys inside T3
- Story: As a keyboard user I can toggle focus out of T3, start a chat with Ctrl+N, jump to the next chat that needs me, and work the sessions list with arrows, F2, Delete and Ctrl+F.
- Build:
  - Ctrl+Alt+C toggles: a second binding to `workbench.action.focusActiveEditorGroup` when `!editorTextFocus && (focusedView == 't3.webview' || activeWebviewPanelId == 't3Panel')`; the first (package.json:240) gets the opposite `when` plus `focusedView != 'workbench.debug.watchExpressionsView'`.
  - Ctrl+N runs `t3-vscode.ours.chat.new` with the same in-T3 `when` (owner question 5).
  - "Go to Next Chat That Needs You" with a key, cycling chats with `pendingRuntimeRequest`; show statusbar.open in the palette when ready (package.json:383) and with no argument open the first waiting chat (statusbar.ts:29-33).
  - Sessions list (promoted arrow keys): Up, Down, Home, End over `button.thread[data-thread-id]`; F2 renames; Delete archives (his `threadAction` path, so the R11 Undo applies); Ctrl+F focuses "Search threads" (ThreadList.tsx:77).
  - F2 in a chat runs his rename (ChatView.tsx:67 is double-click only).
- Files: src/host/ours/keys.ts, new src/webview/ours/listKeys.ts, package.json.
- Size: M.
- Live test: each key once, in a chat tab and in the side panel; check Keyboard Shortcuts for conflicts.
- Risk: whether `focusedView` matches while typing inside a webview is unchecked; check first.

### R15 announce: Screen readers hear new cards, and Alt+1 hits the right one
- Story: As a screen reader user I hear "Approval needed: <title>. Alt+1 ..., Alt+2 ..." when a card appears, and Alt+1 never answers the wrong card.
- Build: a visually hidden `role=status` node in approvalKeys.ts announces new `.approval-card`, `.question-card` and secret cards (G1). Fix the clash: secrets.ts:48 inserts the secret card first in `.composer-column` and approvalKeys.ts:26 takes the first `.approval-card`, so Alt+1 answers the secret card; exclude `.ours-secret-requests` from that query and give the secret card Alt+N only when no approval shows. Secret container `role="region"`, `aria-label="Secret request"`. Context chip: `role="meter"`, `aria-valuenow`, `aria-label="Context used"`, `tabindex=0`, warning colour at 80%, error colour at 95% (contextMeter.ts:18, 31-42). Plan toggle: fixed `aria-label="Plan mode"` (planMode.ts:51-56).
- Files: src/webview/ours/approvalKeys.ts, secrets.ts, contextMeter.ts, planMode.ts.
- Size: S.
- Live test: NVDA on, trigger an approval and a secret request together; hear both; Alt+1 answers the approval.
- Risk: low.

### R16 output: Long output opens in an editor, and copy works by keyboard
- Story: As a user I can open a long command output in a real editor tab and copy it without the mouse.
- Build: "Open in editor" next to the rowCopy button; a new ours RPC (about 8 lines) `openTextDocument({ content, language: "log" })` (planOpen, contextMeter.ts:67, is plan-only). Give `pre.command-input` and `pre.tool-output` `tabindex=0` and an aria-label; focusin does what mouseover does, times included (rowCopy.ts:95); Ctrl+C on a focused box with no selection copies all (merges visual 16 and keyboard G5).
- Files: src/webview/ours/rowCopy.ts, a new RPC in src/host/ours/output.ts.
- Size: S.
- Live test: a long `npm test` output: Open in editor shows all of it; Tab to it, Ctrl+C, paste.
- Risk: low.

### R17 hunks: Undo one hunk in the diff (check first)
- Story: As a user reviewing a turn I can undo one hunk with VS Code's own revert arrow and edit in place.
- Build: in the multi-diff triples (diffs.ts:142) use the real `file:` URI as the right side when `lf(disk) === lf(after)`; virtual sides otherwise. An ours editor/title "Compare with current file" for his single-file diff (nativeDiff.ts:23-26). Check first that the multi-diff view shows revert arrows with a file right side.
- Files: src/host/ours/diffs.ts, package.json.
- Size: S to M.
- Live test: open all changes, click one hunk's arrow: the file changes, Ctrl+Z restores it.
- Risk: writes the user's file with Ctrl+Z as the only undo (owner question 3).

### R18 substop: Stop a running subagent from its card
- Story: As a user a running subagent card in the parent chat has Stop.
- Build: in src/webview/ours/threadActions.ts find `[data-search-row] .subagent-entry` (TranscriptView.tsx:97), look up `childThreadId` in the snapshot by row key, add a stop button that runs the existing `stopSubagent` (src/host/ours/threadActions.ts:42-57).
- Files: src/webview/ours/threadActions.ts.
- Size: S to M.
- Live test: start a subagent; Stop on the card ends it.
- Risk: low; upstream alternative in SubagentCard.tsx.

### R19 emptylist: The empty sessions list explains itself
- Story: As a user who opened a sub or parent folder, the empty list says T3 has chats in other folders and offers "Start a chat".
- Build: a count of threads in `shell.projects` outside the workspace filter (hostState.ts:432-435 matches only an exact root), read by an ours RPC. Ours observer on `.empty-list` (ThreadList.tsx:84): lucide icon, "Start a chat" button (ours `chat.new`), "T3 has N chats in other folders" with Show (opens Switch Chat over those chats), and the line "Alt+K adds the selection, Ctrl+Alt+C focuses the chat" (merges first-five D4 and W4, visual 19). Fix the false "Current workspace only" footer (ThreadList.tsx:90) when no folder is open.
- Files: new src/host/ours/emptyList.ts, new src/webview/ours/emptyList.ts.
- Size: M.
- Live test: open D:\GIT as the folder: the list explains, Show lists the chats, the button starts a chat.
- Risk: Show must not change his filter. The count reads private `shell` by element access, as Q20 reads `threads`.

### R20 longmsg: Long pasted prompts fold (promoted)
- Story: As a user a 300-line paste in my bubble does not push the answer off screen.
- Build: CSS max-height on `.user-bubble` plus a "Show full message" toggle added by a MutationObserver (rowCopy pattern).
- Files: new src/webview/ours/longMessage.ts.
- Size: S.
- Live test: send a long paste: the bubble folds and unfolds.
- Risk: low.

## 3. Upstream candidates (one small change each in his files)

1. src/host/serverDiscovery.ts:60-66: EPERM counts as alive (elevated T3 app reads as stopped). Made here; send with its test.
2. src/extension.ts:113: Thread Actions targets `registry.focusedViewId`. Made in 8373e73.
3. src/extension.ts:99: `openWebUi` uses `SIDEBAR_VIEW_ID`; use `registry.focusedViewId`, or "Open Web UI" from a chat tab opens the sidebar's thread. Not made.
4. src/extension.ts:100: `openWebUi` failure is an info toast; should be an error.
5. src/extension.ts:93: dead "not connected yet" branch.
6. scripts/generate-notices.mjs:9: `shell: process.platform === "win32"`. Made.
7. Windows test fixes (junction, `path.resolve`, prepare-vscode-profile test). Made; one PR.
8. src/host/pairing.ts:56-73: fall back to `<home>/bin/t3.cmd` (R12).
9. src/host/hostState.ts:552-565: a new draft honours T3's default model (R2).
10. src/webview/components/ChatView.tsx:77: the chevron has `aria-label` but no `title`.
11. src/webview/components/SubagentCard.tsx `.subagent-line`: Stop button or `data-child-thread-id` (R18).
12. src/webview/components/Composer.tsx:309: "Remove reference N" should name the file. :346: Tab indent on list lines traps keyboard users.
13. src/webview/components/Composer.tsx:353: Ctrl+B and Ctrl+I take VS Code's side bar toggle while typing.
14. package.json:17-19: `categories: ["Other"]` to `["AI", "Chat"]`, so the Extensions view filters find it.
15. src/host/bridge.ts private openLink: `openTextDocument` throws on images and PDFs and passes no `viewColumn` (ours works around it, Q15).
16. MessageNavigator.tsx:31: hides Latest under 2 exchanges (ours works around it, Q10).
17. src/host/turnDiff.ts:54, TurnChanges.tsx:22: allow interrupted runs (R7), if T3 checkpoints them.
Not a PR: the "+" tooltip (ChatView.tsx:75, ThreadList.tsx:79) is correct in his repo, which has no sidebar chat mode.

## 4. Later

- First-run walkthrough: steps complete on `onContext:t3-vscode.ours.ready`, `onCommand:t3-vscode.ours.chat.focus`, `onContext:t3-vscode.ours.hasThread`, `onCommand:t3-vscode.ours.mcp.setup`; media under resources/walkthrough/ plus an "Open Walkthrough" command; `contributes.walkthroughs` is a new top-level manifest key and needs the owner's OK. `viewsWelcome` does not work on a webview view. M.
- Right (secondary) side bar for new installs: a second view id and changes in his provider (extension.ts:185, :200). L. Round 1 owner question 1 stands.
- Provider status instead of "No models available" (Composer.tsx:356) from `state.providers`; check the nightly's `ServerProvider` fields first. M.
- Usage-limit card with the reset time from `lastErrorClass`/`usageLimitResetAt` on the shell row. M.
- Open T3 on startup setting (`t3.webview.focus` after activation). S.
- Loading progress: `withProgress({ location: { viewId: "t3.webview" } })` while connecting or loading a chat; `role="status"` on "Loading conversation..." (TranscriptView.tsx:250). S to M.
- File-change approval reviewed in a diff editor with Accept and Reject; check first that a pending file_change item carries a patch (`ThreadPendingApproval` has only `detail`, threadRequests.ts:11-21). L.
- "Stop and send now" (Alt+Enter) if a queued message is held after Escape (`queue.held`, conversationActivity.ts:12); check live first. S to M.
- A running command whose output was withheld may stay frozen when opened (TranscriptView.tsx:46-50); check live first.
- The conversation as a keyboard region: `role="region"` and `tabindex=0` on the transcript, PageUp/PageDown from an empty composer (TranscriptView.tsx:251). S.
- Escape also hides a visible VS Code toast (escape.ts:16): stopImmediatePropagation after `stop.click()`. S.
- Tab out of the composer after Escape on list lines (keyboard G14). S.
- Shift+Alt+K in the Explorer via the copyFilePath trick (drop.ts:58-63), restoring the text clipboard. S to M.
- Setup cosmetics: `'...'` quoting in the commands fails in cmd.exe (serverDiscovery.ts:32), and the `$` prompt (ServerSetup.tsx:20). S.
- Remote windows: one notice "T3 VSCode works in local windows only" when `vscode.env.remoteName` is set. S.
- Editor-tab mode only: tabs restore after reload, reopen a closed tab (wrap `hostState.removeView`), running mark on tab titles (wrap `updateTitles`), bring a fresh-draft tab to the front on insert (prompt.ts:32-33). S to M each.
- Switch Chat sorts pinned first and settled last (keys.ts:36). S.
- Unchanged from round 1 Later: model options beyond effort, send-key choice, send in background, prompt stash, empty-chat screen, T3's other keys, edit from here, code block run and insert, multi-root preselect, review into a separate chat, branch picker, forget pairing, T3 settings page, T3 menu QuickPick.
- Docs out of date (S each): FORK-FEATURES Q19 says we never send `thread.visit` (Q9 now does); STATUS "Now" 12:51 on extension.ts:113; STATUS "Known gaps" secret_request (only the history row is missing; his TranscriptView.tsx:108-134, after a re-vendor past 0.0.45); docs/UPSTREAM.md has no lines for extension.ts (activateOurs hook, :113), bridge.ts `case "ours"`, shared/bridge.ts `Methods.ours`, webview/main.tsx import, serverDiscovery.ts EPERM, generate-notices.mjs, the Windows test fixes.
- AltGr: Ctrl+Alt+C, Ctrl+Alt+S and Ctrl+Alt+Shift+N eat characters on Polish layouts; document in FORK-FEATURES Q2.

## 5. Owner questions

Each has the default a builder takes if no answer comes.

1. R2 permission mode for a new chat. T3's server settings decode to `full-access` when never set (vendor/contracts/src/settings.ts:1160, providerPolicy.ts:32), so VS Code cannot tell "you chose it" from "T3's default", and following it would silently widen today's "auto". Default: follow T3's default model; keep "auto" for the mode unless the project override sets one (that key is optional, settings.ts:1014).
2. R7: queued, steered and T3-app turns would show a diff that may include your own edits (his code refuses on purpose). Default: show it, with the note "May include your own edits".
3. R17: the per-hunk revert arrows write straight to your file; Ctrl+Z is the only undo. Default: build it, only when the file on disk equals the turn's result.
4. R6: raise the 9 and 10 px text (session meta, composer shortcuts, counts) to 11 px at the default font size. Default: yes.
5. R14: Ctrl+N inside T3 starts a new chat instead of a new file while T3 has focus (Claude Code and Codex do the same). Default: yes.
6. R19: should a T3 project whose root contains, or sits inside, the open folder count as "this workspace"? Default: no; the empty list only offers to show those chats.
