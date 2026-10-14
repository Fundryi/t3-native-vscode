/**
 * B approvals: an approval request of a thread of this window becomes one VS Code toast with Approve, Deny and Show.
 * Composes around his InputNotificationTracker (map 0.2): his update runs first (his seen set dedups), then we take the
 * approvable requests out of his list and toast them ourselves; user_input and the rest keep his "Open session" toast.
 */
import * as vscode from "vscode";
import { toastWithLogs } from "./logs.js";
import { randomUUID } from "node:crypto";
import type { ThreadSummary } from "../../shared/bridge.js";
import { approvalToast, isAlreadyAnswered, isApprovable, redact } from "./approvalText.js";
import { isReading } from "./finished.js";
import { log } from "./log.js";
import type { OursDeps } from "./types.js";
import { wrap } from "./wrap.js";

export function activateApprovals(deps: OursDeps): vscode.Disposable {
  const sending = new Set<string>();
  const show = async (threadId: string) => {
    if (!deps.hostState.snapshot().threads.some((item) => item.id === threadId)) return;
    try { await deps.provider.openSession(threadId); }
    catch (cause) { toastWithLogs("error", String(cause), cause); }
  };

  const ask = async (thread: ThreadSummary, requestId: string, kind: string): Promise<void> => {
    const projection = await deps.client.getThreadProjection(thread.id).catch((cause: unknown) => {
      log.error(`Approval toast: could not read thread ${thread.id}: ${redact(String(cause))}`);
      return null;
    });
    const toast = approvalToast(thread.title, kind, requestId, projection);
    if (toast.showOnly) log.info(`Approval toast for ${thread.id}: Show only, ${toast.showOnly}.`);
    const choice = await vscode.window.showInformationMessage(toast.text, ...toast.buttons);
    if (choice === "Approve" || choice === "Deny") return answer(thread, requestId, kind, choice === "Approve" ? "accept" : "decline");
    if (choice === "Show") return show(thread.id);
  };

  // Never retries by itself: Retry reads the request anew instead of replaying an answer whose outcome is unknown.
  const answer = async (thread: ThreadSummary, requestId: string, kind: string, decision: "accept" | "decline"): Promise<void> => {
    if (sending.has(requestId)) return void vscode.window.showInformationMessage("An answer to this request is on its way to T3");
    sending.add(requestId);
    let failure: unknown;
    try { await deps.client.dispatch({ type: "runtime-request.respond", commandId: randomUUID(), threadId: thread.id, requestId, decision }); }
    catch (cause) { failure = cause ?? new Error("Unknown error"); }
    finally { sending.delete(requestId); }
    if (failure === undefined) return log.info(`Approval ${decision} sent for thread ${thread.id}, request ${requestId}.`);
    const message = redact(failure instanceof Error ? failure.message : String(failure));
    let full = message;
    try { full += ` ${redact(JSON.stringify(failure) ?? "")}`; } catch { /* a cyclic error: the message is enough */ }
    log.error(`Approval ${decision} for thread ${thread.id}, request ${requestId} failed: ${full}`);
    if (isAlreadyAnswered(full)) return void vscode.window.showInformationMessage("Already answered in T3");
    const choice = await vscode.window.showWarningMessage(`T3 could not answer for "${thread.title || "Untitled session"}": ${message}`, "Retry", "Show");
    if (choice === "Retry") return ask(thread, requestId, kind);
    if (choice === "Show") return show(thread.id);
  };

  const unwrap = wrap(deps.notifications, "update", (original) => (state) => {
    const his = original(state);
    // Claimed synchronously (update is sync); the toast itself waits for the thread's projection.
    return his.filter((thread) => {
      // Q3: no toast (ours or his) for the chat the user is reading; it shows the request already.
      if (isReading(thread.id)) return false;
      const request = thread.pendingRuntimeRequest;
      if (!request || !isApprovable(request.kind)) return true;
      void ask(thread, request.id, request.kind).catch((cause: unknown) => log.error("Approval toast failed:", cause));
      return false;
    });
  });
  return { dispose: unwrap };
}
