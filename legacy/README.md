# Legacy: the old extension (archived 2026-10-14)

`old-extension/` is the source of the retired extension from D:\GIT\t3-vscode (GitHub Fundryi/t3-vscode, archived), copied here at its last commit so the port does not depend on the old repo. It embedded T3's own web page in a webview and poked it from an injected script. Owner decision 17 (docs/ours/HANDOFF.md) ended that road.

What is worth porting from it, and where it lives:

- `context.js`, `mcp.js`, `bridge.js`: the MCP context bridge (workspace, active file, open tabs, diagnostics, git state, terminal output; open file, reveal, show diff). Standalone, no UI. Design: docs/ours/PIECE2.md.
- `extension.js`: approvals as notifications (Approve, Deny, Show; design docs/ours/APPROVE.md), the status bar running state and badge, Add to prompt (Explorer, selection, terminal selection, last command), TODO lens, Fix with T3, Review changes, t3.json tasks, Open in desktop, deep links, save on send, the Hold Shift hint, image attachments from VS Code paths. Each one is marked with its BACKLOG or QOL id in a comment.
- `t3.js` and `panel.js`: the T3-page glue (injected script, panel page). Not portable; read only for the T3 server facts (routes, scopes, the WebSocket approval command) and the drag and drop findings (docs/ours/QOL.md item 1).
- `scripts/`: the old self-checks and the live check harness (a real isolated VS Code via --extensionTestsPath). The harness idea is worth keeping; the checks themselves test the old code.
- `t3-facts.json`: the T3 web UI surfaces the old script relied on. The fork needs its own facts (vendored packages).
- `docs/`: the old repo's remaining docs (STATUS with the full history, NAV, INJECT, PROJECT, SYNC, PLAN, the Codex review).

Nothing in here runs or is built. Do not edit it; port from it.
