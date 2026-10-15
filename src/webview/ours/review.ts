/**
 * P13 review, webview side: picking our /review in his suggestion list asks the host to open the review picker
 * (src/host/ours/review.ts). Read from his suggestion markup in capture listeners, as Q13 planMode.ts does; his handler
 * still runs and clears the typed token. Ours is known by its description, since its label changes next to a provider /review.
 */
import { REVIEW_DESCRIPTION } from "../../shared/ours/review";
import { oursRequest, failed } from "./channel";

const report = failed("review");

/** Text besides the slash token, or a chip: the host must not send over it (his send clears the draft). */
function draftInUse(): boolean {
  const box = document.querySelector(".composer-box");
  const text = box?.querySelector("textarea")?.value ?? "";
  return text.replace(/^\s*\/\S*/, "").trim() !== "" || !!box?.querySelector(".composer-chip");
}

function pick(option: Element | null | undefined): void {
  if (option?.querySelector(".suggestion-description")?.textContent !== REVIEW_DESCRIPTION) return;
  void oursRequest("reviewOpen", { draftInUse: draftInUse() }).catch(report);
}

// The same conditions as his suggestion keys (Composer.tsx onKeyDown): Enter or Tab without modifiers while the list is open.
window.addEventListener("keydown", (event) => {
  try {
    if (event.isComposing || event.keyCode === 229 || event.shiftKey || event.ctrlKey || event.metaKey) return;
    if (event.key !== "Enter" && event.key !== "Tab") return;
    if (!(event.target instanceof HTMLTextAreaElement) || !event.target.closest(".composer-box")) return;
    pick(document.querySelector("#composer-suggestions [aria-selected=\"true\"]"));
  } catch (cause) { report(cause); }
}, true);
window.addEventListener("click", (event) => {
  try { pick(event.target instanceof Element ? event.target.closest("#composer-suggestions [role=\"option\"]") : null); }
  catch (cause) { report(cause); }
}, true);
