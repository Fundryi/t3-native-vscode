/**
 * What the fork's status bar item says (docs/ours/PORT-MAP.md C). Pure, no vscode import, so it is tested.
 * Precedence as T3's own sidebar pill: waiting for you beats running (apps/web/src/components/Sidebar.logic.ts).
 */
import type { HostStateSnapshot, ThreadSummary } from "../../shared/bridge.js";
import { threadIsWorking } from "../../shared/sessionTree.js";
import { minutes, since } from "../../shared/ours/working.js";

type Thread = Pick<ThreadSummary, "id" | "title" | "status" | "activityRunStatus" | "archived" | "providerNativeSubagent" | "pendingRuntimeRequest" | "workingStartedAt">;

export interface Activity {
  readonly wait: ReadonlyArray<Thread>;
  readonly run: ReadonlyArray<Thread>;
  /** P2: idle threads with work left running after their turn (not in wait or run). */
  readonly background: ReadonlyArray<Thread>;
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

/** R4: " 3m" since the run started, or nothing without a start. */
const ran = (thread: Thread, now: number) => { const elapsed = since(thread.workingStartedAt, now); return elapsed === undefined ? "" : ` ${minutes(elapsed)}`; };

/** P2: the T3 banner title of the work a thread left running; waiting = it will wake the agent (not only commands). */
export type BackgroundWork = ReadonlyMap<string, { readonly title: string; readonly waiting: boolean }>;

export function activity(state: { readonly phase: HostStateSnapshot["phase"]; readonly notice?: string; readonly threads: ReadonlyArray<Thread>; readonly background?: BackgroundWork }, now = Date.now()): Activity {
  // Owner default (map question 8): provider subagents do not count, "queued" counts as running.
  const live = state.threads.filter((thread) => !thread.archived && !thread.providerNativeSubagent);
  const wait = live.filter((thread) => thread.pendingRuntimeRequest);
  // His RUNNING_STATUSES (shared/sessionTree.ts) omit "queued"; added here so his file stays untouched.
  const run = live.filter((thread) => !thread.pendingRuntimeRequest && (threadIsWorking(thread) || thread.status === "queued"));
  const work: BackgroundWork = state.background ?? new Map();
  const background = live.filter((thread) => work.has(thread.id) && !wait.includes(thread) && !run.includes(thread));
  const base = { wait, run, background, warning: false, args: [] };
  // His notice says why (no-server reason, "Connection lost. Reconnecting..."), so it leads the tooltip.
  const why = (line: string) => state.notice ? [state.notice, line] : [line];
  if (state.phase === "no-server") return { ...base, text: "T3: not running", command: OPEN, lines: why("T3 Code is not running. Click to open T3 VSCode.") };
  if (state.phase === "error") return { ...base, text: "T3: connection problem", command: OPEN, lines: why("T3 VSCode could not connect to T3 Code. Click to open it and retry.") };
  if (state.phase === "pairing") return { ...base, text: "$(sync~spin) T3: pairing", command: undefined, lines: why("Pairing VS Code with T3 Code.") };
  if (state.phase !== "ready") return { ...base, text: "$(sync~spin) T3: connecting", command: OPEN, lines: why("Connecting to T3 Code.") };
  const lines = [...wait.map((thread) => `${titleOf(thread)}: waits for you`), ...run.map((thread) => `${titleOf(thread)}: running${ran(thread, now)}`),
    ...background.map((thread) => `${titleOf(thread)}: ${work.get(thread.id)!.title}`)];
  const [only] = wait;
  if (only && wait.length === 1) return { ...base, text: "$(warning) T3: needs you", warning: true, command: "t3-vscode.ours.statusbar.open", args: [only.id], lines };
  if (!wait.length && !run.length) {
    if (!background.length) return { ...base, text: "T3", command: OPEN, lines: ["No T3 thread of this window is running. Click to open T3 VSCode."] };
    // As the T3 sidebar "Waiting" pill: only work that will wake the agent changes the text; a dev server stays in the hover.
    const text = background.some((thread) => work.get(thread.id)!.waiting) ? "$(clock) T3: waiting on background work" : "T3";
    const [one] = background;
    return background.length === 1 ? { ...base, text, command: "t3-vscode.ours.statusbar.open", args: [one!.id], lines } : { ...base, text, command: "t3-vscode.showThreads", lines };
  }
  const text = wait.length ? "$(warning) T3: needs you" : run.length > 1 ? `$(sync~spin) T3: ${run.length} running` : `$(sync~spin) T3: running${ran(run[0]!, now)}`;
  return { ...base, text, warning: wait.length > 0, command: "t3-vscode.showThreads", lines };
}
