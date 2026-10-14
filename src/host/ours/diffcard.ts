/**
 * R7 diffcard. His prepareTurnDiff refuses a turn without a pre-send baseline ("Agent-only diff unavailable"): queued,
 * steered, T3-app and older turns then show no changes card. We fall back to the turn's checkpoint range (previous
 * checkpoint to this one) and tell the webview, which adds "May include your own edits" to that card.
 * His card, Open diff and our all-changes view (./diffs.ts) all go through prepareTurnDiff, so all three follow.
 */
import type * as vscode from "vscode";
import { SIDEBAR_VIEW_ID } from "../hostState.js";
import { turnCheckpointRange, turnDiffFiles } from "../turnDiff.js";
import { OURS_EVENT } from "../../shared/ours/channel.js";
import { log } from "./log.js";
import type { OursDeps } from "./types.js";
import { wrap } from "./wrap.js";

// shortcut: matches his error text (hostState.ts prepareTurnDiff); an upstream reword shows his error again, no card.
const NO_BASELINE = /^Agent-only diff unavailable/;

export function activateDiffcard({ hostState, client, registry }: OursDeps): vscode.Disposable {
  // His default viewId does not apply inside our replacement: repeat it.
  const unwrap = wrap(hostState, "prepareTurnDiff", (original) => async (id, sourceId, itemId, viewId = SIDEBAR_VIEW_ID) => {
    try { return await original(id, sourceId, itemId, viewId); }
    catch (cause) {
      if (!(cause instanceof Error && NO_BASELINE.test(cause.message))) throw cause;
      try {
        const state = hostState.snapshot(viewId);
        const row = state.transcript.find((row) => row.item.type === "checkpoint" && row.sourceThreadId === sourceId && (row.sourceItemId ?? row.item.id) === itemId);
        if (state.activeThreadId !== id || row?.item.type !== "checkpoint") throw new Error("the turn is not in this chat");
        const checkpointId = row.item.checkpointId;
        const range = turnCheckpointRange(await client.getThreadProjection(sourceId), checkpointId);
        const files = turnDiffFiles(await client.getSavedTurnDiff(range));
        hostState.snapshot(viewId); // throws like his own re-check when the view closed meanwhile
        registry.postWhenReady(viewId, OURS_EVENT, { kind: "diffcard.mixed", checkpointId });
        return { ...range, files };
      } catch (reason) {
        // His card retries; log quietly and give his own error back.
        log.info(`Diff card: no checkpoint fallback for ${itemId}: ${reason instanceof Error ? reason.message : String(reason)}`);
        throw cause;
      }
    }
  });
  return { dispose: unwrap };
}
