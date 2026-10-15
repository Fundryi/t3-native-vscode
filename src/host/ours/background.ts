/**
 * P2 bgwork, host side (docs/ours/FORK-FEATURES.md P2). Requests from src/webview/ours/background.ts:
 * - background.tasks: what the view chat still runs after its turn ended (the T3 shell roster pendingBackgroundTasks,
 *   worded by presentPendingBackgroundWork of T3), or null.
 * - background.stop { threadId }: after a modal, run.interrupt with the queue held on the run that owns the work,
 *   chosen as interruptThreadTurn of T3 does (client-runtime operations/commands.ts); with no run, it ends the pull
 *   request watches as T3 does. His interrupt returns when the
 *   chat is idle, so this dispatches directly.
 */
import { randomUUID } from "node:crypto";
import * as vscode from "vscode";
import type { OrchestrationV2PendingBackgroundTask, OrchestrationV2ShellSnapshot } from "@t3tools/contracts";
import { presentPendingBackgroundWork } from "@t3tools/client-runtime/state/thread-execution";
import { derivePendingBackgroundWork } from "@t3tools/shared/orchestrationV2PendingBackgroundWork";
import { visibleThreadPullRequests } from "@t3tools/shared/threadPullRequests";
import type { HostState } from "../hostState.js";
import { threadIsWorking } from "../../shared/sessionTree.js";
import { log } from "./log.js";
import { toastWithLogs } from "./logs.js";
import { registerOursRpc } from "./rpc.js";
import type { OursDeps } from "./types.js";

const ACTIVE = ["preparing", "starting", "running", "waiting"];

let warned = false;
function shellOf(hostState: HostState): OrchestrationV2ShellSnapshot | null {
  // shortcut: reads his private HostState.shell by name, as emptyList.ts does; an upstream rename shows no banner and
  // logs once. Swap for a public getter if the lead approves one.
  const host = hostState as unknown as { shell?: OrchestrationV2ShellSnapshot | null };
  if ("shell" in host) return host.shell ?? null;
  if (!warned) { warned = true; log.error("Background work: HostState.shell is gone; no banner."); }
  return null;
}

/** The background work a thread left running, from the live shell ([] while its root run is active). */
export const backgroundTasks = (hostState: HostState, threadId: string): ReadonlyArray<OrchestrationV2PendingBackgroundTask> =>
  shellOf(hostState)?.threads.find((thread) => thread.id === threadId)?.pendingBackgroundTasks ?? [];

/** The T3 banner title of every thread with work left running ("Running: npm run dev", "Waiting on 2 subagents"). */
export function backgroundTitles(hostState: HostState): Map<string, { title: string; waiting: boolean }> {
  const titles = new Map<string, { title: string; waiting: boolean }>();
  // Runs inside his emit loop (status bar listener); never let it throw.
  try {
    for (const thread of shellOf(hostState)?.threads ?? []) {
      const shown = thread.pendingBackgroundTasks?.length ? presentPendingBackgroundWork(thread.pendingBackgroundTasks) : null;
      if (shown) titles.set(thread.id, { title: shown.title, waiting: shown.waiting });
    }
  } catch (cause) { log.error("Background work: reading the shell roster failed.", cause); }
  return titles;
}

export function activateBackground({ client, hostState }: OursDeps): vscode.Disposable {
  const offs = [
    registerOursRpc("background.tasks", (_params, viewId) => {
      const state = hostState.snapshot(viewId);
      const thread = state.threads.find((item) => item.id === state.activeThreadId);
      // As T3 web (ChatView activeBackgroundTasks): only while the chat itself is not working.
      if (!thread || threadIsWorking(thread)) return null;
      const shown = presentPendingBackgroundWork(backgroundTasks(hostState, thread.id));
      return shown ? { threadId: thread.id, title: shown.title, labels: shown.items.map((item) => item.label), waiting: shown.waiting } : null;
    }),
    registerOursRpc("background.stop", async (params, viewId) => {
      // The webview is a trust boundary: the chat is the one this view shows, params only confirm it has not changed.
      const threadId = hostState.snapshot(viewId).activeThreadId;
      if (!threadId || params.threadId !== threadId) throw new Error("This view shows another chat now.");
      try {
        const title = presentPendingBackgroundWork(backgroundTasks(hostState, threadId))?.title ?? "Background work";
        const stop = "Stop";
        const answer = await vscode.window.showWarningMessage(`Stop the work this chat left running? ${title}.`, {
          modal: true,
          detail: "Like the T3 Stop button, this also holds the queued messages of the chat, ends its pull request watches and stops its delegated tasks.",
        }, stop);
        if (answer !== stop) return false;
        // Fresh projection: the shell can lag, and the run must be the one that owns the work.
        const projection = await client.getThreadProjection(threadId);
        let runId = projection.runs.findLast((run) => ACTIVE.includes(run.status))?.id;
        if (runId === undefined) {
          const latestRun = projection.runs.at(-1);
          const left = derivePendingBackgroundWork({ latestRun, providerThreads: projection.providerThreads, turnItems: projection.turnItems,
            activeProviderThreadId: projection.thread.activeProviderThreadId, runs: projection.runs });
          if (left.length) runId = latestRun?.id;
        }
        if (runId === undefined) {
          // As T3 interruptThreadTurn: with no run to interrupt, end the chat's pull request watches.
          let unwatched = false;
          for (const link of visibleThreadPullRequests(projection.thread.pullRequests ?? [])) {
            if (link.watch === undefined) continue;
            await client.dispatch({ type: "thread.pull-request.watch", commandId: randomUUID(), threadId,
              host: link.host, repository: link.repository, number: link.number, watching: false });
            unwatched = true;
          }
          if (!unwatched) void vscode.window.showInformationMessage("Nothing is left running in this chat.");
          return unwatched;
        }
        log.info(`Background work: stopping run ${runId} of ${threadId}.`);
        await client.dispatch({ type: "run.interrupt", commandId: randomUUID(), threadId, runId, holdQueue: true });
        return true;
      } catch (cause) {
        toastWithLogs("error", `T3 VSCode could not stop the background work: ${cause instanceof Error ? cause.message : String(cause)}`, cause);
        throw cause;
      }
    }),
  ];
  return { dispose: () => { for (const off of offs) off(); } };
}
