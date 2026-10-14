/**
 * Q17 approval keys, webview side. Alt+1..9 answers the docked approval card (his PendingRequests.tsx) or picks an
 * option on the question card, and after any answer focus returns to the chat box (his card drops it to the body).
 * No line of his changes: window capture listeners click his own buttons and inputs.
 */
const FOCUS_WATCH_MS = 30_000;
const ACTIONS = ".pending-requests .request-actions button";

const style = document.createElement("style");
style.textContent = `
.approval-card .request-actions button:nth-child(-n+9)::after { counter-increment: ours-key; content: "Alt+" counter(ours-key); margin-left: 6px; font-size: 0.85em; opacity: 0.6; }
.approval-card .request-actions, .question-options { counter-reset: ours-key; }
.question-option:nth-child(-n+9) strong::after { counter-increment: ours-key; content: "Alt+" counter(ours-key); margin-left: 6px; font-weight: normal; opacity: 0.6; }`;
document.head.append(style);

/** The question group Alt+N acts on: the one holding focus, else the first unanswered, else the last. */
function questionGroup(card: Element): HTMLFieldSetElement | undefined {
  const groups = [...card.querySelectorAll("fieldset")];
  return groups.find((group) => group.contains(document.activeElement))
    ?? groups.find((group) => !group.querySelector("input:checked"))
    ?? groups.at(-1);
}

/** Returns the Nth button or option (clicked unless busy), or undefined when there is none (VS Code then keeps the key). */
function pick(index: number): HTMLElement | undefined {
  const approval = document.querySelector(".pending-requests .approval-card");
  if (approval) {
    const button = approval.querySelectorAll<HTMLButtonElement>(".request-actions button")[index];
    // A busy button still swallows the key, so a second press while sending never flips the editor tab.
    if (button && !button.matches(":disabled")) button.click();
    return button;
  }
  const card = document.querySelector<HTMLFormElement>(".pending-requests .question-card");
  if (!card) return undefined;
  const input = questionGroup(card)?.querySelectorAll<HTMLInputElement>(".question-option input")[index];
  if (!input || input.matches(":disabled")) return input; // his fieldset disables its inputs while sending
  input.click();
  // Single-choice cards send once every question has an answer. His Submit enables on the next React commit, so wait a frame.
  if (!card.querySelector("input[type=checkbox]")) requestAnimationFrame(() => {
    const complete = [...card.querySelectorAll("fieldset")].every((group) => group.querySelector("input:checked"));
    const submit = card.querySelector<HTMLButtonElement>("button[type=submit]");
    if (complete && submit && !submit.disabled) card.requestSubmit(submit);
  });
  return input;
}

// Set while a swallowed Alt+N chord is held. VS Code saw Alt go down but not the digit, so an Alt keyup reaching it
// first would read as a lone Alt tap and focus the menu bar (ModifierKeyEmitter + menubar, VS Code 7baac39ec3).
let swallowed = false;

// Capture phase on window: stopPropagation keeps the key from VS Code's own bubble keydown listener on this window
// (webview pre/index.html handleInnerKeydown), which would also run its Alt+N "open editor N" binding.
window.addEventListener("keydown", (event) => {
  swallowed = false;
  // macOS: Option+digit types symbols, so the shortcut is Windows and Linux only.
  if (/Mac/.test(navigator.platform)) return;
  const digit = /^Digit([1-9])$/.exec(event.code);
  // Ctrl+Alt is AltGr on German and similar layouts, where it types { [ ] }.
  if (!digit || !event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.isComposing) return;
  if (!document.querySelector(".pending-requests .approval-card, .pending-requests .question-card")) return;
  if (!event.repeat && !pick(Number(digit[1]) - 1)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  swallowed = true;
}, true);

// Digit up while Alt is held resets VS Code's tracker, so let it pass. Alt up first: hide it and the digit up after it.
// shortcut: VS Code then keeps altKey=true until the next modifier key or window blur (alt toolbar variants show);
// upgrade to a host alt+1..9 keybinding if that bites.
window.addEventListener("keyup", (event) => {
  if (!swallowed) return;
  if (event.altKey) { swallowed = false; return; }
  event.stopImmediatePropagation();
}, true);

/** Refocus the chat box once the answer settled: the button left the page, or was disabled and is enabled again. */
function refocusAfter(target: HTMLElement): void {
  const until = performance.now() + FOCUS_WATCH_MS;
  let seenDisabled = false;
  const check = () => {
    const disabled = target.matches(":disabled");
    seenDisabled ||= disabled;
    const settled = !target.isConnected || (seenDisabled && !disabled);
    if (!settled) { if (performance.now() < until) requestAnimationFrame(check); return; }
    const active = document.activeElement;
    // Never steal focus the user moved somewhere else meanwhile.
    // hasFocus: inside the iframe activeElement keeps its value after the user clicked into an editor.
    if (!document.hasFocus()) return;
    if (!active || active === document.body || active === target || active.closest(".pending-requests")) {
      window.dispatchEvent(new CustomEvent("t3-focus-composer"));
    }
  };
  requestAnimationFrame(check);
}

window.addEventListener("click", (event) => {
  const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>(ACTIONS) : null;
  // A Submit click is handled by the submit listener below; the approval buttons sit in no form.
  if (button && !(button.form && button.type === "submit")) refocusAfter(button);
}, true);
// Enter in a custom answer submits without a click; Submit clicks also land here.
window.addEventListener("submit", (event) => {
  const form = event.target instanceof HTMLFormElement && event.target.matches(".pending-requests .question-card") ? event.target : null;
  const submit = form?.querySelector<HTMLButtonElement>("button[type=submit]");
  if (submit) refocusAfter(submit);
}, true);
