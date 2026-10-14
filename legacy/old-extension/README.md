> Archived 2026-10-14. This extension (T3's web page inside VS Code) is retired by owner decision 17. The project continues as a fork of busFred/t3-vscode with our features on top: https://github.com/Fundryi/t3-native-vscode (on disk D:GIT	3-native-vscode). Nothing here is built on any more.

# T3 Code for VS Code

Makes VS Code a client of a running T3 Code server, the same way the T3 desktop app and the phone are clients. T3 keeps running on your PC with all its features (threads, every harness, worktrees, remote access). VS Code shows T3's own chat page in a side panel or an editor tab and connects it to the editor.

T3 Code itself is not changed. The extension uses what an unmodified nightly already offers: the served web UI, pairing, the MCP endpoint and t3.json project scripts.

## What it does

- The panel follows the VS Code folder: it opens the matching T3 project and its last thread. New thread, thread quick pick, and an in-place switch without a reload.
- File links and diff titles in the chat open in VS Code at the line. Alt+click on a diff title opens VS Code's diff.
- Add to prompt from the Explorer, the editor (Alt+K with a selection), a terminal selection or the last terminal command. Drag and drop of files onto the panel. Save on send.
- Approvals as notifications with Approve, Deny and Show when the panel is hidden. Toasts say what happened: the answer's first line, the error, a usage limit with its reset time, a plan to review.
- The status bar shows running threads; the panel icon gets a badge when T3 waits for you.
- Code actions: Fix with T3 on a diagnostic, Review changes from Source Control, a TODO lens.
- An MCP server that gives T3's agents the editor's context: workspace, active file, open tabs, diagnostics, git state, terminal output; and actions: open a file, reveal in the Explorer, show a diff. Registered natively in VS Code and offered for Claude Code and Codex.
- Run in terminal from a code block, t3.json scripts as VS Code tasks, Open in the desktop app, Copy thread link, keys relayed to VS Code from inside the chat, the VS Code theme applied to T3.

## Setup

1. Run T3 Code nightly on this PC.
2. Install the extension, open a folder, open the T3 panel in the activity bar.
3. Pair: the panel shows the steps. The pairing token stays in VS Code's secret storage.

The walkthrough "T3 Code: Get started" in the Welcome page repeats these steps.

## Settings

`t3vscode.openOnStartup`, `t3vscode.notify` (all, needsYou, off), `t3vscode.saveOnSend`, `t3vscode.todoLens`, `t3vscode.followTheme`, `t3vscode.runInTerminal`, `t3vscode.keysToVsCode`.

## Checks

`node scripts/selfcheck.mjs`, `selfcheck-mcp.mjs`, `selfcheck-panel.mjs`, `selfcheck-ext.mjs` (offline), `node scripts/livecheck.mjs` (a real isolated VS Code). The design and the status live in `docs/`.
