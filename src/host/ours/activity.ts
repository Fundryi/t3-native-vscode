/**
 * What the fork's status bar item says (docs/ours/PORT-MAP.md C). Pure, no vscode import, so it is tested.
 * Precedence as T3's own sidebar pill: waiting for you beats running (apps/web/src/components/Sidebar.logic.ts).
 */
import type { HostStateSnapshot, ThreadSummary } from "../../shared/bridge.js";
import { threadIsWorking } from "../../shared/sessionTree.js";

type Thread = Pick<ThreadSummary, "id" | "title" | "status" | "activityRunStatus" | "archived" | "providerNativeSubagent" | "pendingRuntimeRequest">;

export interface Activity {
  readonly wait: ReadonlyArray<Thread>;
  readonly run: ReadonlyArray<Thread>;
  readonly text: string;
  readonly warning: boolean;
  /** undefined: a click does nothing (pairing: a second click would queue a second pairing). */
  readonly command: string | undefined;
  readonly args: ReadonlyArray<string>;
  /** Tooltip lines, plain text (the caller escapes them). */
  readonly lines: ReadonlyArray<string>;
}

const titleOf = (thread: Thread) => thread.title.trim() || "Untitled session";

const OPEN = "t3.webview.focus";

export function activity(state: { readonly phase: HostStateSnapshot["phase"]; readonly notice?: string; readonly threads: ReadonlyArray<Thread> }): Activity {
  // Owner default (map question 8): provider subagents do not count, "queued" counts as running.
  const live = state.threads.filter((thread) => !thread.archived && !thread.providerNativeSubagent);
  const wait = live.filter((thread) => thread.pendingRuntimeRequest);
  // His RUNNING_STATUSES (shared/sessionTree.ts) omit "queued"; added here so his file stays untouched.
  const run = live.filter((thread) => !thread.pendingRuntimeRequest && (threadIsWorking(thread) || thread.status === "queued"));
  const base = { wait, run, warning: false, args: [] };
  // His notice says why (no-server reason, "Connection lost. Reconnecting..."), so it leads the tooltip.
  const why = (line: string) => state.notice ? [state.notice, line] : [line];
  if (state.phase === "no-server") return { ...base, text: "T3: not running", command: OPEN, lines: why("T3 Code is not running. Click to open T3 VSCode.") };
  if (state.phase === "error") return { ...base, text: "T3: connection problem", command: OPEN, lines: why("T3 VSCode could not connect to T3 Code. Click to open it and retry.") };
  if (state.phase === "pairing") return { ...base, text: "$(sync~spin) T3: pairing", command: undefined, lines: why("Pairing VS Code with T3 Code.") };
  if (state.phase !== "ready") return { ...base, text: "$(sync~spin) T3: connecting", command: OPEN, lines: why("Connecting to T3 Code.") };
  const lines = [...wait.map((thread) => `${titleOf(thread)}: waits for you`), ...run.map((thread) => `${titleOf(thread)}: running`)];
  const [only] = wait;
  if (only && wait.length === 1) return { wait, run, text: "$(warning) T3: needs you", warning: true, command: "t3-vscode.ours.statusbar.open", args: [only.id], lines };
  if (!wait.length && !run.length) return { ...base, text: "T3", command: OPEN, lines: ["No T3 thread of this window is running. Click to open T3 VSCode."] };
  const text = wait.length ? "$(warning) T3: needs you" : run.length > 1 ? `$(sync~spin) T3: ${run.length} running` : "$(sync~spin) T3: running";
  return { wait, run, text, warning: wait.length > 0, command: "t3-vscode.showThreads", args: [], lines };
}
