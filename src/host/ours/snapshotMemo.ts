/**
 * P11 snapmemo. His emit hands every listener its own snapshot(viewId), and his first listener (extension.ts) then
 * snapshots every view again (pushState, updateTitles, meters), as do ours. On a long chat that is a dozen full
 * rebuilds per 32 ms emit. This memo keeps one snapshot per (revision, view), and only starts one inside his emit:
 * emit() bumps the revision and calls snapshot at once, so the first call at a revision not seen before is his loop.
 * A call at a revision already seen, with no live memo, builds uncached: bridge.ts handle() snapshots, then e.g.
 * cancelSessionSearch changes state without an emit and the reply snapshots again; that reply must be fresh.
 * A microtask clears the memo, so it lasts for the emit's synchronous pass (plus continuations queued before it).
 * shortcut: a change without an emit, made later in the same pass as an emit (or in such a queued continuation),
 * is read stale until his next emit; re-check his emit listeners on every upstream merge.
 * No value import of vscode, so the test can load it.
 */
import { SIDEBAR_VIEW_ID, type HostState } from "../hostState.js";
import type { HostStateSnapshot } from "../../shared/bridge.js";
import type { OursFeature } from "./types.js";
import { wrap } from "./wrap.js";

export function memoizeSnapshot(hostState: HostState): () => void {
  let memo: { revision: number; byView: Map<string, HostStateSnapshot> } | undefined;
  let seen = hostState["revision"]; // a memo starts only at a revision his emit raised after the wrap
  const restore = wrap(hostState, "snapshot", (original) => (viewId = SIDEBAR_VIEW_ID) => {
    // revision and views are private in his HostState; element access keeps them type-checked (as modelSync.ts).
    const revision = hostState["revision"];
    const hit = memo?.revision === revision ? memo.byView.get(viewId) : undefined;
    // A closed view must still throw his "tab has been closed" error: callers use snapshot(viewId) as that check.
    if (hit && hostState["views"].has(viewId)) return hit;
    const state = original(viewId);
    if (revision > seen) {
      seen = revision;
      const fresh = { revision, byView: new Map<string, HostStateSnapshot>() };
      memo = fresh;
      queueMicrotask(() => { if (memo === fresh) memo = undefined; });
    }
    if (memo?.revision === revision) memo.byView.set(viewId, state);
    return state;
  });
  // His emit skips snapshot when nobody listens; this keeps the first call at each new revision inside his loop.
  const unlisten = hostState.onDidChangeState(() => {});
  return () => { unlisten(); restore(); };
}

export const activateSnapshotMemo: OursFeature = ({ hostState }) => ({ dispose: memoizeSnapshot(hostState) });
