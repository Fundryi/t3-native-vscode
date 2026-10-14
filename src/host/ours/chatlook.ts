/**
 * X2 chatlook, host side. The look itself is CSS in src/webview/ours/chatlook.ts; here only the setting
 * t3-vscode.ours.chatlook.style ("bubbles" or "plain") goes to the webviews: asked once per view, pushed on change.
 */
import * as vscode from "vscode";
import { OURS_EVENT } from "../../shared/ours/channel.js";
import { log } from "./log.js";
import { registerOursRpc } from "./rpc.js";
import type { OursFeature } from "./types.js";

const SETTING = "t3-vscode.ours.chatlook.style";
const style = () => vscode.workspace.getConfiguration().get<string>(SETTING) === "plain" ? "plain" : "bubbles";

export const activateChatlook: OursFeature = ({ registry }) => {
  // shortcut: the set never forgets a closed view (postWhenReady to a gone id only queues); fine until views churn.
  const views = new Set<string>();
  const unregister = registerOursRpc("chatlookStyle", (_params, viewId) => { views.add(viewId); return { style: style() }; });
  const configListener = vscode.workspace.onDidChangeConfiguration((event) => {
    try {
      if (!event.affectsConfiguration(SETTING)) return;
      for (const viewId of views) registry.postWhenReady(viewId, OURS_EVENT, { kind: "chatlook", style: style() });
    } catch (cause) { log.error("Fork chat look: applying the setting failed.", cause); }
  });
  return new vscode.Disposable(() => { unregister(); configListener.dispose(); });
};
