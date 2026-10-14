# Vendor drift: pinned T3 0.0.45 against the nightly

Checked 2026-10-14. File-level compare (`diff -rq --strip-trailing-cr`, then `diff -u` per file), `*.test.ts` and `shared/src/testing/` excluded. The pinned sha is not in the shallow reference clone, so this compares trees, not history. No re-vendoring was done.

## (a) Reference

- Pin: `vendor/` = T3 0.0.45, `7812230572f2d7e042d8d14ada2381fc71377560` (2026-10-05).
- Reference: `reference/t3code` at `v0.0.46-nightly.20261014.3093`, commit `107f6024ea47`, committed 2026-10-13 21:18 -0700.
- Effect: pin `4.0.0-rc.115`; nightly catalog `4.0.2`. The nightly moved Effect modules: `effect/unstable/rpc` -> `effect/rpc`, `effect/unstable/httpapi` -> `effect/http-api`, `effect/unstable/http` -> `effect/http`, `effect/unstable/socket` -> `effect/socket`.

## (b) New files per package (in the nightly, not in vendor/)

- contracts (5): clientRpcPermissions, desktopBrowser, mcpApps, pullRequestReviewGuide, secretRequest.
- shared (25): AgentScope, HostProcess (case rename of hostProcess), PtyAdapter, atomicWrite, authScopeOptions, codexArtifactTemplates, codexFileCitations, codexMarkdownDirectives, desktopBootstrapToken, fileLinks, githubMarkdownLinks, htmlRender, inlineSkills, markdownGithubAlerts, markdownLinks, markdownListIndentation, markdownPipeline, mcpApp, mcpResponsePayloads, orchestrationV2BoundedSnapshot, promptLinks, proposedPlanText, threadFindText, threadLinks, threadSearch.
- client-runtime (20): diffCount, mcpApps/, preview/, promptLinks, providerUpdateRequiredModels, pullRequestMarkdown, reviewGuideTour, scheduledTaskWebhook, secretRequest, sourceControlClients, webhookAddress, state/{commandPermissions, environmentStreams, fileMetadata, mcpApps, pullRequestStatsPersistence, queryPersistence, shellPullRequests, usageAccess, usageProgress}.
- Gone from client-runtime (moved to shared): codexArtifactTemplates, codexFileCitations, codexMarkdownDirectives, markdownLinks. Gone from shared: hostProcess (now HostProcess).

## (c) Changed files per package

How "touches" was decided: the names `src/` imports from `@t3tools/*` were mapped to the file that declares them, and the declaration of each imported name was compared. "Additive" means optional fields, or new variants on things the extension only sends.

### contracts (34 changed)

- orchestrationV2.ts: TOUCHES `OrchestrationV2TurnItem`, `...TurnItemJson`, `...ThreadProjection`, `...ThreadHistoryPage`, `...ThreadStreamItem`: new turn item variant `type: "secret_request"`; the nightly now decodes turn item arrays with `ForwardCompatibleUnion` (unknown types dropped), the pin does not. `OrchestrationV2Command`: new variants `subagent.stop`, `thread.stop`, optional `workspaceStrategy`, nothing newly required. `ORCHESTRATION_V2_WS_METHODS`: added `searchThread`, `searchThreadStream`, `stopWorkflow`; every key src uses is unchanged. `ThreadShell`, `Subagent`, `ProviderThread`: optional `goal`, `workflow`, `modelSelection`, `lastSnoozeWakeAt`. Notification source kind `system` (the pin's fallback maps it to `background_task`). `SubscribeThreadInput`: optional `acceptCompactTurnItems`.
- rpc.ts: TOUCHES `WS_METHODS`: about 20 methods added, `previewAutomation*` removed (not used); every WS method src calls still exists with the same payload and success schema names. Effect import path moved.
- environment.ts: TOUCHES `ExecutionEnvironmentDescriptor` (optional capability flags, `RepositoryIdentity.origin`); protocol constants unchanged.
- environmentHttp.ts: feeds `rpc/http` `threadHistoryPage`: endpoint, params and headers unchanged; new `mcpOAuth` group; scope error gains optional `requiredPermission`.
- auth.ts: feeds client-runtime `authorization` (pairing): new fine-grained scopes; session responses keep the legacy `scopes` array and add optional `permissions`; old scopes still grant the new ones through `legacyParents`. Compatible.
- server.ts: TOUCHES `ServerConfig`, `ServerProvider`: optional `updateRequiredModels`, `workspaceId`, capability flags `threadFind*`. Additive.
- scheduledTask.ts: TOUCHES `ScheduledTask`, `ScheduledTaskUpsertSchedule`: new `webhook` schedule. The vendored copy carries the local read adapter (vendor/README item 5), so webhook tasks still decode; upstream has no `StructWithRest`, so a re-vendor must re-apply the adapter.
- baseSchemas.ts: TOUCHES every id brand (`ThreadId`, `ProjectId`, ...): `TrimmedNonEmptyString` now rejects whitespace-only strings; new `ForwardCompatible*` helpers and `SecretRef`.
- assets.ts: TOUCHES `AssetResource`: new tagged variant `tool-output-image` (the extension only sends it). `AttachmentCreateUploadUrlInput` unchanged.
- composerContext.ts: TOUCHES `OrchestrationMessageContext`: several fields `optional` -> `optionalKey` (an explicit `undefined` value no longer decodes), and the payload must be plain JSON.
- providerUsageLimits.ts: TOUCHES `ServerProviderUsageWindow`, `UsageLimitSourceSnapshots`: optional `workspaceId`.
- settings.ts: the imported font size constants keep their values. model.ts: `SelectProviderOptionDescriptor` unchanged (adds a `muse` driver; default Claude model now `claude-haiku-5-5`).
- Not imported by src: applicationEvent, desktopBootstrap, editor, filesystem, git, index, ipc, keybindings, orchestrationProject, orchestratorMcp, preview, previewAutomation, project, providerRuntime (optional `initialAnswer`), pullRequest, relay, sourceControl, t3ProjectFile, terminal, threadPullRequest, usage.

### shared (42 changed)

- assistantCitations.ts: TOUCHES `parseAssistantCitationHref`: body changed, signature same.
- composerContextReferences.ts: TOUCHES `collectComposerContextReferences`: body changed, signature same.
- composerTrigger.ts: TOUCHES `detectComposerTrigger`: now returns `slash-command` for any token that starts with `/`.
- threadPullRequests.ts: TOUCHES `threadPullRequestSearchTerms`: input gains optional `branchPullRequest`, whose terms come first.
- usageLimits.ts: TOUCHES `collectLimitAccounts` (account merge keys reworked) and `formatResetsIn` (returns `Resets momentarily` under a minute).
- shell.ts: TOUCHES `resolveSpawnCommand`: upstream body changed; the vendored copy carries the local Windows escaping fix (vendor/README item 4), re-apply on re-vendor.
- hostProcess.ts -> HostProcess.ts: TOUCHES `HostProcessPlatform`, `HostProcessEnvironment`: renamed to `Platform`, `Environment`, subpath `./HostProcess`. Only `src/host/pairing.test.ts` imports them. Case-only rename: watch it on Windows when copying.
- filePreview.ts: imported names unchanged.
- Not imported by src: DrainableWorker, KeyedCoalescingWorker, changeRequestUrl, composerContextLegacy, devProxy, dpop, editor, favicon, git, hostClassification, httpObservability, httpReadiness, keybindings, nodeRuntime, nodeSqliteClient, observability, orchestrationV2PendingBackgroundWork, otelEnvironment, path, preview, projectFavicon, projectScripts, projectSettings, qrCode, relayClient, relayJwt, relayTracing, schemaJson, serverSettings, sourceControl, t3McpToolPresentation, terminalLabels, themePalettes, toolActivity, toolOutput.

### client-runtime (96 changed)

- markdownLinks.ts: TOUCHES `@t3tools/client-runtime/markdown-links`: the module moved to `@t3tools/shared/markdownLinks`; `splitFilePathPosition` moved to `shared/fileLinks.ts`; the other three imported names differ only in comments.
- rpc/session.ts: TOUCHES `Rpc.make`, `RpcSession`: adds a 15 s ping timeout and a "stopped responding" message; signature same; Effect import paths moved.
- state/shell.ts + shellReducer.ts: TOUCHES `applyShellStreamEvent`: skips an upsert whose thread shell is unchanged; `mergeShellSnapshotProjects` unchanged.
- state/threadHistoryMerge.ts: TOUCHES `mergeOlderHistoryIntoProjection`: rewritten as a key-based merge, signature same.
- work-log/itemDetail.ts: TOUCHES `turnItemOutputText`: passes a viewed-image flag to `formatToolValue`.
- providerSkills.ts, state/threadRequests.ts: imported names differ only in comments or line order.
- Imported names unchanged although the file changed: markdownImages, operations/projects, rpc/http, rpc/protocol (adds `PING_TIMEOUT`), state/attachments, state/orchestrationV2Projection, work-log/presentation. Unchanged files: authorization/remote, environment/, connection/model, state/serverConfigProjection.
- Not imported by src: the other 80 changed files (connection/*, device/*, relay/*, platform/*, most of state/*, operations/commands, handoff, mediaReference, mediaSource, t3ToolSummary, userMessage, work-log/toolPresentation, remotePerformance.bench, and so on).

### package.json

- Upstream client-runtime now depends on 7 `@t3tools/source-control-*` workspace packages and `@pierre/diffs`, used only by the new reviewGuideTour.ts and sourceControlClients.ts; shared adds rehype/remark dependencies.
- Upstream manifests carry none of our adapter subpaths (`./rpc/session`, `./rpc/http`, `./connection/model`, `./state/thread-history-merge`, `./state/server-config-projection`); re-apply them (vendor/README step 3).

## (d) Verdict

Handshake: unchanged. The nightly still has `ORCHESTRATION_PROTOCOL_VERSION = 2`, `ORCHESTRATION_PROTOCOL_VERSION_TEXT = "2"`, header `x-t3-orchestration-protocol` and query param `orchestrationProtocol` (packages/contracts/src/environment.ts), so `src/host/serverDiscovery.ts` (refuses a descriptor whose `orchestrationProtocolVersion` is not 2) and `src/host/t3Client.ts` (sends the header on the history request) still match. Every other contracts change the extension decodes is additive (optional fields the pinned schemas strip, new commands and methods it never sends, new event types the pinned stream decoder already skips, auth responses that keep the legacy `scopes` array), with one exception: the new turn item type `secret_request` (an agent asked the user for a secret). The pinned `OrchestrationV2TurnItem` union does not know it, so `getThreadProjection`, the history page and the thread stream fail to decode for any thread that contains one (`turn-item.updated` is a known event type, so the pin's unknown-event skip does not apply). The nightly fixed this class for the future (unknown turn item types are dropped), but only a re-vendor brings that in. Limits: diff-level review only; no typecheck of src against the nightly packages (needs Effect 4.0.2 and new workspace packages) and no live run against the owner's server.

## (e) Recommended next step

Re-vendor now, as its own slice: the `secret_request` decode break is real, every nightly widens the gap, and the nightly's forward-compatible turn item decoding removes this whole class of break. Plan it as an Effect `4.0.0-rc.115` -> `4.0.2` upgrade too (the module paths in src/host/pairing.ts, serverDiscovery.ts and t3Client.ts move), leave out reviewGuideTour.ts and sourceControlClients.ts to avoid the seven source-control packages, and re-apply vendor/README steps 3 to 5.
