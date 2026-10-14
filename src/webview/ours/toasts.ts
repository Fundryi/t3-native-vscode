/**
 * Q3 toasts, webview side: tells the host when this view is the chat the user is reading (it has keyboard focus and
 * shows a chat, not the sessions list), so the host skips toasts for that thread. Sends only on change.
 */
import { oursRequest, failed } from "./channel";

let sent: boolean | undefined;
// blur passes false: hasFocus() may still be true while blur dispatches.
const report = (focused = document.hasFocus()) => {
  const reading = focused && document.body.dataset.surface !== "sidebar";
  if (reading === sent) return;
  sent = reading;
  void oursRequest("toastsFocus", { reading }).catch(failed("toasts"));
};
window.addEventListener("focus", () => report(true));
window.addEventListener("blur", () => report(false));
// K layout flips the sidebar between the list and a chat.
new MutationObserver(() => report()).observe(document.body, { attributes: true, attributeFilter: ["data-surface"] });
report();
