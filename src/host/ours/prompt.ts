/**
 * D add-to-prompt: files, terminal text, the last command, a TODO, a Problem and "review my changes" into the T3 composer.
 * Alt+K (a selection) is his t3-vscode.insertReference. Nothing here ever sends.
 */
import * as vscode from "vscode";
import { stat } from "node:fs/promises";
import { basename } from "node:path";
import { editorReference } from "../editorReference.js";
import { SIDEBAR_VIEW_ID } from "../hostState.js";
import { fileReference, insertAttachments, insertFile, insertText, isAttachableImage } from "./composer.js";
import { fenced, lastCommandText, MAX_PROMPT_CHARS, todoLines } from "./promptText.js";
import { terminalRuns } from "./terminalRuns.js";
import type { OursDeps } from "./types.js";

const MAX_FILES = 50;
const MAX_FIXES = 3;

export function activatePrompt(deps: OursDeps): vscode.Disposable {
  /** Errors as his insertReference shows them; a command never throws into VS Code. */
  const guarded = <A extends unknown[]>(run: (...args: A) => Promise<unknown>) => async (...args: A): Promise<void> => {
    try { await run(...args); } catch (cause) { await vscode.window.showErrorMessage(String(cause)); }
  };

  /**
   * The chat that gets the insert, made visible: createPanel reveals and focuses the panel that already shows the thread,
   * else opens one (as his insertReference). Afterwards registry.focusedViewId is that panel, so insertText agrees.
   */
  const targetPanel = async (): Promise<string> => {
    const focused = deps.registry.focusedViewId;
    if (focused === SIDEBAR_VIEW_ID || deps.hostState.snapshot(focused).activeThreadId) return deps.provider.createPanel(focused);
    // shortcut: a panel on a fresh draft (no thread yet) is not revealed for text or images (file references are, through
    // his insertReference); upgrade when his provider exposes a reveal.
    return focused;
  };

  const addText = async (text: string) => { await targetPanel(); await insertText(deps, text); };

  /** The whole lines of a range of a file, with their snapshot, as his editorReference builds it. */
  const lineReference = async (uri: vscode.Uri, range: vscode.Range) => {
    const document = await vscode.workspace.openTextDocument(uri);
    const end = Math.min(range.end.line, document.lineCount - 1);
    const selection = new vscode.Selection(document.lineAt(Math.min(range.start.line, end)).range.start, document.lineAt(end).range.end);
    return editorReference({ document, selection }, vscode.workspace.getWorkspaceFolder(uri)?.uri.fsPath);
  };

  const todoLensChanged = new vscode.EventEmitter<void>();

  return vscode.Disposable.from(
    // 1. Explorer (multi-select), tab menu, palette: images as attachments, everything else as a whole-file reference.
    vscode.commands.registerCommand("t3-vscode.ours.prompt.addFiles", guarded(async (uri?: unknown, uris?: unknown) => {
      let picked = Array.isArray(uris) && uris.length ? uris.filter((item) => item instanceof vscode.Uri).slice(0, MAX_FILES)
        : uri instanceof vscode.Uri ? [uri] : vscode.window.activeTextEditor ? [vscode.window.activeTextEditor.document.uri] : [];
      // T3 can open only files on this machine (folders included); an untitled or output editor is not one.
      picked = picked.filter((item) => item.scheme === "file");
      if (!picked.length) { void vscode.window.showInformationMessage("Open a file first."); return; }
      const viewId = await targetPanel();
      const images: vscode.Uri[] = [];
      for (const file of picked) {
        const info = await stat(file.fsPath).catch(() => undefined);
        if (info?.isFile() && isAttachableImage(basename(file.fsPath), info.size)) images.push(file);
        else await insertFile(deps, fileReference(file));
      }
      if (images.length) await insertAttachments(deps, viewId, images);
    })),
    // 3. Terminal selection. Terminal.selection is not in the @types/vscode this builds against, so through the clipboard.
    vscode.commands.registerCommand("t3-vscode.ours.prompt.addTerminalSelection", guarded(async () => {
      const saved = await vscode.env.clipboard.readText();
      let text = "";
      try {
        await vscode.env.clipboard.writeText("");
        await vscode.commands.executeCommand("workbench.action.terminal.copySelection");
        text = await vscode.env.clipboard.readText();
      } finally { await vscode.env.clipboard.writeText(saved); }
      if (!text) { void vscode.window.showInformationMessage("Select text in the terminal first."); return; }
      await addText(fenced(text.slice(-MAX_PROMPT_CHARS)));
    })),
    // 4. The newest finished command of the active terminal, else of any terminal (slice 0 terminalRuns).
    vscode.commands.registerCommand("t3-vscode.ours.prompt.addLastCommand", guarded(async () => {
      const runs = terminalRuns();
      // shortcut: runs know their terminal by name only, so two terminals with one name share their runs.
      const active = vscode.window.activeTerminal?.name;
      const run = [...runs].reverse().find((item) => item.terminal === active) ?? runs.at(-1);
      if (!run) { void vscode.window.showInformationMessage("No command recorded yet (shell integration needed)"); return; }
      await addText(lastCommandText(run));
    })),
    // 5 and 6. The lines (with snapshot) as a reference, then the problem as text. Internal: lens and light bulb run it.
    vscode.commands.registerCommand("t3-vscode.ours.prompt.fix", guarded(async (uri?: unknown, range?: unknown, message?: unknown, source?: unknown) => {
      if (!(uri instanceof vscode.Uri) || !(range instanceof vscode.Range)) return;
      const reference = await lineReference(uri, range);
      // His insertReference path: it reveals the tab even on a fresh draft, and leaves it focused for the text below.
      await insertFile(deps, reference);
      if (typeof message === "string" && message) await insertText(deps, `${message}${typeof source === "string" && source ? ` (${source})` : ""} `);
    })),
    // 7. Source Control title.
    vscode.commands.registerCommand("t3-vscode.ours.prompt.reviewChanges", guarded(() => addText("Review my uncommitted changes in this repository."))),
    vscode.languages.registerCodeActionsProvider({ scheme: "file" }, {
      provideCodeActions: (document, _range, context) => context.diagnostics.slice(0, MAX_FIXES).map((diagnostic) => {
        const action = new vscode.CodeAction(`Fix with T3: ${diagnostic.message.slice(0, 60)}`, vscode.CodeActionKind.QuickFix);
        action.diagnostics = [diagnostic];
        action.command = { command: "t3-vscode.ours.prompt.fix", title: "Fix with T3", arguments: [document.uri, diagnostic.range, diagnostic.message, diagnostic.source ?? ""] };
        return action;
      }),
    }, { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }),
    todoLensChanged,
    vscode.languages.registerCodeLensProvider({ scheme: "file" }, {
      onDidChangeCodeLenses: todoLensChanged.event,
      provideCodeLenses: (document) => {
        if (!vscode.workspace.getConfiguration("t3-vscode").get<boolean>("ours.prompt.todoLens", true)) return [];
        return todoLines(document.getText()).map((line) => {
          const range = document.lineAt(line).range;
          return new vscode.CodeLens(range, { title: "Implement with T3", command: "t3-vscode.ours.prompt.fix", arguments: [document.uri, range] });
        });
      },
    }),
    // Turning the setting off removes the lenses at once.
    vscode.workspace.onDidChangeConfiguration((event) => { if (event.affectsConfiguration("t3-vscode.ours.prompt.todoLens")) todoLensChanged.fire(); }),
  );
}
