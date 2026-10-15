/**
 * Q9 read (docs/ours/FORK-FEATURES.md Q9): a chat read in VS Code is marked read in T3, so the T3 app and the phone
 * drop its unread dot. The webview (src/webview/ours/visit.ts) reports the thread it shows while it has focus; we
 * dispatch thread.visit with the thread's updatedAt, as T3's own ChatView does. Only when the server reports
 * capabilities.threadVisitedTracking === true; otherwise nothing is sent.
 * No value import of vscode, so visit.test.ts can load it.
 */
import { randomUUID } from "node:crypto";
import type * as vscode from "vscode";
import { log } from "./log.js";
import { registerOursRpc } from "./rpc.js";
import { unreadIds } from "./unread.js";
import type { OursDeps } from "./types.js";

/** T3's VISIT_DISPATCH_THROTTLE_MS (ChatView.tsx): mid-turn updatedAt bumps come several times a second. */
export const VISIT_THROTTLE_MS = 10_000;

export function activateVisit({ client, hostState }: Pick<OursDeps, "client" | "hostState">): vscode.Disposable {
  const showing = new Map<string, string>(); // viewId -> thread shown while that webview has focus
  const lastShown = new Map<string, string>(); // viewId -> thread it showed last, kept through a blur
  const sent = new Map<string, string>(); // threadId -> updatedAt last dispatched
  const sentAt = new Map<string, number>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  const visit = async (viewId: string): Promise<void> => {
    const threadId = showing.get(viewId);
    if (!threadId || client.config?.environment.capabilities?.threadVisitedTracking !== true) return;
    // The webview is a trust boundary: only the view's own active thread, with the host's updatedAt.
    const state = hostState.snapshot(viewId);
    if (state.activeThreadId !== threadId) return;
    const thread = state.threads.find((item) => item.id === threadId);
    if (!thread || sent.get(threadId) === thread.updatedAt) return;
    sent.set(threadId, thread.updatedAt); sentAt.set(threadId, Date.now());
    try {
      await client.dispatch({ type: "thread.visit", commandId: randomUUID(), threadId, visitedAt: thread.updatedAt });
    } catch (cause) {
      if (sent.get(threadId) === thread.updatedAt) sent.delete(threadId);
      throw cause;
    }
  };
  const run = (viewId: string) => { void visit(viewId).catch((cause) => log.error("Fork read: thread.visit failed.", cause)); };

  const off = registerOursRpc("visitShowing", (params, viewId) => {
    const threadId = typeof params.threadId === "string" && params.threadId ? params.threadId : undefined;
    if (!threadId) { showing.delete(viewId); clearTimeout(timers.get(viewId)); timers.delete(viewId); return; }
    // Switching away and back counts as reopening: T3 visits again then, so does a thread marked unread elsewhere.
    const previous = lastShown.get(viewId);
    if (previous && previous !== threadId) sent.delete(previous);
    lastShown.set(viewId, threadId); showing.set(viewId, threadId);
    // P7: Mark unread rewinds lastVisitedAt but keeps updatedAt, so a chat marked unread is visited again when shown.
    if (unreadIds(hostState).includes(threadId)) sent.delete(threadId);
    // A finished run (or a newly opened chat) skips the throttle, as T3 does for an unseen completion.
    const wait = params.running === true ? (sentAt.get(threadId) ?? 0) + VISIT_THROTTLE_MS - Date.now() : 0;
    if (wait <= 0) { clearTimeout(timers.get(viewId)); timers.delete(viewId); run(viewId); return; }
    if (timers.has(viewId)) return; // the pending trailing visit reads the newest state
    timers.set(viewId, setTimeout(() => { timers.delete(viewId); run(viewId); }, wait));
  });
  return { dispose: () => { off(); for (const timer of timers.values()) clearTimeout(timer); timers.clear(); } };
}
