/**
 * P4 undoturn. "Undo turn" on a turn's changes card (and in the Q16 all-changes view) puts back every file the turn
 * changed, with Q16's per-file rule (./diffsRevert.ts): dirty files and files changed after the turn are skipped.
 * One modal lists what goes back, what is skipped and which later turns touched the same files. All files change in
 * one WorkspaceEdit, so Ctrl+Z in one of them brings them all back. The conversation is not touched.
 */
import * as vscode from "vscode";
import type { T3Client } from "../t3Client.js";
import { turnCheckpointRange, turnDiffFiles, type TurnDiffFile } from "../turnDiff.js";
import { locate, turnSourceOf } from "./diffs.js";
import { revertAction, type RevertAction } from "./diffsRevert.js";
import { log } from "./log.js";
import { registerOursRpc } from "./rpc.js";
import type { OursDeps } from "./types.js";

// Naming later turns costs one git diff each: enough to warn, never a reason to stall the modal.
const LATER_MAX = 30;

interface Step { readonly file: TurnDiffFile; readonly uri?: vscode.Uri; readonly doc?: vscode.TextDocument | undefined; readonly action: RevertAction }
interface Later { readonly sourceThreadId: string; readonly checkpointId: string }

const folders = () => (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri);
const exists = async (uri: vscode.Uri) => { try { await vscode.workspace.fs.stat(uri); return true; } catch { return false; } };
const refuse = (file: TurnDiffFile, reason: string): Step => ({ file, action: { kind: "refuse", reason } });
const reasonOf = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);
const files = (count: number) => `${count} ${count === 1 ? "file" : "files"}`;

/** Later checkpoint rows of this chat that changed one of `paths`, as "turn 5 (a.ts, b.ts)". Best effort. */
async function laterTurns(client: T3Client, rows: ReadonlyArray<Later>, paths: ReadonlySet<string>): Promise<string[]> {
  const projections = new Map<string, ReturnType<T3Client["getThreadProjection"]>>();
  const found = await Promise.allSettled(rows.slice(0, LATER_MAX).map(async (row) => {
    if (!projections.has(row.sourceThreadId)) projections.set(row.sourceThreadId, client.getThreadProjection(row.sourceThreadId));
    const range = turnCheckpointRange(await projections.get(row.sourceThreadId)!, row.checkpointId);
    const changed = turnDiffFiles(await client.getSavedTurnDiff(range)).flatMap((file) => [file.oldPath, file.newPath]);
    const touched = [...new Set(changed)].filter((path) => paths.has(path));
    return touched.length ? `turn ${range.turnNumber} (${touched.join(", ")})` : undefined;
  }));
  return found.flatMap((result) => result.status === "fulfilled" && result.value ? [result.value] : []);
}

async function undoTurn({ hostState, client }: OursDeps, viewId: string, checkpointId: string): Promise<void> {
  const state = hostState.snapshot(viewId);
  const index = state.transcript.findIndex((row) => row.item.type === "checkpoint" && row.item.checkpointId === checkpointId);
  const row = state.transcript[index];
  if (!state.activeThreadId || !row) throw new Error("This turn is no longer in the chat.");
  const diff = await hostState.prepareTurnDiff(state.activeThreadId, row.sourceThreadId, row.sourceItemId ?? row.item.id, viewId);
  const loaded = await Promise.allSettled(diff.files.map((file) => hostState.loadTurnDiffFile(diff, file, viewId)));
  const roots = [vscode.Uri.file(diff.cwd), ...folders()];
  const decide = () => Promise.all(diff.files.map(async (file, i): Promise<Step> => {
    const result = loaded[i]!;
    if (result.status === "rejected") return refuse(file, "T3 cannot show it as text, so it was left alone.");
    try {
      const where = await locate({ roots, newPath: file.newPath });
      if (!where) return refuse(file, "Cannot tell where it lives in this workspace.");
      const doc = await exists(where.uri) ? await vscode.workspace.openTextDocument(where.uri) : undefined;
      const action = revertAction({
        before: result.value.oldContents, after: result.value.newContents, oldPath: file.oldPath, newPath: file.newPath,
        changeType: file.changeType, current: doc?.getText(), dirty: doc?.isDirty ?? false,
      });
      return { file, uri: where.uri, doc, action };
    } catch (cause) { return refuse(file, reasonOf(cause)); }
  }));
  const first = await decide();
  const laterRows = state.transcript.slice(index + 1)
    .flatMap((next): Later[] => next.item.type === "checkpoint" ? [{ sourceThreadId: next.sourceThreadId, checkpointId: next.item.checkpointId }] : []);
  const later = await laterTurns(client, laterRows, new Set(diff.files.flatMap((file) => [file.oldPath, file.newPath])));
  const back = first.filter((step) => step.action.kind !== "refuse");
  const skipped = first.flatMap((step) => step.action.kind === "refuse" ? [`  ${step.file.newPath}: ${step.action.reason}`] : []);
  const how = (step: Step) => step.action.kind === "delete" ? " (delete: this turn created it)" : step.action.kind === "create" ? " (restore: this turn deleted it)" : "";
  const detail = [
    back.length ? `Put back:\n${back.map((step) => `  ${step.file.newPath}${how(step)}`).join("\n")}` : "",
    skipped.length ? `Skipped:\n${skipped.join("\n")}` : "",
    later.length ? `Later turns also touched these files: ${later.join("; ")}. Their changes stay, so those files may end up half undone.` : "",
    back.length ? "The chat stays as it is. Ctrl+Z in one of these files brings them all back." : "",
  ].filter(Boolean).join("\n\n");
  if (!back.length) { void vscode.window.showWarningMessage(`Turn ${diff.turnNumber}: no file can be put back.`, { modal: true, detail }); return; }
  const button = "Undo Turn";
  const question = `Undo turn ${diff.turnNumber}: put back ${back.length} of ${files(first.length)}?`;
  if (await vscode.window.showWarningMessage(question, { modal: true, detail }, button) !== button) return;
  // The modal can stay open while files change: decide again and write only if nothing moved.
  const now = await decide();
  if (JSON.stringify(now.map((step) => step.action)) !== JSON.stringify(first.map((step) => step.action))) {
    void vscode.window.showWarningMessage(`Turn ${diff.turnNumber}: files changed meanwhile. Nothing was put back.`);
    return;
  }
  const edit = new vscode.WorkspaceEdit();
  const writes: vscode.TextDocument[] = [];
  for (const { uri, doc, action } of now) {
    if (!uri) continue;
    if (action.kind === "delete") edit.deleteFile(uri, { ignoreIfNotExists: true });
    else if (action.kind === "create") edit.createFile(uri, { contents: new TextEncoder().encode(action.text) });
    // Replace on the document: VS Code turns the LF text into the file's own line endings.
    else if (action.kind === "write" && doc) {
      edit.replace(doc.uri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), action.text);
      writes.push(doc);
    }
  }
  if (!await vscode.workspace.applyEdit(edit)) throw new Error(`VS Code did not apply the undo of turn ${diff.turnNumber}. Nothing was put back.`);
  await Promise.all(writes.map((doc) => doc.save()));
  log.info(`Undo turn: turn ${diff.turnNumber} in ${diff.cwd}, ${back.length} put back, ${skipped.length} skipped.`);
  const rest = skipped.length ? `, ${skipped.length} skipped` : "";
  void vscode.window.showInformationMessage(`Turn ${diff.turnNumber} undone: ${files(back.length)} put back${rest}. Ctrl+Z in one of them brings them back.`);
}

export function activateUndoTurn(deps: OursDeps): vscode.Disposable {
  const run = async (viewId: string, checkpointId: string) => {
    try { await undoTurn(deps, viewId, checkpointId); }
    catch (cause) { log.error("Undo turn failed:", cause); void vscode.window.showErrorMessage(`Undo turn: ${reasonOf(cause)}`); }
  };
  const unregister = registerOursRpc("undoturn.run", async (params, viewId) => {
    if (typeof params.checkpointId !== "string" || !params.checkpointId) throw new Error("Invalid checkpoint.");
    await run(viewId, params.checkpointId);
    return {};
  });
  return vscode.Disposable.from(
    { dispose: unregister },
    vscode.commands.registerCommand("t3-vscode.ours.undoturn.run", async (arg: unknown) => {
      const uri = arg instanceof vscode.Uri ? arg : vscode.window.activeTextEditor?.document.uri;
      const source = uri && turnSourceOf(uri);
      if (!source) { void vscode.window.showWarningMessage("Undo turn works from a turn's changes card in the chat, or from the all-changes view it opens."); return; }
      await run(source.viewId, source.checkpointId);
    }),
  );
}
