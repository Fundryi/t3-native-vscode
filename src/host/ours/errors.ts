/**
 * R8 errors, host side: "Show Logs" on a turn error writes the error into the fork log, then opens it, so the log
 * the user lands in shows the failure next to the connection lines around it.
 */
import * as vscode from "vscode";
import { log } from "./log.js";
import { registerOursRpc } from "./rpc.js";
import type { OursDeps } from "./types.js";

export function activateErrors(_deps: OursDeps): vscode.Disposable {
  const off = registerOursRpc("errors.showLogs", (params) => {
    // The webview is a trust boundary: only a bounded string is logged.
    if (typeof params.text === "string" && params.text.trim()) log.error(`Turn error: ${params.text.slice(0, 5000)}`);
    return vscode.commands.executeCommand("t3-vscode.ours.log.show");
  });
  return { dispose: off };
}
