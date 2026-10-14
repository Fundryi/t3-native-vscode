/**
 * Q20 contextMeter, host side. Requests from the webview (src/webview/ours/contextMeter.ts):
 * - contextUsage: how full the context of the view's chat is (null when unknown or switched off).
 * - planImplement { key }: switch the chat to default mode and send "PLEASE IMPLEMENT THIS PLAN:" plus the plan, as
 *   T3's web app does (reference apps/web/src/proposedPlan.ts buildPlanImplementationPrompt).
 * - planOpen { key }: the plan as an untitled markdown document.
 * The plan text is looked up here by its transcript key, never taken from the webview.
 */
import * as vscode from "vscode";
import type { OrchestrationV2ThreadProjection } from "@t3tools/contracts";
import { contextLabel, contextMeter, formatTokens } from "./contextUsage.js";
import { log } from "./log.js";
import { registerOursRpc } from "./rpc.js";
import type { OursDeps } from "./types.js";

const SETTING = "t3-vscode.ours.contextMeter.show";
const PLAN_PREFIX = "PLEASE IMPLEMENT THIS PLAN:\n";

export function activateContextMeter(deps: OursDeps): vscode.Disposable {
  const { hostState } = deps;
  let warned = false;
  // shortcut: reads his private HostState.threads by name (TS private is compile-time only); an upstream rename hides
  // the chip and logs once. Swap to a one-line public getter in his hostState.ts if the lead approves one.
  const projection = (threadId: string): OrchestrationV2ThreadProjection | null => {
    const threads = (hostState as unknown as { threads?: unknown }).threads;
    if (threads instanceof Map) return (threads.get(threadId) as { projection?: OrchestrationV2ThreadProjection | null } | undefined)?.projection ?? null;
    if (!warned) { warned = true; log.error("Context meter: HostState.threads is gone; the meter stays hidden."); }
    return null;
  };

  const plan = (params: Readonly<Record<string, unknown>>, viewId: string) => {
    const state = hostState.snapshot(viewId);
    const row = typeof params.key === "string" ? state.transcript.find((item) => item.key === params.key) : undefined;
    if (!row || row.item.type !== "proposed_plan" || !state.activeThreadId) throw new Error("This plan is no longer in the chat.");
    const running = !!state.threads.find((thread) => thread.id === state.activeThreadId)?.activeRunId;
    return { threadId: state.activeThreadId, markdown: row.item.markdown, unfinished: row.item.streaming || running };
  };
  // Every failure, the lookup's too, reaches the user as a toast; the webview only logs it.
  const toast = (action: string, cause: unknown) => {
    void vscode.window.showErrorMessage(`T3 VSCode could not ${action}: ${cause instanceof Error ? cause.message : String(cause)}`);
    throw cause;
  };

  const offs = [
    registerOursRpc("contextUsage", (_params, viewId) => {
      if (!vscode.workspace.getConfiguration().get<boolean>(SETTING, true)) return null;
      const threadId = hostState.snapshot(viewId).activeThreadId;
      const source = threadId ? projection(threadId) : null;
      const meter = source ? contextMeter(source) : null;
      if (!meter) return null;
      const used = `${formatTokens(meter.usedTokens)}${meter.maxTokens === null ? "" : ` of ${formatTokens(meter.maxTokens)}`} tokens`;
      return { label: contextLabel(meter), title: `Context window: ${used} used`, percent: meter.percent };
    }),
    registerOursRpc("planImplement", async (params, viewId) => {
      try {
        const { threadId, markdown, unfinished } = plan(params, viewId);
        // As T3's hasActionableProposedPlan: only a finished plan in a chat that is not working can be implemented.
        if (unfinished) { void vscode.window.showWarningMessage("Wait until the plan is finished and the chat stopped working, then click Implement."); return; }
        if (params.draftInUse === true) {
          void vscode.window.showWarningMessage("Send or clear the text in the composer first: Implement sends only the plan, and sending clears the composer.");
          return;
        }
        await hostState.setModes(threadId, { interactionMode: "default" }, viewId);
        await hostState.sendMessage(`${PLAN_PREFIX}${markdown.trim()}`, threadId, viewId);
      } catch (cause) { toast("send the plan", cause); }
    }),
    registerOursRpc("planOpen", async (params, viewId) => {
      try {
        const { markdown } = plan(params, viewId);
        await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ language: "markdown", content: `${markdown.trimEnd()}\n` }), { preview: false });
      } catch (cause) { toast("open the plan", cause); }
    }),
  ];
  return { dispose: () => { for (const off of offs) off(); } };
}
