/**
 * How agents get the context server (decision 16): a setup page with the CC Switch entry, Add buttons that TYPE the
 * harness CLI line into a terminal (never run it), a read-only check which harness has it, a one-time nudge, and
 * VS Code's own MCP list. Ported from legacy context.js.
 */
import * as vscode from "vscode";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { log } from "../log.js";
import type { OursDeps } from "../types.js";
import { BRIDGE, folders, isRemote, key, slash } from "./discovery.js";

const NUDGE_OFF = "t3-vscode.ours.mcp.nudgeOff";
const bridgePath = slash(BRIDGE);
const entry = JSON.stringify({ mcpServers: { vscode: { command: "node", args: [bridgePath] } } }, null, 2);
const ADD = {
  "Add to Claude Code": `claude mcp add --scope user vscode -- node "${bridgePath}"`,
  "Add to Codex": `codex mcp add vscode -- node "${bridgePath}"`,
} as const;
type AddButton = keyof typeof ADD;

/** Typed into a new terminal, never run: the owner presses Enter. */
function type(line: string): void {
  const terminal = vscode.window.createTerminal({ name: "T3" });
  terminal.show(false);
  terminal.sendText(line, false);
}

// Ours when the LAST arg is our bridge (CC Switch on this PC writes "cmd /c node <bridge>", the add lines "node <bridge>").
const ours = (args: unknown) => Array.isArray(args) && typeof args.at(-1) === "string" && key(args.at(-1) as string) === key(BRIDGE);
const readJson = (file: string): Record<string, unknown> => { try { return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>; } catch { return {}; } };
const hasOurs = (servers: unknown) => !!servers && typeof servers === "object" && Object.values(servers).some((server: unknown) => ours((server as { args?: unknown } | null)?.args));
// shortcut: a regex over [mcp_servers.<name>] blocks, not a TOML parser (no dependency); an inline table or a dotted mcp_servers.x.args key is missed, use a parser if one shows up.
function codexHas(text: string): boolean {
  return text.split(/^\s*\[/m).some((block) => {
    if (!/^mcp_servers\.(?:[\w-]+|"[^"]*"|'[^']*')\s*\]/.test(block)) return false;
    const match = /^\s*args\s*=\s*\[([\s\S]*?)\]/m.exec(block);
    const strings = match?.[1] ? [...match[1].matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'/g)].map((x) => {
      if (x[2] !== undefined) return x[2];
      try { return JSON.parse(`"${x[1]}"`) as string; } catch { return x[1]; }
    }) : [];
    return ours(strings);
  });
}

/** Read only; CC Switch keeps its own list and writes the live entries into these same files. */
function harnesses(): Record<"Claude Code" | "Codex", string | null> {
  const claudeJson = readJson(join(homedir(), ".claude.json"));
  const projects = claudeJson.projects && typeof claudeJson.projects === "object" ? Object.entries(claudeJson.projects) : [];
  const local = projects.some(([path, project]) => folders().some((f) => key(f.uri.fsPath) === key(path)) && hasOurs((project as { mcpServers?: unknown } | null)?.mcpServers));
  const project = folders().some((f) => hasOurs(readJson(join(f.uri.fsPath, ".mcp.json")).mcpServers));
  const claude = hasOurs(claudeJson.mcpServers) ? "user scope" : local ? "local scope" : project ? "project scope, .mcp.json" : null;
  let codex: string | null = null;
  try { if (codexHas(readFileSync(join(process.env.CODEX_HOME || join(homedir(), ".codex"), "config.toml"), "utf8"))) codex = "user scope"; } catch { /* no config */ }
  return { "Claude Code": claude, Codex: codex };
}

async function showSetup(): Promise<void> {
  const found = harnesses();
  const lines = Object.entries(found).map(([harness, scope]) => `${harness}: ${scope ? `registered (${scope})` : "not registered"}`);
  const missing = (Object.keys(ADD) as AddButton[]).filter((button) => !found[button.slice("Add to ".length) as keyof typeof found]);
  const content = [
    "# T3 VSCode: VS Code context server setup",
    "",
    ...lines.map((line) => `- ${line}`),
    "",
    "Three ways to give your agents this server. Use one per harness:",
    "",
    "1. CC Switch: import the Claude Code form below at user scope. The button \"Copy CC Switch entry\" puts it on the clipboard.",
    "2. The buttons in the notification that opened with this page (\"Add to Claude Code\", \"Add to Codex\", shown only for a harness not registered; also the commands \"T3 VSCode: Add the VS Code Context Server to ...\"):",
    "   each opens a VS Code terminal named T3 with the add line below typed in. Press Enter to run it.",
    "3. VS Code's own MCP list: agents inside VS Code (Copilot Chat) get \"T3 VS Code context\" from this extension;",
    "   it appears in MCP: List Servers without a config file (VS Code 1.101 or newer).",
    "",
    "## Claude Code (the form CC Switch imports)",
    "",
    "```json",
    entry,
    "```",
    "",
    "## Codex (~/.codex/config.toml)",
    "",
    "```toml",
    "[mcp_servers.vscode]",
    "command = \"node\"",
    `args = ["${bridgePath}"]`,
    "```",
    "",
    "## The add lines the buttons type",
    "",
    "```",
    ...Object.values(ADD),
    "```",
    "",
  ].join("\n");
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ language: "markdown", content }));
  // Not awaited: the message stays until a click or a dismiss, the command returns now.
  vscode.window.showInformationMessage(`${lines.join(". ")}.`, ...missing, "Copy CC Switch entry").then(async (pick) => {
    if (pick === "Add to Claude Code" || pick === "Add to Codex") return type(ADD[pick]);
    if (pick !== "Copy CC Switch entry") return;
    await vscode.env.clipboard.writeText(entry);
    void vscode.window.showInformationMessage("The CC Switch entry is on the clipboard.");
  }).then(undefined, (cause: unknown) => log.error("MCP setup:", cause));
}

/** VS Code 1.101 API, newer than his @types/vscode 1.100 (not bumped): a narrow local shape behind a runtime guard. */
interface McpApi {
  readonly lm?: { registerMcpServerDefinitionProvider?(id: string, provider: { provideMcpServerDefinitions(): unknown[] }): vscode.Disposable };
  readonly McpStdioServerDefinition?: new (label: string, command: string, args: string[]) => { cwd?: vscode.Uri };
}

export function activateSetup(deps: OursDeps): vscode.Disposable {
  const remote = isRemote();
  const disposables: vscode.Disposable[] = [
    vscode.commands.registerCommand("t3-vscode.ours.mcp.setup", showSetup),
    vscode.commands.registerCommand("t3-vscode.ours.mcp.addClaude", () => type(ADD["Add to Claude Code"])),
    vscode.commands.registerCommand("t3-vscode.ours.mcp.addCodex", () => type(ADD["Add to Codex"])),
  ];

  // Once per window after the first ready connection, only when no harness has the server; "Not now" is kept.
  let nudged = false;
  const nudge = async () => {
    if (nudged || remote || deps.context.globalState.get(NUDGE_OFF)) return;
    nudged = true;
    if (Object.values(harnesses()).some(Boolean)) return;
    const pick = await vscode.window.showInformationMessage("Agents in T3 cannot see VS Code yet.", "Set up", "Not now");
    if (pick === "Set up") await showSetup();
    if (pick === "Not now") await deps.context.globalState.update(NUDGE_OFF, true);
  };
  disposables.push(vscode.commands.registerCommand("t3-vscode.ours.mcp.nudge", nudge));
  // His emit loop has no guard and runs inside his connect: this listener never throws.
  let ready = false;
  let unlisten: (() => void) | undefined;
  unlisten = deps.hostState.onDidChangeState((state) => {
    try {
      if (ready || state.phase !== "ready") return;
      ready = true;
      // The first call runs inside onDidChangeState, before unlisten is assigned.
      queueMicrotask(() => unlisten?.());
      nudge().catch((cause: unknown) => log.error("MCP nudge:", cause));
    } catch (cause) { log.error("MCP nudge:", cause); }
  });
  disposables.push({ dispose: () => unlisten?.() });

  // VS Code's own MCP list (Copilot Chat and other agents inside VS Code).
  const api = vscode as unknown as McpApi;
  const Definition = api.McpStdioServerDefinition;
  if (Definition && typeof api.lm?.registerMcpServerDefinitionProvider === "function") {
    disposables.push(api.lm.registerMcpServerDefinitionProvider("t3-vscode.ours.mcp", {
      provideMcpServerDefinitions: () => {
        if (remote) return [];
        const definition = new Definition("T3 VS Code context", "node", [bridgePath]);
        const first = vscode.workspace.workspaceFolders?.[0];
        if (first) definition.cwd = first.uri;
        return [definition];
      },
    }));
  }
  return vscode.Disposable.from(...disposables);
}
