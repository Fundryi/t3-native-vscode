# Continuity scope: move a chat between Claude Code, Codex and T3

Date: 2026-10-15. Status: scouting only, nothing built, nothing live-tested.

`git -C reference/t3code describe --tags` gives `v0.0.46-nightly.20261015.3145`.
The fork vendor folder was pinned at nightly 20261014.3093 when this was written; since 93fcd95 it is 20261015.3145 (docs/ours/FORK-FEATURES.md section J).

Sources: four scout reports (T3, harness, fork, parity). No skeptic verdicts arrived, so the
lead spot-checked the scouts by re-reading: ClaudeAdapterV2.ts:8528-8550, :9155-9195;
ProviderTurnStartService.ts:1000-1025, :1250-1266; Orchestrator.ts:760-780, :5295-5375;
AgentSessionScanner.ts:1341-1462; AgentSessionImporter.ts:215-232, :385-396; the Codex
extension package.json; and the fork hook files named in section 1.D.

Short names:
- REF = reference/t3code/apps/server/src
- CCX = C:/Users/<user>/.vscode/extensions/anthropic.claude-code-2.1.299-win32-x64/extension.js (minified: cite by grep string)
- CXX = C:/Users/<user>/.vscode/extensions/openai.chatgpt-26.51007.21434-win32-x64/out/extension.js (minified)
- CXP = the package.json next to CXX
- CCD = https://code.claude.com/docs/en/vs-code.md

## The answer in five lines

- Yes. Every direction can work on an unmodified T3 nightly. No T3 change is needed to start.
- T3 already stores the real Claude session id or Codex thread id of every chat. The fork can read it today.
- T3 already has an importer for Claude Code and Codex chats. The fork does not call it yet.
- Two traps, both from reading code, not tested: the first T3 message on an imported Claude chat fails with "Session ID ... is already in use" (only when the cwd slug differs does it silently start a NEW Claude session; QOL-ROUND-3 section 4), and the bulk importer would duplicate chats T3 itself made.
- Rule for every direction: one writer per session. Stop the T3 side before opening the chat elsewhere, and close the other side before sending from T3.

## Decisions (owner, 2026-10-15) and build items

- A running T3 chat is never handed over quietly. "Continue in Claude Code / Codex" on a running chat shows a modal warning (VS Code showWarningMessage with modal: true) that says two tools writing one chat can split it; the buttons are "Stop and continue" and "Cancel". Only "Stop and continue" stops the run (thread.stop), detaches, and opens the chat elsewhere. Nothing else is allowed.
- First slice, built now in one round: C1 (section F1) and C2 (section F2, the Codex half fully; the Claude half only after its live test passes, see C2 below) and C3 (section F4). Items F3 and F5 wait.
- Build items for the qol-build workflow (one builder each, worktree .claude/worktrees/<key>, slot lines "// C1 contnative", "// C2 importchat", "// C3 onewriter" in src/host/ours/features.ts and src/webview/ours/index.ts):
  - C1 contnative, section F1: "Continue in Claude Code / Codex" thread action plus "Copy session id". Includes the running-chat modal above. Shown only for Claude Code and Codex chats.
  - C2 importchat, section F2: "T3: Continue a Claude Code or Codex chat" picker for this folder. Build both halves behind one command, but gate the Claude half: run the live test of F2 in an isolated T3 home (T3_VSCODE_HOME or the t3Home setting pointed at a temp folder, never the owner's) as part of the build; if after one message providerThreads[active].nativeThreadRef.nativeId is not the original UUID, hide Claude sessions from the picker, log why, and say so in NOT DONE. Codex sessions always listed.
  - C3 onewriter, section F4: before a send on a Claude Code or Codex chat whose .jsonl or rollout file changed after T3's last turn, ask "This chat was used elsewhere. Continue here?" with "Continue" and "Cancel".
- Decision (owner 2026-10-15 evening): T3 runs Claude through OpenCode with an API key by design (so T3 can be remote-controlled); T3's own Claude Code provider (driver claudeAgent) stays off and is never required. The native-session path of C2 needs claudeAgent, so for this setup the conversation TEXT is carried over instead: C4 carryover puts the Claude Code or Codex transcript into a new T3 chat on his normal model as its first message (docs/ours/FORK-FEATURES.md "C4 carryover").

## 1. Facts

### 1.A T3 (server)

1. T3 runs Claude through the Agent SDK `query()` (REF/orchestration-v2/Adapters/ClaudeAdapterV2.ts:776). A new thread passes `sessionId`, a resumed one passes `resume` (:1096-1098).
2. T3 makes the Claude session id itself, a random UUID (ClaudeAdapterV2.ts:718-720, used by `ensureThread` :9158-9170). It is stored as `nativeThreadRef.nativeId` (:1375-1400).
3. Resume rule: `shouldResume = resumeSessionAt !== undefined || openedWithResume || hasPersistedProviderTurn` (ClaudeAdapterV2.ts:8533-8546). The T3 comment there: a reused id sent as `sessionId` fails with "already in use", and "a fresh-session fallback ... binds a new native id" (:8534-8538).
4. `openedWithResume` reads a per-process set (ClaudeAdapterV2.ts:3543) that gets an id only after a successful open (:8595) or a fork (:9460). `nativeThreadHasTurns` is true only when an accepted T3 attempt exists (REF/orchestration-v2/ProviderTurnStartService.ts:1004-1021, :1258-1262).
5. Claude `resumeThread` does not touch the CLI. It only marks the provider thread idle (ClaudeAdapterV2.ts:9183-9192).
6. Claude config folder: the instance `homePath` becomes `CLAUDE_CONFIG_DIR`, else the inherited env value, else ~/.claude (REF/provider/Drivers/ClaudeHome.ts:19-55).
7. Codex runs as `codex app-server` (REF/provider/codexLaunchArgs.ts:12-15). New thread: `thread/start` (REF/orchestration-v2/Adapters/CodexAdapterV2.ts:6571). Resume: a real `thread/resume {threadId: nativeId}` (:6599-6605). `CODEX_HOME` is set only with a homePath (:1545-1548).
8. On this PC both T3 provider `homePath` values and `shadowHomePath` are empty (C:/Users/<user>/.t3/userdata/settings.json, keys `providerInstances.claudeAgent.config.homePath`, `providerInstances.codex.config.homePath`). So T3 uses the same ~/.claude and ~/.codex as the two extensions.
9. `thread.create` takes an optional `importedNativeThread: { ref: { driver, nativeId, strength: "strong" }, metadata? }` (reference/t3code/packages/contracts/src/orchestrationV2.ts:2722-2742). The server makes a provider thread with that ref, `status: "not_loaded"` and no runs (REF/orchestration-v2/Orchestrator.ts:2292-2323). T3 itself uses it only for ACP import (REF/ws.ts:1509-1521).
10. Bulk import RPCs: `agentSessions.scan` and `agentSessions.import` (reference/t3code/packages/contracts/src/rpc.ts:392-393, :1279-1291; handled REF/ws.ts:2731-2733). Input `{projectId, expectedWorkspaceRoot?}`, output `{importedCount, skippedCount}` (packages/contracts/src/agentSessions.ts:71-99). Import needs the operate scope (REF/auth/RpcAuthorization.ts:160-161).
11. Importer details (REF/project/AgentSessionImporter.ts): thread id `import:<instanceId>:<sessionId>` (:226-228), `historyOrigin: "v1_import"` (:291), `nativeThreadRef` set to the external id (:319-323), resume cursor `{threadId, resume: id}` for Claude and `{threadId: id}` for Codex (:344-347), user and assistant text only (:362-363). Claude ids must look like a UUID (:42-43, :243-251).
12. Scanner limits (REF/project/AgentSessionScanner.ts): 30 days (:85), 200 messages per chat (:92), 100 transcripts per import (:95). Sidechain, meta and compact-summary records are skipped (:398-402). A transcript counts only if its recorded `cwd` is the project root (:1341-1356, :1440-1447).
13. Not found: a filter that skips sessions T3 itself started. The scanner filters on cwd and file time only (AgentSessionScanner.ts:1341-1356); grep for `originator`, `entrypoint`, `sdk-ts` and `"T3 Code"` in Scanner and Importer finds nothing; the importer dedupes only on its own `import:` thread id (AgentSessionImporter.ts:215-232, :252-266).
14. Re-import does not add new messages; it only records the new file identity (AgentSessionImporter.ts:252-266). Once T3 has written to an imported chat, a new import fails with `AgentSessionThreadModifiedError` (:76-83, :261-262).
15. The importer creates no runs or attempts (AgentSessionImporter.ts:215-232 writes messages only). So by facts 3-4, the first T3 turn on an imported Claude chat sends `sessionId:`, not `resume:`.
16. A `v1_import` thread with no completed run replays its imported messages as a "legacy import" context handoff on the first turn (Orchestrator.ts:764-772, :5299-5371; REF/orchestration-v2/ContextHandoffService.ts:236-290). If the native resume also works, the agent sees that history twice.
17. The T3 web app calls the importer only from the first-run wizard (reference/t3code/apps/web/src/components/onboarding/WelcomeWizard.tsx:59, :1216; apps/web/src/state/agentSessions.ts:22-25). No "open in Claude Code", "copy session id" or "continue in terminal" exists in apps/web/src (grep `--resume`, `codex resume`, `nativeThreadRef`: not found).
18. Releasing the T3 hold on a session: `provider-session.detach {threadId, providerSessionId, reason?}` (packages/contracts/src/orchestrationV2.ts:2941-2946) and `thread.stop {threadId, reason?}` (:3243-3247).
19. T3 DB (read only): C:/Users/<user>/.t3/userdata/statev2.sqlite, table `orchestration_v2_projection_provider_threads`, column `payload_json`, path `$.nativeThreadRef.nativeId`.

### 1.B Claude Code (CLI 2.1.299, VS Code extension 2.1.299)

20. Sessions live at `<config>/projects/<slug>/<sessionId>.jsonl`, config = `CLAUDE_CONFIG_DIR` or ~/.claude (CCX, grep `function Sv(){return j4.join(q6(),"projects")}`).
21. Slug rule: every non letter or digit becomes `-` (CCX, grep `replace(/[^a-zA-Z0-9]/g,"-")`). The folder `d:/GIT/t3-native-vscode` becomes `d--GIT-t3-native-vscode`. Both `d--GIT-...` and `D--GIT-...` folders exist in C:/Users/<user>/.claude/projects/; the extension compares case-insensitively on Windows (CCX, grep `W?B.toLowerCase():B`).
22. Each record has `entrypoint` (who wrote it). Values seen: claude-vscode, cli, claude-desktop, sdk-ts, sdk-py, sdk-cli. T3 sets no `CLAUDE_CODE_ENTRYPOINT` (grep in reference/t3code/apps and packages: not found), so the SDK writes `sdk-ts` (CCX, grep `CLAUDE_CODE_ENTRYPOINT="sdk-ts"`). All 44 Claude ids in the T3 DB exist as .jsonl files under ~/.claude/projects.
23. The extension past-sessions list hides programmatic sessions: entrypoint in `["sdk-cli","sdk-ts","sdk-py"]` (CCX, grep `new Set(["sdk-cli","sdk-ts","sdk-py"])`), skipped unless includeProgrammatic (CCX, grep `includeProgrammatic:this.includeProgrammaticSessions`), and the panel sets it false (CCX, grep `includeProgrammaticSessions=!1`). So chats T3 started do not appear in that list. Inference, not tested: a chat started in the extension keeps its first entrypoint `claude-vscode` and stays listed after T3 continues it.
24. Deep link: the URI handler path `/open` reads `session` and `prompt` and runs `claude-vscode.primaryEditor.open(session, prompt)` (CCX, grep `case"/open"`). The id check only rejects slash, backslash, `..` and NUL (CCX, grep `refine(Vp)`). So `vscode://anthropic.claude-code/open?session=<uuid>` should open any session, including sdk-ts ones. Opening passes `resume: <id>` with the window workspace cwd (CCX, grep `async spawnClaude(`). Documented in CCD:473, :514. Not tested.
25. CLI (`claude --help`): `-r/--resume [id]`, `--fork-session` (new id), `--session-id`, `-c/--continue` (current folder only). `--resume <id>` looks in the cwd folder, then git worktrees, then every `projects/*/<id>.jsonl` if exactly one matches (C:/Users/<user>/.local/bin/claude.exe, grep -a `async function GMr(`). Not verified: which cwd a resumed session runs in, and whether the CLI /resume picker hides sdk-ts sessions.
26. Claude Code shows "This conversation is still open somewhere else" while another process holds the session (CCD:220).

### 1.C Codex (codex-cli 0.162.1, extension openai.chatgpt 26.51007.21434)

27. Rollouts: ~/.codex/sessions/YYYY/MM/DD/rollout-<time>-<uuid>.jsonl, first record `session_meta` with id, cwd, originator, source (listing of C:/Users/<user>/.codex/sessions/2026/10/15). List index: ~/.codex/state_5.sqlite table `threads`. A `thread-writer-locks/` folder exists; its rules were not read.
28. Chats T3 started carry `originator = "T3 Code"`, `source = "vscode"` (CodexAdapterV2.ts:1811-1813 sets clientInfo; 151 rows in state_5.sqlite). 659 rows have originator "Claude Code" (the codex plugin used from Claude).
29. The Codex extension lists interactive sources with no cwd filter at the API and filters by cwd in the webview (CXX, grep `requestThreadList(e)`; schema at reference/t3code/packages/effect-codex-app-server/src/_generated/schema.gen.ts:16467-16472). So T3 Codex chats should already appear in the Codex extension history. Not tested.
30. The Codex extension does have a URI handler: CXP:25-28 lists `"onUri"` in activationEvents (re-read 2026-10-15; the parity scout said "not found", that was wrong). `handleUri` sends the path to the webview router (CXX, grep `var hB=class`), and a local chat route is `/local/<id>` (CXX, grep `function H6e(t)`). So `vscode://openai.chatgpt/local/<thread uuid>` is plausible. Not tested. No command takes a thread id.
31. The Codex extension starts its own `codex app-server` (CXX, grep `Spawning codex app-server`). T3 runs another one. Two processes can open one thread.
32. CLI: `codex resume [SESSION_ID] [PROMPT]`, `-C/--cd <dir>`, `--all`; it asks "Use session directory" when the cwd differs (C:/Users/<user>/AppData/Local/Programs/OpenAI/Codex/bin/codex.exe, grep -a `Use session directory (`).

### 1.D The fork

33. `ThreadSummary` has no session id and no cwd (src/shared/bridge.ts:60-76). The projection does: `client.getThreadProjection(id)` (src/host/t3Client.ts:123).
34. Existing lookup pattern: `projection.providerThreads.find(t => t.id === projection.thread.activeProviderThreadId)` (src/host/ours/contextUsage.ts:17). From it read `.driver` and `.nativeThreadRef?.nativeId` (vendor/contracts/src/orchestrationV2.ts:958-965, :99-105).
35. Thread cwd: `hostState.workspaceForThread(id)` returns worktreePath, else project root, else first workspace root (src/host/hostState.ts:905-909).
36. Thread actions: one list feeds the row menu, header chevron and picker. Ids at src/host/ours/threadActionsList.ts:5, entries :13-22, host `perform` switch src/host/ours/threadActions.ts:54-63, icons src/webview/ours/threadActions.ts:9-15.
37. Terminal pattern: `type(line)` creates a terminal and types the line without Enter, so the owner presses Enter (src/host/ours/mcp/setup.ts:24-28). Module-private, no cwd.
38. `createThread` dispatches `thread.create` with `worktreePath: null` (src/host/hostState.ts:596-634, :626). `client.dispatch` is public and schema-checked (src/host/t3Client.ts:124-127). The vendored contract already has `importedNativeThread` (vendor/contracts/src/orchestrationV2.ts:2716) and the RPC names (vendor/contracts/src/rpc.ts:392-393).
39. Calling `agentSessions.import` needs one public method in his t3Client.ts: `run` and `requireSession` are private (src/host/t3Client.ts:37, :91, :95). `grep agentSessions src/` finds nothing.
40. Fork deep links open a chat only; no `prompt` in src/host/ours/links.ts (grep: not found).

## 2. The four directions

| Direction | Status today | Mechanism |
|---|---|---|
| T3 -> Claude Code | Fork code needed (S) | Read nativeId (fact 34), detach (fact 18), open `vscode://anthropic.claude-code/open?session=<id>` (fact 24), or type `claude --resume <id>` into a terminal at the thread cwd (facts 25, 35, 37) |
| Claude Code -> T3 | Fork code needed (M), one unconfirmed T3 step | `thread.create` + `importedNativeThread {driver: "claudeAgent"}` (fact 9), or `agentSessions.import` (facts 10-12). The first T3 message may bind a new Claude id (facts 3, 15) |
| T3 -> Codex | Fork code needed (S) | Read nativeId, detach, open `vscode://openai.chatgpt/local/<id>` (fact 30), or type `codex resume <id> -C "<cwd>"` (fact 32). The chat should already show in Codex history (fact 29, not tested) |
| Codex -> T3 | Fork code needed (M) | `thread.create` + `importedNativeThread {driver: "codex"}`, or `agentSessions.import`. Real `thread/resume`, no first-turn gap (fact 7) |

- None needs a T3 change to try. Nothing is impossible.
- One thing would need a T3 change: refreshing the T3 transcript after the chat was used elsewhere (fact 14).
- If the live test of Claude Code -> T3 shows a new Claude id on the first T3 message, that half needs a T3 fix (report it upstream).

User stories:
- T3 -> Claude Code: You are in a T3 chat and want the Claude Code panel for it. You pick "Continue in Claude Code" and the same conversation opens there with full memory.
- Claude Code -> T3: Your current chat lives in ~/.claude/projects/d--GIT-t3-native-vscode/ as a `claude-vscode` session. You pick it in T3 VS Code and keep talking to the same Claude session in T3.
- T3 -> Codex: You started a Codex chat in T3 and want the Codex extension view. You pick "Continue in Codex" and it opens on the same Codex thread.
- Codex -> T3: You have a Codex extension chat for this folder. You pick it in T3 VS Code and continue it there.

What the agent remembers vs what T3 shows:
- The agent memory is always complete, because every hop resumes the same native session (facts 1, 7, 25).
- The T3 transcript shows at most 200 imported text messages, and never shows turns made elsewhere after the import (facts 11, 12, 14).
- The Claude Code transcript is the .jsonl file itself, so it should show the T3 turns (inference from fact 22; check live).

## 3. Proposed features, ranked

### F1. "Continue in Claude Code / Codex" thread action (T3 -> other)
- Story: right-click a T3 chat and pick "Continue in Claude Code" (or Codex). The chat opens in that extension on the same session.
- Build:
  - src/host/ours/threadActionsList.ts: add id `continueNative`; show it only for the claudeAgent and codex instances (read `thread.modelSelection.instanceId`).
  - src/host/ours/continueNative.ts (new): get the projection, find the active provider thread (fact 34), read driver and nativeId, dispatch `provider-session.detach` (or `thread.stop` if a run is live, after asking), then a QuickPick: "Open in the extension" (deep link through `vscode.env.openExternal`) or "Type the resume command in a terminal" (setup.ts pattern plus `cwd` from workspaceForThread; never press Enter for the owner).
  - src/host/ours/threadActions.ts: one `case` in `perform`. src/webview/ours/threadActions.ts: one icon.
  - Free extra: "Copy session id" next to "Copy thread ID", same lookup.
  - His files: none.
- Size: S. Risk: low. Both deep links are read from minified code; the Claude one is also documented (CCD:473).
- Live test: in an isolated T3 home, make a Claude chat, run the action, send one message in Claude Code. Check the .jsonl grew, T3 still has the same nativeId, and the "open somewhere else" message (fact 26) does not fire after the detach. Same for Codex with the `/local/<id>` link.

### F2. "Continue a Claude Code / Codex chat in T3" (one chat, by id)
- Story: run "T3: Continue a Claude Code or Codex chat", pick one of this folder's sessions (newest first, titled by the first prompt). It opens as a T3 chat on the same session.
- Build:
  - src/host/ours/importChat.ts (new): list `~/.claude/projects/<slug>/*.jsonl` (both case spellings, fact 21) and the Codex rollouts under ~/.codex/sessions whose `session_meta.cwd` matches. Read first lines only. Skip sessions T3 made (entrypoint sdk-*, originator "T3 Code") and ids already in any T3 thread providerThreads.
  - Dispatch `thread.create` with `importedNativeThread` (fact 9) through `client.dispatch`, then open the thread. If hostState.createThread is reused, it needs one optional parameter (the smallest touch of his file).
- Size: M. Risk: HIGH for Claude until tested (facts 3, 15): the first T3 message fails with "already in use", or, when the cwd slug differs, silently binds a new Claude id (QOL-ROUND-3 section 4). Codex: low. The T3 view starts empty (no history).
- Live test (blocks the Claude half): isolated T3 home, create a thread for a known Claude session, send one message, then read `providerThreads[active].nativeThreadRef.nativeId`. It must equal the original UUID, and the original .jsonl must have grown. If the id changed, ship F2 for Codex only and report the Claude case upstream.

### F3. "Import all Claude Code / Codex chats of this folder" (bulk, with history)
- Story: one command brings the last 30 days of chats for this folder into T3 with their messages.
- Build: one public `importAgentSessions(projectId)` in his src/host/t3Client.ts (fact 39), plus a command in src/host/ours/importChats.ts that resolves the projectId like createThread does and opens `import:<instanceId>:<sessionId>`.
- Size: S code. Risk: HIGH. Fact 13: it would likely make a second T3 thread for every T3-made chat of the last 30 days, on the same native id, and sweep in the Claude-launched Codex rollouts (fact 28). Static reading, not tested. Same Claude first-turn risk as F2, plus double history (fact 16).
- Live test: isolated T3 home with one T3-made chat in the folder; run the import; count threads. If a duplicate appears, drop F3 and keep F2.

### F4. One-writer guard
- Story: you cannot type into one session from two tools at once by accident.
- Build: F1 already detaches before the hand-over. Add in src/host/ours/continueNative.ts: before sending on a thread whose .jsonl or rollout changed after the last T3 turn, ask "This chat was used elsewhere. Continue here?".
- Size: S. Risk: low. Live test: touch the file outside T3, send, see the question.

### F5. Deep link with a prompt (`?prompt=`)
- Story: parity with the Claude Code link `open?session=&prompt=` (CCD:513). Small add to src/host/ours/links.ts.
- Size: S. Risk: low. Live test: open the link, see the composer filled, nothing sent.

## 4. Parity gaps vs the Claude Code and Codex extensions

Value 5 = best. "T3 has it" means an unmodified nightly offers the surface. The continuity rows of the parity scout are covered in section 3.

| # | Gap | Value | Size | T3 surface needed | T3 has it? |
|---|---|---|---|---|---|
| 1 | Rewind code to a turn; fork plus rewind (fork reverts per file and hunk only) | 4 | M | `checkpoint.rollback` with restoreFiles (orchestrationV2.ts:3093-3099) | Yes; fork has 0 hits for rollback or rewind |
| 2 | Start a chat in a git worktree (CC createWorktree, Codex /worktree) | 3 | M | launch strategy worktree (orchestrationV2.ts:520-537) | Yes; fork sends worktreePath: null (hostState.ts:626) |
| 3 | Attach the open file and selection to every prompt automatically | 3 | S | composer file context | Yes |
| 4 | Code-intelligence tools in the MCP bridge (references, workspace symbols) | 3 | S | none (VS Code only) | n/a |
| 5 | List and stop background shells and monitors | 3 | M | background-work list | Yes: the list is `pendingBackgroundTasks` on the shell row (orchestrationV2.ts:1988) and on the provider thread (:978); `thread.background-work.settle` is server-only, a client stops with `run.interrupt` (QOL-ROUND-3 section 1) |
| 6 | /review against a base branch, in this chat or a separate one | 3 | M | `review.getDiffPreview` (rpc.ts:439) | Yes |
| 7 | Reopen closed chat (Ctrl+Shift+T) | 3 | S | none | n/a; fork 0 hits |
| 8 | Focus view: hide tools, keep prompts and answers | 2 | S | none | n/a |
| 9 | Session groups and status filters | 2 | M | none (local state) | n/a |
| 10 | Plan as a document you can comment on | 2 | M | none | n/a |
| 11 | Mention another chat in the composer | 2 | S | composer context kind "thread" (packages/contracts/src/composerContext.ts:230) | Yes |
| 12 | Show the Codex /goal state | 2 | S | ProviderGoal (orchestrationV2.ts:944-957) | Yes |
| 13 | Prompt-cache clock | 2 | S | promptCacheTtlMs (orchestrationV2.ts:1066) | Yes |
| 14 | Expand or collapse all thinking (Ctrl+O) | 2 | S | none | n/a |
| 15 | Setting: Enter vs Ctrl+Enter to send; queue vs steer default | 2 | S | none | n/a |
| 16 | Status dot on the editor tab (waiting, finished unseen) | 2 | S | none | n/a |
| 17 | Lock the editor group a chat opens in | 2 | S | none | n/a |
| 18 | Export the conversation | 2 | S | thread history (already used) | Yes |
| 19 | Customize dialogs: MCP status, hooks, permissions, memory, plugins | 2 | M | `mcp.status.updated` (packages/contracts/src/providerRuntime.ts:192) | MCP only |
| 20 | Side question (/btw, /side) | 2 | L | side chat | Not found |
| 21 | Accept or reject each change before it is written | 2 | - | pre-write review | Not possible: T3 writes to disk (BACKLOG.md:141) |
| 22 | Bookmarks, always-visible timestamps, focus last message, new window, auto-archive, native Chat Sessions view, walkthrough | 1 | S each | auto-archive: `thread.auto-settle` (orchestrationV2.ts:2773) | mostly n/a |

Notes:
- Not verified: which provider slash commands T3 passes through (/compact, /mcp, /export, /review, /init).
- Many "not worth it" rows in docs/ours/BACKLOG.md:136-154 and :174-190 were decided for the old embedded-page design. Re-judge them for the native fork.

## 5. Open questions for the owner

1. The T3 transcript of a chat goes stale after you continue it in Claude Code (the agent still remembers everything). Is that fine, or should F2 open such a chat as a fresh T3 thread each time?
2. When you hand a running T3 chat to Claude Code or Codex, should the fork stop the T3 run by itself, or only warn and let you choose?
3. First slice: F1 alone (safe, small), or F1 plus the Codex half of F2, with the Claude half of F2 waiting for its live test?

## Not checked

- Nothing was run against the live T3 server, the extensions or the CLIs (help text only).
- The deep links of both extensions, `claude --resume` from another folder, the CLI picker filter, the Codex thread-writer-locks rules, who writes the "Codex Desktop" rows.
- Whether the scanner folder match (AgentSessionScanner.ts:1349) treats `d:` and `D:` as one project.
- 99 older T3 Codex ids were not found in ~/.codex/sessions or archived_sessions; not investigated.
