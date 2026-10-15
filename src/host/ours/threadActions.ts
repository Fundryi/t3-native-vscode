/**
 * Q19 threadActions: Snooze, Regenerate title, Mark unread, Copy branch, Copy thread ID and Stop subagent.
 * The webview adds them to his thread menu (src/webview/ours/threadActions.ts). Each server-flagged action is hidden
 * when the flag is absent (threadActionsList.ts).
 * R11 actions: "Thread Actions" (t3-vscode.ours.threadActions.more) is the one QuickPick for the focused chat: his five
 * rows (rename, pin, settle, archive, delete; his command is hidden in package.json) plus ours. A wrapper on
 * hostState.threadAction offers Undo after every Archive, from any menu.
 * C1 contnative: "Continue in Claude Code / Codex" and "Copy session ID" for those chats (./continueNative.ts).
 * P3 allchanges: "Show all changes" opens one multi-diff of every file the chat changed (./diffs.ts).
 * P14 worktree: "Open Worktree in New Window" for a chat that runs in a git worktree (./worktree.ts starts those).
 * P19 mergeback: "Merge back into parent" on a fork sends the fork's conversation to its parent as context (thread.merge_back).
 */
import * as vscode from "vscode";
import { randomUUID } from "node:crypto";
import * as DateTime from "effect/DateTime";
import { resolveMergeBackTargetThreadId } from "@t3tools/client-runtime/state/thread-relationships";
import { resolveSnoozePresets } from "@t3tools/client-runtime/state/thread-settled";
import { resolveLatestMergeBackRun } from "@t3tools/client-runtime/state/thread-workflows";
import type { ThreadSummary } from "../../shared/bridge.js";
import { continueNative, copySessionId } from "./continueNative.js";
import { showAllChanges } from "./diffs.js";
import { log } from "./log.js";
import { registerOursRpc } from "./rpc.js";
import { wrap } from "./wrap.js";
import { threadActionEntries, type ThreadActionId } from "./threadActionsList.js";
import type { OursDeps, OursFeature } from "./types.js";

export const activateThreadActions: OursFeature = (deps) => {
  const { client, hostState, registry, provider } = deps;
  const driver = (thread: ThreadSummary) => client.config?.providers.find((provider) => provider.instanceId === thread.modelSelection.instanceId)?.driver;
  // P14: a thread whose workspace is not its project root runs in a git worktree (his workspaceForThread prefers worktreePath).
  const worktreePath = (thread: ThreadSummary) => {
    try {
      const path = hostState.workspaceForThread(thread.id);
      return path && path !== hostState.snapshot().projects.find((project) => project.id === thread.projectId)?.workspaceRoot ? path : null;
    } catch { return null; }
  };
  const entries = (thread: ThreadSummary) => threadActionEntries(thread, client.config?.environment.capabilities, driver(thread), worktreePath(thread));
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

  // P19: as T3 web's merge (ThreadRelationshipsControl.tsx): target and run from T3's own resolvers, then open the parent.
  const mergeBack = async (thread: ThreadSummary) => {
    const projection = await client.getThreadProjection(thread.id);
    const targetId = resolveMergeBackTargetThreadId(projection);
    if (!targetId) throw new Error("This chat is not a fork.");
    const latest = resolveLatestMergeBackRun(projection);
    if (!latest) throw new Error("Complete a run in this fork before merging it back.");
    const parent = hostState.snapshot().threads.find((item) => item.id === targetId)?.title || "the parent chat";
    const merge = "Merge back";
    const answer = await vscode.window.showWarningMessage(`Merge "${thread.title || "Untitled"}" back into "${parent}"?`, {
      modal: true,
      detail: `The parent chat gets this fork's conversation up to its latest finished turn as context, so its next answer knows the result. Only context moves: files on disk are not touched, and this fork stays as it is.`,
    }, merge);
    if (answer !== merge) return;
    await client.dispatch({ type: "thread.merge_back", commandId: randomUUID(), createdBy: "user", creationSource: "web",
      sourceThreadId: thread.id, targetThreadId: targetId, sourcePoint: { type: "run", runId: latest.id } });
    log.info(`Thread actions: merged ${thread.id} back into ${targetId}.`);
    // A parent outside this workspace's list cannot open here; the merge itself is done.
    try { await provider.openSession(targetId); }
    catch (cause) { log.error(`Thread actions: could not open the parent ${targetId}:`, cause); void vscode.window.showInformationMessage(`T3: merged into "${parent}". Open it in T3 to continue there.`); }
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
      case "continueNative": return continueNative(deps, thread);
      case "copySessionId": return copySessionId(deps, thread);
      case "allChanges": return showAllChanges(client, thread);
      case "openWorktree": { const path = worktreePath(thread); if (path) await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(path), { forceNewWindow: true }); return; }
      case "mergeBack": return mergeBack(thread);
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
