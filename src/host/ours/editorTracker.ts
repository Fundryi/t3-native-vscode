/**
 * The last file editor of this window and its selection (used by A's activeFile tool and P1 idectx).
 * activeTextEditor is undefined while focus sits in a webview such as a T3 chat, so the last one is kept.
 * Only files inside a workspace folder count.
 */
import * as vscode from "vscode";

export interface TrackedEditor { readonly doc: vscode.TextDocument; readonly sel: vscode.Selection }

export function createEditorTracker(): { current(): TrackedEditor | null; dispose(): void } {
  let last: TrackedEditor | null = null;
  const relevant = (doc: vscode.TextDocument) => doc.uri.scheme === "file" && !!vscode.workspace.getWorkspaceFolder(doc.uri);
  const track = (editor: vscode.TextEditor | undefined, sel?: vscode.Selection) => { if (editor && relevant(editor.document)) last = { doc: editor.document, sel: sel ?? editor.selection }; };
  track(vscode.window.activeTextEditor);
  const subscriptions = vscode.Disposable.from(
    vscode.window.onDidChangeActiveTextEditor((editor) => track(editor)), // undefined when focus moves into a webview: keep the last one
    // A background editor may move the remembered document's selection, never become the remembered document.
    vscode.window.onDidChangeTextEditorSelection((e) => { if (e.textEditor === vscode.window.activeTextEditor || last?.doc === e.textEditor.document) track(e.textEditor, e.selections[0]); }),
    vscode.workspace.onDidCloseTextDocument((doc) => { if (last?.doc === doc) last = null; }),
  );
  return {
    current: () => { if (last && (last.doc.isClosed || !relevant(last.doc))) last = null; return last; },
    dispose: () => subscriptions.dispose(),
  };
}
