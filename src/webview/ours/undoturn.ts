/**
 * P4 undoturn, webview side. An "Undo" button on every turn changes card, left of his "Open diff". Appended after his
 * children like R7's note (./diffcard.ts): his card's children are fixed, so React keeps our node, and a re-created
 * card gets a new button from the observer. Own class: ./diffs.ts captures clicks on .open-turn-diff.
 */
import { failed, oursRequest } from "./channel";

const BUTTON = "ours-undoturn";
const ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>';

const style = document.createElement("style");
style.textContent = `.${BUTTON} { display: inline-flex; align-items: center; gap: 4px; position: absolute; top: 6px; right: 78px; padding: 2px; border: 0; background: transparent; color: var(--foreground); font-size: 0.6875rem; cursor: pointer; }
.${BUTTON}:disabled { opacity: 0.5; cursor: default; }
.turn-changes:has(> .${BUTTON}) > details > summary { padding-right: 140px; }`;
document.head.append(style);

const add = () => {
  for (const box of document.querySelectorAll<HTMLElement>(`.turn-changes[data-checkpoint-id]:not(:has(> .${BUTTON}))`)) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = BUTTON;
    button.title = "Undo turn: put back every file this turn changed (the chat stays)";
    button.setAttribute("aria-label", "Undo turn: put back every file this turn changed");
    button.innerHTML = `${ICON}<span>Undo</span>`;
    button.addEventListener("click", () => {
      // Read at click time: React may reuse the card for another turn.
      const checkpointId = button.closest<HTMLElement>(".turn-changes")?.dataset.checkpointId;
      if (!checkpointId) return;
      button.disabled = true;
      oursRequest("undoturn.run", { checkpointId }).catch(failed("undo turn")).finally(() => { button.disabled = false; });
    });
    box.append(button);
  }
};

let queued = false;
new MutationObserver(() => {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => { queued = false; add(); });
}).observe(document.body, { childList: true, subtree: true });
add();
