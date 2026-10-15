/**
 * Q2 keys (docs/ours/FORK-FEATURES.md Q2): one key to type into T3, one for a new chat, a Switch Chat picker.
 * Only his public provider methods; in sidebar mode layout.ts routes openSession and createNewPanel to the sidebar.
 * The insert key (Shift+Alt+K for his t3-vscode.insertReference) is a package.json binding only.
 * R14 keys2: contexts t3-vscode.ours.inT3 (a T3 webview has focus; inT3Tab: a chat tab has focus, reported by src/webview/ours/listKeys.ts; own key
 * as Claude Code's sideBarActive, focusedView is not trusted inside a webview), Go to Next Chat That Needs You,
 * and Delete on a sessions row archives through hostState.threadAction (so the R11 Undo applies).
 */
import * as vscode from "vscode";
import { OURS_EVENT } from "../../shared/ours/channel.js";
import { SIDEBAR_VIEW_ID } from "../hostState.js";
import { otherFolderChats } from "./emptyList.js";
import { unreadIds } from "./unread.js";
import { activity } from "./activity.js";
import { log } from "./log.js";
import { registerOursRpc } from "./rpc.js";
import type { OursDeps } from "./types.js";
import { wrap } from "./wrap.js";

export function activateKeys({ hostState, registry, provider }: OursDeps): vscode.Disposable {
  // His Composer ignores a t3-focus-composer whose draftKey is not its own (Composer.tsx:178).
  const focusComposer = (viewId: string) =>
    registry.postWhenReady(viewId, OURS_EVENT, { kind: "focus", draftKey: hostState.snapshot(viewId).activeThreadId ?? "new" });
  const run = (name: string, body: (...args: unknown[]) => Promise<void>) => async (...args: unknown[]) => {
    try { await body(...args); } catch (cause) {
      log.error(`Fork keys: ${name} failed.`, cause);
      void vscode.window.showErrorMessage(`T3 VSCode: ${name} failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  };
  // R19: chats of other folders stay outside his workspace filter (selectThread refuses them), so picking one offers its folder.
  const switchOther = async () => {
    const chats = otherFolderChats(hostState);
    if (!chats.length) { void vscode.window.showInformationMessage("T3 VSCode: no chats in other folders."); return; }
    const picked = await vscode.window.showQuickPick(chats.map((chat) => ({
      label: chat.title, description: chat.root.split(/[\\/]/).filter(Boolean).pop() ?? chat.root, detail: chat.root, chat,
    })), { placeHolder: "T3 chats in other folders (each opens in its own folder)", matchOnDescription: true, matchOnDetail: true });
    if (!picked?.chat.root) return;
    const open = await vscode.window.showInformationMessage(`"${picked.chat.title}" belongs to ${picked.chat.root}. Open that folder to continue it.`, "Open Folder in New Window");
    if (open) await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(picked.chat.root), { forceNewWindow: true });
  };
  // R14: which T3 webviews have focus; a view closed while focused never sends its blur, so remove() drops it too.
  const inT3 = new Set<string>();
  const setContext = (key: string, value: boolean) => void vscode.commands.executeCommand("setContext", key, value).then(undefined, (cause: unknown) => log.error(`Fork keys: setting ${key} failed.`, cause));
  // inT3Tab: a chat tab (extension.ts mountPanel ids) has focus; Ctrl+Alt+C there must switch editors, not focus its own group.
  const paintInT3 = () => { setContext("t3-vscode.ours.inT3", inT3.size > 0); setContext("t3-vscode.ours.inT3Tab", [...inT3].some((id) => id.startsWith("panel_"))); };
  const unfocusRpc = registerOursRpc("keys.focus", (params, viewId) => {
    if (params.focused === true) inT3.add(viewId); else inT3.delete(viewId);
    paintInT3();
    return true;
  });
  const unremove = wrap(registry, "remove", (original) => (id) => { original(id); if (inT3.delete(id)) paintInT3(); });
  const unarchiveRpc = registerOursRpc("keys.archive", async (params, viewId) => {
    const thread = typeof params.threadId === "string" ? hostState.snapshot(viewId).threads.find((item) => item.id === params.threadId) : undefined;
    if (!thread || thread.archived) return false;
    try { await hostState.threadAction(thread.id, "archive"); return true; } catch (cause) {
      log.error(`Fork keys: archive of ${thread.id} failed.`, cause);
      void vscode.window.showErrorMessage(`T3: ${cause instanceof Error ? cause.message : String(cause)}`);
      return false;
    }
  });
  return vscode.Disposable.from(
    { dispose: () => { unfocusRpc(); unarchiveRpc(); unremove(); inT3.clear(); paintInT3(); } },
    vscode.commands.registerCommand("t3-vscode.ours.chat.nextWaiting", run("Go to Next Chat That Needs You", async () => {
      // Stateless cycle: the waiting chat after the one in front (activity() skips archived chats and provider subagents).
      const wait = activity(hostState.snapshot(SIDEBAR_VIEW_ID)).wait;
      if (!wait.length) { vscode.window.setStatusBarMessage("T3: no chat needs you.", 3000); return; }
      const current = wait.findIndex((thread) => thread.id === hostState.snapshot(registry.focusedViewId).activeThreadId);
      focusComposer(await provider.openSession(wait[(current + 1) % wait.length]!.id));
    })),
    vscode.commands.registerCommand("t3-vscode.ours.chat.focus", run("Focus Chat", async () => {
      const focused = registry.focusedViewId;
      // A chat tab: his createPanel finds the tab of its own thread and reveals it (the layout wrap leaves non-sidebar sources alone).
      if (focused !== SIDEBAR_VIEW_ID) return focusComposer(await provider.createPanel(focused));
      const threadId = hostState.snapshot(SIDEBAR_VIEW_ID).activeThreadId;
      if (!threadId) { await vscode.commands.executeCommand("t3.webview.focus"); return; }
      focusComposer(await provider.openSession(threadId));
    })),
    vscode.commands.registerCommand("t3-vscode.ours.chat.new", run("New Chat", async () => {
      focusComposer(await provider.createNewPanel(SIDEBAR_VIEW_ID));
    })),
    vscode.commands.registerCommand("t3-vscode.ours.chat.switch", run("Switch Chat", async (scope?: unknown) => {
      if (scope === "other") return switchOther();
      const time = (thread: { lastActiveAt?: string | null; updatedAt: string }) => Date.parse(thread.lastActiveAt ?? thread.updatedAt) || 0;
      const threads = hostState.snapshot(SIDEBAR_VIEW_ID).threads.filter((thread) => !thread.archived).sort((a, b) => time(b) - time(a));
      if (!threads.length) { void vscode.window.showInformationMessage("T3 VSCode: no chats in this workspace yet."); return; }
      const unread = new Set(unreadIds(hostState)); // P7: the sessions list dot, as a filled circle here
      const picked = await vscode.window.showQuickPick(threads.map((thread) => ({
        label: `${unread.has(thread.id) ? "$(circle-filled) " : ""}${thread.title.trim() || "New conversation"}`,
        description: [unread.has(thread.id) ? "unread" : "", thread.pinned ? "pinned" : "", thread.pendingRuntimeRequest ? "needs you" : thread.activeRunId ? "working" : ""].filter(Boolean).join(", "),
        id: thread.id,
      })), { placeHolder: "Switch to a T3 chat (type to filter)", matchOnDescription: true });
      if (picked) focusComposer(await provider.openSession(picked.id));
    })),
  );
}
