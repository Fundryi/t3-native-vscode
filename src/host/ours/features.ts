/**
 * The fork's features. Each builder replaces ITS OWN slot line below with one re-export, for example
 *   export { activateMcp as mcp } from "./mcp/index.js";
 * Keep the blank lines between slots: they let nine branches merge without conflicts.
 */

export { activateMcp as mcp } from "./mcp/index.js";

export { activateApprovals as approvals } from "./approvals.js";

export { activateStatusbar as statusbar } from "./statusbar.js";

export { activatePrompt as prompt } from "./prompt.js";

export { activateTasks as tasks } from "./tasks.js";

export { activateDesktop as desktop } from "./desktop.js";

export { activateLinks as links } from "./links.js";

export { activateSaveOnSend as saveOnSend } from "./saveOnSend.js";

export { activateDrop as drop } from "./drop.js";

export { activateLayout as layout } from "./layout.js";
