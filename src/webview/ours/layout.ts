/**
 * K layout, webview side (sidebar only). His App picks SidebarView or ChatView from body[data-surface] on every render
 * (App.tsx), so the "layout" event flips that attribute and re-delivers a state snapshot to make App render again.
 * A slim bar above his ChatView leads back to the sessions list or pops the chat out to an editor tab.
 */
import { bridge, Events, Methods } from "../bridge-client";
import type { HostStateSnapshot } from "../../shared/bridge";
import { oursRequest, registerOursEvent } from "./channel";

const report = (cause: unknown) => console.error("T3 VSCode (fork): layout failed", cause);
const icon = (paths: string) => `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
// A synthetic message: bridge-client accepts it (no source) and hands it to his own handlers.
const deliver = (event: string, data?: unknown) => window.dispatchEvent(new MessageEvent("message", { data: { event, data } }));

if (document.body.dataset.surface === "sidebar") {
  let latest: HostStateSnapshot | undefined;
  bridge.on(Events.stateChanged, (data) => { latest = data as HostStateSnapshot; });

  const style = document.createElement("style");
  style.textContent = `
body[data-ours-chat] { display: flex; flex-direction: column; }
body[data-ours-chat] > #root { flex: 1; min-height: 0; height: auto; }
.ours-sidebar-bar { display: none; }
body[data-ours-chat] > .ours-sidebar-bar { display: flex; align-items: center; gap: 4px; padding: 2px 6px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.ours-sidebar-bar .ours-sidebar-back { display: flex; align-items: center; gap: 4px; width: auto; padding: 0 6px 0 2px; }
.ours-sidebar-bar .ours-sidebar-gap { flex: 1; }`;
  document.head.append(style);

  const bar = document.createElement("div");
  bar.className = "ours-sidebar-bar";
  bar.innerHTML = `<button class="icon-button ours-sidebar-back" title="Back to the sessions list">${icon('<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>')}<span>Sessions</span></button>`
    + `<span class="ours-sidebar-gap"></span>`
    + `<button class="icon-button ours-sidebar-popout" aria-label="Open in editor tab" title="Open this chat in an editor tab">${icon('<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>')}</button>`;
  document.body.insertBefore(bar, document.getElementById("root"));

  const setChat = (chat: boolean) => {
    document.body.dataset.surface = chat ? "panel" : "sidebar";
    document.body.toggleAttribute("data-ours-chat", chat);
    // At once with the last pushed snapshot (an insertReference may follow right away), then a fresh one in case
    // App already holds a newer revision and ignores the first.
    if (latest) deliver(Events.stateChanged, { ...latest });
    void bridge.request<HostStateSnapshot>(Methods.getState).then((state) => deliver(Events.stateChanged, state), report);
  };
  registerOursEvent("layout", (data) => setChat(data.chat === true));
  // His sessions list, usage and task editor requests need SidebarView; ours runs before his App handler stores them.
  for (const event of [Events.showNavigation, Events.showUsage, Events.editScheduledTask]) bridge.on(event, () => {
    if (!document.body.hasAttribute("data-ours-chat")) return;
    setChat(false);
    void oursRequest("layoutList").catch(report);
  });
  bar.querySelector(".ours-sidebar-back")?.addEventListener("click", () => {
    setChat(false);
    void oursRequest("layoutList").catch(report);
  });
  // His App openInTab handler carries the draft and its attachments over; the host then sends us back to the list.
  bar.querySelector(".ours-sidebar-popout")?.addEventListener("click", () => deliver(Events.openInTab));
}
