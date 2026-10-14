/**
 * Q9 read, webview side: tells the host which thread this chat shows while the webview has focus (VS Code gives a
 * webview no visibility event; focus proves it is shown in a focused window). The host sends thread.visit.
 */
import { bridge, Events } from "../bridge-client";
import type { HostStateSnapshot } from "../../shared/bridge";
import { oursRequest } from "./channel";

let latest: HostStateSnapshot | undefined;
let lastKey = "";
const report = () => {
  // His App renders ChatView unless body[data-surface] is "sidebar" (the sessions list).
  const shown = document.hasFocus() && document.body.dataset.surface !== "sidebar" && latest?.phase === "ready";
  const thread = shown ? latest?.threads.find((item) => item.id === latest?.activeThreadId) : undefined;
  const key = thread ? `${thread.id}|${thread.updatedAt}|${thread.activeRunId ? 1 : 0}` : "";
  if (key === lastKey) return;
  lastKey = key;
  void oursRequest("visitShowing", thread ? { threadId: thread.id, running: thread.activeRunId !== null } : {})
    .catch((cause) => console.error("T3 VSCode (fork): read report failed", cause));
};
bridge.on(Events.stateChanged, (data) => { latest = data as HostStateSnapshot; report(); });
window.addEventListener("focus", report);
window.addEventListener("blur", report);
