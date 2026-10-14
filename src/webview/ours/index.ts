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

// R1 theme

// R2 defaults

// R3 viewbar

import "./working";

import "./scroll";

import "./diffcard";

import "./errors";

import "./openline";

// R10 dropview: package.json only (the drop view gets a when clause on t3-vscode.ours.drop.showView), no code here.

// R11 actions

// R12 setup

// R13 focus

// R14 keys2

// R15 announce

// R16 output: built into ./rowCopy (Open in editor, keyboard focus and Ctrl+C on the command and output boxes)

// R17 hunks

import "./substop";

// R19 emptylist

// R20 longmsg
