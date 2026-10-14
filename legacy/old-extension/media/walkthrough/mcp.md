# Register the VS Code context server

The context server lets your agents in T3 see what VS Code sees: open editors, the selection, problems, terminal output.

1. Run **T3: Show MCP setup**. It opens the exact settings for this computer.
2. Register it once for each agent harness you use:
   - with CC Switch, import the Claude Code form at user scope ("Copy CC Switch entry" puts it on the clipboard), or
   - with the buttons "Add to Claude Code" or "Add to Codex" in the notification that opens with the setup page: each types the add line into a terminal named T3, you press Enter.
3. Agents inside VS Code (Copilot Chat) get the server from VS Code's own MCP list; it appears in MCP: List Servers without a config file.

It reads, and opens files or diffs when an agent asks. It answers while this VS Code window is open.
