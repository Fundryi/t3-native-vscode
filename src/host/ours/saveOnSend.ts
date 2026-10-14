/**
 * H. Save on send: agents read files from disk, so my unsaved edits are saved before T3 sends my prompt.
 * Wraps hostState.sendMessage and hostState.queueAction("edit") (docs/ours/PORT-MAP.md 0.2, H). The save runs
 * before his enqueue, so it lands before captureTurnBaseline snapshots the disk for his turn diff; a later save
 * would count my own edits as the agent's changes.
 */
import * as vscode from "vscode";
import { log } from "./log.js";
import type { OursFeature } from "./types.js";
import { wrap } from "./wrap.js";

/** Never rejects: a failed save is logged and toasted, and the prompt is sent anyway (owner question 13). */
async function saveDirty(): Promise<void> {
  try {
    if (!vscode.workspace.getConfiguration("t3-vscode").get<boolean>("ours.saveOnSend.enabled", true)) return;
    const dirty = vscode.workspace.textDocuments.filter((document) => document.isDirty && !document.isUntitled).length;
    if (!dirty) return;
    // false: untitled files stay unsaved.
    if (await vscode.workspace.saveAll(false)) return log.info(`Saved ${dirty} file${dirty === 1 ? "" : "s"} before T3 sent the prompt`);
    warn("VS Code did not save every file.");
  } catch (cause) { warn(cause instanceof Error ? cause.message : String(cause)); }
}

function warn(reason: string): void {
  log.error(`Save on send: ${reason} The prompt was sent anyway.`);
  // Not awaited: the toast resolves only when dismissed and would hold the send.
  void vscode.window.showWarningMessage(`T3: could not save all files before sending (${reason}). The prompt was sent anyway.`);
}

export const activateSaveOnSend: OursFeature = ({ hostState }) => {
  const unwrapSend = wrap(hostState, "sendMessage", (original) => async (...args) => { await saveDirty(); return original(...args); });
  // Only "edit" carries my text; steer with new text goes through sendMessage. Reads action by position (0.10 checklist).
  const unwrapQueue = wrap(hostState, "queueAction", (original) => async (id, action, ...rest) => {
    if (action === "edit") await saveDirty();
    return original(id, action, ...rest);
  });
  return { dispose: () => { unwrapQueue(); unwrapSend(); } };
};
