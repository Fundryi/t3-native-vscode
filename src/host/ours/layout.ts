/**
 * K layout (docs/ours/FORK-FEATURES.md K): with t3-vscode.ours.layout.openThreadsIn = "sidebar" (default) a thread
 * opens inside his sidebar view, as in the Claude Code and Codex extensions, instead of in an editor tab.
 * His panel code stays untouched: openSession, createPanel and createNewPanel are wrapped, the sidebar is re-added to
 * his registry as a chat view, and the "layout" event tells the sidebar webview to render his ChatView.
 */
import * as vscode from "vscode";
import { SIDEBAR_VIEW_ID } from "../hostState.js";
import { OURS_EVENT } from "../../shared/ours/channel.js";
import { layoutMode, panelRoute } from "./layoutRoute.js";
import { log } from "./log.js";
import { registerOursRpc } from "./rpc.js";
import type { OursDeps } from "./types.js";
import { wrap } from "./wrap.js";

const SETTING = "t3-vscode.ours.layout.openThreadsIn";
const mode = () => layoutMode(vscode.workspace.getConfiguration("t3-vscode").get("ours.layout.openThreadsIn"));

export function activateLayout({ hostState, registry, provider }: OursDeps): vscode.Disposable {
  let view: vscode.WebviewView | undefined;
  let chatShown = false; // so a re-resolved sidebar (the view was moved) shows the chat again
  const post = (chat: boolean) => { chatShown = chat; registry.postWhenReady(SIDEBAR_VIEW_ID, OURS_EVENT, { kind: "layout", chat }); };
  const show = async (): Promise<string> => {
    post(true);
    await vscode.commands.executeCommand("t3.webview.focus");
    registry.focus(SIDEBAR_VIEW_ID);
    return SIDEBAR_VIEW_ID;
  };
  const unwraps = [
    wrap(provider, "resolveWebviewView", (original) => (...args) => {
      original(...args);
      const resolved = args[0];
      view = resolved;
      resolved.onDidDispose(() => { if (view === resolved) view = undefined; });
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
      const id = await original(sourceViewId, transfer);
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
  ];
  const offList = registerOursRpc("layoutList", (_params, viewId) => { if (viewId === SIDEBAR_VIEW_ID) chatShown = false; });
  const configListener = vscode.workspace.onDidChangeConfiguration((event) => {
    try {
      if (!event.affectsConfiguration(SETTING) || !view) return;
      const chat = mode() === "sidebar";
      registry.add(SIDEBAR_VIEW_ID, view.webview, chat);
      // shortcut: add() clears his ready flag and a loaded sidebar never asks again; if a switch lands while the view
      // is still loading, events wait for a window reload.
      registry.markReady(SIDEBAR_VIEW_ID);
      if (!chat && chatShown) post(false);
    } catch (cause) { log.error("Fork layout: applying the setting failed.", cause); }
  });
  return vscode.Disposable.from(
    { dispose: () => { for (const unwrap of unwraps.reverse()) unwrap(); offList(); view = undefined; } },
    configListener,
  );
}
