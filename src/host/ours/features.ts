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

export { activateModelSync as models } from "./modelSync.js";

export { activateChatlook as chatlook } from "./chatlook.js";

// X3 titlebtn: its host command lives in threadActions.ts

// R1 theme

export { activateDefaults as defaults } from "./defaults.js";

// R3 viewbar: lives in layout.ts (K layout owns the sidebar view and its chatShown state)

// R4 working

// R5 scroll

export { activateDiffcard as diffcard } from "./diffcard.js";

export { activateErrors as errors } from "./errors.js";

// R9 openline

// R10 dropview: package.json only (the drop view gets a when clause on t3-vscode.ours.drop.showView), no code here.

// R11 actions: lives in threadActions.ts (Q19 activation, no second feature)

// R12 setup

// R13 focus

// R14 keys2: lives in keys.ts (Q2 activation, no second feature)

// R15 announce

export { activateOutput as output } from "./output.js";

// R17 hunks

// R18 substop

export { activateEmptyList as emptyList } from "./emptyList.js";

// R20 longmsg

// C1 contnative: lives in threadActions.ts (continueNative.ts holds the hand-over; Q19 activation, no second feature)

export { activateImportChat as importchat } from "./importChat.js";

export { activateOneWriter as oneWriter } from "./oneWriter.js";

export { activateIdeContext as ideContext } from "./ideContext.js";

export { activateBackground as background } from "./background.js";

// P3 allchanges: lives in diffs.ts (Q16 activation) and threadActions.ts (the menu entry), no second feature

export { activateUndoTurn as undoTurn } from "./undoTurn.js";

export { activatePlanReady as planReady } from "./planReady.js";

export { activateGoal as goal } from "./goal.js";

export { activateUnread as unread } from "./unread.js";

export { activateScope as scope } from "./scope.js";

// P9 lsp: no activation; the MCP tools references and workspaceSymbols live in ./mcp/lsp.ts

// P10 quiet: no module; built into mcp/setup.ts, drop.ts and saveOnSend.ts

export { activateSnapshotMemo as snapmemo } from "./snapshotMemo.js";

export { activateRewind as rewind } from "./rewind.js";

export { activateReview as review } from "./review.js";

export { activateWorktree as worktree } from "./worktree.js";

// P15 modelopts: webview only (src/webview/ours/modelOptions.ts), no host part.

// P16 tidy

// P17 logs: lives in logs.ts (server version line), index.ts (activation line) and log.ts (debug level); no second feature

export { activateHelp as help } from "./help.js";

// P19 mergeback: lives in threadActions.ts (Q19 activation, no second feature)

// P20 deeplink: lives in links.ts (G activation, no second feature)

// C4 carryover: lives in importChat.ts (C2 activation, no second feature); the pure part is importChatCarry.ts
