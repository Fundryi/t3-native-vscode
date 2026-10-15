# Vendored T3 Code packages

Source copied (src only) from the T3 Code repo:

- **Upstream:** https://github.com/pingdotgg/t3code (the fork's read-only clone under `reference/t3code`)
- **Git sha:** `339179f50a84dc599cce373dbb48f172f182f44e` (tag `v0.0.46-nightly.20261015.3145`, committed 2026-10-14)
- **Previous pin:** `107f6024ea4786a58a83c921728a113b849de192` (tag `v0.0.46-nightly.20261014.3093`, committed 2026-10-13)
- **Earlier pin:** `7812230572f2d7e042d8d14ada2381fc71377560` (2026-10-05, upstream version 0.0.45)

## What is here

| Package | Upstream path | Vendored path |
| --- | --- | --- |
| `@t3tools/contracts` | `packages/contracts` | `vendor/contracts` |
| `@t3tools/shared` | `packages/shared` | `vendor/shared` |
| `@t3tools/client-runtime` | `packages/client-runtime` | `vendor/client-runtime` |
| `@t3tools/source-control-<host>` (7) | `packages/source-control-<host>/src/client/definition.ts` | `vendor/source-control-<host>` |

Each of the first three copies contains the package's `src/` tree (structure
preserved) and its `package.json`, nothing else. The seven source-control
copies hold only `src/client/definition.ts` and a reduced `package.json` (step 6).

## What was excluded

- All `*.test.ts` files (39 in contracts, 95 in shared, 134 in client-runtime at 3145).
- `packages/shared/src/testing/` entirely (testkit: `longTempDir.ts`,
  `symlinks.ts`, `TraceRetention.fixture.mjs`). No non-test source imports it.
- All `devDependencies` from the copied package.jsons (test-only tooling).
- `client-runtime/src/reviewGuideTour.ts` (needs `@pierre/diffs` 1.5.2; the
  extension does not use it) and `client-runtime/src/remotePerformance.bench.ts`
  (imports `vite-plus/test`).
- Everything in the seven `source-control-*` packages except
  `src/client/definition.ts`.
- No `__snapshots__` directories existed upstream, so none were copied.

## Why

Single pinned copy of the T3 wire protocol (`contracts`) plus the shared/client
runtime, vendored so the extension builds against a frozen schema instead of a
moving upstream. See `docs/t3-vscode-architecture.md` for the decision record.

## Rendering adapter provenance

The pinned wire/runtime copy remains at the revision above. The extension adapters additionally inspected the locally installed T3 Code 0.0.46 Web UI for `html_render` attachment metadata, responsive heights and theme notifications, and the pinned upstream UI for markdown, KaTeX, media and subagent navigation behavior. These adapters live in `src/shared/` and `src/webview/`; they do not replace the vendored protocol packages or embed the entire original Web UI.

## License

MIT, Copyright (c) 2026 T3 Tools Inc. The full license text is in
[`LICENSE.t3code`](./LICENSE.t3code) and **must ship with any distribution** of
this extension (third-party notices).

[LICENSE.remark-math](LICENSE.remark-math) retains the license from the [rehype-katex 7.0.1 release](https://github.com/remarkjs/remark-math/blob/rehype-katex%407.0.1/license); the same license is present in the [remark-math 6.0.0 release](https://github.com/remarkjs/remark-math/blob/6.0.0/license), and both npm packages omit a standalone license file. The notice generator includes it in the bundled dependency notices.

## Runtime dependencies (for the root package.json)

The vendored manifests declare their runtime dependencies and keep
`workspace:*` references to each other. The workspace override pins one Effect
version; the root also declares Effect because the host adapter imports it.
The lockfile resolves the remaining dependencies:

- `effect` **4.0.4**, unpatched (step 7); exactly one copy, duplicates break
  schema decoding
- `@noble/curves` 1.9.1
- `@noble/hashes` 1.8.0
- `jose` 6.2.2
- `yaml` ^2.9.0
- `mdast-util-directive` 3.1.0
- `micromark-extension-directive` 4.0.0
- `micromark-util-character` 2.1.1
- `rehype-raw` 7.0.0, `rehype-sanitize` 6.0.0, `remark-breaks` 4.0.0,
  `remark-gfm` 4.0.1, `remark-parse` 11.0.0, `remark-rehype` 11.1.2
- `unified` 11.0.5
- `three` 0.180.0

Type-checking additionally needs `micromark-util-types` ^2.0.2 (type-only
import in `shared/src/codexMarkdownDirectives.ts`; it was a devDependency
upstream) and `@types/node` (several `shared` files import `node:*` builtins).
Both belong in the root devDependencies.

## Local adapters to re-apply after a sync

- `shared/src/usageLimits.ts` `nativeReport`: `provider.auth?.email` and `provider.auth?.workspaceId` (optional chaining). Older servers and the extension's browser fixtures send providers without `auth`; the upstream code throws in the sidebar render.

## Syncing from upstream

Against a fresh upstream checkout:

```sh
UPSTREAM=/path/to/t3code          # at the desired sha
DEST=vendor

rsync -a --exclude='*.test.ts' --exclude='__snapshots__/' \
  "$UPSTREAM/packages/contracts/src/"        "$DEST/contracts/src/"
rsync -a --exclude='*.test.ts' --exclude='__snapshots__/' --exclude='/testing/' \
  "$UPSTREAM/packages/shared/src/"           "$DEST/shared/src/"
rsync -a --exclude='*.test.ts' --exclude='__snapshots__/' \
  --exclude='/reviewGuideTour.ts' --exclude='/remotePerformance.bench.ts' \
  "$UPSTREAM/packages/client-runtime/src/"   "$DEST/client-runtime/src/"
for d in "$UPSTREAM"/packages/source-control-*; do
  [ -f "$d/src/client/definition.ts" ] || continue
  mkdir -p "$DEST/$(basename "$d")/src/client"
  cp "$d/src/client/definition.ts" "$DEST/$(basename "$d")/src/client/definition.ts"
done

cp "$UPSTREAM/packages/contracts/package.json"      "$DEST/contracts/package.json"
cp "$UPSTREAM/packages/shared/package.json"         "$DEST/shared/package.json"
cp "$UPSTREAM/packages/client-runtime/package.json" "$DEST/client-runtime/package.json"
cp "$UPSTREAM/LICENSE"                              "$DEST/LICENSE.t3code"
# Only while T3 patches Effect (none since nightly 3105, see step 7):
# cp "$UPSTREAM/patches/effect@<version>.patch"     patches/
```

Empty each `src/` first (or use `rsync --delete`): upstream renames and moves
files (0.0.46 moved `client-runtime/src/markdownLinks.ts` to `shared` and
renamed `shared/src/hostProcess.ts` to `HostProcess.ts`). On Windows, stage a
case-only rename with `git mv`; `git add -A` does not see it.

Then re-apply the package.json edits by hand (they are **not** scripted):

1. Delete the `devDependencies` field from each copied package.json.
2. Replace every `catalog:` / `catalog:default` version with the concrete
   version from the upstream `pnpm-workspace.yaml` `catalog:` section
   (keep `workspace:*` refs as-is).

3. Add the extension adapter subpath exports: `./rpc/session`, `./rpc/http`,
   `./connection/model`, `./state/thread-history-merge`, and
   `./state/server-config-projection`. Each points at the existing source file.
   The `./rpc/session` entry points at `./src/rpc/session.ts`
   (upstream's `./rpc` barrel exports only `protocol.ts` and the `RpcSession`
   type; the extension needs `RpcSessionFactory` for connection lifecycle).

4. Preserve the Windows launcher correction in `shared/src/shell.ts`: escape
   command-path metacharacters without adding argument-style quotes, keeping
   argument escaping separate as in [cross-spawn](https://github.com/moxystudio/node-cross-spawn/blob/master/lib/util/escape.js).
   The extension's `src/host/pairing.test.ts` covers this adapter change.
   Since nightly 3118 upstream builds one joined string
   (`[resolvedCommand, ...args].map(escapeWindowsShellArg).join(" ")`, `args: []`),
   which quotes the command path; rewrite that one line (metachar-escape the
   path, arg-escape the rest, join) rather than swapping the two old lines.

5. Preserve the scheduled-task adapter in `contracts/src/scheduledTask.ts`:
   task reads retain opaque schedule data and unknown server fields; writes still
   validate interval/fixed schedules and keep additional task/schedule fields.
   This lets the extension display newer schedules safely and retain fields
   that its form does not edit. `ScheduledTaskUpsertSchedule` leaves out the
   upstream `webhook` member: the sidebar form writes only interval and
   fixed_time, and `src/shared/scheduledTasks.ts` narrows to that union.
   `src/host/scheduledTasks.test.ts` verifies this boundary. The separate T3
   Code application is not changed.

6. Give each `vendor/source-control-<host>` a reduced `package.json`: the
   upstream name, `private`, `type: module`, only the `./client/definition`
   export, and dependencies `@t3tools/contracts`, `@t3tools/shared`,
   `@t3tools/source-control-core` (where upstream lists it) and `effect`.
   `client-runtime/src/operations/projects.ts` (the host uses it) imports
   `sourceControlClients.ts`, which imports these seven definitions; each
   definition imports only contracts, shared, effect and source-control-core.
   Drop `@pierre/diffs` from client-runtime's dependencies (only the excluded
   `reviewGuideTour.ts` uses it).

7. Set the root `effect` dependency, the `effect` entry of every vendored
   package.json and the `overrides` entry in `pnpm-workspace.yaml` to the
   upstream catalog version (4.0.4 at this pin). If upstream carries a
   `patches/effect@<version>.patch` again, copy it to `patches/` and list it
   under `patchedDependencies`. None at this pin: Effect 4.0.4 ships the
   ping-timeout hook that `client-runtime/src/rpc/session.ts` sets, as the
   `onPingTimeout` option of `RpcClient.makeProtocolSocket` (with 4.0.2 it was
   a `ConnectionHooks` field added by T3's patch, removed in the 3145 sync).
   After `pnpm install`, check that every `node_modules/effect` link resolves
   to the same `effect@<version>` store entry.

Update the provenance block at the top of this file, and re-run the
verification greps: no `three` imports outside `client-runtime/src/device/`,
no imports of `./testing` / `@t3tools/shared/testing` outside test files.

## Known caveats

- `vendor/shared/package.json` still exports `./testing/longTempDir` and
  `./testing/symlinks`, and `vendor/client-runtime/package.json` still exports
  `./review-guide-tour`; those entries are left intact from upstream but point
  at files that are excluded here. Nothing in the vendored tree imports them.
- Effect 4.0 moved its modules out of `unstable`: the host imports
  `effect/http` and `effect/socket/Socket` (src/host/pairing.ts,
  serverDiscovery.ts, t3Client.ts, scripts/spike.ts).
