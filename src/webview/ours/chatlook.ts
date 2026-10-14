/**
 * X2 chatlook, webview only plus the setting. Who wrote what at a glance, as in the Claude Code and Codex chats:
 * the user's message is a tinted bubble on the right under a "You" label, the assistant's turn runs full width
 * behind a quiet left rule from his "Assistant" header with the T3 mark down to its last row, a new user message
 * opens with extra space, and tool and command rows are smaller and muted. One stylesheet scoped under
 * html[data-ours-chatlook="bubbles"]; t3-vscode.ours.chatlook.style "plain" drops the attribute, which is his look.
 * Theme variables only (his tokens map them from --vscode-*), so light, dark and high contrast follow VS Code.
 * shortcut: anchored on his class names (.timeline-row, .user-message, .user-bubble, .response-header, .work-group,
 * .work-entry) and on the ported WorkLog's text-sm/text-secondary-label; re-check them on each upstream merge.
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
}`;
document.head.append(style);

const apply = (value: unknown) => {
  if (value === "plain") delete document.documentElement.dataset.oursChatlook;
  else if (value === "bubbles") document.documentElement.dataset.oursChatlook = "bubbles";
};
// The default at once, so neither the real host nor a host without the fork RPC shows a flash of the plain look.
apply("bubbles");
registerOursEvent("chatlook", (data) => apply(data.style));
void oursRequest<{ style?: unknown } | null>("chatlookStyle").then((reply) => apply(reply?.style), failed("chat look"));
