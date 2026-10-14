/**
 * K layout (docs/ours/FORK-FEATURES.md K): with t3-vscode.ours.layout.openThreadsIn = "sidebar" (default) a thread
 * opens inside his sidebar view, as in the Claude Code and Codex extensions, instead of in an editor tab.
 * His panel code stays untouched: openSession, createPanel and createNewPanel are wrapped, the sidebar is re-added to
 * his registry as a chat view, and the "layout" event tells the sidebar webview to render his ChatView.
 * Q1b (FORK-FEATURES Q1b): a pop-out moves its draft, a tab moves back into the sidebar, "Back to" reopens the chat just
 * left, and the chat the sidebar showed comes back after a window reload.
 * R3 viewbar (FORK-FEATURES R3): context t3-vscode.ours.sidebarChat drives the view title buttons (New Chat in the list,
 * Sessions and pop-out in a chat), and the view title says "Sessions" or the chat title with the project beside it.
 */
import * as vscode from "vscode";
import { SIDEBAR_VIEW_ID } from "../hostState.js";
import { Events } from "../../shared/bridge.js";
import { OURS_EVENT } from "../../shared/ours/channel.js";
import { parseDraftTransfer } from "../../shared/viewDraft.js";
import { layoutMode, panelRoute } from "./layoutRoute.js";
import { log } from "./log.js";
import { registerOursRpc } from "./rpc.js";
import type { OursDeps } from "./types.js";
import { wrap } from "./wrap.js";

const SETTING = "t3-vscode.ours.layout.openThreadsIn";
const mode = () => layoutMode(vscode.workspace.getConfiguration("t3-vscode").get("ours.layout.openThreadsIn"));
const SHOWN_KEY = "t3-vscode.ours.layout.sidebarThread"; // workspaceState: the thread the sidebar chat shows

export function activateLayout({ context, hostState, registry, provider }: OursDeps): vscode.Disposable {
  let view: vscode.WebviewView | undefined;
  let chatShown = false; // so a re-resolved sidebar (the view was moved) shows the chat again
  // R3: his updateTitles resets the sidebar title to "T3 VSCode" on every state change; ours runs right after it.
  const titleView = () => {
    if (!view) return;
    try {
      let title = "Sessions", description = "";
      if (chatShown) {
        const state = hostState.snapshot(SIDEBAR_VIEW_ID);
        const thread = state.threads.find((item) => item.id === state.activeThreadId);
        title = thread?.title.trim() || "New conversation";
        // As his ChatView heading (ChatView.tsx project-label).
        description = state.projects.find((item) => item.id === thread?.projectId)?.title ?? state.draft.workspaceRoot?.split(/[\\/]/).filter(Boolean).at(-1) ?? "";
      }
      view.title = title;
      view.description = description;
    } catch (cause) { log.error("Fork layout: setting the view title failed.", cause); }
  };
  const setShown = (chat: boolean) => {
    chatShown = chat;
    void vscode.commands.executeCommand("setContext", "t3-vscode.ours.sidebarChat", chat).then(undefined, (cause: unknown) => log.error("Fork layout: setting the sidebarChat context failed.", cause));
    titleView();
  };
  setShown(false);
  // The list "+" tooltip in the webview follows the setting.
  const postMode = () => registry.postWhenReady(SIDEBAR_VIEW_ID, OURS_EVENT, { kind: "layoutMode", sidebar: mode() === "sidebar" });
  const remember = (threadId: string | undefined) => {
    if (context.workspaceState.get(SHOWN_KEY) === threadId) return;
    void Promise.resolve(context.workspaceState.update(SHOWN_KEY, threadId)).catch((cause) => log.error("Fork layout: saving the shown chat failed.", cause));
  };
  const post = (chat: boolean) => {
    setShown(chat);
    if (!chat) remember(undefined);
    registry.postWhenReady(SIDEBAR_VIEW_ID, OURS_EVENT, { kind: "layout", chat });
  };
  const show = async (): Promise<string> => {
    post(true);
    await vscode.commands.executeCommand("t3.webview.focus");
    registry.focus(SIDEBAR_VIEW_ID);
    return SIDEBAR_VIEW_ID;
  };
  // Pop-outs whose draft has not reached the new tab yet; the sidebar copy is cleared only once it has.
  const popped = new Set<string>();
  // Tabs asked to move into the sidebar, captured while each was still the active tab.
  const moves = new Map<string, vscode.Tab>();
  const unwraps = [
    wrap(provider, "resolveWebviewView", (original) => (...args) => {
      original(...args);
      const resolved = args[0];
      view = resolved;
      resolved.onDidDispose(() => { if (view === resolved) view = undefined; });
      titleView(); // his original ran updateTitles before view was set
      postMode();
      if (mode() !== "sidebar") return;
      // His line adds the sidebar with acceptsChatFocus false; nothing is ready yet, so re-adding here loses nothing.
      registry.add(SIDEBAR_VIEW_ID, resolved.webview, true);
      if (chatShown) post(true);
    }),
    // His toast, approvals, links and the status bar all come through here.
    wrap(provider, "openSession", (original) => async (threadId) => {
      if (mode() !== "sidebar") return original(threadId);
      await hostState.selectThread(threadId, SIDEBAR_VIEW_ID);
      return show();
    }),
    wrap(provider, "createPanel", (original) => async (sourceViewId = SIDEBAR_VIEW_ID, transfer) => {
      const route = panelRoute(mode(), sourceViewId, SIDEBAR_VIEW_ID, transfer !== undefined);
      if (route === "sidebar") return show();
      if (route === "his-then-list" && transfer) popped.add(transfer.draftKey);
      let id: string;
      try { id = await original(sourceViewId, transfer); }
      catch (cause) { if (transfer) popped.delete(transfer.draftKey); throw cause; }
      if (route === "his-then-list") post(false);
      return id;
    }),
    // The "+" of the sidebar list and of his ChatView in the sidebar; his "in Editor Tab" commands pass no source.
    wrap(provider, "createNewPanel", (original) => async (sourceViewId) => {
      if (mode() !== "sidebar" || sourceViewId !== SIDEBAR_VIEW_ID) return original(sourceViewId);
      const threadId = await hostState.newThread(undefined, SIDEBAR_VIEW_ID);
      await hostState.composerState(threadId, true, false, SIDEBAR_VIEW_ID);
      return show();
    }),
    wrap(provider, "updateTitles", (original) => () => { original(); titleView(); }),
  ];
  const offList = registerOursRpc("layoutList", (_params, viewId) => { if (viewId === SIDEBAR_VIEW_ID) { setShown(false); remember(undefined); } });
  // Every webview reports an initializeDraft it received; a pop-out's arrival in its new tab clears the sidebar copy.
  // When his createPanel only revealed an existing tab, nothing arrives and the sidebar keeps its text.
  const offArrived = registerOursRpc("layoutDraftArrived", (params, viewId) => {
    const { draftKey } = params;
    if (viewId === SIDEBAR_VIEW_ID || typeof draftKey !== "string" || !popped.delete(draftKey)) return;
    registry.postWhenReady(SIDEBAR_VIEW_ID, OURS_EVENT, { kind: "layoutClearDraft", draftKey });
  });
  // "Back to <title>" in the sidebar list.
  const offOpen = registerOursRpc("layoutOpen", async (params, viewId) => {
    const { threadId } = params;
    if (viewId !== SIDEBAR_VIEW_ID || typeof threadId !== "string" || !hostState.snapshot().threads.some((thread) => thread.id === threadId)) throw new Error("This chat is no longer available.");
    await provider.openSession(threadId);
  });
  // The tab's webview answers "layoutMoveOut" with its settled draft, as his openInTab path does.
  const offMove = registerOursRpc("layoutMove", async (params, viewId) => {
    const tab = moves.get(viewId);
    moves.delete(viewId);
    if (!tab) throw new Error("No move to the side panel is pending for this tab.");
    const transfer = parseDraftTransfer(params, hostState.snapshot(viewId).activeThreadId ?? "new");
    if (!transfer || transfer.draftKey === "new") throw new Error("This tab has no chat to move.");
    // His saveComposerDraft accepts an upload only from a view that owns it, and only registerView hands ownership on;
    // the sidebar is registered already. So a draft with attachments stays in its tab.
    if (transfer.draft.attachments?.length) {
      void vscode.window.showWarningMessage("T3 VSCode: send or remove the attachments first; they cannot move into the side panel.");
      return false;
    }
    const threadId = transfer.draftKey;
    await hostState.selectThread(threadId, SIDEBAR_VIEW_ID);
    // Before the tab closes: a view showing the thread keeps his empty-thread cleanup from deleting it.
    await hostState.composerState(threadId, true, false, SIDEBAR_VIEW_ID);
    registry.postWhenReady(SIDEBAR_VIEW_ID, Events.initializeDraft, transfer);
    await show();
    // The tab's stored draft would otherwise come back the next time this thread opens in a tab.
    hostState.saveComposerDraft(threadId, { text: "", contexts: [] }, undefined, viewId);
    // Later than his bridge posting this reply to the tab's webview.
    setTimeout(() => { void Promise.resolve(vscode.window.tabGroups.close(tab)).catch((cause) => log.error("Fork layout: closing the moved tab failed.", cause)); }, 0);
    return true;
  });
  const viewbarCommands = [
    // His showThreads posts showNavigation; the sidebar webview then flips to the list and reports layoutList.
    vscode.commands.registerCommand("t3-vscode.ours.viewbar.sessions", () => Promise.resolve(vscode.commands.executeCommand("t3-vscode.showThreads")).catch((cause) => log.error("Fork layout: Sessions failed.", cause))),
    // The webview runs his openInTab path, which carries the draft and its attachments.
    vscode.commands.registerCommand("t3-vscode.ours.viewbar.popOut", () => { registry.postWhenReady(SIDEBAR_VIEW_ID, OURS_EVENT, { kind: "layoutPopOut" }); }),
  ];
  const moveCommand = vscode.commands.registerCommand("t3-vscode.ours.sidebar.moveToSidebar", async () => {
    try {
      if (mode() !== "sidebar") { void vscode.window.showInformationMessage("T3 VSCode: set Open Threads In to sidebar to move a chat into the side panel."); return; }
      // A click in the sidebar leaves it the focused chat, and a title bar button does not focus the tab's webview.
      // Focusing the editor group makes his App report the tab (focusView); wait for that, at most 500 ms.
      if (registry.focusedViewId === SIDEBAR_VIEW_ID) await new Promise<void>((resolve) => {
        const done = () => { clearTimeout(timer); off(); resolve(); };
        const timer = setTimeout(done, 500);
        const off = registry.onDidFocusView(done);
        void Promise.resolve(vscode.commands.executeCommand("workbench.action.focusActiveEditorGroup")).catch(done);
      });
      const viewId = registry.focusedViewId;
      const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
      const threadId = viewId === SIDEBAR_VIEW_ID ? undefined : hostState.snapshot(viewId).activeThreadId;
      if (!threadId || !(tab?.input instanceof vscode.TabInputWebview) || !tab.input.viewType.endsWith("t3Panel")) {
        void vscode.window.showInformationMessage("T3 VSCode: open the chat tab you want to move first.");
        return;
      }
      moves.set(viewId, tab);
      registry.postWhenReady(viewId, OURS_EVENT, { kind: "layoutMoveOut", draftKey: threadId });
    } catch (cause) { log.error("Fork layout: moving the tab to the side panel failed.", cause); }
  });
  // Restore after reload: remember the sidebar chat while it shows; on the first ready, show it again.
  let restored = false;
  const offState = hostState.onDidChangeState((state) => {
    try {
      if (chatShown && state.phase === "ready") remember(state.activeThreadId);
      if (restored || state.phase !== "ready") return;
      restored = true;
      const threadId = context.workspaceState.get<string>(SHOWN_KEY);
      if (!threadId) return;
      if (mode() !== "sidebar" || !state.threads.some((thread) => thread.id === threadId && !thread.archived)) { remember(undefined); return; }
      // Not through openSession: its show() focuses the sidebar, which would take the focus on every reload.
      void hostState.selectThread(threadId, SIDEBAR_VIEW_ID).then(() => post(true), (cause) => { remember(undefined); log.error("Fork layout: restoring the sidebar chat failed.", cause); });
    } catch (cause) { log.error("Fork layout: tracking the sidebar chat failed.", cause); }
  }, SIDEBAR_VIEW_ID);
  const configListener = vscode.workspace.onDidChangeConfiguration((event) => {
    try {
      if (!event.affectsConfiguration(SETTING) || !view) return;
      const chat = mode() === "sidebar";
      registry.add(SIDEBAR_VIEW_ID, view.webview, chat);
      // shortcut: add() clears his ready flag and a loaded sidebar never asks again; if a switch lands while the view
      // is still loading, events wait for a window reload.
      registry.markReady(SIDEBAR_VIEW_ID);
      postMode();
      if (!chat && chatShown) post(false);
    } catch (cause) { log.error("Fork layout: applying the setting failed.", cause); }
  });
  return vscode.Disposable.from(
    { dispose: () => { for (const unwrap of unwraps.reverse()) unwrap(); offList(); offArrived(); offOpen(); offMove(); offState(); moves.clear(); view = undefined; } },
    configListener, moveCommand, ...viewbarCommands,
  );
}
