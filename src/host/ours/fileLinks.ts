/**
 * Q15 fileLinks (docs/ours/FORK-FEATURES.md Q15): a file link in a chat opens with VS Code's own editor for the file
 * (text, image, pdf), and from a chat in an editor tab it opens in another editor group, so the chat stays visible.
 * His openLink (host/bridge.ts) is private; src/webview/ours/fileLinks.ts sends file links here instead. Anything this
 * handler does not open (a missing file, a bad link) throws, and the webview then runs his openLink. A directory opens
 * quick open scoped to it instead of his revealInExplorer, so the T3 chat in the side bar stays.
 */
import * as vscode from "vscode";
import { resolveChatFileLink } from "../fileLinks.js";
import { SIDEBAR_VIEW_ID } from "../hostState.js";
import { log } from "./log.js";
import { registerOursRpc } from "./rpc.js";
import type { OursFeature } from "./types.js";

export const activateFileLinks: OursFeature = ({ hostState }) => {
  const off = registerOursRpc("fileLinks.open", async (params, viewId) => {
    if (typeof params.href !== "string") throw new Error("Invalid link.");
    const threadId = typeof params.threadId === "string" ? params.threadId : undefined;
    const target = resolveChatFileLink(params.href, hostState.workspaceForThread(threadId));
    const uri = vscode.Uri.file(target.path);
    const { type } = await vscode.workspace.fs.stat(uri);
    if (type & vscode.FileType.Directory) {
      // Not his revealInExplorer: that swaps the side bar from the T3 chat to the Explorer. Quick open stays in the editor.
      // shortcut: a folder outside the workspace or the root itself gets a quick open that lists little; upgrade if links like that show up.
      await vscode.commands.executeCommand("workbench.action.quickOpen", `${vscode.workspace.asRelativePath(uri, false)}/`);
      return hostState.snapshot(viewId);
    }
    if (!(type & vscode.FileType.File)) throw new Error("Not a file.");
    // A click in a chat tab makes its group the active one; the sidebar chat is in no group, so Active is fine there.
    const groups = vscode.window.tabGroups;
    const viewColumn = viewId === SIDEBAR_VIEW_ID ? vscode.ViewColumn.Active : groups.all.find((group) => group !== groups.activeTabGroup)?.viewColumn ?? vscode.ViewColumn.Beside;
    try {
      if (!target.line) await vscode.commands.executeCommand("vscode.open", uri, { viewColumn, preview: true });
      else {
        // A position means a text file; the end of a line-only range needs the document, as in his openLink.
        const document = await vscode.workspace.openTextDocument(uri);
        const editor = await vscode.window.showTextDocument(document, { viewColumn, preview: true });
        const position = new vscode.Position(target.line - 1, (target.column ?? 1) - 1);
        const end = target.endLine ? new vscode.Position(target.endLine - 1, target.endColumn === undefined ? document.lineAt(Math.min(document.lineCount - 1, target.endLine - 1)).text.length : target.endColumn - 1) : position;
        editor.selection = new vscode.Selection(position, end); editor.revealRange(new vscode.Range(position, end));
      }
    } catch (cause) { log.error(`File link: opening ${target.path} failed; his openLink runs.`, cause); throw cause; }
    return hostState.snapshot(viewId); // his run() feeds the result to receive() as a snapshot
  });
  return { dispose: off };
};
