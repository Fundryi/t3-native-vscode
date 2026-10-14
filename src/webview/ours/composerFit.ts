/**
 * Q12 composerFit, webview only, no edit in his Composer.tsx:
 * - Height: his effect writes min(scrollHeight, 220) px inline on every text change; when it hits that cap we write the
 *   full scrollHeight and our CSS caps it at 40 percent of the view instead.
 * - Placeholder: his two strings get a hint about @ and /. His text stays a prefix (scripts/verify-ui.mjs finds the box
 *   by it). React rewrites the attribute only when `running` flips; the observer catches that.
 * - A failed send: his run() shows only the top banner (App.tsx), so the error is repeated above the box in his
 *   composer-attachment-error style until the next send or the next keystroke.
 */
import { bridge } from "../bridge-client";
import type { RpcMethod } from "../../shared/bridge";

// shortcut: keyed to his 220 px literal and two placeholder strings (Composer.tsx); re-check them on each upstream merge.
const HIS_CAP = "220px";
const HINT = " Type @ for files, / for commands.";
const HIS_PLACEHOLDERS = new Set(["Ask anything, or describe a task\u2026", "Send a follow-up\u2026"]);
const report = (cause: unknown) => console.error("T3 VSCode (fork): composerFit failed", cause);

const style = document.createElement("style");
style.textContent = ".composer-box textarea { max-height: 40vh !important; }";
document.head.append(style);

const fit = () => {
  for (const box of document.querySelectorAll<HTMLTextAreaElement>(".composer-box textarea")) {
    if (HIS_PLACEHOLDERS.has(box.placeholder)) box.placeholder += HINT;
    if (box.style.height === HIS_CAP && box.scrollHeight > 220) box.style.height = `${box.scrollHeight}px`;
  }
};
new MutationObserver(() => { try { fit(); } catch (cause) { report(cause); } })
  .observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["placeholder", "style"] });

const ERROR_CLASS = "ours-send-error";
const clearError = () => { for (const node of document.querySelectorAll(`.${ERROR_CLASS}`)) node.remove(); };
const showError = (cause: unknown) => {
  try {
    clearError();
    const textarea = document.querySelector<HTMLTextAreaElement>(".composer-box textarea");
    if (!textarea?.parentElement) return;
    const note = document.createElement("div");
    note.className = `composer-attachment-error ${ERROR_CLASS}`;
    note.setAttribute("role", "alert");
    note.textContent = `Not sent: ${cause instanceof Error ? cause.message : String(cause)}`;
    textarea.parentElement.insertBefore(note, textarea);
  } catch (error) { report(error); }
};
window.addEventListener("input", (event) => { if (event.target instanceof HTMLTextAreaElement) clearError(); }, true);

// Observe-only: his request runs once and his promise goes back unchanged, so his banner and his draft logic stay.
const request = bridge.request.bind(bridge);
bridge.request = <T>(method: RpcMethod, params?: unknown, timeoutMs?: number): Promise<T> => {
  const pending = request<T>(method, params, timeoutMs);
  if (method === "sendMessage") {
    try { clearError(); pending.then(undefined, showError); } catch (cause) { report(cause); }
  }
  return pending;
};
