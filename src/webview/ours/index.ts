/**
 * The fork's webview entry, imported once by his src/webview/main.tsx.
 * Each builder with a webview part replaces ITS OWN slot line below with one import, for example
 *   import "./drop";
 * and registers there with registerOursEvent (./channel).
 * Keep the blank lines between slots: they let nine branches merge without conflicts.
 */
import "./composer";

// A mcp

// B approvals

// C statusbar

// D prompt

// E tasks

// F desktop

// G links

// H saveOnSend

import "./drop";

import "./layout";

// Q1b sidebar

// Q2 keys

import "./toasts";

import "./reconnect";

import "./escape";

// Q7 statusbar2

// Q8 contexts

import "./latest";

import "./reprompt";

import "./composerFit";

import "./planMode";

import "./fileLinks";

import "./diffs";

import "./approvalKeys";

import "./rowCopy";

import "./shiftHint";

import "./visit";

import "./secrets";

import "./threadActions";

import "./contextMeter";

// X1 models

import "./chatlook";

import "./titleButton";

import "./polish";

import "./defaults";

// R3 viewbar: in ./layout (the slim bar it hides and the "+" labels sit there)

import "./working";

import "./scroll";

import "./diffcard";

import "./errors";

import "./openline";

// R10 dropview: package.json only (the drop view gets a when clause on t3-vscode.ours.drop.showView), no code here.

// R11 actions: host-side only (src/host/ours/threadActions.ts)

// R12 setup

import "./focus";

import "./listKeys";

// R15 announce

// R16 output: built into ./rowCopy (Open in editor, keyboard focus and Ctrl+C on the command and output boxes)

// R17 hunks

import "./substop";

import "./emptyList";

// R20 longmsg: in ./chatlook (X2), no import of its own

// C1 contnative: two icons in ./threadActions (the entries come from the host list)

// C2 importchat: host only (command palette and the sessions view menu), no webview code.

// C3 onewriter: host only (wraps sendMessage in src/host/ours/oneWriter.ts), no webview part.

import "./ideContext";

import "./background";

// P3 allchanges: one icon in ./threadActions (the entry comes from the host list)

import "./undoturn";

// P5 planready: host toast only (src/host/ours/planReady.ts), no webview code

import "./goal";

import "./unread";

// P8 scope: host only (wraps workspaceRoots in src/host/ours/scope.ts), no webview part.

// P9 lsp: no webview part

// P10 quiet: host only (src/host/ours/mcp/setup.ts, drop.ts, saveOnSend.ts)

// P11 snapmemo: host only (src/host/ours/snapshotMemo.ts), no webview code.

import "./rewind";

import "./review";

// P14 worktree: host only (src/host/ours/worktree.ts); its Thread Actions entry reaches his menu through threadActions.list, icon in ./threadActions.ts.

import "./modelOptions";

// P16 tidy

// P17 logs: host only (log lines in src/host/ours/logs.ts, index.ts, log.ts, drop.ts), no webview code.

// P18 help: host only (src/host/ours/help.ts), no webview code.

// P19 mergeback: lives in threadActions.ts (the host lists the entry; one icon there)

// P20 deeplink: host only (src/host/ours/links.ts)
