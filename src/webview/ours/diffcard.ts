/**
 * R7 diffcard, webview side. The host says which turn cards come from the checkpoint range in place of the agent-only
 * baseline; those get "May include your own edits". Appended after his .open-turn-diff button: his card's children
 * are fixed, so React keeps our node, and a re-created card is marked again by the observer.
 */
import { registerOursEvent } from "./channel";

const NOTE = "ours-diffcard-note";
const mixed = new Set<string>();

const style = document.createElement("style");
style.textContent = `.${NOTE} { padding: 0 10px 7px 30px; margin-top: -4px; color: var(--muted-foreground); font-size: 0.6875rem; }`;
document.head.append(style);

const mark = () => {
  for (const box of document.querySelectorAll<HTMLElement>(".turn-changes[data-checkpoint-id]")) {
    if (!mixed.has(box.dataset.checkpointId ?? "") || box.querySelector(`.${NOTE}`)) continue;
    const note = document.createElement("div");
    note.className = NOTE;
    note.textContent = "May include your own edits";
    note.title = "No snapshot was saved right before this turn (queued, steered, started in the T3 app, or older), so this shows everything that changed since the previous turn.";
    box.append(note);
  }
};

registerOursEvent("diffcard.mixed", (data) => {
  if (typeof data.checkpointId !== "string") return;
  mixed.add(data.checkpointId);
  mark();
});
new MutationObserver(() => { if (mixed.size) mark(); }).observe(document.body, { childList: true, subtree: true });
