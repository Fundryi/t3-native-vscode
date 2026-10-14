# APPROVE: answer a T3 approval from a VS Code notification (B14)

Research of 2026-10-13. Source: `reference/t3code` at `5d6e4192` (nightly .3042). All paths below are in that clone unless they start with our own file names. Read only: no POST, no WebSocket message, no token was used. Live checks were GETs with `Authorization: Bearer invalid`.

## Answer

Possible with the pairing bearer we already hold. Not over HTTP and not over `/mcp`: the only way is T3's own WebSocket RPC `orchestration.dispatchCommand` with the command `runtime-request.respond`. It needs the scope `orchestration:operate`, which is in the Standard pairing set. The web UI sends exactly this when the owner clicks Approve.

This corrects HANDOFF section 5 (question 6 "Gaps") and BACKLOG B14: `t3_pending_request_respond` on `/mcp` cannot approve anything. It answers user questions only. So no second credential is needed.

## Findings

### 1. What answers a pending request

- **No HTTP route.** The full HTTP API list (`packages/contracts/src/environmentHttp.ts:450-759`) has only GET snapshots under `/api/orchestration/*` (`:610-641`). Nothing answers a request. Live: `GET /api/auth/websocket-ticket` falls through to the SPA (200 HTML), so that route is POST only (`environmentHttp.ts:479`).
- **WebSocket RPC, the one real path.** Method name `orchestration.dispatchCommand` (`packages/contracts/src/orchestrationV2.ts:3239`). Its payload is any `OrchestrationV2Command` (`:3735-3738`, `packages/contracts/src/rpc.ts:1620-1622`). The server handler is `apps/server/src/ws.ts:1821-1867`; it queues the command and returns `{ sequence }`.
- **The command** (`orchestrationV2.ts:3059-3067`):
  `{ type: "runtime-request.respond", commandId, threadId, requestId, decision?, answers?, attachmentsByQuestionId? }`.
  A sister command `thread.user-input.dismiss` `{ commandId, threadId, requestId }` closes a question without answering (`:3068-3073`).
- **`/mcp`.** `t3_pending_request_respond` still exists, but its own description says "This cannot approve a permission request" (`apps/server/src/mcp/toolkits/thread/tools.ts:169-176`). The handler sends `answers` only (`apps/server/src/mcp/toolkits/thread/handlers.ts:219-232`), and `t3_pending_request_list` lists only `user_input` requests (`:203-211`).

### 2. Which credential

- `dispatchCommand` needs `orchestration:operate` (`apps/server/src/auth/RpcAuthorization.ts:47`). Every RPC on a socket is checked against that socket's session scopes (`:279-284`, wired in `apps/server/src/ws.ts:3196`). No per-payload extra scope for this method (`packages/contracts/src/clientRpcPermissions.ts:13-67` does not list it).
- `orchestration:operate` is in `AuthStandardClientScopes` (`packages/contracts/src/auth.ts:83`, `:205-219`). The "Read only" preset lacks it, so a read-only pairing gets an authorization failure.
- **Getting onto `/ws` with a bearer.** The bearer-client path is: `POST /api/auth/websocket-ticket` with `Authorization: Bearer <token>` (`packages/client-runtime/src/authorization/remote.ts:170-176`, handler `apps/server/src/auth/http.ts:415-424`), then open `/ws?wsTicket=<ticket>&orchestrationProtocol=2` (`remote.ts:221`). The ticket lives 5 minutes (`apps/server/src/auth/SessionStore.ts:433`) and carries the session's scopes (`apps/server/src/auth/EnvironmentAuth.ts:1251-1267`). Without a ticket the upgrade falls back to cookie or bearer header (`:1271`); HANDOFF section 5 question 2 saw a 101 with the bearer header through our forwarder. Use the ticket anyway: HANDOFF notes that the header fallback is internal code no first-party client uses, so a nightly may drop it, while the ticket is what T3's own remote clients use.
- Protocol version 2 is required on the upgrade URL (`packages/contracts/src/environment.ts:13`, `apps/server/src/ws.ts:3162-3171`). Live: `GET /ws` gives 426, `GET /ws?orchestrationProtocol=2` with a bad bearer gives 401 `auth_invalid`.
- An MCP OAuth token is refused on `/ws` (HANDOFF section 2.3 item 3; `rejectMcpClientAudience`, `EnvironmentAuth.ts:1259`). The desktop app's session is not needed.

### 3. What the web UI sends on Approve

- Buttons: `apps/web/src/components/chat/ComposerPendingApprovalActions.tsx`. Default options are Cancel, Decline, "Always allow this session", Approve (`:25-30`). `accept` and `decline` are the two main buttons, the rest sit in a "..." menu (`:40-45`). When the provider sends its own `options`, those replace the defaults (`:37`).
- Handler: `apps/web/src/components/ChatView.tsx:10197-10228`. It does nothing unless the session has `orchestration:operate` and the request's `responseCapability` is `live` (`:10199-10205`). On failure it shows the error text in the thread (`:10217-10223`), which suggests the orchestrator text reaches the client.
- Client call: `respondToThreadApproval` dispatches `{ type: "runtime-request.respond", commandId, threadId, requestId, decision }` (`packages/client-runtime/src/operations/commands.ts:851-861`). `commandId` is a fresh UUID v4 (`:265-271`), sent through `dispatchCommand` (`:273-274`). User input uses the same command with `answers` instead of `decision` (`:863-876`).

### 4. What a response needs

- `threadId` and `requestId`: both in the shell summary we already poll (`pendingRuntimeRequest = {id, kind, createdAt}`, `orchestrationV2.ts:1910-1914`, `:1964`). `commandId`: any trimmed non-empty string (`packages/contracts/src/baseSchemas.ts:310-320`); use `crypto.randomUUID()` like T3.
- Decisions: `accept | acceptForSession | acceptAlways | decline | cancel` (`packages/contracts/src/providerPolicy.ts:50-56`). There is no separate "remember" flag; remembering is the decision `acceptForSession` or `acceptAlways`.
- Per kind:
  - `command`, `file-read`, `file-change`, `mcp-elicitation`, `permission` (`providerPolicy.ts:38-44`): `decision`. The UI offers them only when `responseCapability` is `live`.
  - `user_input`: `answers` keyed by question id; each required question needs a non-empty string answer (`apps/server/src/orchestration-v2/Orchestrator.ts:7440-7458`). Needs the questions from the thread snapshot. Not a notification job.
  - `dynamic_tool_call`, `auth_refresh`: the UI never shows Approve for them (`packages/client-runtime/src/state/threadRequests.ts:97`; `models.ts:258-262` does not count `auth_refresh` as an approval). We should not either.
- The shell summary lacks `responseCapability`, `prompt` and `options`. They are in `GET /api/orchestration/threads/:threadId/bounded` (`environmentHttp.ts:625`, scope `orchestration:read`, `apps/server/src/orchestration-v2/http.ts:181-184`): `projection.runtimeRequests[]` has `status` and `responseCapability` (`orchestrationV2.ts:1114-1133`), and the `approval_request` turn item has `prompt`, `appName`, `options` (`:1550-1560`).
- The `prompt` is not always the command text. Codex sends the reason if there is one, else the command (`apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.ts:5079-5082`). Claude sends the SDK title, description or decision reason, else a summary (`ClaudeAdapterV2.ts:8014-8018`).

### 5. Wire format (Effect RPC over JSON)

- The server uses `RpcSerialization.layerJson` (`apps/server/src/ws.ts:3211`): one JSON message per WebSocket frame, an array is also accepted (`.repos/effect-smol/packages/effect/src/rpc/RpcSerialization.ts:129-140`).
- Request: `{"_tag":"Request","id":"1","tag":"orchestration.dispatchCommand","payload":{...},"headers":[]}` (`.repos/effect-smol/packages/effect/src/rpc/RpcMessage.ts:71-81`).
- Answer: `{"_tag":"Exit","requestId":"1","exit":{"_tag":"Success","value":{"sequence":N}}}`, or an exit with `"_tag":"Failure"` and a `cause` list (`RpcMessage.ts:287-317`). A failure carries `OrchestrationV2DispatchCommandError` with `message` (`ws.ts:1857-1865`); that text is the deepest non-generic message of the cause (`apps/server/src/orchestration-v2/UserFacingErrors.ts:104-110`), so match it by substring. A missing scope fails with "The authenticated token is missing required scope: ..." (`RpcAuthorization.ts:229-233`).
- Caveat: the vendored Effect copy is 4.0.1; the server runs the catalog 4.0.2 (`pnpm-workspace.yaml:56`) with `patches/effect-4.0.2.patch` (an at sign in the real name), which touches `RpcClient` only. Nothing in `ws.ts` reads per-request RPC headers, so an empty `headers` list should do.

### 6. Risks

- **Answered twice** (two windows, or the owner already clicked in T3): the server refuses with "Runtime request <id> is resolved." (`Orchestrator.ts:7317-7323`). Harmless.
- **Stale id** (request gone after a restart or expiry): "Runtime request <id> was not found." (`:7310-7316`), or "is expired" or "is cancelled". A request whose provider session died is `not_resumable` and refused with its reason (`:7325-7330`).
- **Retry of the same command**: a repeated `commandId` for the same thread replays the receipt instead of acting twice (`Orchestrator.ts:248-257`). A network retry with the same id is safe.
- **Another window's project**: the server has no per-thread owner check; any operate session may answer any thread. Our only guard is `threadsFor` (this window's threads). Two windows on the same folder both get the toast; the second click gets "is resolved".
- **Blind approval**: the toast shows `prompt`, which may be a reason, not the command (see 4). Approve from a toast is weaker than Approve in the panel, where the command item is visible.
- **Deny semantics**: `decline` and `cancel` both mark the request node cancelled (`Orchestrator.ts:7356`). Use `decline` for Deny, like the UI's main button. Whether `cancel` also stops the run was not checked.

## Recommended design (B14)

1. Trigger stays the edge in `track` (extension.js): `requestId` changed and `kind` is one of `command`, `file-read`, `file-change`, `mcp-elicitation`, `permission`. Other kinds keep today's "Show" only. `threadsFor` must also return `kind`.
2. On that edge, `t3.js` reads `GET /api/orchestration/threads/<id>/bounded` (bearer, protocol header). The request with that id must be `status: "pending"` and `responseCapability.type: "live"`, else fall back to "Show" only. Take `prompt` and `options` from the `approval_request` item with that `requestId`.
3. Toast: "T3: (thread) asks: (prompt, cut to about 200 chars)" with buttons Approve, Deny, Show. If `options` exist, use their labels for `accept` and `decline`, and drop a button whose decision is not offered. No buttons for `acceptForSession`, `acceptAlways`, `cancel`.
4. On Approve or Deny, one new function in `t3.js`, `respond(origin, bearer, threadId, requestId, decision)`: POST `/api/auth/websocket-ticket` with the bearer, open `/ws?wsTicket=(ticket)&orchestrationProtocol=2`, send the one Request frame of section 5 with `decision` `accept` or `decline` and `commandId = crypto.randomUUID()`, wait for the `Exit` with that id (10 s limit), close. Ignore every other frame.
5. Success: say nothing, run one poll at once; the badge clears.
6. Failure text with "is resolved", "was not found", "is expired" or "is cancelled": info "Already answered in T3". A scope error: warning "This pairing cannot approve (needs Operate)". Anything else, or a timeout: warning with the redacted message and a "Show" button. Never retry automatically.
7. Same commit: facts in `t3-facts.json` for `runtime-request.respond`, `orchestration.dispatchCommand`, the `dispatchCommand` line in `RpcAuthorization.ts`, `wsTicket`, `approval_request`, `responseCapability`, `/bounded`.

## Effort

M, not L as the backlog guessed. About 80 lines: one GET, one ticket POST through the existing `call`, one short WebSocket round trip, two buttons, error mapping. No new credential, no `/mcp` client, no T3 change.

## Not verified

- That `globalThis.WebSocket` exists in the owner's VS Code extension host (Node 22 has it). The standard API cannot set an `Authorization` header, which is why the design uses `wsTicket`. If it is missing, the extension has no WebSocket client without a new dependency.
- A real `Exit` frame from the live nightly. The frame shape comes from the vendored Effect 4.0.1 source, not a wire capture.
- Whether a short-lived `/ws` connection shows up in T3 Settings, Connections (`sessions.recordClientConnection`, `ws.ts:3189`) and how it looks.
- The real `prompt` text for a command approval from Claude and from Codex on the live nightly.
- Whether `cancel` differs from `decline` beyond the node status.

## Open questions for the owner

1. Approve from a toast that may show only a reason, not the exact command: allowed, or should the toast offer only Deny and Show, with Approve done in the panel?
2. Should "Always allow this session" (`acceptForSession`) also be a toast button, or stay in T3 only?
3. If two VS Code windows cover the same folder, both toast. Fine, or toast only in the window whose folder is the thread's own project (`mine` in `threadsFor`)?
