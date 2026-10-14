/**
 * R1 theme, webview only. The chat takes VS Code's own colours for hover, focus, buttons, menus and scrollbars (high
 * contrast included), no text is smaller than .6875rem (11 px at his default 16 px interface size), and a chat in the
 * side bar has the side bar colour (his tokens use the editor colour everywhere). One stylesheet after his, so a rule
 * that copies his selector wins on order. X2 (chatlook.ts) owns the user bubble and the .work-* rows: not restyled here.
 * shortcut: anchored on his class names and selectors in styles/tokens.css; re-check them on each upstream merge.
 */

export {}; // a module, not a script: its consts stay its own

// Stamped once from the host's HTML; layout.ts later flips data-surface to "panel" while the sidebar shows a chat.
if (document.body.dataset.surface === "sidebar") document.body.dataset.oursSurface = "sidebar";

const SIDE = 'body[data-ours-surface="sidebar"]';
const HC = ":is(body.vscode-high-contrast, body.vscode-high-contrast-light)";
const SHADOW = "var(--vscode-widget-shadow, #0003)";
const FLOOR = ".6875rem";
// Every selector of his that sets a font below the floor, copied verbatim so the override ties on specificity.
const SMALL = [
  ".thread-match", ".message-author .streaming-label", ".work-status", ".project-trigger", ".model-providers button small",
  ".model-options header", ".model-options small", ".model-picker-footer", ".model-preferences-note", ".composer-footnote",
  ".composer-hint", ".question-option small", ".change-counts", ".thread-branch", ".thread-meta", ".thread-age",
  ".thread-working", ".thread-input", ".history-settings > span", ".account-usage > summary", ".account-limit small",
  ".setup-connection-state", ".server-setup .setup-section-label", ".setup-service summary span", ".message-nav-position",
  ".message-nav-response", ".message-nav-latest", ".work-group-failures", ".visual-actions", ".find-count",
  ".find-result-meta", ".find-resize", ".find-context-popover p", ".compact-history .history-heading > span",
  ".history-picker-hint", ".list-assist-toggle", ".composer-shortcuts", ".scheduled-task-meta", ".task-weekdays label",
];

const style = document.createElement("style");
style.textContent = `
${SIDE} { --background: var(--vscode-sideBar-background, #fafafa); --muted: color-mix(in srgb, var(--foreground) 7%, transparent); --message-surface: color-mix(in srgb, var(--foreground) 7%, transparent); }
/* One line under the "Back to" bar: his chat header draws its own. */
${SIDE}[data-ours-chat] > .ours-sidebar-bar { border-bottom: 0; }

.icon-button:hover { background: var(--vscode-toolbar-hoverBackground, var(--muted)); }
.btn:not(.primary) { background: var(--vscode-button-secondaryBackground, var(--card)); color: var(--vscode-button-secondaryForeground, var(--foreground)); border-color: var(--vscode-button-border, var(--border)); }
.btn:not(.primary):hover { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-toolbar-hoverBackground, var(--muted))); }
.btn.primary:hover { background: var(--vscode-button-hoverBackground, var(--vscode-button-background, var(--primary))); }
.menu-popup, .thread-actions-popup { background: var(--vscode-menu-background, var(--card)); color: var(--vscode-menu-foreground, var(--foreground)); border-color: var(--vscode-menu-border, var(--border)); }
.menu-popup button:hover, .thread-actions-popup button:hover, .thread-actions-popup button:focus-visible { background: var(--vscode-menu-selectionBackground, var(--muted)); color: var(--vscode-menu-selectionForeground, var(--foreground)); }
.composer-suggestions > button:hover { background: var(--vscode-list-hoverBackground, var(--muted)); }
.composer-suggestions > button[aria-selected="true"] { background: var(--vscode-list-activeSelectionBackground, var(--muted)); color: var(--vscode-list-activeSelectionForeground, var(--foreground)); }
.composer-suggestions > button[aria-selected="true"] .suggestion-description { color: inherit; opacity: .8; }
${HC} :is(.icon-button, .btn, .menu-popup button, .thread-actions-popup button, .composer-suggestions > button):hover { outline: 1px dashed var(--vscode-contrastActiveBorder, var(--ring)); outline-offset: -1px; }

* { scrollbar-color: var(--vscode-scrollbarSlider-background, var(--input)) transparent; }
*::-webkit-scrollbar-thumb { background: var(--vscode-scrollbarSlider-background, var(--input)); }
*::-webkit-scrollbar-thumb:hover { background: var(--vscode-scrollbarSlider-hoverBackground, var(--input)); }
*::-webkit-scrollbar-thumb:active { background: var(--vscode-scrollbarSlider-activeBackground, var(--input)); }

/* VS Code's ring: 1 px inside the element, so a parent with overflow hidden cannot clip it. */
button:focus-visible, a:focus-visible { outline: 1px solid var(--ring); outline-offset: -1px; }
.composer-box:focus-within { border-color: var(--vscode-focusBorder, var(--ring)); }

.connection-dot { background: var(--vscode-testing-iconPassed, #22c55e); }
.menu-popup { box-shadow: 0 8px 30px ${SHADOW}; }
.thread-actions-popup, .composer-options-popup, .citation-selection-button { box-shadow: 0 4px 18px ${SHADOW}; }
.model-picker, .citation-comment { box-shadow: 0 10px 35px ${SHADOW}; }
.composer-suggestions { box-shadow: 0 6px 20px ${SHADOW}; }
.message-nav-preview, .math-context-menu, .model-drag-ghost { box-shadow: 0 3px 10px ${SHADOW}; }
.find-context-popover, .chat-scheduled-drawer { box-shadow: 0 5px 18px ${SHADOW}; }
.session-find[data-expanded="false"] { box-shadow: 0 3px 8px ${SHADOW}; }
@container (max-width: 720px) { .projects-sidebar { box-shadow: 15px 0 40px ${SHADOW}; } }

${SMALL.join(", ")} { font-size: ${FLOOR}; }

/* Copy and "use again" on my messages show on hover or keyboard focus, like his assistant actions. */
.user-message > .copy-button { opacity: 0; }
.user-message:hover > .copy-button, .user-message:focus-within > .copy-button { opacity: 1; }

/* The plan card at side bar width: its actions wrap under the title instead of squeezing it. */
.plan-card > header { flex-wrap: wrap; }
@container (max-width: 420px) { .plan-card { padding: 12px; border-radius: 12px; } }`;
document.head.append(style);
