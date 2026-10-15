# Upstream merges

One entry per merge of https://github.com/busFred/t3-vscode (remote `upstream`) into this fork. Newest last.

Routine: `git fetch upstream`, `git merge upstream/main` (never a rebase of published history), `pnpm install --frozen-lockfile`, `pnpm run build`, `pnpm run typecheck`, `pnpm test`, then our own checks, then the live list in docs/STATUS.md. Write here what broke and what was done, then commit.

## fork-start, 2026-10-14

- Base: upstream 900a3d7 (his 0.1.21). No merge yet; this is where the fork starts.

## re-vendor to T3 nightly v0.0.46-nightly.20261014.3093, 2026-10-14

Not a merge of his repo: our own re-vendor of the T3 packages (port map item J, docs/ours/VENDOR-DRIFT.md). Why: the nightly's new turn item `secret_request` broke his 0.0.45 decoder for any thread that contains one; the nightly also drops unknown turn item types instead of failing.
- vendor/contracts, shared, client-runtime: src from T3 107f6024ea47, steps in vendor/README.md (adapter subpaths, Windows shell fix, scheduled-task adapter). New: vendor/source-control-* (seven `client/definition.ts` files, needed by client-runtime `operations/projects.ts`), T3's `patches/effect@4.0.2.patch`.
- Effect 4.0.0-rc.115 to 4.0.2 (root package.json, pnpm-workspace.yaml override and patchedDependencies, lockfile).
- His files touched by the bump (import moves only): src/host/pairing.ts, serverDiscovery.ts, t3Client.ts, fileLinks.ts, pairing.test.ts, scripts/spike.ts.
- Merge rule for his future releases: take his vendor/ wholesale, then re-apply this re-vendor if his pin is older than 107f6024ea47.

## re-vendor to T3 nightly v0.0.46-nightly.20261015.3145, 2026-10-15

Our own re-vendor again (docs/ours/VENDOR-DRIFT.md block "Re-vendor 3093 -> 3145"). Why: the fork follows the owner's nightly; the facts effect-version and effect-rpc-ping-timeout-patch had been failing on purpose since Effect moved.
- vendor/contracts, shared, client-runtime and the source-control client definitions: src from T3 339179f50a84, same steps as before (vendor/README.md). New files: client-runtime/src/imageAttachmentSize.ts, state/threadTranscriptHttp.ts, shared/src/threadTranscript.ts; two new package exports.
- Effect 4.0.2 to 4.0.4; T3 dropped its Effect patch (the ping-timeout hook is a makeProtocolSocket option now), so patches/effect@4.0.2.patch is gone and pnpm-workspace.yaml has no patchedDependencies entry for it.
- Contract changes that reach the fork: the new event thread.pull-request-link-updated now decodes and applies (before, the stream skipped it); everything else additive. No change in src/, none of his files touched.
- Merge rule unchanged: take his vendor/ wholesale, then re-apply this re-vendor if his pin is older than 339179f50a84.

## Checklist after every `git merge upstream/main`

Run after the merge, before build and tests (details in docs/ours/PORT-MAP.md section 0.10):

- The wrapped members still exist with the same parameter order: `notifications.update`, `provider.resolveWebviewView`, `provider.openSession`, `provider.createPanel`, `provider.createNewPanel`, `provider.updateTitles`, `provider.insertReference`, `hostState.sendMessage`, `hostState.queueAction` (`action`, `text`), and the members typed in src/host/ours/types.ts.
- `ours: "ours"` is still the first key of Methods in src/shared/bridge.ts and `case "ours"` is still the first case in src/host/bridge.ts handle; `activateOurs` is still called in src/extension.ts; `import "./ours/index"` is still in src/webview/main.tsx.
- package.json: his test glob line still carries the ours globs; our entries still sit first in each array; his Thread Actions view/title entry still has `when: false` (we show one list).
- Chat tab ids still start with `panel_` (extension.ts mountPanel): src/host/ours/keys.ts (`inT3Tab`), layout.ts and composer.ts rely on it.
- `grep registerUriHandler src` finds only ours (G breaks if he adds one).
- scripts/commands.test.mjs still scans src/host/ours.
- Local vendor adapters still applied: vendor/README.md "Local adapters to re-apply after a sync".
- Then: pnpm run typecheck, pnpm test, pnpm run build, scripts/verify-ui.mjs, scripts/verify-views.ts, scripts/verify-drag.mjs.
