# T3 nightly bumps

Written by scripts/references.mjs after every reference/t3code move (design: docs/DRIFT.md). Newest block last. A review ends a block by editing its Status line: at most three short sentences. The updater drops reviewed blocks beyond the newest three; git history keeps them.

## 2026-10-14 07:59:34 t3code none (review every fact) -> 107f6024ea47 (v0.0.46-nightly.20261014.3093)


- 0 facts unchanged

Status: unreviewed

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

Status: unreviewed
