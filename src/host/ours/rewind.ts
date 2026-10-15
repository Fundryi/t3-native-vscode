/**
 * P12 rewind, host side. "Edit from here" on one of my messages: a modal offers "Rewind chat and files" (only for a
 * chat in its own worktree, T3 restores files nowhere else) or "Rewind chat only", then dispatches T3's
 * checkpoint.rollback to the checkpoint before that message and hands the prompt back to the webview.
 * The checkpoint rule is in src/shared/ours/rewind.ts. No line of his changed.
 */
import { randomUUID } from "node:crypto";
import { isAbsolute, relative, sep } from "node:path";
import * as vscode from "vscode";
import { recallText } from "../../shared/ours/reprompt.js";
import { rewindTarget } from "../../shared/ours/rewind.js";
import { log } from "./log.js";
import { registerOursRpc } from "./rpc.js";
import type { OursDeps } from "./types.js";

type Reply = { readonly threadId: string; readonly text: string } | Record<string, never>;
const refuse = (message: string): Reply => { void vscode.window.showWarningMessage(message); return {}; };
const STOP_FIRST = "Stop the current turn first, then use Edit from here.";
const CHAT_AND_FILES = "Rewind chat and files";
const CHAT_ONLY = "Rewind chat only";
// T3 web derivePhase counts these as working; a queued run can leave activeRunId null.
const BUSY = new Set(["preparing", "queued", "starting", "running", "waiting"]);

/** Open files with unsaved changes inside the checkout a file restore overwrites (a checkpoint covers all of it). */
const dirtyUnder = (cwd: string) => vscode.workspace.textDocuments
  .filter((doc) => doc.isDirty && doc.uri.scheme === "file")
  .map((doc) => relative(cwd, doc.uri.fsPath))
  .filter((path) => path !== "" && !isAbsolute(path) && path.split(sep)[0] !== "..");

async function rewind({ client, hostState }: OursDeps, key: string, viewId: string): Promise<Reply> {
  const state = hostState.snapshot(viewId);
  const threadId = state.activeThreadId;
  const row = state.transcript.find((entry) => entry.key === key);
  if (!threadId || row?.item.type !== "user_message") return refuse("This message is no longer in the chat.");
  if (row.sourceThreadId !== threadId) return refuse("This message belongs to the chat this one was forked from. Rewind it there.");
  const running = () => {
    const now = hostState.snapshot(viewId);
    return now.sending || now.threads.some((thread) => thread.id === threadId && (thread.activeRunId !== null || BUSY.has(thread.status)));
  };
  if (running()) return refuse(STOP_FIRST);
  const item = row.item;
  const projection = await client.getThreadProjection(threadId);
  const provider = state.providers.find((entry) => entry.instanceId === projection.thread.modelSelection.instanceId);
  if (provider?.supportsConversationRollback === false) return refuse("This provider cannot rewind a chat. Start a new chat instead.");
  const target = rewindTarget(projection.checkpoints, item);
  if ("refuse" in target) return refuse(target.refuse);

  const cwd = projection.checkpointScopes.find((scope) => scope.id === target.scopeId)?.cwd;
  const dirty = cwd ? dirtyUnder(cwd) : [];
  const canRestore = Boolean(projection.thread.worktreePath && cwd && !dirty.length);
  const files = !projection.thread.worktreePath || !cwd
    ? "Files stay as they are: T3 puts files back only for a chat in its own worktree."
    : dirty.length
      ? `Files stay as they are: save or discard the unsaved files first (${dirty.slice(0, 3).join(", ")}${dirty.length > 3 ? ", ..." : ""}).`
      : `"${CHAT_AND_FILES}" also puts every file in ${cwd} back as it was before this message, your own later edits included.`;
  const detail = [
    "This message and everything after it leave the chat, and the agent forgets them. The message comes back in the box to edit and send again.",
    files,
    ...(item.attachments.length ? ["Its attachments are not put back; attach them again."] : []),
  ].join("\n\n");
  const buttons = canRestore ? [CHAT_AND_FILES, CHAT_ONLY] : [CHAT_ONLY];
  const choice = await vscode.window.showWarningMessage("Rewind the chat to before this message?", { modal: true, detail }, ...buttons);
  if (choice !== CHAT_AND_FILES && choice !== CHAT_ONLY) return {};
  if (running()) return refuse(STOP_FIRST);
  // restoreFiles always explicit: T3 restores files when it is left out.
  await client.dispatch({ type: "checkpoint.rollback", commandId: randomUUID(), threadId, scopeId: target.scopeId, checkpointId: target.checkpointId, restoreFiles: choice === CHAT_AND_FILES });
  log.info(`Rewind: thread ${threadId} back to checkpoint ${target.checkpointId}${choice === CHAT_AND_FILES ? " with files" : ", chat only"}.`);
  return { threadId, text: recallText(item.text) };
}

export function activateRewind(deps: OursDeps): vscode.Disposable {
  const unregister = registerOursRpc("rewind", async (params, viewId) => {
    if (typeof params.key !== "string" || !params.key) throw new Error("Invalid message.");
    try { return await rewind(deps, params.key, viewId); }
    catch (cause) {
      log.error("Rewind failed:", cause);
      void vscode.window.showErrorMessage(`T3 could not rewind the chat: ${cause instanceof Error ? cause.message : String(cause)}`);
      return {};
    }
  });
  return { dispose: unregister };
}
