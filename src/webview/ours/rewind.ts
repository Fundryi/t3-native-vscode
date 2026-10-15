/**
 * P12 rewind, webview side. An "Edit from here" button on each of my messages (beside Q11's "use again"). The host
 * (src/host/ours/rewind.ts) asks, rolls the chat back and returns the prompt; it goes back into that chat's box,
 * after any text already there, as T3 web does. No line of his changed: buttons are added by a MutationObserver.
 */
import { readDraft, rememberDraftSelection, updateDraft } from "../composerDrafts";
import { failed, oursRequest } from "./channel";

const report = failed("rewind");

const style = document.createElement("style");
style.textContent = ".user-message > .ours-rewind-button { margin-top: 0; flex-shrink: 0; }";
document.head.append(style);

const button = document.createElement("button");
button.className = "icon-button copy-button ours-rewind-button";
button.title = "Edit from here: rewind the chat (and files, if you choose) to before this message and put it back in the box";
button.setAttribute("aria-label", "Edit from here");
button.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.4 2.6a1 1 0 0 1 3 3l-9 9a2 2 0 0 1-.85.5l-2.87.84a.5.5 0 0 1-.62-.62l.84-2.87a2 2 0 0 1 .5-.85z"/></svg>';

let frame = 0;
const decorate = () => {
  frame = 0;
  for (const article of document.querySelectorAll<HTMLElement>("[data-search-row] > article.user-message")) {
    if (!article.querySelector(":scope > .ours-rewind-button")) article.append(button.cloneNode(true));
  }
};
new MutationObserver(() => { if (!frame) frame = requestAnimationFrame(decorate); }).observe(document.body, { childList: true, subtree: true });

let busy = false;
window.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target.closest(".ours-rewind-button") : null;
  const key = target?.closest<HTMLElement>("[data-search-row]")?.dataset.searchRow;
  if (!target || !key) return;
  event.preventDefault();
  if (busy) return; // one modal at a time
  busy = true;
  void oursRequest<Readonly<Record<string, unknown>>>("rewind", { key }).then((reply) => {
    const { threadId, text } = reply ?? {};
    if (typeof threadId !== "string" || typeof text !== "string" || !text) return;
    // The thread the host rolled back, not the one shown now: the modal can outlive a chat switch.
    const current = readDraft(threadId).text;
    const next = current.trim() ? `${current}\n\n${text}` : text;
    updateDraft(threadId, (draft) => ({ ...draft, text: next }), "take-focus");
    rememberDraftSelection(threadId, { start: next.length, end: next.length });
    window.dispatchEvent(new CustomEvent("t3-focus-composer", { detail: { draftKey: threadId, cursor: next.length } }));
  }).catch(report).finally(() => { busy = false; });
});
