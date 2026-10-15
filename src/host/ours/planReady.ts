/**
 * P5 planready (docs/ours/FORK-FEATURES.md P5): when a turn settles with a plan ready in a chat you are not reading,
 * one toast "Plan ready" with Implement, Open as Markdown and Show, in place of the Q3 "finished" toast for that turn.
 * The rule is the T3 Plan Ready rule (reference packages/client-runtime/src/state/threadInbox.ts:36): plan mode, an
 * actionable proposed plan, no active run. Q3 (finished.ts) owns the turn edge and the settle delay and asks our hook,
 * so a flag that flickers while the plan streams never toasts. Implement and Open reuse the Q20 handlers (contextMeter.ts).
 */
import * as vscode from "vscode";
import type { OrchestrationV2ShellSnapshot } from "@t3tools/contracts";
import { implementPlan, openPlanMarkdown } from "./contextMeter.js";
import { isReading, setPlanReadyHook } from "./finished.js";
import { log } from "./log.js";
import type { OursDeps } from "./types.js";

type ShellThread = OrchestrationV2ShellSnapshot["threads"][number];
interface DraftStore { owned?: (scope: string, threadId: string, owner: string) => { draft?: { text?: string; contexts?: unknown[]; attachments?: unknown[] } } | undefined }
const SETTING = "t3-vscode.ours.planReady.toast";
const SIDEBAR_VIEW_ID = "sidebar"; // his default viewId (hostState.ts SIDEBAR_VIEW_ID), as defaults.ts

export function activatePlanReady({ hostState, client, provider }: OursDeps): vscode.Disposable {
  // shortcut: reads his private HostState.shell, composerDrafts and draftScope by name (TS private is compile-time only,
  // as emptyList.ts reads shell); an upstream rename turns the plan toast off (the Q3 toast shows) and logs once.
  const host = hostState as unknown as { shell?: OrchestrationV2ShellSnapshot | null; composerDrafts?: DraftStore; draftScope?: () => string };
  let warned = false;
  const row = (threadId: string): ShellThread | undefined => {
    if (!("shell" in host)) {
      if (!warned) { warned = true; log.error("Plan ready: HostState.shell is gone; no plan toasts."); }
      return undefined;
    }
    return host.shell?.threads.find((thread) => thread.id === threadId);
  };
  const ready = (thread: ShellThread | undefined): thread is ShellThread =>
    !!thread && thread.interactionMode === "plan" && thread.hasActionableProposedPlan === true && !thread.activeRunId;
  // sendMessage clears the sidebar draft of that chat (hostState.ts sendMessage); a draft we cannot see counts as in use.
  const draftInUse = (threadId: string): boolean => {
    try {
      if (typeof host.composerDrafts?.owned !== "function" || typeof host.draftScope !== "function") return true;
      const draft = host.composerDrafts.owned(host.draftScope(), threadId, SIDEBAR_VIEW_ID)?.draft;
      return !!(draft?.text?.trim() || draft?.contexts?.length || draft?.attachments?.length);
    } catch { return true; }
  };
  // Active plans keep their markdown in the projection (reference threadHistoryPaging.ts:556-562); fetched on click.
  const planMarkdown = async (threadId: string): Promise<string> => {
    const projection = await client.getThreadProjection(threadId);
    const plans = Array.isArray(projection?.plans) ? projection.plans : [];
    const plan = plans.filter((item) => item.kind === "proposed_plan" && item.status === "active").pop();
    if (plan?.kind !== "proposed_plan" || typeof plan.markdown !== "string" || !plan.markdown.trim()) throw new Error("This plan is no longer in the chat.");
    return plan.markdown;
  };
  const show = async (threadId: string) => { await provider.openSession(threadId); };
  const act = async (threadId: string, choice: string | undefined): Promise<void> => {
    if (choice === "Show") return show(threadId);
    if (choice === "Open as Markdown") return openPlanMarkdown(await planMarkdown(threadId));
    if (choice !== "Implement") return;
    // The toast may be clicked minutes later: check again, and show the chat instead of sending when it changed.
    if (!ready(row(threadId))) {
      void vscode.window.showWarningMessage("This plan is no longer ready: the chat is working or left plan mode.");
      return show(threadId);
    }
    if (draftInUse(threadId)) {
      void vscode.window.showWarningMessage("Send or clear the text in the composer of that chat first: Implement sends only the plan, and sending clears the composer.");
      return show(threadId);
    }
    await implementPlan(hostState, threadId, await planMarkdown(threadId));
    await show(threadId);
  };

  setPlanReadyHook((threadId) => {
    try {
      if (!vscode.workspace.getConfiguration().get<boolean>(SETTING, true)) return false;
      const thread = row(threadId);
      if (!ready(thread)) return false;
      if (isReading(threadId)) return true;
      log.info(`Plan ready toast for thread ${threadId}.`);
      const toast = vscode.window.showInformationMessage(`T3: Plan ready: "${thread.title.trim() || "Untitled session"}"`, "Implement", "Open as Markdown", "Show");
      void Promise.resolve(toast).then((choice) => act(threadId, choice)).catch((cause: unknown) => {
        log.error("Plan ready action failed:", cause);
        void vscode.window.showErrorMessage(`T3 VSCode: ${cause instanceof Error ? cause.message : String(cause)}`);
      });
      return true;
    } catch (cause) {
      log.error("Plan ready check failed; the finished toast shows instead.", cause);
      return false;
    }
  });
  return { dispose: () => setPlanReadyHook(undefined) };
}
