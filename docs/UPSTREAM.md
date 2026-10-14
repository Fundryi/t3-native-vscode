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
