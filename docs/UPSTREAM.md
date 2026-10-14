# Upstream merges

One entry per merge of https://github.com/busFred/t3-vscode (remote `upstream`) into this fork. Newest last.

Routine: `git fetch upstream`, `git merge upstream/main` (never a rebase of published history), `pnpm install --frozen-lockfile`, `pnpm run build`, `pnpm run typecheck`, `pnpm test`, then our own checks, then the live list in docs/STATUS.md. Write here what broke and what was done, then commit.

## fork-start, 2026-10-14

- Base: upstream 900a3d7 (his 0.1.21). No merge yet; this is where the fork starts.
