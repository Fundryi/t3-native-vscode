/** Q19: which extra thread actions a thread gets. No vscode import, so the gating rule is testable. */
import type { ThreadSummary } from "../../shared/bridge.js";
import { threadIsWorking } from "../../shared/sessionTree.js";

export type ThreadActionId = "snooze" | "regenerateTitle" | "markUnread" | "copyBranch" | "copyId" | "stopSubagent" | "continueNative" | "copySessionId";
export interface ThreadActionEntry { readonly id: ThreadActionId; readonly label: string; readonly icon: string }

/** The server flags we read; T3 says older servers lack them, so absent means hidden (environment.ts:143-176). */
export interface ThreadActionCapabilities { readonly threadSnooze?: boolean; readonly threadTitleRegeneration?: boolean; readonly threadVisitedTracking?: boolean }

/** C1 contnative: the drivers whose chats live on as a Claude Code session or a Codex thread, and the tool that opens them. */
const NATIVE_TOOLS: Readonly<Record<string, string>> = { claudeAgent: "Claude Code", codex: "Codex" };
export const nativeTool = (driver: string | null | undefined): string | undefined => driver && Object.hasOwn(NATIVE_TOOLS, driver) ? NATIVE_TOOLS[driver] : undefined;

type Thread = Pick<ThreadSummary, "archived" | "branch" | "parentThreadId" | "relationshipToParent" | "status" | "activityRunStatus">;

/** `driver` is the provider driver of the thread's model instance (server config); unknown means no C1 entries. */
export function threadActionEntries(thread: Thread, caps: ThreadActionCapabilities | null | undefined, driver?: string | null): ThreadActionEntry[] {
  const entries: ThreadActionEntry[] = [];
  const tool = nativeTool(driver);
  if (tool) entries.push({ id: "continueNative", label: `Continue in ${tool}...`, icon: "link-external" });
  if (thread.relationshipToParent === "subagent" && thread.parentThreadId && threadIsWorking(thread)) entries.push({ id: "stopSubagent", label: "Stop subagent", icon: "debug-stop" });
  if (caps?.threadSnooze && !thread.archived) entries.push({ id: "snooze", label: "Snooze...", icon: "clock" });
  if (caps?.threadTitleRegeneration) entries.push({ id: "regenerateTitle", label: "Regenerate title", icon: "refresh" });
  if (caps?.threadVisitedTracking) entries.push({ id: "markUnread", label: "Mark unread", icon: "mail" });
  if (thread.branch) entries.push({ id: "copyBranch", label: "Copy branch", icon: "git-branch" });
  entries.push({ id: "copyId", label: "Copy thread ID", icon: "copy" });
  if (tool) entries.push({ id: "copySessionId", label: "Copy session ID", icon: "copy" });
  return entries;
}
