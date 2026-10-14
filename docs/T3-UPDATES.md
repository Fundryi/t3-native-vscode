# T3 nightly bumps

Written by scripts/references.mjs after every reference/t3code move (design: docs/DRIFT.md). Newest block last. A review ends a block by editing its Status line: at most three short sentences. The updater drops reviewed blocks beyond the newest three; git history keeps them.

## 2026-10-14 07:59:34 t3code none (review every fact) -> 107f6024ea47 (v0.0.46-nightly.20261014.3093)


- 0 facts unchanged

Status: reviewed 2026-10-14. Seed block: vendor/ is pinned at this sha (vendor/README.md), nothing to compare.

## 2026-10-14 12:31:20 t3code 107f6024ea47 (v0.0.46-nightly.20261014.3093) -> 3417bc3856a2 (v0.0.46-nightly.20261014.3105)

- GONE: effect-version (root package.json and pnpm-workspace.yaml override: the single Effect version the vendored packages need): "  effect: 4.0.2" is not in pnpm-workspace.yaml
- GONE: effect-rpc-ping-timeout-patch (patches/effect@4.0.2.patch (copied from T3): RpcClient onPingTimeout hook that vendored client-runtime rpc/session.ts sets): "readonly onPingTimeout?: Effect.Effect<void> | undefined;" is not in patches/effect@4.0.2.patch
- changed 27 lines in packages/contracts: vendor-contracts
- changed 1168 lines in packages/shared: vendor-shared
- changed 269 lines in packages/client-runtime: vendor-client-runtime
- changed 10 lines in packages/contracts/src/orchestrationV2.ts: run-status-queued, shell-thread-status, activity-run-status, runtime-request-respond, approval-request-item, turn-item-secret-request, turn-items-forward-compatible
- changed 49 lines in apps/server/src/orchestration-v2/Orchestrator.ts: runtime-request-refused-status, runtime-request-refused-missing
- changed 7 lines in packages/shared/src/shell.ts: vendor-shell-adapter-site
- diff: git -C reference/t3code diff 107f6024ea47 3417bc3856a2 -- packages/contracts packages/shared packages/client-runtime packages/contracts/src/orchestrationV2.ts apps/server/src/orchestration-v2/Orchestrator.ts packages/shared/src/shell.ts
- 22 facts unchanged

Status: reviewed 2026-10-14. T3 moved to Effect 4.0.4 and dropped its Effect patch; our vendor stays at 3093 on 4.0.2 plus patch, so effect-version and effect-rpc-ping-timeout-patch miss on purpose until the re-vendor (docs/STATUS.md open work 3, vendor/README.md step 7). The contracts and Orchestrator changes (pull request link event, restart continuation) touch nothing we use.

## 2026-10-14 19:15:35 t3code 3417bc3856a2 (v0.0.46-nightly.20261014.3105) -> 7ac952c630ef (v0.0.46-nightly.20261014.3118)

- GONE: effect-version (root package.json and pnpm-workspace.yaml override: the single Effect version the vendored packages need): "  effect: 4.0.2" is not in pnpm-workspace.yaml
- GONE: effect-rpc-ping-timeout-patch (patches/effect@4.0.2.patch (copied from T3): RpcClient onPingTimeout hook that vendored client-runtime rpc/session.ts sets): "readonly onPingTimeout?: Effect.Effect<void> | undefined;" is not in patches/effect@4.0.2.patch
- GONE: vendor-shell-adapter-site (vendor/shared/src/shell.ts resolveSpawnCommand: the line the Windows launcher fix replaces (vendor/README step 4)): "command: escapeWindowsShellArg(resolvedCommand)," is not in packages/shared/src/shell.ts
- changed 4 lines in packages/contracts: vendor-contracts
- changed 957 lines in packages/shared: vendor-shared
- changed 434 lines in packages/client-runtime: vendor-client-runtime
- changed 123 lines in apps/server/src/orchestration-v2/ProjectionStore.ts: thread-visited-no-updatedat-bump
- changed 4 lines in apps/web/src/components/ChatView.tsx: visit-throttle, web-draft-default-model
- changed 29 lines in apps/web/src/components/chat/ChatComposer.tsx: q13-web-plan-slash
- changed 56 lines in apps/server/src/vcs/GitVcsDriverCore.ts: review-diff-file-git-show
- changed 20 lines in packages/shared/src/serverSettings.ts: model-prefs-patch-apply
- changed 5 lines in packages/shared/src/projectSettings.ts: project-settings-resolve
- diff: git -C reference/t3code diff 3417bc3856a2 7ac952c630ef -- packages/contracts packages/shared packages/client-runtime apps/server/src/orchestration-v2/ProjectionStore.ts apps/web/src/components/ChatView.tsx apps/web/src/components/chat/ChatComposer.tsx apps/server/src/vcs/GitVcsDriverCore.ts packages/shared/src/serverSettings.ts packages/shared/src/projectSettings.ts
- 91 facts unchanged

Status: reviewed 2026-10-14. Nothing broke: the new event thread.pull-request-link-updated is skipped by the pinned thread stream (new fact thread-stream-unknown-event), and the visit, slash, git show and settings lines we rely on are unchanged. T3 rewrote the Windows spawn site in shell.ts (fact vendor-shell-adapter-site moved to the new line, vendor/README.md step 4) and T3 web now shrinks PNG/JPEG to a 2000 px edge before attaching (imageAttachmentSize.ts); both wait for the re-vendor.
