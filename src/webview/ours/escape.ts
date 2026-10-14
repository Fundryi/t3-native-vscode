/**
 * Q5 escape: Escape in the chat box (or the transcript) stops the running turn, as in Claude Code and Codex.
 * It acts only when nothing else wanted the key: his popups either call preventDefault (Composer mention list, model
 * picker, find, history, thread menu, math menu, message navigator, citation comment) or are found in the DOM.
 * The DOM check runs in the window capture phase, before any handler (his image dialog's document listener) can close
 * its popup; the decision runs in the window bubble phase, after React's root handlers had their chance.
 */
// details: only his composer overflow menu; transcript details (changed files) stay open as content, not popups.
const POPUPS = "[role=dialog], [role=menu], details.composer-options-overflow[open]";
let popupAtKeyDown = false;

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") popupAtKeyDown = document.querySelector(POPUPS) !== null;
}, true);

window.addEventListener("keydown", (event) => {
  try {
    if (event.key !== "Escape" || event.defaultPrevented || event.repeat || event.isComposing || popupAtKeyDown) return;
    if (event.ctrlKey || event.altKey || event.shiftKey || event.metaKey) return;
    const target = event.target instanceof Element ? event.target : null;
    const chat = target?.closest(".chat-main[data-thread-id]:not([data-thread-id=''])");
    if (!chat || !target) return;
    const inComposer = target instanceof HTMLTextAreaElement && target.closest(".composer-box") !== null;
    if (!inComposer && !target.closest(".transcript-container")) return;
    // His stop button exists only while this chat's turn runs; its click is his own interrupt path.
    const stop = chat.querySelector<HTMLButtonElement>(".stop-button");
    if (!stop || stop.disabled) return;
    event.preventDefault();
    stop.click();
  } catch (cause) { console.error("T3 VSCode (fork): escape failed", cause); }
});
