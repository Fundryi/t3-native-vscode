/** G: thread deep links (docs/ours/PORT-MAP.md section G). P20 deeplink: a link to a chat of another folder offers that folder. */
import * as vscode from "vscode";
import { otherFolderChats } from "./emptyList.js";
import { log } from "./log.js";
import { parseThreadLink, threadLink, type ThreadLink } from "./linkParse.js";
import type { OursFeature } from "./types.js";

const WAIT_MS = 5 * 60_000; // a cold link waits through discovery and pairing, but never opens hours later

export const activateLinks: OursFeature = ({ context, hostState, registry, provider }) => {
  let pending: (() => void) | undefined; // one parked link; a newer one replaces it

  const open = ({ environmentId, threadId }: ThreadLink) => {
    const state = hostState.snapshot();
    const sameEnvironment = state.environment?.environmentId === environmentId;
    if (!sameEnvironment || !state.threads.some((thread) => thread.id === threadId)) {
      log.info(`Link: thread ${threadId} of environment ${environmentId.slice(0, 80)} is not in this window.`);
      // P20: a chat of another folder on the same server offers its folder; VS Code focuses a window that already has it open.
      // shortcut: opens the project root, not a T3 worktree path (his filter only shows the root's chats until P8 scope is in).
      const chat = sameEnvironment ? otherFolderChats(hostState).find((item) => item.id === threadId) : undefined;
      if (!chat?.root) { void vscode.window.showWarningMessage("This T3 thread is not in this window."); return; }
      void vscode.window.showInformationMessage(`"${chat.title}" belongs to ${chat.root}, not to this window.`, "Open Its Window")
        .then((pick) => pick && vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(chat.root), { forceNewWindow: true }))
        .then(undefined, (cause: unknown) => log.error(`Link: opening the folder of thread ${threadId} failed:`, cause));
      return;
    }
    provider.openSession(threadId).catch((cause: unknown) => log.error(`Link: opening thread ${threadId} failed:`, cause));
  };

  const handleUri = (uri: vscode.Uri) => {
    const link = parseThreadLink(uri.path);
    if (!link) { log.info(`Link: not a thread link: ${uri.path.slice(0, 200)}`); return; }
    pending?.();
    let done = false, unsubscribe: (() => void) | undefined;
    const timer = setTimeout(() => { log.info(`Link: gave up on thread ${link.threadId}, T3 did not connect.`); pending?.(); }, WAIT_MS);
    const stop = () => { done = true; clearTimeout(timer); unsubscribe?.(); if (pending === stop) pending = undefined; };
    pending = stop;
    // Fires at once; his emit runs inside connect with no guard, so catch everything and open off his stack.
    unsubscribe = hostState.onDidChangeState((state) => {
      try {
        if (done || state.phase !== "ready") return;
        stop();
        setTimeout(() => { try { open(link); } catch (cause) { log.error("Link: open failed:", cause); } }, 0);
      } catch (cause) { log.error("Link: state listener failed:", cause); }
    });
    if (done) unsubscribe();
    else log.info(`Link: waiting for the T3 connection to open thread ${link.threadId}.`);
  };

  const copy = async () => {
    let state;
    try { state = hostState.snapshot(registry.focusedViewId); } catch { state = hostState.snapshot(); }
    const environmentId = state.environment?.environmentId, threadId = state.activeThreadId;
    if (!environmentId || !threadId) { void vscode.window.showInformationMessage("No thread open."); return; }
    await vscode.env.clipboard.writeText(threadLink(vscode.env.uriScheme, context.extension.id, { environmentId, threadId }));
    void vscode.window.showInformationMessage("Link copied.");
  };

  return vscode.Disposable.from(
    vscode.window.registerUriHandler({ handleUri }),
    vscode.commands.registerCommand("t3-vscode.ours.links.copy", copy),
    { dispose: () => pending?.() },
  );
};
