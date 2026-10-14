/**
 * Q19 threadActions: Snooze, Regenerate title, Mark unread, Copy branch, Copy thread ID and Stop subagent.
 * The webview adds them to his thread menu (src/webview/ours/threadActions.ts). Each server-flagged action is hidden
 * when the flag is absent (threadActionsList.ts).
 * R11 actions: "Thread Actions" (t3-vscode.ours.threadActions.more) is the one QuickPick for the focused chat: his five
 * rows (rename, pin, settle, archive, delete; his command is hidden in package.json) plus ours. A wrapper on
 * hostState.threadAction offers Undo after every Archive, from any menu.
 */
import * as vscode from "vscode";
import { randomUUID } from "node:crypto";
import * as DateTime from "effect/DateTime";
import { resolveSnoozePresets } from "@t3tools/client-runtime/state/thread-settled";
import type { ThreadSummary } from "../../shared/bridge.js";
import { log } from "./log.js";
import { registerOursRpc } from "./rpc.js";
import { wrap } from "./wrap.js";
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

  const focused = () => {
    let viewId: string | undefined = registry.focusedViewId, state;
    try { state = hostState.snapshot(viewId); } catch { viewId = undefined; state = hostState.snapshot(); }
    const thread = state.threads.find((item) => item.id === state.activeThreadId);
    if (!thread) void vscode.window.showInformationMessage("No thread open.");
    return { thread, viewId };
  };
  const focusedThread = () => focused().thread;

  // His rows, as his t3-vscode.threadActions (src/extension.ts) and his BridgeHandler prompts (src/host/bridge.ts).
  const hisRows = (thread: ThreadSummary) => [
    { label: "$(edit) Rename thread", his: "rename" },
    { label: thread.pinned ? "$(pinned) Unpin thread" : "$(pin) Pin thread", his: thread.pinned ? "unpin" : "pin" },
    ...(!thread.archived ? [{ label: thread.settled ? "$(debug-restart) Unsettle thread" : "$(check) Settle thread", his: thread.settled ? "unsettle" : "settle" }] : []),
    { label: thread.archived ? "$(archive) Restore thread" : "$(archive) Archive thread", his: thread.archived ? "unarchive" : "archive" },
    { label: "$(trash) Delete thread", his: "delete" },
  ];
  const runHis = async (thread: ThreadSummary, action: string, viewId: string | undefined) => {
    let title: string | undefined;
    if (action === "rename") {
      title = await vscode.window.showInputBox({ title: "Rename thread", value: thread.title, validateInput: (value) => value.trim() ? null : "Enter a title." });
      if (title === undefined) return;
    }
    if (action === "delete" && await vscode.window.showWarningMessage(`Delete "${thread.title}"?`, { modal: true }, "Delete thread") !== "Delete thread") return;
    // A prompt may stay open after its chat tab closed (snapshot throws then) or the thread went away.
    if (!hostState.snapshot(viewId).threads.some((item) => item.id === thread.id)) throw new Error("This thread is not available in the current workspace.");
    log.info(`Thread actions: ${action} on ${thread.id}.`);
    await hostState.threadAction(thread.id, action, title);
  };
  const more = async () => {
    const { thread, viewId } = focused();
    if (!thread) return;
    const ours = entries(thread).map((entry) => ({ label: `$(${entry.icon}) ${entry.label.replace(/\.\.\.$/, "")}`, id: entry.id }));
    const choice = await vscode.window.showQuickPick<{ label: string; his?: string; id?: ThreadActionId; kind?: vscode.QuickPickItemKind }>(
      [...hisRows(thread), { label: "", kind: vscode.QuickPickItemKind.Separator }, ...ours],
      { title: thread.title || "Untitled", placeHolder: "Thread actions" });
    if (choice?.his) await runHis(thread, choice.his, viewId).catch((cause: unknown) => {
      log.error(`Thread actions: ${choice.his} on ${thread.id} failed:`, cause);
      void vscode.window.showErrorMessage(`T3: ${cause instanceof Error ? cause.message : String(cause)}`);
    });
    else if (choice?.id) run(thread, choice.id);
  };

  // Undo for Archive, whichever menu archived (his webview menu, his command, this list): all go through threadAction.
  const unwrap = wrap(hostState, "threadAction", (original) => async (id, action, title) => {
    const name = action === "archive" ? hostState.snapshot().threads.find((item) => item.id === id)?.title : undefined;
    await original(id, action, title);
    if (action !== "archive") return;
    void vscode.window.showInformationMessage(`T3: archived "${name || "Untitled"}".`, "Undo").then((choice) => {
      if (choice !== "Undo") return;
      hostState.threadAction(id, "unarchive").catch((cause: unknown) => {
        log.error(`Thread actions: undo archive of ${id} failed:`, cause);
        void vscode.window.showErrorMessage(`T3: ${cause instanceof Error ? cause.message : String(cause)}`);
      });
    });
  });

  const unregister = [
    registerOursRpc("threadActions.list", (params, viewId) => entries(findThread(params, viewId)).map(({ id, label }) => ({ id, label }))),
    registerOursRpc("threadActions.run", (params, viewId) => {
      const thread = findThread(params, viewId);
      if (typeof params.action !== "string") throw new Error("Invalid thread action.");
      run(thread, params.action as ThreadActionId);
      return true;
    }),
  ];
  // X3 titlebtn: the same action from the view menu and the palette (the header button uses threadActions.run).
  const regenerateTitle = () => {
    const thread = focusedThread();
    if (!thread) return;
    if (!entries(thread).some((entry) => entry.id === "regenerateTitle")) { void vscode.window.showInformationMessage("This T3 server cannot regenerate titles."); return; }
    run(thread, "regenerateTitle");
  };
  return vscode.Disposable.from(
    vscode.commands.registerCommand("t3-vscode.ours.threadActions.more", more),
    vscode.commands.registerCommand("t3-vscode.ours.threadActions.regenerateTitle", regenerateTitle),
    { dispose: () => { unregister.forEach((stop) => stop()); unwrap(); } },
  );
};
