/**
 * Q8 contexts (docs/ours/FORK-FEATURES.md Q8): context keys for when clauses, so the palette and menus offer
 * thread commands only when they can work. t3-vscode.ours.ready: connected to T3. t3-vscode.ours.hasThread: the
 * chat in front (registry.focusedViewId, falls back to the sidebar) shows a thread.
 */
import * as vscode from "vscode";
import { log } from "./log.js";
import type { OursDeps } from "./types.js";

export function activateContexts({ hostState, registry }: OursDeps): vscode.Disposable {
  const last = new Map<string, boolean>();
  const set = (key: string, value: boolean) => {
    if (last.get(key) === value) return;
    last.set(key, value);
    void vscode.commands.executeCommand("setContext", key, value).then(undefined, (cause: unknown) => log.error(`Fork contexts: setting ${key} failed.`, cause));
  };
  // Runs inside his emit and his focus loop, which have no guard: catch everything.
  const update = () => {
    try {
      const state = hostState.snapshot(registry.focusedViewId);
      const ready = state.phase === "ready";
      set("t3-vscode.ours.ready", ready);
      // After a disconnect the thread list is stale, so hasThread needs ready too.
      set("t3-vscode.ours.hasThread", ready && state.threads.some((thread) => thread.id === state.activeThreadId));
    } catch (cause) { log.error("Fork contexts: update failed.", cause); }
  };
  const unlisten = hostState.onDidChangeState(update);
  const unfocus = registry.onDidFocusView(update);
  return { dispose: () => { unlisten(); unfocus(); } };
}
