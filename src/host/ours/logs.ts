/**
 * Q7 statusbar2 (docs/ours/FORK-FEATURES.md): "Show Logs" opens the fork's output channel, every connection phase
 * change is logged there, and ours error toasts carry a "Show Logs" button (toastWithLogs).
 */
import * as vscode from "vscode";
import { log } from "./log.js";
import type { OursDeps } from "./types.js";

/** Logs the message (and the cause's stack), then shows it with a "Show Logs" button. Never awaited: a toast resolves only when dismissed. */
export function toastWithLogs(level: "error" | "warning", message: string, cause?: unknown): void {
  log.error(message, cause);
  const shown = level === "error" ? vscode.window.showErrorMessage(message, "Show Logs") : vscode.window.showWarningMessage(message, "Show Logs");
  void shown.then((pick) => { if (pick) log.show(); });
}

export function activateLogs({ hostState }: OursDeps): vscode.Disposable {
  const command = vscode.commands.registerCommand("t3-vscode.ours.log.show", () => log.show());
  let last = "", server = "";
  // His state emits on every transcript update; log only when the phase, notice or problem kind changes.
  const unlisten = hostState.onDidChangeState((state) => {
    try {
      // P17 logs: once per T3 server (environment) or version change, so the log names both sides that talked.
      const env = state.environment;
      const serverLine = env ? `T3 server ${env.serverVersion ?? "(version unknown)"} (environment ${env.environmentId})` : "";
      if (serverLine && serverLine !== server) { server = serverLine; log.info(serverLine); }
      const kind = state.connectionSetup?.problem?.kind;
      const line = `T3 connection: ${state.phase}${kind ? ` (${kind})` : ""}${state.notice ? `: ${state.notice}` : ""}`;
      if (line === last) return;
      last = line;
      if (state.phase === "error" || state.phase === "no-server") log.error(line); else log.info(line);
    } catch (cause) { log.error("Fork connection log failed.", cause); }
  });
  return vscode.Disposable.from(command, { dispose: unlisten });
}
