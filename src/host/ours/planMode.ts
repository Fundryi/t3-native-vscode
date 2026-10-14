/**
 * Q13 plan mode, host side. The Plan/Build toggle itself lives in src/webview/ours/planMode.ts and switches through his
 * setModes. Here: /plan and /default join his slash suggestions, only in views where the toggle shows (the webview
 * reports that, since a view's thread and provider are private to his HostState), and the setting
 * t3-vscode.ours.planMode.enabled stands in for T3's per-client planModeEnabled, which the extension cannot read.
 */
import * as vscode from "vscode";
import { SIDEBAR_VIEW_ID } from "../hostState.js";
import { OURS_EVENT } from "../../shared/ours/channel.js";
import { log } from "./log.js";
import { withPlanSuggestions } from "./planModeSuggestions.js";
import { registerOursRpc } from "./rpc.js";
import type { OursFeature } from "./types.js";
import { wrap } from "./wrap.js";

const SETTING = "t3-vscode.ours.planMode.enabled";
const enabled = () => vscode.workspace.getConfiguration().get<boolean>(SETTING, false);

export const activatePlanMode: OursFeature = ({ hostState, registry }) => {
  // shortcut: neither set forgets a closed view (no close hook here); a few ids per session, fine until views churn.
  const allowed = new Set<string>(), views = new Set<string>();
  const unregister = registerOursRpc("planModeAllowed", (params, viewId) => {
    if (typeof params.allowed !== "boolean") throw new Error("Invalid plan mode report.");
    if (params.allowed) allowed.add(viewId); else allowed.delete(viewId);
  });
  // The webview's first state: his getState would mark the view ready before his App listens (bridge.ts attach).
  // His bridge already builds this snapshot for every request, so it costs no new side effect.
  const unregisterState = registerOursRpc("planModeState", (_params, viewId) => {
    views.add(viewId);
    return { state: hostState.snapshot(viewId), enabled: enabled() };
  });
  const configListener = vscode.workspace.onDidChangeConfiguration((event) => {
    try {
      if (!event.affectsConfiguration(SETTING)) return;
      for (const viewId of views) registry.postWhenReady(viewId, OURS_EVENT, { kind: "planMode", enabled: enabled() });
    } catch (cause) { log.error("Fork plan mode: applying the setting failed.", cause); }
  });
  const unwrap = wrap(hostState, "composerSuggestions", (original) => async (kind, query, atPromptStart, viewId) => {
    const items = await original(kind, query, atPromptStart, viewId);
    if (kind !== "slash-command" || !allowed.has(viewId ?? SIDEBAR_VIEW_ID)) return items;
    try { return withPlanSuggestions(items, query); }
    catch (cause) { log.error("Plan mode suggestions failed; his list stays.", cause); return items; }
  });
  return new vscode.Disposable(() => { unwrap(); unregister(); unregisterState(); configListener.dispose(); });
};
