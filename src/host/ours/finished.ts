/**
 * Q3 toasts (docs/ours/FORK-FEATURES.md Q3): a toast when a turn finished or failed while you were away, and no toast
 * (finished, approval or question) for the chat you are reading.
 * "Reading" comes from the webview (src/webview/ours/toasts.ts): the chat view that has keyboard focus reports itself;
 * the host checks which thread that view shows. B approvals asks isReading before it toasts.
 */
import * as vscode from "vscode";
import type { ThreadSummary } from "../../shared/bridge.js";
import { turnEdges, turnOutcome } from "./finishedEdge.js";
import { log } from "./log.js";
import { registerOursRpc } from "./rpc.js";
import type { OursDeps } from "./types.js";

/** A thread that streams in bursts flips between working and idle; wait this long before calling it done. */
const SETTLE_MS = 2000;
const setting = () => vscode.workspace.getConfiguration("t3-vscode").get<string>("ours.notify.finished", "unfocused");

let readingView: string | undefined;
let showsThread: ((viewId: string) => string | undefined) | undefined;

/** True when VS Code has focus and the focused chat view shows this thread. False until Q3 is active. */
export function isReading(threadId: string): boolean {
  if (!vscode.window.state.focused || readingView === undefined || !showsThread) return false;
  // shortcut: a focused Usage panel copies its source view's thread and surface, so it counts as reading that thread.
  return showsThread(readingView) === threadId;
}

export function activateToasts({ hostState, provider }: OursDeps): vscode.Disposable {
  // snapshot throws once a view is gone (a tab closed while focused never reports its blur).
  showsThread = (viewId) => { try { return hostState.snapshot(viewId).activeThreadId; } catch { return undefined; } };
  const offRpc = registerOursRpc("toastsFocus", (params, viewId) => {
    if (typeof params.reading !== "boolean") throw new Error("reading must be true or false.");
    if (params.reading) readingView = viewId;
    else if (readingView === viewId) readingView = undefined;
  });

  const show = async (threadId: string) => {
    if (!hostState.snapshot().threads.some((item) => item.id === threadId)) return;
    try { await provider.openSession(threadId); }
    catch (cause) { await vscode.window.showErrorMessage(String(cause)); }
  };
  let working = new Set<string>();
  let latest = new Map<string, ThreadSummary>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const settle = (threadId: string) => {
    timers.delete(threadId);
    const thread = latest.get(threadId);
    const outcome = thread && turnOutcome(thread);
    const mode = setting();
    if (!thread || !outcome || mode === "off") return;
    if (mode === "always" ? isReading(threadId) : vscode.window.state.focused) return;
    const text = `T3: "${thread.title.trim() || "Untitled session"}" ${outcome}.`;
    log.info(`Turn ${outcome} toast for thread ${threadId}.`);
    const toast = outcome === "failed" ? vscode.window.showWarningMessage(text, "Show") : vscode.window.showInformationMessage(text, "Show");
    void Promise.resolve(toast).then((choice) => choice === "Show" ? show(threadId) : undefined)
      .catch((cause: unknown) => log.error("Turn toast failed:", cause));
  };
  // Runs inside his emit loop (and his connect); never let it throw. Only ready snapshots count, so a reconnect keeps
  // the working set and toasts what finished meanwhile; the first call only seeds it.
  const unlisten = hostState.onDidChangeState((state) => {
    try {
      if (state.phase !== "ready") return;
      latest = new Map(state.threads.map((thread) => [thread.id, thread]));
      const edges = turnEdges(working, state.threads);
      for (const id of edges.working) { clearTimeout(timers.get(id)); timers.delete(id); }
      for (const id of edges.stopped) { clearTimeout(timers.get(id)); timers.set(id, setTimeout(() => { try { settle(id); } catch (cause) { log.error("Turn toast failed:", cause); } }, SETTLE_MS)); }
      working = edges.working;
    } catch (cause) { log.error("Fork turn toasts update failed.", cause); }
  });
  return { dispose: () => {
    unlisten(); offRpc();
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear(); readingView = undefined; showsThread = undefined;
  } };
}
