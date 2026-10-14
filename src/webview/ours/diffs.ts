/**
 * Q16 diffs, webview side. His "Open diff" on a turn with two or more files asks with a QuickPick for ONE file; a
 * capture listener sends it to the host's all-changes view instead. On any error his click runs as before.
 */
import { oursRequest } from "./channel";

let bypass = false;
window.addEventListener("click", (event) => {
  if (bypass || !(event.target instanceof Element)) return;
  const button = event.target.closest<HTMLElement>(".open-turn-diff");
  const box = button?.closest(".turn-changes");
  const checkpointId = box?.getAttribute("data-checkpoint-id");
  // His tree keeps every file button in the DOM, also inside closed folders.
  if (!button || !box || !checkpointId || box.querySelectorAll(".change-file").length < 2) return;
  event.preventDefault();
  event.stopPropagation(); // his React handler never sees it
  oursRequest("diffs.openAll", { checkpointId }).catch((cause: unknown) => {
    console.error("T3 VSCode (fork): all changes failed, his diff picker runs", cause);
    bypass = true;
    try { button.click(); } finally { bypass = false; }
  });
}, true);
