/**
 * R13 focus: focus never drops to the page. Three window-level listeners, no line of his changed:
 * - Sidebar flip (layout.ts toggles body[data-ours-chat]): once his tree re-renders and the old focus is gone, the chat
 *   gets the composer caret (his t3-focus-composer path, which restores the remembered caret), the list gets the chat's
 *   row, else the active row, else "Search threads".
 * - Removing an attachment or reference chip: focus moves to the next chip's X, else the composer box.
 * - Tabbing out of a popup (the ones escape.ts knows): it closes with a synthetic Escape, so Escape stops a turn again.
 *   Only when focus leaves from inside it (or from nowhere), so a popup opened without focus stays reachable by Tab.
 */
import { POPUPS } from "./escape";

const SETTLE_MS = 2000;
const CHIP_X = ".composer-chips :is(.remove-attachment, .context-chip .icon-button)";
const fail = (what: string) => (cause: unknown) => console.error(`T3 VSCode (fork): focus ${what} failed`, cause);

/** Focus sits nowhere useful: on the body, on a removed node or on a hidden one (display:none keeps it active). */
const lost = (): boolean => {
  const active = document.activeElement;
  return !(active instanceof HTMLElement) || active === document.body || !active.isConnected || active.getClientRects().length === 0;
};

/** Runs step each frame until it returns true, the deadline passes or the webview loses focus to VS Code. */
function settle(step: () => boolean): void {
  const until = performance.now() + SETTLE_MS;
  const attempt = () => {
    try {
      if (!document.hasFocus() || step() || performance.now() > until) return;
      requestAnimationFrame(attempt);
    } catch (cause) { fail("settle")(cause); }
  };
  requestAnimationFrame(attempt);
}

// Sidebar flip between the sessions list and a chat.
new MutationObserver(() => {
  try {
    const chat = document.body.hasAttribute("data-ours-chat");
    const before = document.activeElement;
    // His tree has not re-rendered yet, so the chat it leaves is still mounted.
    const leftId = chat ? undefined : document.querySelector<HTMLElement>(".chat-main[data-thread-id]")?.dataset.threadId;
    settle(() => {
      if (!lost() && document.activeElement !== before) return true; // someone else placed focus
      if (!lost()) return false; // the old element is still on screen: wait for his re-render
      if (chat) {
        if (document.activeElement instanceof HTMLTextAreaElement) return true;
        window.dispatchEvent(new CustomEvent("t3-focus-composer"));
        return false;
      }
      const target = (leftId ? document.querySelector<HTMLElement>(`button.thread[data-thread-id="${CSS.escape(leftId)}"]`) : null)
        ?? document.querySelector<HTMLElement>("button.thread.active")
        ?? document.querySelector<HTMLElement>('input[aria-label="Search threads"]');
      // preventScroll: layout.ts restores the list's scroll position over the next frames.
      target?.focus({ preventScroll: true });
      return target !== null;
    });
  } catch (cause) { fail("flip")(cause); }
}).observe(document.body, { attributes: true, attributeFilter: ["data-ours-chat"] });

// Removing a chip. Attachments are keyed by file (the node goes), references by index (the node stays and becomes the
// next chip's X, already focused), so act only when focus actually dropped.
window.addEventListener("click", (event) => {
  try {
    const button = event.target instanceof Element ? event.target.closest<HTMLElement>(CHIP_X) : null;
    const box = button?.closest<HTMLElement>(".composer-box");
    if (!button || !box) return;
    const all = () => [...box.querySelectorAll<HTMLElement>(CHIP_X)];
    const count = all().length;
    const index = all().indexOf(button);
    settle(() => {
      if (!box.isConnected) return true;
      if (button.isConnected && all().length === count) return false;
      if (!lost()) return true;
      const next = all()[index] ?? box.querySelector<HTMLElement>("textarea");
      next?.focus();
      return true;
    });
  } catch (cause) { fail("chip")(cause); }
}, true);

// Tab out of a popup. His Escape handlers put focus back on their anchor, so the new target gets it again after.
let closing = false;
// Only keyboard focus moves count: a click on a popup's own trigger also moves focus out, and his click handler then
// toggles the popup, so closing it here would reopen it. His outside-click handlers already cover the pointer.
let pointer = false;
window.addEventListener("pointerdown", () => { pointer = true; }, true);
window.addEventListener("keydown", () => { pointer = false; }, true);
window.addEventListener("focusin", (event) => {
  if (closing || pointer) return;
  try {
    const target = event.target;
    if (!(target instanceof HTMLElement) || target.closest(POPUPS)) return; // into a popup (or a nested one): keep all
    // Close only a popup Tab leaves from (a portaled popup his code never focuses must stay reachable); no relatedTarget
    // means focus came from the body or VS Code, so close as before.
    const from = event.relatedTarget instanceof Node ? event.relatedTarget : null;
    const popups = [...document.querySelectorAll<HTMLElement>(POPUPS)].filter((popup) => !popup.contains(target) && (!from || popup.contains(from)));
    if (!popups.length) return;
    closing = true;
    try {
      for (const popup of popups) popup.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      if (target.isConnected && document.activeElement !== target) target.focus({ preventScroll: true });
    } finally { closing = false; }
  } catch (cause) { fail("popup")(cause); }
});
