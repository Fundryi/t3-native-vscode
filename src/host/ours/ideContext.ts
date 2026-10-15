/**
 * P1 idectx, host side: the file and lines I am looking at go with my prompt, as in Claude Code and Codex.
 * The webview (src/webview/ours/ideContext.ts) asks before each composer send, so host sends (Q20 Implement,
 * "/goal resume") never carry it. Requests:
 * - ideContext: the chip, { label, title } or null (setting off, no file editor, or its tab closed).
 * - ideContextText { text }: { text } with the reference appended (rules in ./ideContextText.ts).
 */
import * as vscode from "vscode";
import { editorReference } from "../editorReference.js";
import type { FileReference } from "../../shared/composerContext.js";
import { createEditorTracker } from "./editorTracker.js";
import { ideChipLabel, ideReference, withIdeReference } from "./ideContextText.js";
import { registerOursRpc } from "./rpc.js";
import type { OursFeature } from "./types.js";

/** onDidCloseTextDocument comes late or never for a closed tab, so the tab itself decides. */
const hasTab = (uri: vscode.Uri) => vscode.window.tabGroups.all.some((group) => group.tabs.some(({ input }) =>
  (input instanceof vscode.TabInputText && input.uri.toString() === uri.toString())
  || (input instanceof vscode.TabInputTextDiff && input.modified.toString() === uri.toString())));

export const activateIdeContext: OursFeature = () => {
  const tracker = createEditorTracker();
  const current = (): FileReference | null => {
    if (!vscode.workspace.getConfiguration("t3-vscode").get<boolean>("ours.ideContext.enabled", true)) return null;
    const last = tracker.current();
    if (!last || !hasTab(last.doc.uri)) return null;
    const range = last.doc.validateRange(last.sel); // the document may have changed since the selection event
    return ideReference(editorReference({ document: last.doc, selection: new vscode.Selection(range.start, range.end) }, vscode.workspace.getWorkspaceFolder(last.doc.uri)?.uri.fsPath));
  };
  const offs = [
    registerOursRpc("ideContext", () => {
      const reference = current();
      return reference && { label: ideChipLabel(reference), title: reference.label };
    }),
    registerOursRpc("ideContextText", (params) => {
      if (typeof params.text !== "string") throw new Error("Invalid message text.");
      const reference = current();
      return { text: reference ? withIdeReference(params.text, reference) : params.text };
    }),
  ];
  return { dispose: () => { for (const off of offs) off(); tracker.dispose(); } };
};
