/**
 * P6 goal, host side (docs/ours/FORK-FEATURES.md P6). Requests from src/webview/ours/goal.ts:
 * - goal: the /goal of the view's chat as T3 web shows it (presentProviderGoal), plus working; null without a goal.
 * - goal.run { command: "resume" | "clear", draftInUse }: sends "/goal resume" or "/goal clear" through his
 *   sendMessage, as T3 web's goal row does (ChatView.tsx sendStandaloneCommand). Refused while the chat works: T3 would
 *   queue the command behind the run (Orchestrator.ts isGoalCommand never steers).
 */
import * as vscode from "vscode";
import type { OrchestrationV2ShellSnapshot } from "@t3tools/contracts";
import { presentProviderGoal } from "@t3tools/client-runtime/state/thread-execution";
import { log } from "./log.js";
import { registerOursRpc } from "./rpc.js";
import { Declined } from "./wrap.js";
import type { OursDeps } from "./types.js";

export function activateGoal({ hostState }: OursDeps): vscode.Disposable {
  let warned = false;
  const current = (viewId: string) => {
    // shortcut: reads his private HostState.shell by name, as emptyList.ts does; an upstream rename hides the bar and
    // logs once. Swap for a public getter (or goal in his ThreadSummary mapping) if the lead approves one.
    const host = hostState as unknown as { shell?: OrchestrationV2ShellSnapshot | null };
    if (!("shell" in host)) {
      if (!warned) { warned = true; log.error("Goal bar: HostState.shell is gone; the bar stays hidden."); }
      return null;
    }
    const state = hostState.snapshot(viewId);
    const row = state.activeThreadId ? host.shell?.threads.find((thread) => thread.id === state.activeThreadId) : undefined;
    // Servers without goals omit the field; a cleared goal is null.
    if (!row?.goal) return null;
    const working = !!row.activeRunId || state.sending;
    return { threadId: row.id, archived: row.archivedAt !== null, working, ...presentProviderGoal(row.goal, working) };
  };

  const offs = [
    registerOursRpc("goal", (_params, viewId) => {
      const goal = current(viewId);
      return goal && { threadId: goal.threadId, title: goal.title, objective: goal.objective, usage: goal.usage, canResume: goal.canResume, actions: !goal.working && !goal.archived };
    }),
    registerOursRpc("goal.run", async (params, viewId) => {
      const command = params.command;
      if (command !== "resume" && command !== "clear") throw new Error("Unknown goal command.");
      try {
        const goal = current(viewId);
        if (!goal) return;
        if (goal.working) { void vscode.window.showWarningMessage("The chat is working on its goal. Stop it first, then Resume or Clear."); return; }
        if (params.draftInUse === true) {
          void vscode.window.showWarningMessage(`Send or clear the text in the composer first: sending /goal ${command} clears the composer.`);
          return;
        }
        await hostState.sendMessage(`/goal ${command}`, goal.threadId, viewId);
      } catch (cause) {
        // C3 one-writer: the user said no to sending; nothing failed.
        if (cause instanceof Declined) return;
        void vscode.window.showErrorMessage(`T3 VSCode could not ${command} the goal: ${cause instanceof Error ? cause.message : String(cause)}`);
        throw cause;
      }
    }),
  ];
  return { dispose: () => { for (const off of offs) off(); } };
}
