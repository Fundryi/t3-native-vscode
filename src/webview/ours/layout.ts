/**
 * K layout, webview side. His App picks SidebarView or ChatView from body[data-surface] on every render (App.tsx), so
 * in the sidebar the "layout" event flips that attribute and re-delivers a state snapshot to make App render again.
 * A slim bar above his ChatView leads back to the sessions list or pops the chat out to an editor tab; in the list it
 * offers "Back to <title>" (Q1b). Every webview answers the move of its tab into the sidebar and reports an arrived draft.
 */
import { bridge, Events, Methods } from "../bridge-client";
import { isObject, type HostStateSnapshot } from "../../shared/bridge";
import { clearDraft, readDraft } from "../composerDrafts";
import { settleDraftAttachments } from "../composerAttachments";
import { oursRequest, registerOursEvent } from "./channel";

const report = (cause: unknown) => console.error("T3 VSCode (fork): layout failed", cause);
const icon = (paths: string) => `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
// A synthetic message: bridge-client accepts it (no source) and hands it to his own handlers.
const deliver = (event: string, data?: unknown) => window.dispatchEvent(new MessageEvent("message", { data: { event, data } }));

// The host clears a popped-out draft from the sidebar only once the new tab reports it (see host layout.ts).
bridge.on(Events.initializeDraft, (data) => {
  if (isObject(data) && typeof data.draftKey === "string") void oursRequest("layoutDraftArrived", { draftKey: data.draftKey }).catch(report);
});
// "Move to side panel" on this tab: hand the settled draft over; the host shows it in the sidebar and closes the tab.
registerOursEvent("layoutMoveOut", (data) => {
  const { draftKey } = data;
  if (typeof draftKey !== "string") return;
  void settleDraftAttachments(draftKey).then(() => oursRequest("layoutMove", { draftKey, draft: readDraft(draftKey) })).catch(report);
});

if (document.body.dataset.surface === "sidebar") {
  let latest: HostStateSnapshot | undefined;
  let lastThreadId: string | undefined; // the chat this sidebar showed last, for "Back to"
  let listScroll = 0;

  const style = document.createElement("style");
  style.textContent = `
body[data-ours-chat], body[data-ours-back] { display: flex; flex-direction: column; }
body[data-ours-chat] > #root, body[data-ours-back] > #root { flex: 1; min-height: 0; height: auto; }
.ours-sidebar-bar { display: none; }
body[data-ours-chat] > .ours-sidebar-bar, body[data-ours-back] > .ours-sidebar-bar { display: flex; align-items: center; gap: 4px; padding: 2px 6px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.ours-sidebar-bar .ours-sidebar-back, .ours-sidebar-bar .ours-sidebar-return { display: flex; align-items: center; gap: 4px; width: auto; padding: 0 6px 0 2px; }
.ours-sidebar-bar .ours-sidebar-gap { flex: 1; }
.ours-sidebar-return { min-width: 0; max-width: 100%; }
.ours-sidebar-return > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
body[data-ours-chat] .ours-sidebar-return, body:not([data-ours-chat]) .ours-sidebar-back, body:not([data-ours-chat]) .ours-sidebar-gap, body:not([data-ours-chat]) .ours-sidebar-popout { display: none; }
@media (max-width: 300px) {
  body[data-ours-chat] .chat-header .project-label, body[data-ours-chat] .chat-header .breadcrumb-divider,
  body[data-ours-chat] .chat-header .scheduled-header-button, body[data-ours-chat] .chat-header [aria-label="Open Web UI"] { display: none; }
}`;
  document.head.append(style);

  const bar = document.createElement("div");
  bar.className = "ours-sidebar-bar";
  bar.innerHTML = `<button class="icon-button ours-sidebar-back" title="Back to the sessions list">${icon('<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>')}<span>Sessions</span></button>`
    + `<button class="icon-button ours-sidebar-return">${icon('<path d="m12 5 7 7-7 7"/><path d="M5 12h14"/>')}<span></span></button>`
    + `<span class="ours-sidebar-gap"></span>`
    + `<button class="icon-button ours-sidebar-popout" aria-label="Open in editor tab" title="Open this chat in an editor tab">${icon('<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>')}</button>`;
  document.body.insertBefore(bar, document.getElementById("root"));
  const back = bar.querySelector<HTMLButtonElement>(".ours-sidebar-return")!;

  const chatShown = () => document.body.hasAttribute("data-ours-chat");
  const updateBack = () => {
    const title = latest?.threads.find((thread) => thread.id === lastThreadId)?.title.trim();
    const label = title === undefined ? undefined : `Back to ${title || "Untitled session"}`;
    document.body.toggleAttribute("data-ours-back", label !== undefined);
    if (label === undefined) return;
    back.querySelector("span")!.textContent = label;
    back.title = label;
  };
  bridge.on(Events.stateChanged, (data) => {
    latest = data as HostStateSnapshot;
    if (chatShown() && latest.activeThreadId) lastThreadId = latest.activeThreadId;
    updateBack();
  });

  const scroller = () => document.querySelector<HTMLElement>("#sessions-manager .session-list");
  // His SidebarView mounts again after a React commit that lands a frame or more after the state delivery.
  const restoreScroll = (top: number) => {
    let frames = 30;
    const attempt = () => {
      const list = scroller();
      if (list && list.scrollHeight - list.clientHeight >= top) { list.scrollTop = top; return; }
      if (--frames > 0) requestAnimationFrame(attempt);
      else if (list) list.scrollTop = top;
    };
    requestAnimationFrame(attempt);
  };
  const setChat = (chat: boolean) => {
    const was = chatShown();
    if (chat && !was) listScroll = scroller()?.scrollTop ?? 0;
    document.body.dataset.surface = chat ? "panel" : "sidebar";
    document.body.toggleAttribute("data-ours-chat", chat);
    updateBack();
    // At once with the last pushed snapshot (an insertReference may follow right away), then a fresh one in case
    // App already holds a newer revision and ignores the first.
    if (latest) deliver(Events.stateChanged, { ...latest });
    void bridge.request<HostStateSnapshot>(Methods.getState).then((state) => deliver(Events.stateChanged, state), report);
    if (!chat && was && listScroll) restoreScroll(listScroll);
  };
  registerOursEvent("layout", (data) => setChat(data.chat === true));
  // A pop-out reached its new tab: the text now lives there only.
  registerOursEvent("layoutClearDraft", (data) => { if (typeof data.draftKey === "string") clearDraft(data.draftKey); });
  // His sessions list, usage and task editor requests need SidebarView; ours runs before his App handler stores them.
  for (const event of [Events.showNavigation, Events.showUsage, Events.editScheduledTask]) bridge.on(event, () => {
    if (!chatShown()) return;
    setChat(false);
    void oursRequest("layoutList").catch(report);
  });
  bar.querySelector(".ours-sidebar-back")?.addEventListener("click", () => {
    setChat(false);
    void oursRequest("layoutList").catch(report);
  });
  back.addEventListener("click", () => { if (lastThreadId) void oursRequest("layoutOpen", { threadId: lastThreadId }).catch(report); });
  // His App openInTab handler carries the draft and its attachments over; the host then sends us back to the list.
  bar.querySelector(".ours-sidebar-popout")?.addEventListener("click", () => deliver(Events.openInTab));
}
