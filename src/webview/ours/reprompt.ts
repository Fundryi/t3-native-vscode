/**
 * Q11 reprompt, webview side. ArrowUp in an empty chat box brings back the last prompt (ArrowDown walks forward),
 * a "use again" button beside Copy on each of my messages and a Retry button under a turn error put a past prompt
 * back into the box. No line of his changed: a window capture keydown runs before his Composer onKeyDown, and the
 * buttons are added to his rendered rows by a MutationObserver (his TranscriptView has no slot for them yet).
 */
import { bridge, Methods } from "../bridge-client";
import type { HostStateSnapshot } from "../../shared/bridge";
import { readDraft, rememberDraftSelection, updateDraft } from "../composerDrafts";
import { promptBefore, promptEntries, recallText, stepPrompt, type PromptPosition } from "../../shared/ours/reprompt";

const report = (cause: unknown) => console.error("T3 VSCode (fork): reprompt failed", cause);
const icon = (paths: string) => `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const composer = () => document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]');

// Fresh on every action: his App also takes snapshots from request results, so a cached event copy can name an old thread.
const snapshot = () => bridge.request<HostStateSnapshot>(Methods.getState);

/**
 * Replaces the box text through his draft store; "take-focus" makes his Composer replay it as a native edit, so
 * Ctrl+Z brings the old text back. Only when the box shows exactly the stored draft, so the two never diverge.
 */
function putPrompt(state: HostStateSnapshot, text: string): boolean {
  const input = composer(), key = state.activeThreadId ?? "new"; // the draft key his Composer uses
  if (!input || input.disabled || input.value !== readDraft(key).text) return false;
  updateDraft(key, (draft) => ({ ...draft, text }), "take-focus");
  input.focus();
  input.setSelectionRange(text.length, text.length);
  rememberDraftSelection(key, { start: text.length, end: text.length });
  return true;
}

// ArrowUp / ArrowDown, T3's rules: steps only from an empty box or an unedited recall, so a typed draft moves the
// caret as always; in a multi-line recall the arrows move inside it until the caret is on its first or last line.
let position: (PromptPosition & { readonly thread: string | undefined }) | null = null;
let queue = Promise.resolve(); // one step after another, so fast presses walk instead of repeating
window.addEventListener("keydown", (event) => {
  if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
  const input = event.target;
  if (!(input instanceof HTMLTextAreaElement) || input !== composer() || input.disabled) return;
  if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey || event.isComposing || event.keyCode === 229) return;
  if (input.getAttribute("aria-expanded") === "true") return; // his @ and / suggestions own the arrows
  const { value, selectionStart, selectionEnd } = input, backward = event.key === "ArrowUp";
  if (value && position?.recalled !== value) return;
  const lineEdge = backward ? !value.slice(0, selectionStart).includes("\n") : !value.slice(selectionEnd).includes("\n");
  if (selectionStart !== selectionEnd || !lineEdge) return;
  event.preventDefault(); event.stopPropagation();
  queue = queue.then(async () => {
    const state = await snapshot(), thread = state.activeThreadId, current = input.value;
    if (position && position.thread !== thread) position = null;
    if (readDraft(thread ?? "new").attachments?.length) return; // an old prompt with new attachments is never what ArrowUp meant
    const step = stepPrompt(backward ? "backward" : "forward", promptEntries(state.transcript), position, current);
    if (step && putPrompt(state, step.prompt)) position = step.position && { ...step.position, thread };
  }).catch(report);
}, true);

// "Use again" beside Copy on my messages, Retry under a turn error. Data is looked up on click, never at insertion.
const style = document.createElement("style");
style.textContent = `.user-message > .ours-reuse-button { margin-top: 0; flex-shrink: 0; }
.ours-retry-button { display: flex; align-items: center; gap: 4px; margin: -4px 0 10px; font-size: 0.75rem; }`;
document.head.append(style);

const reuse = document.createElement("button");
reuse.className = "icon-button copy-button ours-reuse-button";
reuse.title = "Use this prompt again (puts it in the box)";
reuse.setAttribute("aria-label", "Use this prompt again");
reuse.innerHTML = icon('<polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/>');
const retry = document.createElement("button");
retry.className = "text-button ours-retry-button";
retry.title = "Put the prompt that failed back in the box; Enter sends it again";
retry.innerHTML = `${icon('<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>')}<span>Retry</span>`;

let frame = 0;
const decorate = () => {
  frame = 0;
  // Appended after his CopyButton: the article's children are elements, so a React update leaves an extra one alone.
  for (const article of document.querySelectorAll<HTMLElement>("[data-search-row] > article.user-message")) {
    if (!article.querySelector(":scope > .ours-reuse-button")) article.append(reuse.cloneNode(true));
  }
  // A sibling, not a child: the error div holds only text, which React rewrites on an update.
  for (const error of document.querySelectorAll<HTMLElement>("[data-search-row] > .turn-error")) {
    if (!(error.nextElementSibling?.classList.contains("ours-retry-button") ?? false)) error.after(retry.cloneNode(true));
  }
};
new MutationObserver(() => { if (!frame) frame = requestAnimationFrame(decorate); }).observe(document.body, { childList: true, subtree: true });

window.addEventListener("click", (event) => {
  const button = event.target instanceof Element ? event.target.closest(".ours-reuse-button, .ours-retry-button") : null;
  const key = button?.closest<HTMLElement>("[data-search-row]")?.dataset.searchRow;
  if (!button || !key) return;
  event.preventDefault();
  const again = button.classList.contains("ours-reuse-button");
  void snapshot().then((state) => {
    const row = state.transcript.find((item) => item.key === key);
    // "Use again" takes exactly its own message; Retry the prompt the failed turn answered.
    const text = again ? row?.item.type === "user_message" ? recallText(row.item.text) : "" : promptBefore(state.transcript, key);
    if (text) putPrompt(state, text);
  }).catch(report);
});
