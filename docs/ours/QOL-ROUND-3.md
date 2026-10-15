# QoL round 3: ranked build list

Written 2026-10-15 from six read-only scouts (parity with the Claude Code extension 2.1.299, parity with the Codex extension 26.51007, T3 surfaces the fork never uses, many windows and long sessions, first run and notification noise, leftovers of rounds 1 and 2 and the continuity round), merged and spot-checked by the writer. Line numbers: fork main 93fcd95, T3 reference v0.0.46-nightly.20261015.3145, vendor pin nightly 20261014.3093 (FORK-FEATURES.md:118). Where a vendor line differs from the reference both are given. (critic) Wrong since 93fcd95: vendor/ is re-vendored to 3145 (vendor/README.md) and vendor/contracts/src/orchestrationV2.ts equals the reference (diff --strip-trailing-cr), so every vendor line equals the reference line; the 3093 vendor cites below (:1972, :1975, :3075, :3264) were stale and are corrected. Nothing here was run live.

Method as rounds 1 and 2 (docs/ours/QOL-ROUND-2.md section 2): one builder per item in .claude/worktrees/<name>, ours files first, slot line `// Pn name` at the end of src/host/ours/features.ts and src/webview/ours/index.ts, package.json merged as JSON (dedupe after every batch). "Check first" = verify live before building; if it fails, the item drops to Later.

Raw T3 calls from ours need no line in his t3Client.ts: `client["run"](client["requireSession"]().client[WS_METHODS.x](...))` (src/host/ours/secrets.ts:42-43). Commands go through `client.dispatch`. His private members are reached by element access as in src/host/ours/modelSync.ts:16-17.

## 1. Already there (do not rebuild)

- Slash commands: T3 passes /compact and every command Claude reports (ClaudeProvider.ts:444, :490-492); his composer lists them (src/shared/composerSuggestions.ts:18); /goal and /feedback pass through for Codex (CodexProvider.ts:765-774).
- Usage and cost: his usageStatusBar.ts, AccountUsage.tsx, /usage-limits; context left is Q20. Claude Code has no cost view to match.
- Fork a chat from a response: his hostState.ts:860-875 (`thread.fork`).
- Queue, steer, edit and reorder queued prompts: his hostState.ts:640 and Composer.tsx.
- Find in chat: his SessionFind.tsx (Ctrl+F).
- @ file and folder mentions: his hostState.ts:969 and ComposerSuggestions.tsx:11.
- Attach, paste, drop files and images: his composerAttachments.ts, Composer.tsx:322; fork D, I, Q21.
- Model picker and effort: his ModelPicker.tsx, Composer.tsx:271-280 (`setModelOption`, bridge.ts:200); fork X1, R2.
- Permission modes: his Composer.tsx:282 select; plan mode and Implement: Q13, Q20.
- Per-turn diffs, revert a file, revert a hunk, open at the change: his nativeDiff.ts, TurnChanges.tsx; fork Q16, R7, R9, R17.
- Approvals by toast and by key: B, Q17, R15. Turn finished toast: Q3.
- Sessions list with search, archive, pin, rename, delete, settle; archive undo: his ThreadList.tsx; fork R11.
- Mark unread, snooze, regenerate title, copy ID or branch, stop a subagent: Q19, X3, R18.
- Switch chat (Ctrl+Alt+S), next chat needing you (Ctrl+Alt+W), new chat (Ctrl+N in T3): Q2, R14.
- Add selection, file, terminal output, TODO CodeLens: fork D; Alt+K / Shift+Alt+K: his insertReference plus Q2.
- MCP bridge with 10 tools (workspace, activeFile, openTabs, diagnostics, gitState, extensions, terminalOutput, openFile, revealInExplorer, showDiff): fork A.
- Save on send: H. Deep links: G. Logs: Q7. Status bar: C, Q7.
- Continue in Claude Code or Codex and back: C1, C2, C3.
- Background task roster EXISTS (correction to CONTINUITY-SCOPE.md section 4 row 5): `pendingBackgroundTasks` on the shell row (reference orchestrationV2.ts:1988; vendor the same line (critic)) and on the provider thread (:978).
- `thread.stop` and `thread.background-work.settle` are server-only (`OrchestrationV2InternalCommand`, reference orchestrationV2.ts:3176-3181). A client stops leftover work with `run.interrupt` on the latest run (reference :3030-3039), as T3 web does (ChatView.tsx:7423-7450).
- `provider.switch` is not a gap: `thread.model-selection.set` with another instance already switches (Orchestrator.ts:4110-4117).
- Not buildable by T3's design, do not re-ask: approve a file edit before it is written, accept or reject per hunk before write (BACKLOG.md:141). Substitutes: Q16, R17, P4.

## 2. Build list, ranked

Rank = value for a daily user (1-5) / size (S=1, M=2, L=3). Ties go to the item that removes a reason to open the Claude Code or Codex extension.

### P1 idectx: the file and lines I am looking at go with my prompt
- Story: I select lines (or just have a file open), click into T3, ask "why does this fail?", and the agent gets file.ts#L12-20, as in Claude Code and Codex (both on by default).
- Build: wrap `hostState.sendMessage` (pattern saveOnSend.ts:30). Append one reference for the last-focused editor (selection, or the file alone) unless the text already names that file. Lift the editor tracker out of src/host/ours/mcp/tools.ts:148-152 into a shared module (activeTextEditor is undefined while the webview has focus). Format it with his composer reference serializer (src/shared/composerContext.ts:129-160), as D does. Webview chip next to the Q20 chip, "IDE: foo.ts:12-20", click skips it for one send. Setting `t3-vscode.ours.ideContext.enabled`.
- Files: new src/host/ours/ideContext.ts, src/webview/ours/ideContext.ts, src/host/ours/editorTracker.ts; src/host/ours/mcp/tools.ts (import the tracker); package.json setting. His: none.
- Size: S (chip included).
- Live test: select lines 10-20 of README.md, click into the chat, send "what do these lines say?". The bubble shows README.md#L10-20 and the answer quotes them. Click the chip off, resend: no reference.
- Risk: three wrappers on sendMessage. Order in features.ts: oneWriter outermost (it asks before sending), then ideContext, then saveOnSend. Token cost on unrelated prompts, hence the chip and the setting.
- Check first: wrap order really composes (wrap.ts:20 wraps the current value; the last registered is outermost).
- (critic) Activation order is alphabetical by export name, not slot position: `import * as features` is a namespace object with sorted keys (dist/extension.mjs `features_exports`). An export named ideContext activates before oneWriter and saveOnSend, so the real chain is saveOnSend (outermost), oneWriter, ideContext (innermost). That still asks before the reference is added. Every sendMessage caller goes through the wrap: the composer (bridge.ts:190), Q20 Implement (contextMeter.ts:64) and P6's "/goal resume". Skip non-composer sends and text that starts with "/". Extra live test: "/goal clear" and Implement carry no IDE reference.

### P2 bgwork: see and stop work the agent left running
- Story: after a turn ends I see "2 background tasks: npm run dev, monitor [Stop]" instead of a chat that looks finished, and Stop kills them.
- Build: host reads `pendingBackgroundTasks` (kind, description) for the open thread, or derives it with T3's own derivePendingBackgroundWork (vendor/shared/src/orchestrationV2PendingBackgroundWork.ts:223). When non-empty and the run is idle, post it to the view. Webview banner over the composer (DOM insert like diffcard.ts). Status bar C counts them as "waiting". Stop: modal confirm, then dispatch `run.interrupt` {runId: projection.runs.at(-1).id, holdQueue: true}. Keep the button enabled for a retry (acceptance does not mean the task ended, ChatView.tsx:7436).
- Files: new src/host/ours/background.ts (registerOursRpc "background.stop"), src/webview/ours/background.ts; src/host/ours/statusbar.ts. His: none (his interrupt, hostState.ts:797-810, returns when idle, so ours dispatches directly).
- Size: S.
- Live test: ask Claude to run `ping -n 120 127.0.0.1` in the background and end the turn. The banner shows 1 command. Stop: the banner goes, the ping process is gone in Task Manager.
- Risk: Stop also holds the queue, ends PR watches and stops delegated tasks (schema comment reference :3035-3038); the modal says so. Codex may report no tasks.
- Check first: the roster is empty while the root run is active (comment reference :1986); confirm it fills after the turn; confirm `run.interrupt` on a completed run is accepted (ChatView.tsx:7428-7430).

### P3 allchanges: one diff of everything this chat changed
- Story: before I commit, one multi-diff shows every file the chat touched across all turns (Codex "Changes" panel). Q16 and R7 are per turn.
- Build: "Show All Changes in This Chat" in the R11 Thread Actions list and the chat editor title. Host calls his `client.getTurnDiff(id, 0, latestTurnCount)` (t3Client.ts:188) and opens Q16's multi-diff (`vscode.changes`, src/host/ours/diffs.ts:185) under the same scheme, so Open File and Revert keep working. (critic) getTurnDiff returns only {threadId, turn range, diff} (contracts checkpointDiff.ts:21-27), no refs, and Q16's file reads go through his loadTurnDiffFile, which sends baseRef/headRef as a branch-range (turnDiff.ts:42-44). Build the TurnDiff from projection.checkpoints instead: baseRef = the ready ordinal-0 checkpoint ref of the scope, headRef = the latest ready ref (turnCheckpointRange pattern, turnDiff.ts:22-33), files from his getSavedTurnDiff with those refs. A chat whose cwd changed has several scopes. getFullThreadDiff (reference :3273) is the alternative.
- Files: src/host/ours/diffs.ts, src/host/ours/threadActionsList.ts, package.json. His: none.
- Size: S.
- Live test: a 3-turn chat that edits 4 files. The view lists all 4; revert one and `git diff` drops it.
- Risk: includes my own edits between turns; reuse R7's "May include your own edits" note.
- Check first: the latest turn has a ready checkpoint when the run just ended.

### P4 undoturn: put back every file a turn changed, in one click
- Story: one "Undo turn" on a turn's changes card reverts all its files (Codex "Revert all"), without cutting the conversation.
- Build: button on the R7 card and in the Q16 view. Loop Q16's revert per file with the revertAction checks (src/host/ours/diffsRevert.ts:23): skip dirty files and files changed since the turn. One modal lists reverted, skipped, and later turns that touched the same files. Apply as one WorkspaceEdit so Ctrl+Z undoes it (R17 lesson).
- Files: src/host/ours/diffs.ts, src/host/ours/diffsRevert.ts, src/webview/ours/diffcard.ts. His: none.
- Size: S.
- Live test: a turn edits 3 files, I hand-edit one, then Undo turn. The modal says 2 reverted, 1 skipped; `git diff` shows only my hand edit. Ctrl+Z brings the 2 back.
- Risk: later turns that built on these files end up half-undone; the modal names them.
- Check first: none beyond Q16's revert path. Build after P3 (same files).

### P5 planready: a toast when a plan is ready in a chat I am not reading
- Story: an agent finishes a plan in another chat; a toast "Plan ready: TITLE" offers Implement, Open as Markdown, Show.
- Build: watch the shell row `hasActionableProposedPlan` (reference :1985; vendor the same line (critic)) going false to true, fire only after the run settles (finishedEdge.ts pattern), skip the chat being read (Q3 rule). Implement and Open reuse Q20's handlers (src/host/ours/contextMeter.ts:17, :64) by thread id. Replace the Q3 "finished" toast for that turn so one toast shows.
- Files: new src/host/ours/planReady.ts; src/host/ours/contextMeter.ts (export the handlers); src/host/ours/finished.ts (suppress hook). His: none.
- Size: S.
- Live test: in plan mode ask for a plan, switch to another chat. One toast; Implement leaves plan mode and starts building.
- Risk: toast spam if the flag flickers while streaming; settle first.
- Check first: how ours gets live shell rows. His ThreadSummary does not map the flag (hostState.ts:1108-1130). threadActions.ts:37 calls `client.snapshotShell()` once; a live feed needs `client.subscribeShell` or a throttled read per emit. If neither is clean, one field in his mapping (section 3).
- (critic) Answered: his private `shell` is live (hostState.ts:118, subscribeShell :367, handleShell :386) and src/host/ours/emptyList.ts:21-28 already reads it by name. Read it in an onDidChangeState listener; no field in his mapping is needed for P2, P5, P6, P7. Also: Q20's plan handlers find the plan in the view's transcript by row key (contextMeter.ts:31-37), so a chat not open in a view needs a projection lookup (getThreadProjection) before Implement or Open work by thread id.

### P6 goal: a bar that shows the /goal and its state
- Story: after /goal I see the objective, its status (pursuing, paused, achieved, limited) and tokens or time used, with Resume and Clear, as in Codex and T3 web (ChatView.tsx:7581-7619).
- Build: host reads the shell `goal` (reference :1998, type :940-955) and formats it with presentProviderGoal (vendor/client-runtime/src/state/threadExecution.ts:410). Webview one-line bar above the composer (Q20 DOM pattern). Resume and Clear send "/goal resume" and "/goal clear" through hostState.sendMessage; hidden while the run works.
- Files: new src/host/ours/goal.ts, src/webview/ours/goal.ts. His: none.
- Size: S.
- Live test: Codex chat, send "/goal make README one line shorter". The bar shows "Pursuing goal", then "Goal achieved". Clear removes it; the T3 app shows no goal.
- Risk: servers without goals omit the field (hide the bar). Wording differs per provider.
- Check first: same live shell feed as P5; whether Claude passes /goal through in this nightly.

### P7 unread: a dot on chats that finished while I was away
- Story: the sessions list marks chats that finished since I last looked, as the T3 app sidebar does; Q19 "Mark unread" finally shows.
- Build: host computes T3's rule hasUnseenCompletion (latest run completedAt later than lastVisitedAt, apps/web/src/components/Sidebar.logic.ts:774-783) from shell rows (lastVisitedAt, reference :2021 (critic); T3's rule is false while lastVisitedAt is null) and posts the ids. Webview puts a dot on `[data-thread-id]` rows (ThreadList.tsx:55). Also a dot in Switch Chat (keys.ts).
- Files: new src/host/ours/unread.ts, src/webview/ours/unread.ts; src/host/ours/keys.ts. His: none, if the shell feed of P5 exists; else one field in his mapping (section 3).
- Size: S.
- Live test: let a chat finish while another is shown: a dot. Open it: the dot goes. Mark unread: the dot is back.
- Risk: his row class names change on a merge; anchor on data-thread-id only.
- Check first: same live shell feed as P5. Build P5, P6, P7 in one worktree or in order (shared feed).

### P8 scope: a window on a T3 worktree or a subfolder shows its chats
- Story: T3 "Open in VS Code" on a worktree chat opens a window whose T3 list is empty; same for a window on D:/GIT/repo/src.
- Build: wrap `hostState["options"].workspaceRoots` (as modelSync.ts:17,25 wraps options). Return the real folders first, then add (a) the main checkout of a folder that is a git worktree (port `mainCheckout` from src/host/ours/mcp/bridgeSource.ts), (b) the project root of a shell thread whose worktreePath equals a window folder (reference :1950), (c) a project root that contains a window folder. Drop non-file folders (discovery.ts:25 filter). Keep roots[0] the real first folder.
- Files: new src/host/ours/scope.ts. His: none.
- Size: S.
- Live test: start a worktree chat in T3, Open in > VS Code: the new window lists it and a send works. Open D:/GIT/t3-native-vscode/src alone: the repo's chats appear.
- Risk: the extra roots also appear in his project picker (extension.ts:155-162). "New chat" in a worktree window still makes a second T3 project (hostState.ts:554, :612-616); P14 is the real fix.
- Check first: visibility is computed from workspaceRoots on every snapshot (hostState.ts:432-440), so the wrap takes effect without a reload.

### P9 lsp: the agent can ask VS Code for references and symbols
- Story: the agent asks "where is this used?" and "find symbol X" through VS Code's language servers, as the Codex LSP MCP does.
- Build: next to `diagnostics` in src/host/ours/mcp/tools.ts add `references` {path, line, column} (vscode.executeReferenceProvider) and `workspaceSymbols` {query} (vscode.executeWorkspaceSymbolProvider). Read-only, at most 200 results, relative paths, 10 s timeout.
- Files: src/host/ours/mcp/tools.ts; FORK-FEATURES.md section A. His: none.
- Size: S.
- Live test: in a T3 chat, "call the vscode tool references on src/host/hostState.ts line 636 column 3 and quote the raw result": the callers are listed: bridge.ts:190 and contextMeter.ts:64 (critic: saveOnSend.ts reaches sendMessage by a string key and is not a reference).
- Risk: empty while the language server starts; say "language server not ready" rather than "no references".
- Check first: none.

### P10 quiet: toasts that repeat stop repeating
- Story: the MCP nudge, the drop hint and the save warning stop coming back on every window, drag and send.
- Build: (a) MCP nudge (src/host/ours/mcp/setup.ts:124-130): text "Let Claude Code and Codex in T3 see this VS Code window (open files, selection, problems)?", buttons Set up / Later / Don't ask again; only the last writes NUDGE_OFF; Later or a dismiss stores a globalState time and waits 7 days. (critic) Today "Not now" already writes NUDGE_OFF for good (setup.ts:129); only a dismiss repeats per window. Keep NUDGE_OFF set for people who already said no. (b) Drop hint (src/host/ours/drop.ts:87-90): once per install (globalState), later bounces only log; drop "(Electron 43.7)" from the text. (c) Save warning (src/host/ours/saveOnSend.ts:16-27): toast only when the reason changes, else log.
- Files: the three above. His: none.
- Size: S.
- Live test: open 2 windows, pick Later in the first: no nudge in the second. Drag a file over the chat twice, reload, drag again: one toast in total. Mark a dirty file read-only and send 3 prompts: one toast, three log lines.
- Risk: none; the composer note (Q21) and the log keep the information.
- Check first: none.

### P11 snapmemo: long streaming chats stop burning the extension host
- Story: a 300-turn chat streaming at 32 ms emits no longer rebuilds the full snapshot about 12 times per emit.
- Build: wrap the public `hostState.snapshot` with a memo keyed on (revision, viewId), cleared by queueMicrotask after the first fill, so it lives one synchronous emit pass. It dedupes his callers (extension.ts:57, :66, :212, bridge.ts:39-41) and ours (contexts.ts:20,27, finished.ts:60, layout.ts:35, :179, logs.ts:20, reconnect.ts:59, statusbar.ts:55).
- Files: new src/host/ours/snapshotMemo.ts. His: none.
- Size: S.
- Live test: Developer: Start Extension Host Profile while a long chat streams, before and after; snapshot self-time drops. The view still updates every token.
- Risk: snapshot deletes from acceptedMessages (hostState.ts:1092), idempotent. A memo held past one pass would serve stale state; hence the microtask.
- Check first: a revision counter exists and changes on every state change; if not, key on a counter bumped in an emit wrap.
- (critic) `revision` exists (hostState.ts:133) but bumps only in emit (:1263); a caller that changes state without an emit and reads snapshot in the same pass would get the memo. Check that case before keying on revision.

### P12 rewind: edit from a past message, files optional
- Story: the agent went wrong at message 3; I click "Edit from here", the chat (and the files, if I choose) go back to before it, and my prompt is back in the box.
- Build: webview button next to Q11's "use again" (src/webview/ours/reprompt.ts pattern, row key from rowCopy.ts). Host gets getThreadProjection (t3Client.ts:123); turn count = ready checkpoints of turn_start or queued_turn messages before this one (T3 web session-logic.ts:1045-1068) (critic: T3's rule is the ready checkpoint of this message's own run, checkpointTurnCount - 1); checkpoint: appRunOrdinal == count, or for count 0 ordinalWithinScope 0 with appRunOrdinal null (vendor client-runtime commands.ts:889-930). Modal: "Rewind chat and files" / "Rewind chat only" / Cancel. Dispatch `checkpoint.rollback` {threadId, scopeId, checkpointId, restoreFiles} (reference :3093-3099; vendor the same line (critic)), then put the prompt back with Q11's insert.
- Files: new src/host/ours/rewind.ts, src/shared/ours/rewind.ts (pure resolver plus one test: a wrong checkpoint overwrites files), src/webview/ours/rewind.ts. His: none.
- Size: M.
- Live test: 3 turns that edit a.txt. Edit from turn 2 with files: a.txt matches the end of turn 1, turns 2-3 are gone, turn 2's prompt is in the box. Again with chat only: the file stays.
- Risk: restoreFiles overwrites my own later edits and open editors; refuse when an affected file is dirty (diffsRevert.ts rule), say so in the modal. Attachments are not restored (say so). A chat open in Claude Code at the same time diverges (C3).
- Check first: refuse while running and when the provider's `supportsConversationRollback === false` (server.ts:266; T3 web ChatView.tsx:8518-8540); `inputIntent` is on vendor projection messages (vendor orchestrationV2.ts:1476).

### P13 review: /review against my changes, a branch or a commit
- Story: I run /review, pick "against main", and get prioritized findings with file:line, as Codex's Code review menu does.
- Build: host QuickPick with four targets: uncommitted, base branch, commit, custom instructions. Branches and commits from the vscode.git API (getAPI(1)). Build a prompt naming the exact command ("git diff main...HEAD", "git show SHA") and the output shape. Setting `t3-vscode.ours.review.delivery`: thisChat or newChat. Add a /review suggestion through the Q13 suggestion wrap (src/host/ours/planModeSuggestions.ts). Replace the fixed text at src/host/ours/prompt.ts:96 with this picker.
- Files: new src/host/ours/review.ts; src/host/ours/prompt.ts; src/host/ours/planModeSuggestions.ts; package.json. His: none.
- Size: M.
- Live test: on a branch 2 commits ahead of main, /review, "Against a base branch", main. The findings cite only files from those 2 commits.
- Risk: a written prompt, not Codex's trained review mode.
- Check first: whether Claude's slash list already has /review; if so label ours "/review (VS Code)" or hide it for Claude.

### P14 worktree: start a chat on a fresh worktree and branch
- Story: I start a chat in its own git worktree, so parallel agents never touch my checkout (Claude Code createWorktree, Codex /worktree).
- Build: command "T3: New Chat in a Worktree..." with a QuickPick of the base branch (vscode.git API), optional branch name, InputBox for the first prompt. Raw RPC `orchestration.launchThread` (reference :3282; vendor the same line (critic)) with workspaceStrategy {type: "worktree", baseRef, branch?} (reference :520-537) and the initial message, as vendor client-runtime operations/commands.ts:645-690 does. Then open the thread in the view. Thread Actions gets "Open Worktree in New Window" when thread.worktreePath is set.
- Files: new src/host/ours/worktree.ts; src/host/ours/threadActionsList.ts; package.json. His: none (raw RPC, not his private createThread hostState.ts:596).
- Size: M.
- Live test: new worktree chat from main, "create hello.txt". `git worktree list` shows the new worktree, hello.txt is there and not in the open folder, the T3 app shows the branch.
- Risk: no setup progress card (subscribeWorktreeSetup unused); worktrees pile up, removal is manual. The MCP bridge matches by cwd and reaches the main checkout (R19).
- Check first: the full launchThread input past commands.ts:680 (unread by the scouts). (critic) Read: OrchestrationV2ThreadLaunchInput, reference :3315-3335; required commandId, projectId, title, modelSelection, runtimeMode, interactionMode, workspaceStrategy; optional threadId, reuseExistingThread, generateTitle, initialMessage {messageId?, text, context?, attachments}. commands.ts:645-691 builds it. `worktreePath` is not in his ThreadSummary (hostState.ts:1108-1130), so the "Open Worktree in New Window" entry reads the shell row as P5 does. Alternative if launchThread is awkward: rewrite the first `message.dispatch` with dispatchMode defer_start plus a worktree strategy (reference :2978) via wrap(client, "dispatch"); unverified that a thread created on root accepts it.

### P15 modelopts: 1M context or fast mode from the composer
- Story: I switch Claude to the 1M context window, or Codex to the fast service tier, from the composer, as T3 web does.
- Build: render every select or boolean descriptor from getProviderOptionDescriptors except the effort one (src/shared/modelOptions.ts:5) as a small select or toggle in `.composer-traits` (Q13 planMode.ts DOM pattern), in the "..." popup when compact. Write through his existing `setModelOption` action (bridge.ts:200, as Composer.tsx:280 does).
- Files: new src/webview/ours/modelOptions.ts. His: none.
- Size: M.
- Live test: a Claude chat shows "Context: 1M"; change it and the T3 app shows the same option. A Codex model with Fast: set it, a turn runs.
- Risk: his compact-width measure (Composer.tsx:218-222) does not count our control, so the sidebar can overflow; hide ours when compact and use the popup.
- Check first: which descriptors this nightly really sends: contextWindow (ClaudeModelCatalog.ts:258-263), serviceTier (CodexProvider.ts:204-225); Claude fastMode is only seen in test fixtures (ClaudeModelCatalog.testFixtures.ts, shared model.test.ts:57).

### P16 tidy: manifest and doc defects
- Story: Settings shows each section once, and the README link in the Extensions view works.
- Build: delete the second "Fork: Drop files view" block (package.json:603-614, identical to :591-602). In our README section (README.md:19) use https://github.com/Fundryi/t3-native-vscode/blob/main/docs/ours/FORK-FEATURES.md (vsce rewrites relative links to busFred's repo, a 404); check the other relative links there. FORK-FEATURES R10 says the drop view is off by default; it is on (6f60b99). FORK-FEATURES.md:584 and CONTINUITY-SCOPE "two traps": the first Claude message after an import fails with "Session ID ... is already in use"; only when the cwd slug differs does a new session start silently (section 4). CONTINUITY-SCOPE section 4 row 5: the background list exists. (critic) FORK-FEATURES J (line 118) still names the 3093 pin; vendor is 3145 since 93fcd95.
- Files: package.json, README.md (fork section only), docs/ours/FORK-FEATURES.md, docs/ours/CONTINUITY-SCOPE.md. His: none.
- Size: S.
- Live test: Settings, `@ext:hungtienhuang.t3-vscode`: each title once. Package, unzip extension/readme.md, the link is Fundryi's.
- Risk: none.
- Check first: no other duplicate after the JSON merges (node over contributes.configuration titles).

### P17 logs: the log says which versions talked, and hides drag noise
- Story: the first log lines name the extension, VS Code and T3 server versions; drag traces stop burying errors.
- Build: on activation one info line (packageJSON.version, vscode.version, process.platform) in src/host/ours/index.ts:30-31; once per environment change "T3 server VERSION (environment ID)" in the connection listener (src/host/ours/logs.ts:20-28; serverVersion from his snapshot, hostState.ts:1102). Add `debug` to log (src/host/ours/log.ts:11-18 (critic); the file has 19 lines) and move the drag trace and "Paste ... without text" in src/host/ours/drop.ts:76, :84-86 to it.
- Files: those four. His: none.
- Size: S.
- Live test: reload, Show Logs: versions first. Drag over the chat: no line; Set Log Level Debug: the line appears.
- Risk: none; no paths or tokens logged.
- Check first: serverVersion is non-empty with this nightly. Build after P10 (both touch drop.ts).

### P18 help: one Help entry, and "Font Settings" stops lying
- Story: one place for docs, keys, settings, logs and setup; the "Font Settings" row opens all settings today.
- Build: command "T3 VSCode: Help and Settings" QuickPick: Fork features (Fundryi URL), Keyboard Shortcuts (workbench.action.openGlobalKeybindings "t3-vscode"), All Settings (@ext:hungtienhuang.t3-vscode), Show Logs, Let Agents See VS Code (mcp.setup), Open Web UI, Report an Issue (Fundryi issues). Put it in the view "..." menu (group t3ours); hide his "Font Settings" row there (his command `t3-vscode.fontSettings`, extension.ts:102, stays).
- Files: new src/host/ours/help.ts; package.json. His: one menu value in package.json (when false on his view/title row), same precedent as round 2's Thread Actions row; a wrapper cannot hide a menu row.
- Size: S.
- Live test: palette "T3 VSCode: Help"; each row opens its target; the "..." menu shows Help, not Font Settings.
- Risk: the hidden-row edit conflicts on a merge; drop it then.
- Check first: none.

### P19 mergeback: bring a fork's result back into its parent
- Story: I forked to try something, it worked, and I bring it back into the main chat.
- Build: Thread Actions entry "Merge Back into Parent", only for a fork (parent data already in src/host/ours/threadActions.ts). Modal (context only, not files), then dispatch `thread.merge_back` {sourceThreadId, targetThreadId, sourcePoint: {type: "run", runId: latest completed run}} (reference :3111-3118; web ThreadRelationshipsControl.tsx:346-358), then open the parent.
- Files: src/host/ours/threadActionsList.ts, src/host/ours/threadActions.ts. His: none.
- Size: S.
- Live test: fork at turn 2, one turn in the fork, merge back. The parent shows the context transfer and its next answer knows the fork's result.
- Risk: moves context only; the modal says files are untouched.
- Check first: the exact sourcePoint shape in vendor 3093. (critic) Answered: {type: "run", runId} (reference :134-138). Take the target from T3's resolveMergeBackTargetThreadId (client-runtime state/threadRelationships.ts:35: forkedFrom.threadId for a run fork, else the lineage parent) and the run from resolveLatestMergeBackRun (state/threadWorkflows.ts:48); his ThreadSummary.parentThreadId is the lineage parent only.

### P20 deeplink: a link that lands in the wrong window offers the right one
- Story: a vscode:// thread link lands in another window, which today says "not in this window" and stops.
- Build: in src/host/ours/links.ts:13-18, when the shell has the thread (otherFolderChats, src/host/ours/emptyList.ts:28-34), offer "Open Folder in New Window" as keys.ts:37-38 does; with P8, prefer the thread's worktreePath.
- Files: src/host/ours/links.ts. His: none.
- Size: S.
- Live test: copy a link in window A, focus window B (another folder), open the link: B offers Open Folder, which opens or focuses A.
- Risk: none.
- Check first: whether `vscode.openFolder` with forceNewWindow focuses a window that already holds the folder; word the button by the result.
- (critic) links.ts:14 also refuses a link of another environment; offer Open Folder only when the environment matches.

### Order and collisions
- P3 before P4 (diffs.ts, diffcard.ts). P5, P6, P7 share the live shell feed: one builder, or P5 first. P10 before P17 (drop.ts). P8 before P20 and P14. P1 changes the sendMessage wrap order; merge it alone and rerun C3's live test.
- Modal confirms: P2, P4, P12, P19 (they stop work, write files or move context).

## 3. Upstream candidates (his files, pull requests to busFred if the owner says yes)

- package.json:334 single-key `ctrl+k` for insertReference with a selection: probably steals VS Code's Ctrl+K chords (Ctrl+K Ctrl+C comment). Live test in an isolated profile first; then propose dropping it (Alt+K and Shift+Alt+K stay). A wrapper cannot remove a keybinding.
- src/host/hostState.ts:797-810 interrupt: returns when nothing is running, so leftover background work cannot be stopped; T3 web interrupts the latest run with holdQueue (ChatView.tsx:7423-7450).
- src/shared/modelOptions.ts:5 shows only effort, and Composer.tsx:218-222 measures only runtime and effort: rendering every descriptor in his composer is cleaner than our DOM insert (P15).
- src/host/hostState.ts:1108-1130 ThreadSummary mapping: add lastVisitedAt, hasActionableProposedPlan, goal, pendingBackgroundTasks; P2, P5, P6, P7 would then read the snapshot.
- src/host/t3Client.ts:91, :95: run and requireSession are private; a public `launchThread` (or a generic `rpc(method, input)`) would remove our element-access calls.
- src/webview/components/Composer.tsx:239 addFiles: downscale PNG and JPEG above a 2000 px edge, as T3 web does (apps/web/src/lib/imageCompression.ts:12-28).
- Already listed (STATUS open work 5): src/host/serverDiscovery.ts EPERM pid check; src/host/pairing.ts ~/.t3/bin launcher.

## 4. Upstream to T3 (needs a T3 change; the owner files it)

- Imported native Claude sessions fail their first turn. Path: Orchestrator.ts:2292-2320 (importedNativeThread) and AgentSessionImporter.ts:312-333 (wizard import) create the provider thread with `nativeConversationHeadRef: null` and no attempts; ProviderTurnStartService.ts:1256-1263 then reports `nativeThreadHasTurns: false`; ClaudeAdapterV2.ts:8541-8542 gives shouldResume false and makeClaudeQueryOptions sends `{sessionId: <imported id>}` (:1096-1098); the Claude CLI refuses an id that exists ("Session ID ... is already in use"). When the cwd slug differs, the CLI accepts it and silently starts a new session. Proposed change: in apps/server/src/orchestration-v2/ProviderTurnStartService.ts:1256-1263 report `nativeThreadHasTurns: true` for a provider thread that arrived with a non-null nativeThreadRef, has never had a T3-started run, and was loaded through resumeThread (:682), not ensureThread (:650). It must not cover a T3-made thread whose first turn died before the CLI wrote a transcript (ClaudeAdapterV2.ts:8537-8538). Alternative: in ClaudeAdapterV2.ts openQuery (:8533-8547) reopen once with `resume` when the CLI exits with "already in use" (coupled to the error text). Repro on unmodified T3: import a Claude Code chat through T3's first-run wizard and send one message.

## 5. Later

- Bulk import of a folder's chats (agentSessions.scan/import, reference rpc.ts:392-393): every imported Claude chat fails its first turn (section 4), and C2 imports would be duplicated (random ids, importChat.ts:110). After the T3 fix.
- Claude live test of C2 (new scripts/verify-import-claude.ts modeled on scripts/verify-host.ts): waits on owner question 4.
- Secondary side bar container: owner question 2.
- Walkthrough (port the legacy 4 steps; `walkthroughs` key plus `!resources/walkthrough/**` in .vscodeignore): owner question 3.
- Remote windows: `"extensionKind": ["ui"]` plus non-file folders dropped (P8): owner question 5.
- Request toast setting `t3-vscode.ours.notify.requests` (always, unfocused, off): S, value 2.
- Startup burst: more than 2 waiting chats on the first snapshot gives one "N T3 chats need you" toast (approvals.ts:55-66): S-M.
- One toast across windows: the window that owns the folder toasts, folderless windows defer (discovery files, approvals.ts, finished.ts): M.
- Folder tag on session rows in multi-root windows (new src/webview/ours/rowFolder.ts): S, value 2.
- New chat in a multi-root window takes the active editor's folder (layout.ts:102-107, keys.ts): M.
- Reconnect jitter by pid and a pairing re-check across windows (reconnect.ts:37-55): S, unmeasured.
- Settings regroup into 4 fork sections with plainer titles, no key renames (package.json:578-724): S-M.
- Wording: "Chat" in our command titles, one name for the drop view, "Open Setting" buttons (importChat.ts:133, layout.ts:157): S.
- Setup page as a read-only preview instead of an untitled file (mcp/setup.ts:97): S.
- PR watch: Thread Actions "Watch pull request" dispatching `thread.pull-request.watch` (reference :2889-2898): S, needs T3 GitHub auth.
- Delete a scheduled task (scheduledTasks.delete, rpc.ts:519) as a palette command: S, value 2.
- Mention another chat (`thread` context kind, composerContext.ts:226-235): M; unverified that t3_thread_read reaches a normal chat.
- providerHome(driver) from config runtimePaths.homePath for oneWriter.ts:18-19 and importChatScan.ts:11: S; the owner's homePath is empty.
- Shrink pasted images before attach: with the re-vendor (STATUS open work 3), or upstream (section 3).
- Deep link `?prompt=` fills the composer and never sends (links.ts): S, value 1.
- Usage history page (server.getUsageSummary, rpc.ts:511): M, value 2.
- Branch review multi-diff (review.getDiffPreview with baseRef): M, value 2.
- Update the Claude or Codex CLI (server.updateProvider, rpc.ts:478); CLI sign-in (provider.auth.*): value 2.
- Focus view (hide tool rows, Ctrl+Alt+F), export the chat as Markdown, copy the last code block: S each, value 2.
- Status page (T3 version, model, server) and open CLAUDE.md or AGENTS.md: S, value 2.
- Tab status mark, reopen a closed tab, tab restore after reload: editor mode only.
- Next or previous chat, go to chat 1-9, clear all unreads, show keyboard shortcuts: value 1.
- Plan comments, side questions (/btw, /side), session groups, bookmarks, git commit and PR from the chat, MCP status page: value 1-2, M-L.
- Prompt-cache clock (promptCacheTtlMs), auto-settle toggle, pin reorder, stop workflow: value 1.

## 6. Owner questions

1. P1 idectx: attach the open file and selection to every prompt by default? Default taken: ON (Claude Code and Codex both do), with a visible chip to skip one send and a setting to turn it off.
2. Move the chat to the secondary side bar (right) so the Explorer stays left (round 1 question 1, still open)? Default taken: no move; the activity-bar view and the sidebar layout (K) stay.
3. Add a first-run walkthrough (new `walkthroughs` key in package.json)? Default taken: not built.
4. C2 Claude live test: start an isolated T3 server once (task "T3 VSCode: start isolated server", base dir under %TEMP%) and accept one new folder under your ~/.claude/projects? Default taken: wait; the Claude import stays off.
5. Do you open WSL or SSH windows? Default taken: no; `extensionKind` stays unset, so the extension does nothing in remote windows.

Not checked: nothing ran live; the live shell feed for P5-P7, the launchThread input for P14 and the Claude descriptors for P15 are "check first". Risk: P1 changes every prompt and P12 writes files, so both need their live tests before install.
