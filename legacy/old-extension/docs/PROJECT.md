# Panel follows the VS Code folder

Research for "T3 in the panel is on the project of the open VS Code folder, and a new thread starts there" (owner, 2026-10-12). No code yet.
Source: `reference/t3code` at `d83929ad` (tag `v0.0.46-nightly.20261012.3010`); paths below are under it. Live checks: GETs against the running nightly
on 2026-10-12 without a valid bearer, plus one read-only look at T3's project and thread tables to find where the owner's thread ran.

## What actually happened

- The thread did **not** take the "or start without a project" path. That path runs in a fresh folder under `~/.t3/scratch/` (fact 4), and that folder is empty.
  The thread ran in an existing T3 project whose root **is the home folder**. So the agent searched the home folder because its project root is home.
- Why that project: the panel loads `/`. The index route opens a draft in the **most recently active** project (`apps/web/src/routes/_chat.index.tsx:42-69`,
  `sortScopedProjectsForSidebar(projects, threads, "updated_at")[0]` at :53). Activity = the newest user message in its threads (`packages/client-runtime/src/state/threadSort.ts:109-119`); a project's own `updatedAt` counts only when it has
  no threads (`apps/web/src/components/Sidebar.logic.ts:1303-1319`). The home project had the newest thread, so `/` landed there.
- T3 has no project for this repo yet. A project for a **parent** folder of this repo exists; it must not count as a match.

## Facts

**1. Project model and storage.** `Project` = `id` (UUID, `apps/web/src/lib/utils.ts:44`), `title`, `workspaceRoot`, `repositoryIdentity`, icon fields,
`defaultModelSelection`, `defaultThreadEnvMode`, `scripts`, `createdAt`, `updatedAt`, `deletedAt` (`packages/contracts/src/project.ts:165-180`). No environment field:
a project belongs to the server it lives on; the web client scopes it with the server's `environmentId`. Stored in SQLite `~/.t3/userdata/statev2.sqlite`
(`apps/server/src/config.ts:144`), table `projection_projects` (`apps/server/src/orchestration-v2/ProjectStore.ts:129`).
- **HTTP, same auth middleware as the shell route (not yet tried with a real pairing session):** `GET /api/projects` returns `{projects, updatedAt}`, scope `orchestration:read` (`packages/contracts/src/environmentHttp.ts:645`,
  `apps/server/src/project/http.ts:41-50`). `POST /api/projects/mutate` takes a `ProjectMutation` (`environmentHttp.ts:652`, `http.ts:52-63`). Create payload:
  `{type:"project.create", commandId, projectId, title, workspaceRoot, createWorkspaceRootIfMissing?, defaultModelSelection?, scripts?}` (`project.ts:199-226`).
  Scope `orchestration:operate`, plus settings scopes only if `scripts` is sent (`packages/contracts/src/settings.ts:1672-1681`). A root that already has a project
  gives `ProjectConflictError`, answered as 400 `invalid_command` (`apps/server/src/project/ProjectService.ts:64-74`, `http.ts:23-28`). 401 bad auth, 403 missing scope
  (`environmentHttp.ts:160`, `:179`).
- **WS RPC (what the web client uses):** `projects.mutate` (`packages/contracts/src/rpc.ts:382`, `:1242`; server `apps/server/src/ws.ts:2687`; client
  `packages/client-runtime/src/operations/commands.ts:342`), same payload. Also `projects.ensureScratch` and `projects.createNew` (name only, new folder under
  `~/.t3/projects`) (`rpc.ts:383-384`, `ws.ts:2600-2613`). `projects.list/add/remove` are names only, no handler (`rpc.ts:374-376`). WS adds nothing over HTTP here.
- **Read model:** `GET /api/orchestration/shell` (`environmentHttp.ts:610`) returns `projects` and `threads` (`id`, `projectId`, `updatedAt`, `archivedAt`, `lineage`;
  `packages/contracts/src/orchestrationV2.ts:1927-1990`, `:2022-2033`). It needs header `x-t3-orchestration-protocol: 2` (`environmentHttp.ts:80-84`, `environment.ts:16`).
- **Path matching trap:** the server normalizes with `path.resolve` only and compares `workspace_root = ?` exactly (`apps/server/src/workspace/WorkspacePaths.ts:156`,
  `ProjectStore.ts:136`). The web client compares lower-cased on Windows (`packages/shared/src/path.ts:49-55`). VS Code's `fsPath` has a lower-case drive letter,
  T3's rows have upper case, and `path.win32.resolve` keeps the case it gets (checked). Sending `d:\...` as is would create a duplicate project.

**2. How the web UI picks the project.** Routes (`apps/web/src/routes/`): `/` (index, above), `/<environmentId>/<threadId>`, `/draft/<draftId>`, `/new`,
`/projects/<projectKey>` (redirects to Settings, `projects.$projectKey.tsx:11-15`). No route or search param takes a project id or a cwd.
- `/draft/<draftId>` only works for a draft already in localStorage `t3code:composer-drafts:v1` (store version 9, 300 ms debounced writer,
  `apps/web/src/composerDraftStore.ts:90-91`, `:98-115`, shape `:325-359`).
- `/new` needs a non-empty `prompt` and matches a GitHub `repo=owner/name`, never a path (`packages/shared/src/promptLinks.ts:154-182`).
- Hero text "What should we build in X" and "or start without a project": `apps/web/src/components/chat/DraftHeroHeadline.tsx:373`, `:399`.
- No "last project" storage key exists. Related: `t3code:ui-state:v1` (`projectOrder`, `sidebarProjectScopeKey`; `apps/web/src/uiStateStore.ts:6`, `:22-30`).
  `projectOrder` only feeds the `defaultProjectRef` of the command palette and Snap Shot (`apps/web/src/hooks/useHandleNewThread.ts:469-490`), not the index landing.
- The `environmentId` in thread routes is the descriptor's (`apps/web/src/connection/platform.ts:220`); `GET /.well-known/t3/environment` is public.
- In a thread view the header has `button[aria-label="New thread in {project}"]`, which starts a draft in that thread's project
  (`apps/web/src/components/chat/ChatHeader.tsx:324-325`, `apps/web/src/components/ChatView.tsx:2599-2601`, `:11433`). Live: the string is in `main-*.js`.

**3. Desktop "open folder".** `t3 app [path]` sends `{type:"open-workspace", workspaceRoot}` to the desktop app over a local socket (`apps/server/src/cli/app.ts:200-230`).
The desktop renderer finds the project by path (client side, case-insensitive), creates it if missing, then opens a new draft in it
(`apps/web/src/desktopAppActivation.ts:57-119`, `apps/web/src/components/desktop/DesktopAppActivationCoordinator.tsx:47-73`). Exactly our behaviour, but it is fed only
by `window.desktopBridge.appActivation` (Electron). Faking `window.desktopBridge` is out: `isElectron` is `window.desktopBridge !== undefined` (`apps/web/src/env.ts`),
and the web code reads `window.desktopBridge` in 93 places. The server's own "create from cwd" is `ProjectService.bootstrap` (get or create by root,
`ProjectService.ts:396-402`), used at server start with `autoBootstrapProjectFromCwd` (`apps/server/src/serverRuntimeStartup.ts:270-305`); no RPC or route exposes it.

**4. Thread cwd.** A thread runs in `thread.worktreePath ?? project.workspaceRoot` (`apps/server/src/orchestration-v2/RuntimePolicy.ts:103-112`,
`ThreadLaunchService.ts:538`). "Without a project" is the Scratch project, root `<T3 home>/scratch`, offered only when T3's home is not inside a git checkout
(`apps/server/src/project/ManagedProjectFolders.ts:274-292`); each of its threads gets its own `scratch/<date>-<words>-<id>` folder as worktree path (`:358-380`,
`ThreadLaunchService.ts:819-832`). A thread in a normal project at its root runs in exactly the project root.

**5. Hints about the client's folder.** None in the web client or the server: no query param, header, storage key or setting tells T3 which folder the
viewer has open. The only folder hint is Electron's `appActivation` (fact 3), unreachable from our frame.

**6. Live (2026-10-12, no bearer and `Bearer invalid`).** `GET /api/projects`: 401 JSON (exists). `GET /api/orchestration/shell`: 401 JSON (exists).
`GET /api/projects/mutate`: 200 HTML (SPA fallback; the route is POST only). `GET /api/orchestration/projects`: 200 HTML (no such route).
`GET /.well-known/t3/environment`: 200 JSON with `environmentId`.

## Design

The facts rule out pure (A) and (B), and make (C) over WS pointless:
- (A) a project URL: none exists for "new thread in project X". A thread URL does exist.
- (B) seed localStorage: no "last project" key. Seeding `composer-drafts` means writing T3's internal store (version 9, debounced writer) and can drop the owner's drafts. Rejected.
- (C) WS RPC: the same `project.create` as HTTP, and selection is still UI state. HTTP is the contracted route and needs no socket. Use HTTP.

**Recommended: ensure over HTTP, land by URL, then one click by meaning.**
1. Folder: `workspace.workspaceFolders[0]`, `file` scheme only (a `.code-workspace` lists folders in file order, so this is its first folder). Upper-case the drive letter.
2. Ensure (t3.js, Node side, pairing bearer): `GET /api/projects`; match `workspaceRoot` the way T3's client does (lower-case compare on Windows, exact root only).
   Missing: `POST /api/projects/mutate` with `{type:"project.create", commandId: uuid, projectId: uuid, title: basename, workspaceRoot, createWorkspaceRootIfMissing:false,
   defaultModelSelection:null}` and no `scripts`, as the desktop activation sends it (`DesktopAppActivationCoordinator.tsx:54-62`). A 400 `invalid_command` means "already exists": GET again.
3. Land: `GET /api/orchestration/shell`; the newest non-archived, non-subagent thread of the project gives iframe src `/<environmentId>/<threadId>`.
   No thread (fresh project): `/`. The index picks it because a new project's `updatedAt` is newest, unless a user message lands in another thread between create and load (rare, accepted; agent runs do not count).
4. Click: panel.js posts `{type:"t3vscode:new-thread"}` to the frame after load; the injected script waits (max 10 s) for `button[aria-label^="New thread in "]` and
   clicks it once. T3's own handler makes the draft, and the hero reads "What should we build in <project>?". No button: do nothing; the owner sees the project's last thread.
5. Any failed fetch: load `/` as today and log one line.

**Folder changes while the panel is open:** on `onDidChangeWorkspaceFolders`, only if the first folder changed, run steps 2-4 and re-point the iframe. An unsent message
survives, since T3 keeps drafts in its store. Inside the frame the owner may switch projects; we only re-apply on panel load, Reload, or a folder change.
**Several folders:** the first folder, no question (T3 binds a thread to one root, HANDOFF 2.1). The panel status line names the folder it used.
**Scopes:** no `orchestration:read`: skip, load `/`. Read but no `orchestration:operate`, and no project: load `/` and show one line in the panel:
"T3 has no project for <folder>. Add it in T3, or pair with edit rights." Check the stored session's scopes before the POST; a 403 means the same.
**No local folder** (empty window, remote, virtual): load `/`.

## Facts for t3-facts.json (the lead adds them; this file does not edit it)

| path | grep |
|---|---|
| packages/contracts/src/environmentHttp.ts | `"/api/projects/mutate"` |
| packages/contracts/src/environmentHttp.ts | `"/api/projects", {` |
| packages/contracts/src/project.ts | `type: Schema.Literal("project.create")` |
| packages/contracts/src/settings.ts | `export function requiredScopesForProjectMutation` |
| apps/server/src/project/http.ts | `requireEnvironmentScope(AuthOrchestrationReadScope)` |
| apps/server/src/orchestration-v2/ProjectStore.ts | `workspace_root = ${request.workspaceRoot}` |
| packages/shared/src/path.ts | `export function normalizeProjectPathForComparison` |
| packages/contracts/src/environment.ts | `ORCHESTRATION_PROTOCOL_HEADER = "x-t3-orchestration-protocol"` |
| apps/web/src/routes/_chat.index.tsx | `sortScopedProjectsForSidebar(projects, threads, "updated_at")` |
| apps/web/src/components/chat/ChatHeader.tsx | ``aria-label={`New thread in ${activeProjectName}`}`` |
| apps/web/src/connection/platform.ts | `environmentId: descriptor.environmentId` |
| apps/server/src/orchestration-v2/RuntimePolicy.ts | `input.thread.worktreePath ??` |

## Open

- Open: step 4 is DOM driving (one click, found by aria-label). The owner said "no clicks". The alternative is to land on the project's last thread and let the owner press "New thread". Owner to choose.
- Open: the existing project whose root is the home folder stays and keeps winning `/` in other clients. The owner may want to remove or rename it in T3; we never touch it.
- Open: a fresh project with no thread lands via `/` and loses to a user message sent elsewhere in the same seconds. Fix only if seen.
- Open: first implementation step is one `GET /api/projects` with the stored pairing bearer, to prove the bearer is accepted there (inferred from the shared middleware).
- Open: should Reload re-apply the folder's project, or keep where the owner navigated? Proposal above: re-apply.
- Open: `CLAUDE.local.md` still names `ed0f7b90` as the reference commit; the clone is now at `d83929ad`.

## Lead decisions (2026-10-12)

- Build the recommended design: ensure over HTTP, land by URL, one click by meaning. "No clicks" means no owner clicks; one scripted click guarded by the project name is fine.
- Land on the project's newest open thread. The scripted "New thread in <title>" click runs only when the project has no thread yet (fresh project), and only on a button whose aria-label is exactly `New thread in <title>` (the title we created or found), never on another project's button. Reopening the panel otherwise shows the project where the owner left it, like reopening T3.
- Reload and a folder change re-apply the folder's project. Inside the frame the owner may switch projects; we re-apply only on those events.
- The existing project rooted at the home folder stays untouched.
- No thread creation over HTTP exists (`/api/orchestration/*` is GET only; threads are made over the WS RPC). We do not speak T3's WS RPC from the extension for this; the scripted click uses T3's own handler instead.
- Scopes: the stored session's scopes decide before any call. No `orchestration:read`: load `/`. No `orchestration:operate` and no project: load `/` plus one line in the panel card naming the folder. Both logged.
- Every fetch has a 5 s timeout; any failure falls back to `/` with one log line; the panel never blocks on T3's API.
- The first implementation step proves the bearer on `GET /api/projects` in the owner's real panel (the agents hold no bearer). The selfcheck uses a fake upstream that mimics the three routes.
- `t3-facts.json` gets the facts listed above in the same commit.

## Review (Codex), 2026-10-12

Checked read-only against `reference/t3code` HEAD `d83929ad`. Source paths below are relative to that clone. Live unauthenticated GETs: `/api/projects` and `/api/orchestration/shell` returned 401 JSON; `/.well-known/t3/environment` returned 200 JSON with `environmentId`. No authenticated behavior or mutation was tested.

1. **Must change: no-thread landing is not project selection.** `/` picks global activity and immediately opens a draft (`apps/web/src/routes/_chat.index.tsx:50-69`). A threadless project's `updatedAt` competes with thread activity (`apps/web/src/components/Sidebar.logic.ts:1303-1318`; `packages/client-runtime/src/state/threadSort.ts:82-106`). Creation normally wins, but another message can beat it; an older project with zero eligible threads need not win at all. The exact-label button only belongs to the active project (`apps/web/src/components/chat/ChatHeader.tsx:316-325`), so waiting cannot select a different project. Fix: use T3's existing New thread picker for the no-thread case (`apps/web/src/components/Sidebar.tsx:5022-5038`; `CommandPalette.tsx:1244-1298`), select by workspace root and environment, and verify the destination. A title alone is not identity: two roots can have the same basename. Prove this small DOM flow before building; do not add WS RPC or draft-store writes.

2. **Must specify full path comparison, including concurrent creates.** The server trims/expands home and uses platform `path.resolve`, then exact SQL equality (`apps/server/src/workspace/WorkspacePaths.ts:156-158`; `apps/server/src/orchestration-v2/ProjectStore.ts:131-136`). On Windows, resolve converts `/` to `\`, removes non-root trailing separators, and preserves letter case; it does not uppercase the drive or canonicalize filesystem case. The client trims trailing separators, preserves drive roots, converts Windows separators and lowercases (`packages/shared/src/path.ts:24-54`). Fix: normalize both roots this way for lookup, never accept a parent root, and retain the server's returned root/id. Uppercase the drive for creation, not the whole path. Same-string creates are serialized (`apps/server/src/project/ProjectService.ts:228-272`); differently cased roots can still create duplicates. If simultaneous missing-project creation must deduplicate those too, serialize only ensure/create across windows by normalized root and re-read inside that guard. Report ambiguous existing matches, do not delete or merge them.

3. **Must change: 400 is not proof of existence.** `invalid_command` also covers missing-project and not-empty errors (`apps/server/src/project/http.ts:23-30`). Fix: after a create refusal, GET again and accept only an actual active exact-root match, using the winning id/title. Otherwise surface the failure. Two windows must not keep their independently generated project ids after one loses.

4. **Specify thread selection precisely.** Shell returns `threads` and separate `archivedThreads` (`packages/contracts/src/orchestrationV2.ts:2022-2033`); rows carry `id`, `projectId`, `lineage`, `createdAt`, `updatedAt`, `archivedAt`, and `latestUserMessageAt` (`:1927-1944`, `:1965-1990`). Fix: select from `threads`, require matching projectId and null archivedAt, exclude `lineage.relationshipToParent === "subagent"`, retain ordinary forks (`:108-112`). For newest activity, sort by valid `latestUserMessageAt`, then `updatedAt`, then `createdAt`, with an id tie-break (`packages/client-runtime/src/state/threadSort.ts:71-118`), not array position or updatedAt alone. Wakes/agent messages can also move latestUserMessageAt (`orchestrationV2.ts:1967-1971`); the claim that agent activity never counts is too strong.

5. **Create/list contract is sound; keep the payload minimal.** Required create fields are `type:"project.create"`, `commandId`, `projectId`, non-empty `title`, and `workspaceRoot`; UUIDs are valid, not schema-required (`packages/contracts/src/project.ts:199-225`; `baseSchemas.ts:310-320`). `createWorkspaceRootIfMissing`, `defaultModelSelection`, and `scripts` are optional. GET returns `{projects, updatedAt}`, with project `id`, `title`, `workspaceRoot`, `deletedAt` and the fields at `project.ts:165-185`; it lists active projects (`apps/server/src/project/ProjectService.ts:564-576`; `ProjectStore.ts:131`). Fix: send false for folder creation, omit scripts, and ensure a non-empty title for a drive-root workspace. No settings scopes are needed without scripts (`packages/contracts/src/settings.ts:1672-1680`).

6. **Route is sound; complete its inputs.** The path is `/<environmentId>/<threadId>` (`apps/web/src/routes/_chat.$environmentId.$threadId.tsx:5`). The primary connection uses the public descriptor's environmentId, not a project field (`apps/web/src/connection/platform.ts:344-357`). Shell requires `x-t3-orchestration-protocol: 2` (`packages/contracts/src/environmentHttp.ts:80-84`, `:610-614`). Fix: include that header, URL-encode ids, and validate JSON/status/content-type for all reads. Apply the 5 s deadline to descriptor lookup too; a chain of individually bounded requests is not a 5 s total operation.

7. **Must change: silent fallback repeats the owner's bug.** The fallback at this document's lines 84 and 127 allows `/` to choose home while the panel appears bound to the workspace. Fix: show a visible routing failure and keep the workspace-bound chat unavailable until resolved; reserve ordinary `/` for genuinely unsupported/no-folder windows. Scope failures must be visible too. A project match also does not promise literal execution cwd: existing threads may use worktrees (`apps/server/src/orchestration-v2/RuntimePolicy.ts:103-112`). Preserve T3's worktree behavior and state that limit instead of changing project settings.

8. **Keep integration small and cancellable.** `extension.js:159-202` already guards refreshes with seq checks; extend those after every new await and before rendering. Keep selectors and T3 semantics in `t3.js:144-179`; `panel.js:105-118` should only transport the typed request to its iframe. Validate parent source/origin, wait for React hydration rather than iframe load alone, stop after success/timeout or owner navigation, and acknowledge success/failure. Add facts for every new selector plus lineage, sorting and normalization sources, not just the current list. Verify with the fake upstream and one real panel run covering fresh project, duplicate titles and home winning `/`; no extra framework or polling feature is needed.

Verdict: change no-thread selection, verified conflict recovery, path/race handling and visible failure behavior first; then build the small HTTP plus T3-owned UI design.

## Lead decisions after the review (2026-10-12)

Numbers refer to the Codex findings above. Build with these.

1. Fresh project (no thread yet): the extension already holds the full project list, so it knows whether the new project's title is unique among T3's projects. Unique: the script clicks the one button whose aria-label is exactly `New thread in <title>` (T3's own handler; the title is identity because no other project carries it). Not unique, or the button never appears within 10 s: no click; the panel card shows one line "T3 project <title> is ready. Pick it in T3's sidebar for the first thread." The sidebar picker flow (Sidebar.tsx:5022-5038) is not driven in this slice.
2. Lookup normalizes both sides like T3's client: `path.resolve`, trailing separator stripped (drive root kept), backslashes to `/`, lower-case. Exact match only, never a parent or child root. The server's returned `id`, `title` and `workspaceRoot` are kept. Create sends the resolved path with the drive letter upper-cased. Two or more active projects match after normalization: no create, the panel line says "T3 has two projects for this folder: <titles>. Keep one in T3." No cross-window lock; the server serializes same-string creates, and the case rule above makes both windows send the same string.
3. A create refusal (400 or anything else) means: GET again, accept only an exact active match, use its id and title; otherwise the panel line shows the server's error text (redacted by the existing helper).
4. Thread choice from `GET /api/orchestration/shell` with header `x-t3-orchestration-protocol: 2`: `threads` only (not `archivedThreads`), `projectId` equal, `archivedAt` null, `lineage.relationshipToParent !== "subagent"`; sort by `latestUserMessageAt`, then `updatedAt`, then `createdAt`, then `id`, newest first.
5. Create payload: `{type:"project.create", commandId, projectId, title, workspaceRoot, createWorkspaceRootIfMissing:false}` with random UUIDs, no `scripts`, title = folder basename or the drive letter for a drive root.
6. Route `/<environmentId>/<threadId>` with both ids URL-encoded; environmentId from `GET /.well-known/t3/environment`. Every request: 5 s each, status 200 and JSON content type checked, 8 s for the whole ensure-and-land step; past that, fall back as in 7.
7. Visible, never silent: when the step fails (scope missing, timeout, server error, ambiguous match) the panel still loads `/` so the owner can work, but the session card shows one line "T3 is not on <folder>: <reason>. Reload to retry." Codex's position (keep the chat unavailable until resolved) is recorded; the lead prefers a usable panel with a visible warning. Worktree threads keep T3's behaviour; the card does not claim the thread cwd.
8. The seq guard in refresh covers every new await. panel.js only transports a typed `{type:"t3vscode:new-thread", title}` into the iframe after load; the script waits for the button (poll up to 10 s), clicks once, and stops on success, timeout or navigation. Facts for every new selector, route, field and sort rule go into `t3-facts.json` in the same commit.

## Code review (Codex), 2026-10-12

Reviewed commit `142b710` against its parent, with the lead decisions above authoritative. The reviewed code still matches the worktree; T3 reference HEAD remained `d83929ad`. This review accepts the lead's visible `/` fallback and manual first-thread selection limits, but checks that they are actually visible.

### Previous findings 1 to 8

| Finding | Status | Evidence |
|---|---|---|
| 1, no-thread selection | partly | `t3.js:221-223` checks title uniqueness; `extension.js:214-215` asks for the click. Timeout does not report the promised manual-selection note (C1). |
| 2, roots and concurrent creates | partly | `t3.js:145-150` handles ordinary Windows path shapes; creation retains folder/share case, so case-variant windows can duplicate projects (C4). |
| 3, verify refused create | fixed | `t3.js:215-217` re-reads after success or refusal and requires an active normalized-root match; it uses the winning row's id. |
| 4, thread choice | fixed | `t3.js:186-197` excludes archived rows and subagents, retains forks, uses the first valid timestamp and larger-id tie-break. Matches `reference/t3code/packages/client-runtime/src/state/threadSort.ts:82-118,154-175`. |
| 5, minimal create/list contract | fixed | `t3.js:167-175,203` uses active rows, random ids, basename/drive title and the minimal payload with folder creation false; valid against `reference/t3code/packages/contracts/src/project.ts:199-225`. |
| 6, route/header/deadlines | fixed | `t3.js:153-163,187,224-228` checks status/JSON, obtains descriptor environmentId, encodes ids, sends protocol 2 and caps the operation at 8 s. |
| 7, visible failure and worktrees | partly | `panel.js:139-147` opens and escapes explicit notes; no thread cwd is claimed. Lead's usable fallback is implemented, but the fresh-project timeout still reports success and error text is not always safe (C1, C2). |
| 8, cancellation/messages/facts | partly | `extension.js:210-211` guards the new await; `panel.js:110-120` preserves message boundaries; all 23 added fact anchors exist. Navigation cancellation and failure feedback remain incomplete (C1, C3). |

### Findings

1. **Blocks (C1): the promised 10 s failure note never arrives.** `t3.js:223` returns fresh/unique with no note; `t3.js:288-293` merely clears the poll if the button is absent. `panel.js:143` can then say "T3 is on <folder>" while `/` opened the home project. The exact button exists only for the active project (`reference/t3code/apps/web/src/components/chat/ChatHeader.tsx:316-325`), and index selects global activity (`routes/_chat.index.tsx:50-69`). Fix: send a typed failure acknowledgement on timeout/navigation, validate its iframe source and origin in the panel, and show the lead's manual-selection note. Do not assert successful binding while that step is pending. Driving the picker remains outside this slice as decided.

2. **Blocks (C2): upstream error text can put secrets in the note and log.** `t3.js:156` copies raw Content-Type into an error; `:182` copies a partly redacted refusal body; `:232` forwards e.message to the note; `extension.js:212` logs it. Fake upstream probes reproduced both a known synthetic bearer echoed in Content-Type and an unknown synthetic password in refusal JSON reaching the note. `panel.js:143` escapes HTML correctly, but escaping does not remove secrets. Fix: use locally written status/code-only routing errors, without arbitrary upstream headers/body values in the note or log; redact the known bearer at the final error boundary too. No real server secret was read or exposed in these probes.

3. **Should fix (C3): the poll cannot identify the first redirect as T3's.** At `t3.js:285-291`, any first pathname change from `/` is accepted. The VM probe changed `/` to an owner-selected thread before the first tick and the script still clicked the exact-label button. Title uniqueness is also only a snapshot of one server's projects (`:221`), not proof against a later rename/create or another connected environment with that title. Fix: cancel on trusted owner navigation/input, allow only the expected initial draft transition, and verify project/environment identity before any automatic click. Add these cases to `scripts/selfcheck.mjs:701-729`, which currently tests navigation only after a baseline was established.

4. **Should fix (C4): uppercasing the drive is not one creation spelling.** `t3.js:150,213-216` creates `D:\Work\Demo` and `D:\work\demo` separately although lookup treats them as equal. UNC host/share case has the same issue. Server SQL equality and workspace locks are exact-string (`reference/t3code/apps/server/src/orchestration-v2/ProjectStore.ts:134-136`; `project/ProjectService.ts:228-272`). A barrier-based fake upstream reproduced two simultaneous case-variant creates and two stored rows. Fix: serialize missing-project ensure/create across windows by normalized root, re-reading inside that narrow guard. The lead's no-lock rationale is incorrect for folder/share casing; the server still safely deduplicates identical spellings. Do not lowercase the creation path as a blanket fix for case-sensitive Windows directories.

5. **Should fix (C5): first local folder differs from the first workspace folder.** `extension.js:31` uses `.find(file)` rather than folder zero. A workspace starting with a virtual/remote folder and then a local folder binds to the second folder, contrary to SYNC row 1 and the no-local-first-folder design. `scripts/selfcheck-ext.mjs:379-385` currently encodes that mismatch. Fix: inspect workspaceFolders[0], use it only if its scheme is file, otherwise leave the panel unbound; adjust that existing check. No folder picker is needed.

6. **Note (C6): the deadline/render/message mechanics otherwise hold.** The streaming fake upstream completed its initial missing-project GET after the 8 s fallback; `t3.js:213,228-235` prevented a subsequent POST. Promise.race returns one result, and `extension.js:210-211` rejects a stale refresh before logging or rendering. A POST already started before the cap can still finish later; the cap is not a rollback guarantee. `frameLoaded` comes from the outer panel's load listener (`panel.js:120`), not iframe messages: the iframe cannot directly forge that extension command through `panel.js:110-118`. The host-to-frame message drops extra fields and targets the frame origin. Keep these boundaries. Add facts for the server's normalization (`reference/t3code/apps/server/src/workspace/WorkspacePaths.ts:156-158`) and actual new-thread handler (`apps/web/src/components/ChatView.tsx:2599-2601`) when fixing the binding flow; the existing 23 anchors all match, but do not watch these dependencies. No broader framework, WS client or polling feature is needed.

Checks: explicit Node runs with disposable `T3VSCODE_HOME` passed `selfcheck.mjs` 58, `selfcheck-mcp.mjs` 29, `selfcheck-panel.mjs` 13, `selfcheck-ext.mjs` 18, all exit 0, no WARN. Own in-memory/fake-upstream probes reproduced C2-C4 and verified the post-cap guard. Live GET only: projects/shell 401 JSON, descriptor 200 JSON with environmentId, `/` 200 HTML. First check attempt incorrectly used the context sandbox's Bun executable: main check failed after 12 PASS, MCP timed out after 5 PASS, extension check failed loading vscode, panel check passed. All four were rerun explicitly with Node. The initial context-tool lookup and one auxiliary INJECT harness attempt also failed; corrected calls passed. No authenticated panel run, live POST, CLI, token access, code edit, reference mutation or commit.

Verdict: not ready; fix C1-C5, retain the small HTTP plus T3-owned UI design, then verify the fresh-project flow in the real panel.

## Verification (lead's verifier), 2026-10-12

Own probes only (own fake upstream, own vm and vscode stubs) in `%LOCALAPPDATA%/Temp/t3probe/verify2/` (p1 to p4); the builder's selfchecks were not used as proof. Live: GETs only, `Bearer invalid`. Reference `d83929ad`.

**FAIL**
- 6 (silent failure, decision 1 not fully built): decision 1 says "Not unique, or the button never appears within 10 s: no click; the panel card shows one line." Only the not-unique half exists. The 10 s timeout (t3.js:288 `throw 0`) sends nothing back, logs nothing, and the card (panel.js:143, fed by extension.js:215 `folderName`) still says "T3 is on <folder>". This is Codex finding 1's case: a fresh project lands on `/`, another project (the home one) wins the index, the exact-label button never appears, and the owner's original symptom returns under a reassuring card line.

**PASS**
- 1a: newest by latestUserMessageAt wins over newest by updatedAt; archived and subagent threads newer than all are skipped.
- 1b: folder `d:/git/T3-VSCODE/` (backslashes, trailing one) matches stored `D:/GIT/t3-vscode`, no POST.
- 1c: POST keys exactly type, commandId, projectId, title, workspaceRoot, createWorkspaceRootIfMissing; both ids UUID v4 shape and distinct; drive upper-cased; false; no scripts, no defaultModelSelection.
- 1d: 400 then listed: the shell route is read and the thread of the server's project id is chosen.
- 1e: 400 and still missing: note carries the server text, the echoed bearer is masked.
- 1f: two roots matching after normalization: no POST, note names both titles.
- 1g: no orchestration:read (and scopes null): zero requests, note.
- 1h: read only, no project: only GET /api/projects, no POST, note.
- 1i: 9 s silent upstream: note at 5.0 s (per-request idle timeout); body trickled 1 byte/s for 10 s: note at 8.0 s ("within 8 s").
- 1j: 500 JSON, 200 HTML, 200 non-JSON, 200 `null`: fallback note each, no throw.
- 1k: environment route 404: fallback note.
- 1l: bearer absent from every note, including a shell 500 that echoes it and a create refusal that echoes it.
- 1m: root `D:/`: title `D`, payload root `D:` plus backslash, no crash; `d:` plus backslash matches it afterwards.
- 1n: normalizeRoot gives `d:/` for `D:/`, `D:` plus backslash, and `d:` (from a C: cwd); see INFO.
- 2: exact label clicked once, others untouched; `New thread in X ` and `New thread in XY` never clicked; a second message while polling ignored; poll stops after tick 41 (10 s) with no click; `/` to `/draft/abc` keeps polling and clicks; a second path change stops it; non-parent and malformed messages ignored; the open-file chip handler still posts with both listeners installed, also during a poll.
- 3: state.path appears once, in the iframe src only; `"` and `<` escaped as `&#34;` and `&#60;`; frameLoaded posts new-thread once per render (twice frameLoaded: one post; reload: one more); an unchanged first folder (same string, new object; or a second folder added) does not refresh, a changed one refreshes once; an older ensureProject resolving after a newer refresh does not render and leaves no click request.
- 4: `/.well-known/t3/environment` 200 JSON with environmentId; `/api/projects` and `/api/orchestration/shell` 401 JSON with `Bearer invalid`, with and without `x-t3-orchestration-protocol: 2`.
- 5: all 23 new facts match `git grep -F` at HEAD in their paths.
- 6 (reach): no new way for the T3 page to reach the extension. frameLoaded comes from the webview's own iframe load listener; a T3 self-reload only re-fires it after newThread is already cleared.

**INFO (not failures)**
- t3.js:486 exports environmentId, projects, createProject, latestThread; nothing outside t3.js uses them (only normalizeRoot and createRoot are used, by selfcheck).
- Drive root folder: `path.basename` is empty, so extension.js:215 gives folderName `''` and the card shows neither the folder line nor a note.
- No local folder: no `Project:` log line (by design, "load /"), the one branch with no trace.
- `d:` alone is drive-relative: from a D: cwd normalizeRoot gives `d:/git/t3-vscode`. T3's server does the same; VS Code's fsPath never produces it.
- A POST still in flight when the 8 s cutoff fires completes server-side behind a failure note; the next Reload finds the project.

## Code review 2 (Codex), 2026-10-12

Reviewed `ee1fabe`; worktree code matches it, reference HEAD `d83929ad`. Own disposable Node/VM/fake-upstream probes and all four isolated selfchecks ran: 60 + 29 + 14 + 20 PASS, no WARN. Initial combined probe command failed to parse; corrected probes all exited 0. No live calls, token access, code/reference edits or commit.

1. **C1 partly:** `t3.js:323-346` acknowledges click, timeout, established navigation and trusted input; `panel.js:111-125` accepts failure only from the exact frame window/origin and shows/posts it once, confirmed by probes. `panel.js:151` still claims binding while pending and `t3.js:344` sends success before clicking; use pending text and claim success only after verified selection.
2. **C2 fixed:** `t3.js:154-162,191,269` excludes upstream header/body text and redacts the final boundary; header, GET-error and create-refusal probes echoing synthetic bearer/password leaked neither into notes nor their logged text (`extension.js:213`).
3. **C3 partly:** `t3.js:333-335` cancels on trusted click/keydown, confirmed. `t3.js:339-344` still accepts any first path change from `/` and matches title alone: own probe changed to another environment's thread and still clicked/reported success. Verify root/environment and the initial draft transition, or report manual selection when identity cannot be verified; trusted-input cancellation alone does not establish project identity.
4. **C4 fixed:** `t3.js:196-209,241-252` locks by normalized root under `T3VSCODE_HOME` and re-reads inside it; two concurrent differently cased callers against one fake upstream sent exactly one create. The explicitly documented stale-lock recovery race at `t3.js:207` remains a crash-recovery limitation.
5. **C5 fixed:** `extension.js:31` binds only local folder zero; own probes reject an empty workspace and remote-first/local-second workspace and accept local-first. `extension.js:215-217` also fixes verifier FAIL 6 by using the project's title for drive-root display.
6. **C6 fixed:** `t3-facts.json:48-49` anchors both dependencies; own checks match `reference/t3code/apps/server/src/workspace/WorkspacePaths.ts:156` and `reference/t3code/apps/web/src/components/ChatView.tsx:2600` at `d83929ad`.

Verdict: not ready; C3 still permits an unverified same-title project to receive the automatic click, and C1 needs truthful pending/success text before the owner's live test.

## Lead decisions after review 2 (2026-10-12)

- C1: done in the next commit. The card says "Opening the first thread in <title>" while the request is pending; the script reports success only after the click; the line then becomes "T3 is on <title>", or the failure text.
- C3: recorded as a limit, not built. The "New thread in <title>" button carries only the title. The title is unique among this server's projects (checked from the list the extension holds). A same-named project in another T3 environment shown by the same UI is the remaining case; a wrong click there creates an empty draft and no message, and the owner sees the project name in T3's own hero text. If that case shows up in use, the next step is the sidebar picker flow (Codex finding 1 of the design review).

## Research 2: a robust first thread (2026-10-12)

Source: `reference/t3code` at `d83929ad` (tag `v0.0.46-nightly.20261012.3010`), paths under `apps/web/src` unless stated. Live: GET of `/`, `/assets/main-CgmjZ_f_.js` and
`/assets/command-BEHy9H_H.js` from the running nightly (no bearer, no POST). Asset names churn with every nightly.

### Findings

**1. The command palette bus.** `commandPaletteBus.ts:10` defines `t3code:open-command-palette`; the detail (`:12-16`) takes `open?: "add-project" | "new-thread-in"`,
`query?: string`, `linkedThreads?`. The listener (`components/CommandPalette.tsx:499-517`, registered in a `useEffect`, so a dispatch before mount is lost) routes:
`open:"new-thread-in"` opens the "New thread in..." project submenu but **drops any query** (`:1789-1803` sets the query to ""); `open:"add-project"` starts the add flow;
otherwise a `query` opens the root palette in search mode with that query already in the input (`OpenSearch`, `CommandPalette.logic.ts:103-112`, applied at
`CommandPalette.tsx:1768-1778`). The palette is mounted at the root for every route (`routes/__root.tsx:201`, `:221`). The live main chunk carries the same event name and
the same `query:e.query` dispatch.
- Root search lists projects: with a non-empty query, `filterCommandPaletteGroups` appends a "Projects" group of `projectSearchItems` (`CommandPalette.logic.ts:468-475`).
  Items match when every space-separated token is a substring of the joined search terms (`:496`), and the terms include `project.workspaceRoot` (`:282-287`).
- A project row in search: `buildProjectActionItems` (`CommandPalette.logic.ts:270-296`), value `project:<environmentId>:<projectId>` (`:281`). The value is **not** in the
  DOM: the row is `CommandItem` = Base UI `AutocompleteItem` with `data-slot="command-item"` (`components/ui/command.tsx:198`; live in `command-BEHy9H_H.js`), inside the
  popup carrying `data-command-palette="true"` (`CommandPalette.tsx:567`, also `data-palette-mode` and `data-testid="command-palette"`). Its text is the project title,
  then `ProjectSearchDescription` (`CommandPalette.tsx:3630-3660`): for an ungrouped project a span with the environment label ("Local" for the primary environment,
  `:825`), a dot, and **a span whose text is exactly `project.workspaceRoot`** (`:3654`; `truncate` is CSS only, the text is full). Grouped projects show only environment
  labels, no root (`:3659`).
- Activation: `onClick` runs `onExecuteItem(item)` (`CommandPaletteResults.tsx:202-211`; `onMouseDown` only prevents focus loss). `executeItem` closes the palette and runs
  the item (`CommandPalette.tsx:3240-3263`). Enter on the highlighted row goes through the input's key handler; a click needs no highlight.
- What the project row does: `openProjectFromSearch` (`CommandPalette.tsx:1154-1196`): the project's latest non-archived thread if any, else
  `handleNewThread(scopeProjectRef(environmentId, id))` (`:1186`), the same handler as every New thread button. For a fresh project that is exactly "new thread in X".
- The "New thread in <project>" palette action (`:1813-1833`) is the active project only (`startNewThreadFromContext`). The "New thread in..." submenu items
  (`:1244-1298`, value `new-thread-in:<env>:<id>`) always show `location · workspaceRoot` and call `handleNewThread` directly, but reaching ours needs either scrolling a
  virtualized list (`CommandPalette.tsx:3545`, `:3600`) or typing into a React-controlled input. Root search avoids both.
- Trap: a query starting with `/`, `./`, `../`, `.\`, `..\`, `~/` or a Windows absolute path switches the root view into filesystem browse mode
  (`packages/client-runtime/src/state/projects.ts:80-91`; on because `browseEnvironmentId` falls back to the default add-project environment, `CommandPalette.tsx:958`).
  A `>` prefix means actions only (`CommandPalette.logic.ts:449`). So the query must not be the root itself. The basename is safe.

**2. The sidebar.** The current sidebar has **no project rows**: it is a thread list with a project scope filter (a combobox, `components/Sidebar.tsx:5124`
"Search projects", which only filters the thread list). Its New thread button (`:5022-5040`) creates directly with one project, otherwise calls
`openCommandPalette({ open: "new-thread-in" })` (`:5038`); `routes/_chat.tsx:135` does the same for the shortcut. Per-project buttons with
`aria-label="Create new thread in <displayName>"` exist only in `LegacySidebar.tsx:2542`, shown only when the legacy sidebar setting is on
(`components/AppSidebarLayout.tsx:232`). No project element in either sidebar carries the project id or root as an attribute. So the current manual line
"Pick it in T3's sidebar" points at something the owner does not have.

**3. Other routes and events.** The only `t3code:` window events are the palette bus, `t3code:preview-action` and `t3code:focus-composer`; none selects a project.
- `/new?prompt=...&repo=owner/name` (`routes/_chat.new.tsx`, `packages/shared/src/promptLinks.ts:154-182`) needs a non-empty prompt (`:166`) and matches by GitHub
  repository identity (`components/promptLinks/NewThreadLinkView.tsx:246`), not by root; with no match it offers a clone. Unusable: it puts text in the composer.
- `/projects/$projectKey` redirects to `/settings/projects` (`routes/projects.$projectKey.tsx:11-15`). No `?project=` on `/`.
- `/draft/<id>`: drafts are client-only state in the composer draft store (`hooks/useHandleNewThread.ts:374` mints the id); an unknown id goes back to `/`
  (`components/ThreadRouteView.tsx:142`). A draft for a project cannot be made from outside without writing T3's store (rejected in Design).

**4. What `/` does for a threadless project.** `routes/_chat.index.tsx:50-69`: once bootstrapped, `sortScopedProjectsForSidebar(projects, threads, "updated_at")[0]`
(order hard-coded, not the owner's setting) gets one `handleNewThread(..., { replace: true })`. Each project's key (`components/Sidebar.logic.ts:1303-1319`) is the max over
its non-archived thread shells (`:1439-1441`, subagent and fork threads included) of `getThreadSortTimestamp`: `latestUserMessageAt`, else the thread's `updatedAt`,
else `createdAt` (`packages/client-runtime/src/state/threadSort.ts:82-119`). A project with no such thread uses its own `updatedAt ?? createdAt`. Ties go by title, then
environment id, then project id (`Sidebar.logic.ts:1452-1455`). So the fresh project wins only if its creation time is later than every other project's latest user
message, and later than the `updatedAt` of every thread without a user message. Any message sent in another project after the create, or any busy thread without a user
message, beats it. No title or field makes it win deterministically; bumping `updatedAt` loses the same race. Landing on `/` stays a guess.

**5. Landing anywhere, then switching.** The palette path does not care where the page landed: the event works on every route. By DOM assumptions:
(a) today's exact `aria-label` button: one label, but it exists only for the active project, which `/` chose (finding 4); (b) palette "New thread in..." submenu: event,
popup attribute, row slot, root span, plus scrolling or typing into the input; (c) palette root search: event (with our query), popup attribute `data-command-palette`,
row slot `data-slot="command-item"`, a span whose text equals the root. (c) has the fewest, and each is T3's own attribute or its rendered data, not styling.

### Design (smallest robust)

Replaces the exact-label wait in `injected()`. The panel's message carries `root` (the project's `workspaceRoot` exactly as `GET /api/projects` returned it) and `title`.
1. Query = the last segment of `root` (split on `\` and `/`). Never the root itself (browse mode trap). The basename cannot start with a path prefix.
2. Every 500 ms, while `document.querySelector('[data-command-palette]')` is null and fewer than 10 s have passed: dispatch
   `new CustomEvent('t3code:open-command-palette', { detail: { query: q } })` on `window`. A repeat while it is open re-runs the same search, harmless.
3. Once the palette is there, scan `[data-command-palette] [data-slot="command-item"]`. A row matches when one of its `span` elements has `textContent === root`.
   Exactly one matching row is the identity check (root, not title). Zero or more than one: keep polling until 10 s, then fallback.
4. Click that row (`row.click()`; T3's `onClick` runs `executeItem`). Success only when the palette has gone (`[data-command-palette]` null) within 2 s after the click.
   Do not require a new pathname: `handleNewThread` reuses an empty stored draft of the same project, so if `/` already picked our project the path stays the same.
   The dispatch loop of step 2 ends at the click (otherwise it would reopen the palette T3 just closed).
5. Owner input (trusted click or keydown) at any point: stop, `ok:false`, as today.
6. Fallback: send `ok:false` and leave the palette open with the query in it, so the owner sees the matching project and clicks it. Card line, replacing the sidebar
   text: "T3 project <title> is ready. Pick it in T3's open search (or New thread in...) for the first thread." The line must change: the sidebar has no project rows.
7. Known fallbacks by design: another T3 project in the same repository group (default grouping is `"repository"`, `packages/contracts/src/settings.ts:75`) shows no root
   in its row; the same root in two environments gives two rows. Both end in step 6.
8. The title-uniqueness rule (decision 1) is no longer needed: identity is the root.

Open check before building (Codex: prove the DOM flow first): a scripted `.click()` on a Base UI `AutocompleteItem` under `mode="none"` must reach T3's `onClick`.
The source passes the props through (`ui/command.tsx:189-200`), but `node_modules` is absent here, so prove it once live in the panel (devtools: dispatch the event,
click the row, see a draft of the project).

### Facts for t3-facts.json (the lead adds them)

| id | path | grep |
|---|---|---|
| palette-event | `apps/web/src/commandPaletteBus.ts` | `const COMMAND_PALETTE_OPEN_EVENT = "t3code:open-command-palette";` |
| palette-query | `apps/web/src/components/CommandPalette.tsx` | `query: detail.query,` |
| palette-attr | `apps/web/src/components/CommandPalette.tsx` | `data-command-palette="true"` |
| palette-root-mount | `apps/web/src/routes/__root.tsx` | `<CommandPalette>` |
| palette-projects-search | `apps/web/src/components/CommandPalette.logic.ts` | `value: "projects-search",` |
| palette-token-match | `apps/web/src/components/CommandPalette.logic.ts` | `if (!queryTokens.every((token) => haystack.includes(token))) {` |
| palette-item-slot | `apps/web/src/components/ui/command.tsx` | `data-slot="command-item"` |
| palette-item-click | `apps/web/src/components/CommandPaletteResults.tsx` | `props.onExecuteItem(props.item);` |
| palette-row-root | `apps/web/src/components/CommandPalette.tsx` | `<span className="truncate">{props.workspaceRoot}</span>` |
| palette-project-run | `apps/web/src/components/CommandPalette.tsx` | `await handleNewThread(scopeProjectRef(project.environmentId, project.id));` |
| palette-browse-trap | `packages/client-runtime/src/state/projects.ts` | `(allowWindowsPaths && isWindowsAbsolutePath(value))` |
| grouping-default | `packages/contracts/src/settings.ts` | `const DEFAULT_SIDEBAR_PROJECT_GROUPING_MODE: SidebarProjectGroupingMode = "repository";` |
| palette-live | live | `t3code:open-command-palette` and `query:e.query` in `assets/main-*.js`; `command-item` in `assets/command-*.js` (2026-10-12) |

When this lands, the `new-thread-button` and `new-thread-handler` facts can go if the exact-label path is removed.

## Review 2 (Codex), 2026-10-12

Reviewed Research 2 from `e7f31df` against read-only reference HEAD `d83929ad`; builder files are in flight and were not reviewed as final.

1. **Supported: use the query event, not a fabricated draft.** `commandPaletteBus.ts:10-30` accepts `t3code:open-command-palette` with optional `query`; `components/CommandPalette.tsx:499-517,1768-1778` opens command mode and resets to root search. Nonempty ordinary queries include Projects and require every token to match (`CommandPalette.logic.ts:449-496`). Ungrouped descriptions render the full root in a span (`CommandPalette.tsx:3640-3654`). Row click calls executeItem (`CommandPaletteResults.tsx:202-211`); an ungrouped project with no open thread calls handleNewThread (`CommandPalette.tsx:1173-1188`). Fix: retain this small event/UI path and its bounded mount wait; keep the title-uniqueness rule removed.

2. **Blocks: palette closure does not prove selection succeeded.** `CommandPalette.tsx:3250-3262` closes first, then runs the asynchronous command; rejection only shows a toast. A probe executing that source with a rejected action confirmed closed palette plus error toast. Thus the 2 s closure check can acknowledge failure as success, and the promised open-palette fallback is absent after such a rejection. Fix: acknowledge success only after verifying the destination's project/environment identity, including the same-path draft-reuse case. On unverified completion, show the failure note and reopen the same search only if the owner has not taken over.

3. **Blocks: any matching span is not a project discriminator.** Root search also includes Threads (`CommandPalette.logic.ts:484-489`), and every result title is a span (`CommandPaletteResults.tsx:218,232`); a thread title equal to the root satisfies the proposed predicate. Chat content also participates in search (`CommandPalette.tsx:759-760`; `CommandPalette.logic.ts:365-369`) and is rendered as text (`ThreadSearchMatch.tsx:59-64`). No script execution is needed to contaminate results. Fix: restrict matching to a project description's root field and the expected environment, excluding titles and snippets; if that identity cannot be established from the actual DOM, do not click. Keep the extension-provided root/query as data, never selector or script text.

4. **Blocks: root-search results are virtualized too.** `CommandPalette.tsx:3545,3600` uses `CommandPaletteVirtualizedResults`; `CommandPaletteResults.tsx:96-100,121-145` explicitly leaves offscreen rows unmounted. One mounted match cannot prove total uniqueness, and an unmounted target cannot be found by waiting. Repository grouping emits one representative (`CommandPalette.tsx:886-909`), hides its root (`:3659`) and can open another member's newest thread (`:1156-1184`). Ungrouped identical roots across environments are also possible. Fix: identify the primary environment as well as the root, exclude grouped rows, and bound any scrolling needed to find the project; never infer global uniqueness from DOM count. Keep grouped/unverifiable cases as an explicit manual fallback without changing T3 grouping settings.

5. **Should fix: a drive root has no safe basename by default.** Splitting `D:\` yields an empty final segment, or `D:` after dropping empties. Empty search omits the Projects search group (`CommandPalette.logic.ts:453-457`); `D:` is recognized as a Windows path (`packages/shared/src/path.ts:1-10`; `packages/client-runtime/src/state/projects.ts:80-90`) and enters browse mode. A leading `>` is actions-only (`CommandPalette.logic.ts:449-469`). Fix: use a nonempty, non-path query, explicitly using the drive letter for drive roots, and validate reserved prefixes before dispatch; never substitute the full root as the query.

6. **Should fix: opening is possible from composer focus, but does not arbitrate dialogs.** The event listener has no focus/dialog guard (`CommandPalette.tsx:499-517`); the palette makes the background inert (`:532-534`) and autofocuses its input (`ui/command.tsx:103-104`). Another open dialog is not checked there, so usable modal stacking is unverified. An existing palette also makes step 2 skip dispatch and scan the owner's previous search/submenu. Fix: decline automation when an unrelated dialog or palette is already open, track the palette opened by this run, and stop on trusted owner input throughout dispatch, search and completion. Do not overwrite an existing query or reopen after owner cancellation.

7. **Note: live DOM click proof remains outstanding.** `ui/command.tsx:189-200` forwards onClick to Base UI, but source wiring alone does not prove the real primitive's scripted click behavior. Add facts for grouping, virtualized result rendering and the destination-identity check; then prove the corrected flow once in the real panel, with home winning `/`, an unrelated same-root title, a remote duplicate and a grouped project. No WS client or internal draft-store access is needed.

Checks: source reads and the closure/matcher probes passed; live unauthenticated GET `/` returned 200. The page referenced an index asset, so the attempted main-asset lookup made no asset request and proved no bundle signature. Failed exploratory rg commands named nonexistent `ui/command-dialog.tsx`, `projectPathLogic.ts` and `ThreadSearchMatchExcerpt.tsx`; a grouping lookup in Sidebar.logic.ts returned no matches. Correct files were subsequently inspected. No live UI action, POST, CLI, token access, code/reference edit or commit.

Verdict: change success proof, project/environment matching, virtualized-result handling and query/dialog guards first; then build the small command-palette approach.

## Lead decisions after review 2 (2026-10-12)

Numbers refer to the Codex findings above. The builder applies these on top of Research 2.

2. Success needs two proofs: before the click, the clicked row's path element equals the root (identity); after the palette closed, within 3 s the page shows a button with aria-label exactly `New thread in <title>` (the active-project header button; it is a post-check now, not the trigger). Missing either: `ok:false`, the failure line, no second attempt.
3. Match only the element that renders a project's root path (read `CommandPalette.tsx:3640-3654` for the element and its stable attribute; if there is no stable attribute, match a row whose title element is not the root and whose description element is the root). Thread rows and search snippets never match. The root and the query are data, never selector text.
4. Virtualization: the query is the folder basename, so the result list is short. The script scans mounted rows only; a target that is not mounted is a fallback (`ok:false`, palette left open with the query, the owner clicks). Grouped rows (no path shown) fall back the same way. No scrolling.
5. Drive root: the query is the drive letter alone (for `D:\` the query is `D`); never a string that starts with a path prefix (`/`, `./`, `../`, `.\`, `..\`, `~/`, `X:`) or with `>`.
6. If `[data-command-palette]` already exists before our first dispatch, do not automate: `ok:false` with the failure line, nothing touched. Only the palette opened by this run is used; the owner's trusted click or keydown stops the run at every stage.
7. Facts for grouping, virtualized results and the post-check go into t3-facts.json. The live proof is the owner's test on a fresh project.

## Code review 3 (Codex), 2026-10-12

Reviewed `9ba5657`, "First thread through T3's command palette, identity by folder path". HEAD `855f770` adds only STATUS; reviewed code equals the clean worktree. Reference HEAD stayed `d83929ad`. Lead decisions after review 2 govern this review, including no scrolling and grouped/unmounted fallback.

### Review 2 findings

| # | Status | Evidence |
|---|---|---|
| 1, event/search path | fixed | `t3.js:322-323,359-362` sends the contracted `{query}` event with a bounded mount wait; `:258-260` returns T3's exact workspaceRoot. |
| 2, success proof | partly | `t3.js:350-356` adds the title post-check and `panel.js:160-169` shows pending text, but another same-title project can still pass (P1). |
| 3, project row discrimination | partly | `t3.js:367-372` rejects current thread titles/snippets, which end with time (`reference/t3code/apps/web/src/components/CommandPaletteResults.tsx:236-239`), but accepts a non-project action description (P3). |
| 4, virtualization/grouping | partly | `t3.js:360,372-374` implements the lead's no-scroll fallback; a sole mounted remote duplicate is still clicked (P2). |
| 5, safe query | fixed | `t3.js:322-323` uses the drive letter, rejects empty/reserved-prefix queries and keeps root/query out of selectors; VM probes confirmed the event detail. |
| 6, palette ownership/input | fixed per lead decision | `t3.js:359` leaves a pre-existing palette/query untouched; `:342-344` stops on trusted click/keydown. Other-dialog arbitration remains unverified, as previously noted. |
| 7, facts/live proof | partly | New grouping/virtualization/header anchors match in `t3-facts.json`; the real Base UI click/destination check is still the owner's test. The commit adds 17 fact entries, 16 source anchors and one live-only entry, not 18 new entries. |

### Findings

1. **Blocks (P1): the header can already name an unrelated project.** `t3.js:355` accepts any exact-title header after closure, without checking whether it existed before the click or which root/environment it represents. VM reproduction: the correct root row is clicked, its action fails but closes the palette, and the old same-title project's header remains; the script reports `ok:true`. T3 closes before asynchronous execution and only toasts failures (`reference/t3code/apps/web/src/components/CommandPalette.tsx:3250-3262`). Fix: verify destination root/environment; treat an already-present same-title header as unverified unless its current root is independently established. Otherwise return false. The code follows lead decision 2, but that decision's two checks do not prove identity.

2. **Blocks (P2): the one visible root match can belong to another environment.** `t3.js:371-374` ignores the row's environment. A VM with only the remote duplicate mounted, the intended local row offscreen, and identical root/title clicked the remote row and passed the post-check. Virtualization makes this a legitimate result state (`reference/t3code/apps/web/src/components/CommandPaletteResults.tsx:96-100,121-145`). Fix: require the expected primary environment in addition to the root before clicking, or decline automation when it cannot be verified. This preserves the no-scroll decision; an unmounted local target must fall back rather than select a different visible project.

3. **Should fix (P3): last leaf is not uniquely a project root field.** `t3.js:371-372` accepts `["Project settings", root]`. That shape can be real: T3's Project settings action renders the current group's displayName as its description and matches queries such as "settings" or "scripts" (`reference/t3code/apps/web/src/components/CommandPalette.tsx:2256-2282`). If that name equals the target root and the actual project row is absent/grouped, the script opens settings. The VM reproduced the unwanted click, followed by a failed post-check. Fix: require the actual ProjectSearchDescription structure, including preceding environment metadata (`CommandPalette.tsx:3642-3654`), instead of any final description span. Retain the title/snippet rejection and add this counterexample to the existing selfcheck.

4. **Note: message gates, query handling and owner takeover hold.** Own VM probes confirmed `panel.js:111,120-136` accepts frame results only from the exact window/origin and forwards only typed root/title with extra fields dropped to the frame origin. Pending/failure attributes and text are escaped (`:161-169`). `extension.js:105,218` sends the object once on outer-page frameLoaded; the bearer stays out of it. Existing palettes receive no dispatch, their queries remain unchanged, and trusted click/key cancellation prevents later clicks. No broader framework or WS client is needed.

Checks: explicit Node selfchecks with disposable T3VSCODE_HOME passed 62 + 29 + 15 + 20, all exit 0, no WARN. Own VM probes reproduced P1-P3 and verified thread/snippet rejection, grouped fallback, existing-palette preservation, owner-input stop, drive query, dispatch shape and panel gates. All 16 newly added source fact anchors matched; the live-only anchor was not verified. No command failed. No live UI action, POST, CLI, token access, code/reference edit or commit; only this section was appended.

Verdict: not ready for the owner's fresh-project test; fix P1/P2 identity proof and P3 project-row discrimination first.

## Lead decisions after code review 3 (2026-10-12, under decision 13)

- P1: applied. If the header already names our title before the click (an older project with the same name), the script does not automate; the owner picks in the open palette. Success after the click still needs the header button to appear.
- P2 (a same-root project in another T3 environment, with the local one unmounted) and P3 (a settings action whose description equals the root): recorded as limits, not built. Both need a second T3 environment or a group named like a full path. If one shows up in use, add the environment check from the row value.
