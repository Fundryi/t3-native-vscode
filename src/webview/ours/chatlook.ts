/**
 * X2 chatlook, webview only plus the setting. Who wrote what at a glance, as in the Claude Code and Codex chats:
 * the user's message is a tinted bubble on the right under a "You" label, the assistant's turn runs full width
 * behind a quiet left rule from his "Assistant" header with the T3 mark down to its last row, a new user message
 * opens with extra space, and tool and command rows are smaller and muted. One stylesheet scoped under
 * html[data-ours-chatlook="bubbles"]; t3-vscode.ours.chatlook.style "plain" drops the attribute, which is his look.
 * Theme variables only (his tokens map them from --vscode-*), so light, dark and high contrast follow VS Code.
 * shortcut: anchored on his class names (.timeline-row, .user-message, .user-bubble, .response-header, .work-group,
 * .work-entry) and on the ported WorkLog's text-sm/text-secondary-label; re-check them on each upstream merge.
 * R20 longmsg (both looks): a long user message folds to a few lines with a "Show full message" toggle. The clip sits
 * on the bubble's own .markdown child (not .message-references, which shares the class), never on the bubble: X2's
 * "You" label sits outside the bubble box. shortcut: same anchors plus .markdown and .message-references.
 */
import { oursRequest, registerOursEvent, failed } from "./channel";

const ON = 'html[data-ours-chatlook="bubbles"]';
const style = document.createElement("style");
style.textContent = `
${ON} { --ours-you: var(--primary); --ours-you-surface: color-mix(in srgb, var(--primary) 13%, transparent); --ours-you-border: color-mix(in srgb, var(--primary) 32%, transparent); --ours-rule: color-mix(in srgb, var(--muted-foreground) 35%, transparent); }
${ON} body.vscode-high-contrast, ${ON} body.vscode-high-contrast-light { --ours-you-border: var(--vscode-contrastActiveBorder, var(--vscode-contrastBorder, #fff)); --ours-rule: var(--vscode-contrastBorder, #fff); }
/* flow-root keeps the message margins inside the row, so the rule runs unbroken from row to row. The rule is a
   background in the row's left padding: no layout change, and it stays clear of the view edge. */
${ON} .transcript-list .timeline-row { display: flow-root; }
${ON} .transcript-list .timeline-row:not(:has(.user-message)) { background: linear-gradient(var(--ours-rule), var(--ours-rule)) 12px 0 / 2px 100% no-repeat; }
${ON} .timeline-row:has(.user-message) { padding-top: 10px; }
/* The label floats above the bubble, so his row (bubble, copy, reprompt) keeps its one line. */
${ON} .user-message { padding-top: 18px; }
${ON} .user-bubble { position: relative; }
${ON} .user-bubble::before { content: "You"; position: absolute; bottom: calc(100% + 2px); right: 6px; color: var(--ours-you); font-size: .6875rem; font-weight: 600; line-height: 1.4; }
${ON} .user-bubble { max-width: min(calc(100% - 27px), 88%); padding: 7px 13px; border: 1px solid var(--ours-you-border); border-radius: 14px 14px 4px 14px; background: var(--ours-you-surface); color: var(--foreground); }
${ON} .timeline-row .message-author { color: var(--foreground); }
${ON} .timeline-row .message-author > span:not(.working-label) { color: var(--foreground); font-weight: 600; }
${ON} .work-group-toggle, ${ON} .work-entry, ${ON} .work-entry .text-secondary-label { color: var(--muted-foreground); }
${ON} .work-group-toggle, ${ON} .work-entry .text-sm { font-size: .75rem; }
${ON} .work-group-toggle:hover, ${ON} .work-entry button:hover .text-secondary-label { color: var(--foreground); }
${ON} .work-entry pre { color: var(--foreground); }
@container (max-width: 720px) {
  ${ON} .user-bubble { max-width: calc(100% - 27px); }
  ${ON} .transcript-list .timeline-row:not(:has(.user-message)) { padding-left: 22px; background-position: 7px 0; }
}
.user-bubble[data-ours-fold="closed"] > .markdown:not(.message-references) { max-height: min(16.5em, 40vh); overflow: clip; -webkit-mask-image: linear-gradient(#000 calc(100% - 3em), transparent); mask-image: linear-gradient(#000 calc(100% - 3em), transparent); }
.user-bubble > .ours-fold-toggle { display: block; margin: 4px 0 2px auto; font-size: .75rem; }`;
document.head.append(style);

const apply = (value: unknown) => {
  if (value === "plain") delete document.documentElement.dataset.oursChatlook;
  else if (value === "bubbles") document.documentElement.dataset.oursChatlook = "bubbles";
};
// The default at once, so neither the real host nor a host without the fork RPC shows a flash of the plain look.
apply("bubbles");
registerOursEvent("chatlook", (data) => apply(data.style));
void oursRequest<{ style?: unknown } | null>("chatlookStyle").then((reply) => apply(reply?.style), failed("chat look"));

// R20 longmsg. The list is virtual and remounts rows on scroll, so the opened ones are kept by row key.
const reportFold = failed("long message fold");
const opened = new Set<string>();
const SHOW = "Show full message", LESS = "Show less";
const text = (bubble: HTMLElement) => bubble.querySelector<HTMLElement>(":scope > .markdown:not(.message-references)");
const setFold = (bubble: HTMLElement, open: boolean) => {
  bubble.dataset.oursFold = open ? "open" : "closed";
  const toggle = bubble.querySelector<HTMLButtonElement>(":scope > .ours-fold-toggle");
  if (toggle) { toggle.textContent = open ? LESS : SHOW; toggle.setAttribute("aria-expanded", String(open)); }
};
let foldFrame = 0;
const fold = () => {
  foldFrame = 0;
  try {
    for (const bubble of document.querySelectorAll<HTMLElement>(".user-message > .user-bubble:not([data-ours-fold])")) {
      const body = text(bubble);
      if (!body || !body.getClientRects().length) continue; // no text, references only, or not laid out yet
      bubble.dataset.oursFold = "closed";
      // Fold only when it hides at least about three lines; otherwise the toggle would reveal next to nothing.
      if (body.scrollHeight - body.clientHeight < 3 * (parseFloat(getComputedStyle(body).lineHeight) || 20)) { bubble.dataset.oursFold = "none"; continue; }
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "text-button ours-fold-toggle";
      bubble.append(toggle); // a trailing element child: React updates leave it alone (as reprompt's button)
      const key = bubble.closest<HTMLElement>("[data-search-row]")?.dataset.searchRow;
      setFold(bubble, key !== undefined && opened.has(key));
    }
  } catch (cause) { reportFold(cause); }
};
new MutationObserver(() => { if (!foldFrame) foldFrame = requestAnimationFrame(fold); }).observe(document.body, { childList: true, subtree: true });
window.addEventListener("click", (event) => {
  try {
    const toggle = event.target instanceof Element ? event.target.closest<HTMLElement>(".ours-fold-toggle") : null;
    const bubble = toggle?.parentElement;
    if (!bubble) return;
    const open = bubble.dataset.oursFold !== "open", key = bubble.closest<HTMLElement>("[data-search-row]")?.dataset.searchRow;
    if (key !== undefined) { if (open) opened.add(key); else opened.delete(key); }
    setFold(bubble, open);
    if (!open) bubble.scrollIntoView({ block: "nearest" }); // a 300-line collapse must not strand the view far below
  } catch (cause) { reportFold(cause); }
});
