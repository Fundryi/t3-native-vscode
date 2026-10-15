/** P18 help (docs/ours/FORK-FEATURES.md): one pick for docs, keys, settings, logs and setup. */
import * as vscode from "vscode";
import { toastWithLogs } from "./logs.js";
import type { OursDeps } from "./types.js";

const REPO = "https://github.com/Fundryi/t3-native-vscode";

export function activateHelp({ context }: OursDeps): vscode.Disposable {
  const run = (command: string, ...args: unknown[]) => () => vscode.commands.executeCommand(command, ...args);
  const open = (url: string) => () => vscode.env.openExternal(vscode.Uri.parse(url));
  const rows: (vscode.QuickPickItem & { go: () => Thenable<unknown> })[] = [
    { label: "$(book) Fork features", detail: "What this fork adds, with a live test for each", go: open(`${REPO}/blob/main/docs/ours/FORK-FEATURES.md`) },
    { label: "$(keyboard) Keyboard Shortcuts", go: run("workbench.action.openGlobalKeybindings", "t3-vscode") },
    { label: "$(settings-gear) All Settings", detail: "Font sizes and every T3 VSCode option", go: run("workbench.action.openSettings", `@ext:${context.extension.id}`) },
    { label: "$(output) Show Logs", go: run("t3-vscode.ours.log.show") },
    { label: "$(plug) Let Agents See VS Code", detail: "Set up the VS Code context server for Claude Code or Codex", go: run("t3-vscode.ours.mcp.setup") },
    { label: "$(globe) Open Web UI", go: run("t3-vscode.openWebUi") },
    { label: "$(bug) Report an Issue", go: open(`${REPO}/issues`) },
  ];
  return vscode.commands.registerCommand("t3-vscode.ours.help.show", async () => {
    const pick = await vscode.window.showQuickPick(rows, { title: "T3 VSCode: Help and Settings", matchOnDetail: true });
    try { await pick?.go(); }
    catch (cause) { toastWithLogs("error", `Help: "${pick?.label.replace(/^\$\([^)]*\) /, "")}" failed.`, cause); }
  });
}
