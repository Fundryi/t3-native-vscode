# Status

The progress file of this fork. Read it first after a restart, a compaction or a new chat. Updated before and after every run. Older history of our features lives in docs/ours/ (the old repo's design docs) and in the old repo D:\GIT\t3-vscode (archived, never built on again).

## Resume notes (2026-10-14, day one of the fork)

- What this is: the owner's fork of busFred/t3-vscode (native React chat for a running T3 Code server), origin https://github.com/Fundryi/t3-native-vscode, upstream https://github.com/busFred/t3-vscode (tag fork-start = upstream 900a3d7, his 0.1.21). Decision 17 in docs/ours/HANDOFF.md: no T3 web page in VS Code any more; our features go on top of his code in separate modules; his releases get merged (docs/UPSTREAM.md logs each merge).
- Owner's standing orders carry over: fully autonomous, no permission prompts (.claude/settings.local.json), Opus builders in worktrees, never Fable as a subagent, never modify T3 Code, reference/ read-only, never push unless the owner says so for that push, commit author 19733372+Fundryi@users.noreply.github.com, ASCII only in repo text, no em dashes, ELI5 replies. His AGENTS.md rules stay where the owner's rules do not override them (see AGENTS.md top section).
- Port order (docs/ours/SWITCH.md section 4 and docs/ours/KICKOFF.md section 6): Windows build and pairing first, the vendored T3 pin against the owner's nightly, then the MCP context bridge, approvals as notifications, status bar running state, the prompt helpers (Add to prompt, Alt+K, terminal selection, last command, TODO lens, Fix with T3, Review changes), t3.json tasks, Open in desktop, deep links, save on send, then drag and drop (Explorer Shift-drag, images, the Hold Shift hint, a native Drop files here view).

## Now

- Day one in progress: clone done, upstream added, our docs under docs/ours/, references updater and workspace file carried over. Windows build, tests and the VSIX: see the Log.

## Log

### 2026-10-14, day one

- Cloned the owner's fork to D:\GIT\t3-native-vscode, remote upstream = busFred, tag fork-start at 900a3d7. Node 24.18, pnpm 12.11.
- Carried over from the old repo: docs (HANDOFF, SWITCH, FEATURES, PIECE2, APPROVE, QOL, BACKLOG, KICKOFF, DRIFT) under docs/ours/, the old facts file as docs/ours/t3-facts-old.json (its paths name the T3 web UI surfaces the old injected script relied on; the fork needs its own facts for the vendored packages), scripts/references.mjs with references.json (t3code nightly, busFred original) so reference/ keeps the original author's repo and the T3 source read-only, CLAUDE.md stub, CLAUDE.local.md, .claude/settings.local.json, the workspace file.
- Windows build: pnpm install and pnpm run build pass (dist/extension.mjs, webview.js, mermaid.js, KaTeX). pnpm test: 249 of 256 pass; the 6 failures are Windows-only test assumptions, not product code: symlink EPERM in prepare-vscode-profile and workspace symlink tests (Windows needs Developer Mode or admin for symlinks), and fileLinks tests that expect /tmp/workspace paths where path.resolve gives D:\tmp\workspace; the manual-edits snapshot test fails on the same symlink. Left as they are for now; listed for a later Windows pass. pnpm run package failed: scripts/generate-notices.mjs spawned pnpm without a shell (ENOENT on Windows); fixed with shell on win32. Packaged target-installer/t3-vscode-0.1.21.vsix (45 files, 3.09 MB), uninstalled fundryi.t3-vscode, installed the VSIX: hungtienhuang.t3-vscode@0.1.21 is now the only T3 extension in the owner's VS Code. Not verified yet: pairing and a first thread on Windows (the owner reloads the window; his extension pairs itself through the t3 CLI).
- Open: the extension still carries his publisher and name (hungtienhuang.t3-vscode), so a Marketplace update of his would replace ours; rename to our own id before the first real feature.
