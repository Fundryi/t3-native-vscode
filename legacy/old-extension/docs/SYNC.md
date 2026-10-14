# Sync contract: what VS Code and T3 must agree on

Written 2026-10-12 after the owner's words: "the communication between our extension and T3 has to be flawless; T3 understands exactly what we are doing in VS Code." This is the one list of every piece of state the two sides share, the direction, how we get it from an unmodified T3, and where it stands. Build order is the priority column. `docs/FEATURES.md` is the long checklist against the Claude Code and Codex extensions; this file is the contract behind it.

Rule for every row: VS Code is the place the owner works in. T3 keeps running on the PC with all its features. The extension steers T3 through what T3 already exposes (web UI in the panel, pairing bearer, HTTP API, WS RPC, the injected script); T3 itself never changes. When the owner acts inside T3's UI, that action wins until VS Code changes the same state again.

## VS Code to T3 (T3 and its agents know what the owner is doing)

| # | State | How, with an unmodified T3 | Stands | Priority |
|---|---|---|---|---|
| 1 | **The open folder.** The panel shows T3 on the project whose folder is the window's workspace folder (first folder of a multi-root workspace). A new thread starts in that folder. No project yet: the extension creates it. The window's folder changes: the panel follows. | Research in `docs/PROJECT.md`: T3's project model, the route for "new thread in project X", the create call (HTTP or WS RPC with the pairing bearer), or a storage key the script can seed. | Decision 12, in research | **1** |
| 2 | **Which window.** Several VS Code windows: each panel follows its own window; agents asking VS Code get the window whose folder contains their cwd, else the last focused one with a note. | Built: per-window discovery files, bridge selection (decision 10). | built | done |
| 3 | **Active file, cursor, selection.** Agents can ask. | Built: MCP tools `workspace`, `activeFile` (Piece 2 slice 0). | built, not yet registered in CC Switch | 2 (owner registers) |
| 4 | **Selection into the prompt.** Like Claude Code's "current selection" chip: the owner's selection is attached to what they type in T3. | Later: the injected script inserts a file mention into T3's composer (T3 has @file mentions), or an MCP tool the agent calls first. Needs decision: automatic chip or on request. | not built | 5 |
| 5 | **Problems, open tabs, git state** (branch, changed files, staged). | Piece 2 slice 1: MCP tools `diagnostics`, `openTabs`, `gitState` over the VS Code API. | built 2026-10-12 (`docs/PIECE2.md`), not yet in a real window | done |
| 6 | **Terminals in VS Code** (what the owner ran, the last error). | Piece 2 later: a `terminalOutput` tool if VS Code exposes it (shell integration API). | built 2026-10-12 (terminalOutput, finished commands only) | done |
| 7 | **Source control state and worktrees.** T3 threads may run in worktrees; VS Code shows one folder. | Row 1 covers the main folder. Worktree threads: the panel shows them as T3 does; file clicks from a worktree thread resolve against the thread root (needs row 1's project knowledge). | partly (absolute paths only) | 4 |
| 8 | **Editor choice.** Files always open in VS Code when clicked in the panel. | Built: injected script plus `openFile` (decision 1). T3's own "Open in editor" (Ctrl+click, menus) stays T3's and follows T3's own picker. | built, owner test open | done |
| 9 | **Installed extensions, settings.** Agents may ask what tools VS Code has. | Piece 2 later: an `extensions` tool. Low value until an agent needs it. | built 2026-10-12 (extensions tool) | done |
## T3 to VS Code (VS Code shows what T3 does)

| # | State | How, with an unmodified T3 | Stands | Priority |
|---|---|---|---|---|
| 10 | **File links.** A plain click on a file in a reply opens it in VS Code at the line and reveals it in the Explorer. | Built: injected script, panel gate, `openFile` with path validation. Relative paths (mentions, diff titles) wait for row 1 (thread root). | built, owner test open | done |
| 11 | **Files the agent changed.** VS Code shows the new content and the SCM view shows the change. | Free: T3 edits the files on disk; VS Code reloads them. | works | done |
| 12 | **Diffs.** "Show this change in VS Code's diff view" for a file a thread changed. | Piece 2 slice 2 action tool, or a click target in the panel's diff header (relative path, needs row 1). | built 2026-10-13: Alt+click a diff title in the panel (c14d033) and the showDiff MCP tool (B22) | done |
| 13 | **Thread status.** Running, waiting for approval, done, failed: in the status bar and as a notification when the panel is hidden. | Polls `GET /api/orchestration/shell` with the pairing bearer, never `/mcp`. No push feed exists. | built: cf14a81 (status bar, badge, notifications), 06bc1bb (finished notification, `t3vscode.notify`) | 4 |
| 14 | **Approvals.** Agent asks "may I run this": the owner answers in T3's UI inside the panel. | Free: T3's UI. A status bar badge when one waits comes with row 13. | works | done |
| 15 | **Threads from the phone.** A thread started on the phone shows in the panel. | Free: the panel is T3's UI on the same server. | works, owner tested | done |
| 16 | **Session.** Paired once, renews itself, other windows follow a Forget. | Built: decisions 8 and 9, cross-window secret watch. | built, owner tested | done |
| 17 | **T3 not running.** The panel says so and offers Start T3. | Built: decision 4. | built | done |

## Rules that keep it flawless

- **One source of truth per row.** The folder comes from VS Code (row 1). The thread list and status come from T3 (rows 13, 15). The session comes from the secret store (row 16). No row is guessed from the UI.
- **Follow, do not fight.** The panel sets T3's project when the panel opens and when the window's folder changes. If the owner then picks another project inside T3, the panel leaves it until the next VS Code change.
- **No agent round trips for routing.** Window choice (row 2), folder (row 1) and file opening (row 10) are decided by the extension, never by the agent.
- **Every T3 surface a row uses gets a fact in `t3-facts.json`** in the same commit (AGENTS.md rule), so a nightly change shows up in `docs/T3-UPDATES.md`.
- **Real check per row.** A row is "built" after the offline check and "done" after the owner saw it work once.

## Open

- Open: row 4, selection into the prompt: automatic (every message carries the selection, like Claude Code) or only on a command (`T3: Send selection`). Lead: on a command first; automatic later if the owner wants it.
- Open: row 1, multi-root workspaces: first folder, or one project per folder with a picker in the panel. Lead: first folder.
