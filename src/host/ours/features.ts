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

// Q1b sidebar

export { activateKeys as keys } from "./keys.js";

export { activateToasts as toasts } from "./finished.js";

export { activateReconnect as reconnect } from "./reconnect.js";

// Q5 escape

export { activateLogs as statusbar2 } from "./logs.js";

export { activateContexts as contexts } from "./contexts.js";

// Q10 latest

// Q11 reprompt

// Q12 composerFit

export { activatePlanMode as planMode } from "./planMode.js";

export { activateFileLinks as fileLinks } from "./fileLinks.js";

export { activateDiffs as diffs } from "./diffs.js";

// Q17 approvalKeys

// Q18 rowCopy

// Q21 shiftHint

export { activateVisit as read } from "./visit.js";

export { activateSecrets as secrets } from "./secrets.js";

export { activateThreadActions as threadActions } from "./threadActions.js";

export { activateContextMeter as contextMeter } from "./contextMeter.js";
