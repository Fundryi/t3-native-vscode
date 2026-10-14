/**
 * The fork's entry, called once from his activate (src/extension.ts) before `await hostState.start()`.
 * Features are listed in ./features.ts, one re-export line each (replace your own slot line).
 *
 * Rules for every feature (docs/ours/PORT-MAP.md section 0):
 * - Synchronous activate: set hooks and wrappers before returning (his state listener fires at once).
 * - Change his behavior only through wrap() (./wrap.ts) on a public member of a deps instance, never in his files.
 *   wrap() already falls back to his original when our replacement throws or rejects.
 * - Every listener of ours (onDidChangeState and the like) catches ALL errors, logs them (./log.ts) and lets his code
 *   go on: his emit loop has no guard and runs inside his connect.
 * - Command ids are `t3-vscode.ours.<feature>.<verb>`, registered with a DOUBLE-QUOTED LITERAL:
 *   vscode.commands.registerCommand("t3-vscode.ours.mcp.status", ...). scripts/commands.test.mjs scans
 *   src/extension.ts and src/host/ours/** for that exact form; a const or template string fails it.
 * - Webview requests go through registerOursRpc (./rpc.ts); events to a webview through
 *   registry.postWhenReady(viewId, OURS_EVENT, { kind, ... }) (src/shared/ours/channel.ts).
 * - package.json: insert FIRST, right after the opening [ or {, each entry with its own trailing comma; never edit,
 *   reorder or reformat his entries (map 0.9). Configuration: one section per feature,
 *   { "title": "Fork: <Feature>", "order": 10 or higher, "properties": { "t3-vscode.ours.<feature>.<name>": ... } }.
 *   Settings use scope "window". Menu group "t3ours". The new menu keys (explorer/context, editor/title,
 *   editor/title/context, terminal/context, scm/title, view/item/context) already exist; fill them, never add a key.
 * - Docs for a feature go to docs/ours/FORK-FEATURES.md; each T3 fact it relies on goes to t3-facts.json.
 */
import * as vscode from "vscode";
import * as features from "./features.js";
import { log, setLogChannel } from "./log.js";
import { activateTerminalRuns } from "./terminalRuns.js";
import type { OursDeps, OursFeature } from "./types.js";

export function activateOurs(context: vscode.ExtensionContext, deps: Omit<OursDeps, "context">): vscode.Disposable {
  const channel = vscode.window.createOutputChannel("T3 VSCode (fork)", { log: true });
  setLogChannel(channel);
  // Keybindings that override his or VS Code's (the Explorer Ctrl+C) stay off until our code runs.
  void vscode.commands.executeCommand("setContext", "t3-vscode.ours.active", true);
  // terminalRuns is shared plumbing (A and D read it), so it is always on.
  const all: Readonly<Record<string, OursFeature>> = { terminalRuns: activateTerminalRuns, ...features };
  const ours: OursDeps = { context, ...deps };
  const disposables: vscode.Disposable[] = [];
  for (const [name, activate] of Object.entries(all)) {
    // One broken feature never breaks his activation or the other features.
    try { disposables.push(activate(ours)); }
    catch (cause) { log.error(`Fork feature ${name} failed to activate:`, cause); }
  }
  // The channel goes last, so a feature can still log while it is disposed.
  return vscode.Disposable.from(...disposables, { dispose: () => { setLogChannel(undefined); channel.dispose(); } });
}
