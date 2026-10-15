/**
 * Q19 threadActions, webview side: adds Snooze, Regenerate title, Mark unread, Copy branch, Copy thread ID and
 * Stop subagent to his thread menu (ThreadActionsMenu.tsx) without touching it. The menu is a portal straight into
 * document.body; capture listeners note which thread it opens for, and the host decides which entries apply.
 */
import { oursRequest, failed } from "./channel";

const report = failed("thread actions");
const ICONS: Readonly<Record<string, string>> = {
  stopSubagent: '<rect width="18" height="18" x="3" y="3" rx="2"/>',
  snooze: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  regenerateTitle: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  markUnread: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
  copyBranch: '<line x1="6" x2="6" y1="3" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
  // C1 contnative: Lucide external-link and key-round.
  continueNative: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  copySessionId: '<path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/>',
  copyId: '<line x1="4" x2="20" y1="9" y2="9"/><line x1="4" x2="20" y1="15" y2="15"/><line x1="10" x2="8" y1="3" y2="21"/><line x1="16" x2="14" y1="3" y2="21"/>',
};
const icon = (id: string) => `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[id] ?? ""}</svg>`;

let menuThreadId: string | undefined;
// A sessions row: right-click, or the ContextMenu key / Shift+F10 (ThreadList.tsx). The chat header: his chevron button (ChatView.tsx).
const rowId = (target: EventTarget | null) => (target instanceof Element ? target.closest<HTMLElement>("button.thread[data-thread-id]")?.dataset.threadId : undefined);
window.addEventListener("contextmenu", (event) => { menuThreadId = rowId(event.target) ?? menuThreadId; }, true);
window.addEventListener("keydown", (event) => { if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) menuThreadId = rowId(event.target) ?? menuThreadId; }, true);
window.addEventListener("click", (event) => {
  const button = event.target instanceof Element ? event.target.closest('button[aria-label="Thread actions"]') : null;
  const id = button?.closest<HTMLElement>(".chat-main")?.dataset.threadId;
  if (id) menuThreadId = id;
}, true);

async function extend(menu: HTMLElement, threadId: string): Promise<void> {
  const entries = await oursRequest<ReadonlyArray<{ id: string; label: string }>>("threadActions.list", { threadId });
  if (!menu.isConnected || !entries.length) return;
  const anchor = menu.querySelector(":scope > hr");
  for (const entry of entries) {
    const button = document.createElement("button");
    button.setAttribute("role", "menuitem"); button.className = "ours-thread-action";
    button.innerHTML = icon(entry.id); button.append(entry.label);
    button.addEventListener("click", () => {
      // His menu closes on Escape (its onKeyDown); React listens on the portal's container, so a synthetic key reaches it.
      menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      setTimeout(() => { if (menu.isConnected) window.dispatchEvent(new Event("resize")); }, 0); // his other close path
      oursRequest("threadActions.run", { threadId, action: entry.id }).catch(report);
    });
    menu.insertBefore(button, anchor);
  }
  // His layout effect clamped the menu before our rows existed.
  const box = menu.getBoundingClientRect();
  if (box.bottom > innerHeight - 6) menu.style.top = `${Math.max(6, innerHeight - box.height - 6)}px`;
}

new MutationObserver((records) => {
  for (const record of records) for (const node of record.addedNodes) {
    if (!(node instanceof HTMLElement) || !node.classList.contains("thread-actions-popup") || !menuThreadId) continue;
    extend(node, menuThreadId).catch(report);
  }
}).observe(document.body, { childList: true });
