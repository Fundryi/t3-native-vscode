/**
 * Q19 threadActions: Snooze, Regenerate title, Mark unread, Copy branch, Copy thread ID and Stop subagent.
 * The webview adds them to his thread menu (src/webview/ours/threadActions.ts); "More Thread Actions" offers them as a
 * QuickPick for the focused chat. Each server-flagged action is hidden when the flag is absent (threadActionsList.ts).
 */
import * as vscode from "vscode";
import { randomUUID } from "node:crypto";
import * as DateTime from "effect/DateTime";
import { resolveSnoozePresets } from "@t3tools/client-runtime/state/thread-settled";
import type { ThreadSummary } from "../../shared/bridge.js";
import { log } from "./log.js";
import { registerOursRpc } from "./rpc.js";
import { threadActionEntries, type ThreadActionId } from "./threadActionsList.js";
import type { OursDeps, OursFeature } from "./types.js";

export const activateThreadActions: OursFeature = (deps) => {
  const { client, hostState, registry } = deps;
  const entries = (thread: ThreadSummary) => threadActionEntries(thread, client.config?.environment.capabilities);
  // viewId comes from his attach; the thread must be one this view lists (the webview is a trust boundary).
  const findThread = (params: Readonly<Record<string, unknown>>, viewId: string): ThreadSummary => {
    const thread = typeof params.threadId === "string" ? hostState.snapshot(viewId).threads.find((item) => item.id === params.threadId) : undefined;
    if (!thread) throw new Error("This thread is not available in the current workspace.");
    return thread;
  };
  const dispatch = (type: string, threadId: string, extra: Record<string, unknown> = {}) => client.dispatch({ type, commandId: randomUUID(), threadId, ...extra });

  const snooze = async (thread: ThreadSummary) => {
    let snoozed = false;
    try {
      const until = (await client.snapshotShell()).threads.find((item) => item.id === thread.id)?.snoozedUntil;
      snoozed = until != null && DateTime.toEpochMillis(until) > Date.now();
    } catch (cause) { log.error("Thread actions: could not read the snooze state:", cause); }
    const presets = resolveSnoozePresets(new Date()).map((preset) => ({ label: `$(clock) ${preset.label}`, description: preset.whenLabel, until: preset.snoozedUntil as string | null }));
    const choice = await vscode.window.showQuickPick([...(snoozed ? [{ label: "$(bell) Wake thread", description: "", until: null }] : []), ...presets],
      { title: `Snooze: ${thread.title || "Untitled"}`, placeHolder: "Hide this chat in T3 until" });
    if (!choice) return;
    if (choice.until === null) await dispatch("thread.unsnooze", thread.id, { reason: "user" });
    else { await dispatch("thread.snooze", thread.id, { snoozedUntil: choice.until }); vscode.window.setStatusBarMessage(`T3: snoozed until ${choice.description}.`, 4000); }
  };

  // As T3's stopSubagent (ThreadRelationshipsControl.tsx): a provider-native child stops through its parent run, any other through its own run.
  const stopSubagent = async (thread: ThreadSummary) => {
    const agent = thread.parentThreadId ? (await client.getThreadProjection(thread.parentThreadId)).subagents.find((item) => item.childThreadId === thread.id) : undefined;
    if (agent?.origin === "provider_native" && agent.runId) await dispatch("subagent.stop", agent.threadId, { runId: agent.runId, subagentId: agent.id });
    else await hostState.interrupt(thread.id);
  };

  const copy = async (text: string, what: string) => { await vscode.env.clipboard.writeText(text); vscode.window.setStatusBarMessage(`T3: ${what} copied.`, 3000); };

  const perform = async (thread: ThreadSummary, action: ThreadActionId): Promise<void> => {
    switch (action) {
      case "snooze": return snooze(thread);
      case "regenerateTitle": return dispatch("thread.metadata.update", thread.id, { regenerateTitle: true });
      case "markUnread": return dispatch("thread.mark-unread", thread.id);
      case "copyBranch": if (thread.branch) await copy(thread.branch, "branch"); return;
      case "copyId": return copy(thread.id, "thread ID");
      case "stopSubagent": return stopSubagent(thread);
    }
  };
  // Detached, so a QuickPick left open never times out the webview request; failures become a toast.
  const run = (thread: ThreadSummary, action: ThreadActionId) => {
    if (!entries(thread).some((entry) => entry.id === action)) throw new Error("This thread action is not available.");
    log.info(`Thread actions: ${action} on ${thread.id}.`);
    perform(thread, action).catch((cause: unknown) => {
      log.error(`Thread actions: ${action} on ${thread.id} failed:`, cause);
      void vscode.window.showErrorMessage(`T3: ${cause instanceof Error ? cause.message : String(cause)}`);
    });
  };

  const more = async () => {
    let state;
    try { state = hostState.snapshot(registry.focusedViewId); } catch { state = hostState.snapshot(); }
    const thread = state.threads.find((item) => item.id === state.activeThreadId);
    if (!thread) { void vscode.window.showInformationMessage("No thread open."); return; }
    const choice = await vscode.window.showQuickPick(entries(thread).map((entry) => ({ label: `$(${entry.icon}) ${entry.label.replace(/\.\.\.$/, "")}`, id: entry.id })),
      { title: thread.title || "Untitled", placeHolder: "More thread actions" });
    if (choice) run(thread, choice.id);
  };

  const unregister = [
    registerOursRpc("threadActions.list", (params, viewId) => entries(findThread(params, viewId)).map(({ id, label }) => ({ id, label }))),
    registerOursRpc("threadActions.run", (params, viewId) => {
      const thread = findThread(params, viewId);
      if (typeof params.action !== "string") throw new Error("Invalid thread action.");
      run(thread, params.action as ThreadActionId);
      return true;
    }),
  ];
  return vscode.Disposable.from(
    vscode.commands.registerCommand("t3-vscode.ours.threadActions.more", more),
    { dispose: () => unregister.forEach((stop) => stop()) },
  );
};
