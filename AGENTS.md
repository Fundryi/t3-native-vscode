# t3-native-vscode

The owner's fork of busFred/t3-vscode: a native VS Code client (React chat in webviews, no T3 web page) for a running T3 Code server, with our own features on top. Origin https://github.com/Fundryi/t3-native-vscode, upstream https://github.com/busFred/t3-vscode. The old embedded-web-page extension (D:\GIT\t3-vscode, Marketplace-less, never pushed as a release) is archived; its design docs are under docs/ours/.

Read docs/STATUS.md first: what is done, what is in flight, what waits on the owner. Decisions are in docs/ours/HANDOFF.md section 1.2 (decision 17 is the fork itself). The port order is docs/ours/SWITCH.md section 4.

## Hard rules (owner)

- **Never modify T3 Code.** The owner runs T3 nightly and will not run a fork or a patched build. Use only what an unmodified nightly offers.
- **`reference/` is read-only.** Shallow clones of T3 Code (newest nightly tag) and of the original author's repo, for reading. Gitignored, refreshed by the workspace task "References: keep up to date" or `node scripts/references.mjs --yes`. Never edit, build or install inside it.
- **Upstream stays mergeable.** Our features live in their own files (prefer src/host/ours/ and src/webview/ours/, or a clearly named module); touch his files only where a feature must hook in, in the smallest way. Merge his releases with `git merge upstream/main`, never a rebase of pushed history, and log every merge in docs/UPSTREAM.md (what broke, what was done).
- **Never push** unless the owner says so for that push. Commit author `19733372+Fundryi@users.noreply.github.com`. No private data in commits (real names, private paths, tokens). The company privacy guard is not installed here (owner decision 2026-10-13).
- **Windows first.** The owner's machine is Windows 11; the original author verified Linux first. A Windows failure of a build step or a test is ours to fix, in the smallest way, and noted in docs/STATUS.md.
- **Keep it small.** Smallest working slice first, then extend. No abstraction nobody asked for.
- **ASCII only** in repo text we write; no em dashes, no curly quotes. Replies to the owner in the ELI5 style.

## Agents on this project

| Role | Who | Does |
|---|---|---|
| Lead | Claude (Fable) in VS Code | Owns the plan, writes docs/, makes the final call, merges |
| Builders | Claude Opus subagents, one per item, in git worktrees | Build one port item each; the lead reviews and merges |
| Second opinion | Codex (`astra`) | Not a gate. Adversarial or advisory questions only (a security boundary, a T3 assumption, a design fork) |

- Fully autonomous: no permission prompts (.claude/settings.local.json sets bypassPermissions). Questions to the owner only for real decisions.
- The original author's rules below still apply where they do not clash with the owner's: his regression-review agent before a VSIX is optional here (Codex is not a gate); packaging a VSIX and installing it into the owner's VS Code is the owner's standing order, not a separate authorization; his test isolation rules stay.

## Where things are

- `docs/STATUS.md`: the progress file. `docs/UPSTREAM.md`: the merge log. `docs/ours/`: the old repo's design docs (HANDOFF decisions, SWITCH plan, FEATURES, PIECE2 for the MCP bridge, APPROVE, QOL, BACKLOG ideas, KICKOFF section 6 for day one).
- His docs: `docs/user-guide.md`, `docs/t3-vscode-architecture.md`, `docs/development.md` (build, verify scripts with an isolated T3 home), `docs/publishing.md`, `docs/feature-history.md`, `CHANGELOG.md`.
- `references.json` + `scripts/references.mjs`: the reference clones and their updater; `t3-facts.json`: the T3 surfaces this fork relies on (empty at the start; grows with the vendored packages).
- Machine-specific notes live in `CLAUDE.local.md`, not committed.

---

# Original author's rules (busFred), kept as merged from upstream

# T3 VSCode development

- Keep [docs/feature-history.md](docs/feature-history.md) current whenever a feature is introduced, changed or removed. Maintain its linked overview table and add concise versioned entries under the affected feature; verify historical release versions from Git rather than guessing.
- Before creating any VSIX, launch a separate regression-review agent with fresh context (`fork_turns: "none"`). Give it the repository, comparison revision, scope and existing feature requirements; ask it to check for accidental regressions independently.
- Resolve blocking review findings, run relevant verification, and obtain the agent's review of the final changes before packaging. Record the review and validation outcome in the release notes or feature history.
- Build installers under `target-installer/`; packaging does not authorize installation into the user's normal VS Code profile.
- Build VSIX installers for completed implementation work. Publish only when the owner explicitly authorizes the specific version and channel; packaging is not authorization. Keep the manifest version unchanged until the owner explicitly requests a version change.
- Keep implementation changes in this extension repository; do not modify the T3 Code application.
- All native VS Code tests must isolate user data, extensions and shared data. All T3 verification must use an explicitly isolated home; never mutate the user's normal T3 state or VS Code extension catalogs.
- Use an inexpensive advertised model for live provider tests, currently GPT-6 Luna with low effort. Test scripts accept `T3_VSCODE_TEST_MODEL` for an explicit alternative and must fail rather than silently falling back to a premium model; deterministic fixtures do not call a model.

## Response style

Follow the below guidelines when responding in chat:
* Be direct and concise.
* Prefer bullets over paragraphs.
* Use tables when they improve clarity or comparison.
* Keep unavoidable paragraphs brief.
* Do not restate the request or add unnecessary background.
* Include only information needed to act or decide.
* Optimize for low cognitive load and minimal context-window usage.
