/** F: the thread of the focused chat in the T3 desktop app (docs/ours/PORT-MAP.md section F, legacy R17). */
import * as vscode from "vscode";
import { log } from "./log.js";
import type { OursDeps } from "./types.js";

const NOT_TAKEN = "The T3 app did not take the link. Is T3 Code installed?";

export function activateDesktop({ hostState, registry }: OursDeps): vscode.Disposable {
  return vscode.commands.registerCommand("t3-vscode.ours.desktop.open", async () => {
    let link = "t3code://new";
    try {
      const state = hostState.snapshot(registry.focusedViewId);
      const environmentId = state.environment?.environmentId;
      // The shape T3's promptLinkDeepLink builds and its desktop app routes (packages/shared/src/promptLinks.ts).
      if (environmentId && state.activeThreadId) link = `t3code://threads/${encodeURIComponent(environmentId)}/${encodeURIComponent(state.activeThreadId)}`;
      if (await vscode.env.openExternal(vscode.Uri.parse(link))) return;
      log.info(`Open in the T3 app: no handler took ${link}`);
    } catch (cause) { log.error(`Open in the T3 app failed for ${link}:`, cause); }
    void vscode.window.showWarningMessage(NOT_TAKEN);
  });
}
