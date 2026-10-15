/**
 * Q16 diffs. "Open diff" on a turn with two or more files shows all of them in one multi-diff view (vscode.changes),
 * through his public hostState.prepareTurnDiff and loadTurnDiffFile; his nativeDiff.ts keeps its QuickPick for the
 * fallback. On any diff side (his t3-turn-diff or our t3-ours-diff): Open File and a guarded Revert (./diffsRevert.ts).
 * P3 allchanges: "Show All Changes in This Chat" opens the same view from the first saved baseline of the chat to its
 * latest saved checkpoint (./allChangesRange.ts), so Open File, Revert and the hunk arrows work there too.
 */
import { randomUUID } from "node:crypto";
import * as vscode from "vscode";
import { turnDiffFileRequest, turnDiffFiles, type TurnDiff, type TurnDiffFile } from "../turnDiff.js";
import { threadChangeRanges } from "./allChangesRange.js";
import { lf, revertAction, type RevertAction } from "./diffsRevert.js";
import { log } from "./log.js";
import { wrap } from "./wrap.js";
import { registerOursRpc } from "./rpc.js";
import type { OursDeps } from "./types.js";

const SCHEME = "t3-ours-diff";
const HIS_SCHEME = "t3-turn-diff";
// Not freed on close like his: the multi-diff view can release an inner model and ask for it again.
const KEEP = 10;

/** `what` names the range in the Revert question: "this turn", or "this chat" for P3. `source`: the chat card a Q16 view came from, so P4 undoturn can undo the whole turn from it. */
interface Turn { readonly cwd: string; readonly files: ReadonlyArray<TurnDiffFile>; readonly texts: Map<string, string>; readonly what: string; readonly source?: TurnSource | undefined }
export interface TurnSource { readonly viewId: string; readonly checkpointId: string }
interface Pair { readonly before: string; readonly after: string; readonly oldPath: string; readonly newPath: string; readonly changeType: string; readonly roots: vscode.Uri[]; readonly what: string }
/** Every file his diffs (and ours) loaded, so a diff side leads back to its turn cwd and changeType. */
interface Loaded { readonly cwd: string; readonly file: TurnDiffFile; readonly before: string; readonly after: string }

const turns = new Map<string, Turn>();
const loadedFiles: Loaded[] = [];
const sideUri = (key: string, side: "before" | "after", path: string) => vscode.Uri.from({ scheme: SCHEME, path: `/${key}/${side}/${path}` });
const parse = (uri: vscode.Uri) => {
  const match = /^\/([^/]+)\/(before|after)\/(.+)$/.exec(uri.path);
  return match ? { key: match[1]!, side: match[2] as "before" | "after", path: match[3]! } : undefined;
};
const folders = () => (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri);
const exists = async (uri: vscode.Uri) => { try { await vscode.workspace.fs.stat(uri); return true; } catch { return false; } };
const GONE = "This diff is no longer available. Open it again from the chat.";
/** R17: a real file shown as a diff's right side, mapped to that diff's virtual after side (the latest diff wins). */
const live = new Map<string, vscode.Uri>();

async function pairOf(uri: vscode.Uri): Promise<Pair> {
  if (uri.scheme === "file") uri = live.get(uri.toString()) ?? uri;
  const part = parse(uri);
  if (!part || (uri.scheme !== SCHEME && uri.scheme !== HIS_SCHEME)) throw new Error("This is not a T3 turn diff.");
  if (uri.scheme === SCHEME) {
    const turn = turns.get(part.key);
    const file = turn?.files.find((file) => (part.side === "after" ? file.newPath : file.oldPath) === part.path);
    if (!turn || !file) throw new Error(GONE);
    const before = turn.texts.get(sideUri(part.key, "before", file.oldPath).toString());
    const after = turn.texts.get(sideUri(part.key, "after", file.newPath).toString());
    if (before === undefined || after === undefined) throw new Error(GONE);
    return { before, after, oldPath: file.oldPath, newPath: file.newPath, changeType: file.changeType, roots: [vscode.Uri.file(turn.cwd), ...folders()], what: turn.what };
  }
  // His single-file diff: both sides are open documents under one key.
  const side = (wanted: "before" | "after") => vscode.workspace.textDocuments.find((doc) => {
    const other = doc.uri.scheme === HIS_SCHEME ? parse(doc.uri) : undefined;
    return other?.key === part.key && other.side === wanted;
  });
  const before = side("before"), after = side("after");
  if (!before || !after) throw new Error(GONE);
  const oldPath = parse(before.uri)!.path, newPath = parse(after.uri)!.path;
  // A worktree thread lives outside the workspace: never guess its folder, take the cwd T3 gave for this turn.
  const known = loadedFiles.findLast((entry) => entry.file.oldPath === oldPath && entry.file.newPath === newPath
    && lf(entry.before) === lf(before.getText()) && lf(entry.after) === lf(after.getText()));
  if (!known) throw new Error(GONE);
  return { before: known.before, after: known.after, oldPath, newPath, changeType: known.file.changeType, roots: [vscode.Uri.file(known.cwd), ...folders()], what: "this turn" };
}

/** The real file of a diff: the first root where it exists (cwd first; git paths are repo-root relative), else the cwd. */
export async function locate(pair: Pick<Pair, "roots" | "newPath">): Promise<{ readonly uri: vscode.Uri; readonly found: boolean } | undefined> {
  const candidates = pair.roots.map((root) => ({ root, uri: vscode.Uri.joinPath(root, ...pair.newPath.split("/")) }))
    // A patch path is data from T3: never leave the root through "..".
    .filter(({ root, uri }) => uri.path.toLowerCase().startsWith(root.path.toLowerCase().replace(/\/?$/, "/")));
  for (const { uri } of candidates) if (await exists(uri)) return { uri, found: true };
  return candidates[0] && { uri: candidates[0].uri, found: false };
}

/**
 * R17: the real file when its text (open buffer included) is exactly what the turn left, else the virtual side.
 * A writable right side gives VS Code's own per-hunk revert arrow; undo is the editor's Ctrl+Z.
 */
async function rightSide(roots: vscode.Uri[], newPath: string, after: string, virtual: vscode.Uri): Promise<vscode.Uri> {
  try {
    const file = await locate({ roots, newPath });
    if (!file?.found) return virtual;
    const doc = await vscode.workspace.openTextDocument(file.uri);
    if (lf(doc.getText()) !== lf(after)) return virtual;
    live.set(file.uri.toString(), virtual);
    return file.uri;
  } catch (cause) {
    log.info(`Diffs: ${newPath} shown read-only: ${String(cause)}`);
    return virtual;
  }
}

/** R17: his single diff again, with the real file on the right, so single hunks can be undone in place. */
async function compare(arg: unknown) {
  const uri = target(arg);
  if (!uri) return;
  const pair = await pairOf(uri);
  const key = randomUUID();
  const before = sideUri(key, "before", pair.oldPath), after = sideUri(key, "after", pair.newPath);
  const right = await rightSide(pair.roots, pair.newPath, pair.after, after);
  if (right === after) { void vscode.window.showWarningMessage(`${pair.newPath} is not on disk or changed after this turn, so it cannot be edited from this diff.`); return; }
  const file = { oldPath: pair.oldPath, newPath: pair.newPath, changeType: pair.changeType as TurnDiffFile["changeType"], additions: 0, deletions: 0 };
  turns.set(key, { cwd: pair.roots[0]!.fsPath, files: [file], texts: new Map([[before.toString(), pair.before], [after.toString(), pair.after]]), what: pair.what });
  for (const old of [...turns.keys()].slice(0, -KEEP)) turns.delete(old);
  await vscode.commands.executeCommand("vscode.diff", before, right, `${pair.newPath} (before ${pair.what} vs current file)`, { preview: true });
}

/** P4 undoturn: the chat turn behind a diff side (or the real file shown as its right side), when it came from a card. */
export function turnSourceOf(uri: vscode.Uri): TurnSource | undefined {
  if (uri.scheme === "file") uri = live.get(uri.toString()) ?? uri;
  return uri.scheme === SCHEME ? turns.get(parse(uri)?.key ?? "")?.source : undefined;
}

const target = (arg: unknown) => arg instanceof vscode.Uri ? arg : vscode.window.activeTextEditor?.document.uri;

async function openFile(arg: unknown) {
  const uri = target(arg);
  if (!uri) return;
  const pair = await pairOf(uri);
  const file = await locate(pair);
  if (!file?.found) { void vscode.window.showWarningMessage(`${pair.newPath} is not on disk in this workspace (this turn may have deleted it).`); return; }
  await vscode.window.showTextDocument(file.uri, { preview: false });
}

async function revert(arg: unknown) {
  const uri = target(arg);
  if (!uri) return;
  const pair = await pairOf(uri);
  const file = await locate(pair);
  if (!file) { void vscode.window.showWarningMessage(`Cannot tell where ${pair.newPath} lives in this workspace. Nothing was reverted.`); return; }
  const decide = async (): Promise<{ readonly action: RevertAction; readonly doc: vscode.TextDocument | undefined }> => {
    const doc = await exists(file.uri) ? await vscode.workspace.openTextDocument(file.uri) : undefined;
    return { action: revertAction({ ...pair, current: doc?.getText(), dirty: doc?.isDirty ?? false }), doc };
  };
  const first = await decide();
  if (first.action.kind === "refuse") { void vscode.window.showWarningMessage(`${pair.newPath}: ${first.action.reason}`); return; }
  const who = pair.what === "this chat" ? "This chat" : "This turn";
  const [question, button] = first.action.kind === "delete" ? [`${who} created ${pair.newPath}. Delete it?`, "Delete"]
    : first.action.kind === "create" ? [`${who} deleted ${pair.newPath}. Restore it?`, "Restore"]
    : [`Put ${pair.newPath} back as it was before ${pair.what}?`, "Revert"];
  const detail = `Only this file changes. It still matches what ${pair.what} left.`;
  if (await vscode.window.showWarningMessage(question, { modal: true, detail }, button) !== button) return;
  // The modal can stay open while the file changes: decide again and write only if nothing moved.
  const { action, doc } = await decide();
  if (JSON.stringify(action) !== JSON.stringify(first.action)) { void vscode.window.showWarningMessage(`${pair.newPath} changed meanwhile. Nothing was reverted.`); return; }
  const edit = new vscode.WorkspaceEdit();
  if (action.kind === "delete") edit.deleteFile(file.uri, { ignoreIfNotExists: true });
  else if (action.kind === "create") edit.createFile(file.uri, { contents: new TextEncoder().encode(action.text) });
  // Replace on the document: VS Code turns the LF text into the file's own line endings.
  else if (action.kind === "write" && doc) edit.replace(doc.uri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), action.text);
  if (!await vscode.workspace.applyEdit(edit)) throw new Error(`VS Code did not apply the revert of ${pair.newPath}.`);
  if (action.kind === "write" && doc) await doc.save();
  log.info(`Diffs: ${action.kind} ${file.uri.fsPath}, back to before ${pair.what}.`);
}

type Load = (file: TurnDiffFile) => Promise<{ readonly oldContents: string; readonly newContents: string }>;

/** Runs `run` on every item, at most 8 at a time: a whole chat can mean hundreds of git processes. */
async function settled<T, R>(items: ReadonlyArray<T>, run: (item: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = [];
  let next = 0;
  const worker = async () => {
    for (let index = next++; index < items.length; index = next++) {
      try { results[index] = { status: "fulfilled", value: await run(items[index]!) }; }
      catch (reason) { results[index] = { status: "rejected", reason }; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, items.length) }, worker));
  return results;
}

/** One multi-diff over saved diffs (Q16: one turn; P3: one per folder the chat ran in). Returns the number of files shown. */
async function openChanges(title: (files: number) => string, what: string, parts: ReadonlyArray<{ readonly diff: TurnDiff; readonly load: Load; readonly source?: TurnSource }>): Promise<number> {
  const shown: Array<[vscode.Uri, vscode.Uri, vscode.Uri]> = [];
  const made = new Map<string, Turn>();
  for (const { diff, load, source } of parts) {
    // T3 refuses to expand a binary file; show the rest.
    const loaded = await settled(diff.files, load);
    const key = randomUUID();
    const turn: Turn = { cwd: diff.cwd, files: diff.files, texts: new Map(), what, source };
    const roots = [vscode.Uri.file(diff.cwd), ...folders()];
    shown.push(...await Promise.all(diff.files.flatMap((file, index) => {
      const result = loaded[index]!;
      if (result.status === "rejected") { log.info(`Diffs: ${file.newPath} left out of the all-changes view: ${String(result.reason)}`); return []; }
      const before = sideUri(key, "before", file.oldPath), after = sideUri(key, "after", file.newPath);
      turn.texts.set(before.toString(), result.value.oldContents);
      turn.texts.set(after.toString(), result.value.newContents);
      const resource = vscode.Uri.joinPath(vscode.Uri.file(diff.cwd), ...file.newPath.split("/"));
      return [rightSide(roots, file.newPath, result.value.newContents, after).then((right): [vscode.Uri, vscode.Uri, vscode.Uri] => [resource, before, right])];
    })));
    made.set(key, turn);
  }
  if (!shown.length) throw new Error("No changed file can be shown as text.");
  for (const [key, turn] of made) turns.set(key, turn);
  for (const old of [...turns.keys()].slice(0, -KEEP)) turns.delete(old);
  await vscode.commands.executeCommand("vscode.changes", title(shown.length), shown);
  return shown.length;
}

/**
 * P3 allchanges: every file the chat changed, from its first saved baseline to its latest saved checkpoint, read with
 * git from the T3 checkpoint refs on this machine (as his turn diffs). Any thread works, loaded in a view or not.
 */
export async function showAllChanges(client: OursDeps["client"], thread: { readonly id: string; readonly title: string }): Promise<void> {
  await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: "T3: loading all changes of this chat" }, async () => {
    const ranges = threadChangeRanges(await client.getThreadProjection(thread.id));
    const parts = (await Promise.all(ranges.map(async (range) => {
      const diff: TurnDiff = { ...range, files: turnDiffFiles(await client.getSavedTurnDiff(range)) };
      return { diff, load: (file: TurnDiffFile) => client.getDiffFileContents(turnDiffFileRequest(diff, file)) };
    }))).filter((part) => part.diff.files.length);
    if (!parts.length) { void vscode.window.showInformationMessage("T3: this chat has not changed any file yet (or its last turn is still being saved)."); return; }
    // As the R7 card note: between turns the saved range also holds your own edits and anything a pull brought in.
    await openChanges((files) => `${thread.title || "Untitled"}: all changes, ${files} files (may include your own edits)`, "this chat", parts);
    log.info(`Diffs: all changes of ${thread.id}, ${parts.length} folder(s).`);
  });
}

const guarded = (name: string, run: (arg: unknown) => Promise<void>) => async (arg: unknown) => {
  try { await run(arg); }
  catch (cause) { log.error(`Diffs: ${name} failed:`, cause); void vscode.window.showErrorMessage(cause instanceof Error ? cause.message : String(cause)); }
};

export function activateDiffs({ hostState, client, registry }: OursDeps): vscode.Disposable {
  const unwrap = wrap(hostState, "loadTurnDiffFile", (original) => async (diff, file, viewId) => {
    const result = await original(diff, file, viewId);
    loadedFiles.push({ cwd: diff.cwd, file, before: result.oldContents, after: result.newContents });
    loadedFiles.splice(0, loadedFiles.length - 100);
    return result;
  });
  const unregister = registerOursRpc("diffs.openAll", async (params, viewId) => {
    const checkpointId = params.checkpointId;
    if (typeof checkpointId !== "string" || !checkpointId) throw new Error("Invalid checkpoint.");
    const state = hostState.snapshot(viewId);
    const row = state.transcript.find((row) => row.item.type === "checkpoint" && row.item.checkpointId === checkpointId);
    if (!state.activeThreadId || !row) throw new Error("This turn is no longer in the chat.");
    const diff = await hostState.prepareTurnDiff(state.activeThreadId, row.sourceThreadId, row.sourceItemId ?? row.item.id, viewId);
    const files = await openChanges((files) => `Turn ${diff.turnNumber}: ${files} changed files`, "this turn", [{ diff, load: (file) => hostState.loadTurnDiffFile(diff, file, viewId), source: { viewId, checkpointId } }]);
    return { files };
  });
  // P3: the focused chat (palette, chat tab title); the thread menus reach showAllChanges through the Q19 threadActions.
  const allChanges = async () => {
    let state;
    try { state = hostState.snapshot(registry.focusedViewId); } catch { state = hostState.snapshot(); }
    const thread = state.threads.find((item) => item.id === state.activeThreadId);
    if (!thread) { void vscode.window.showInformationMessage("No thread open."); return; }
    await showAllChanges(client, thread);
  };
  return vscode.Disposable.from(
    { dispose: () => { unwrap(); unregister(); turns.clear(); loadedFiles.length = 0; live.clear(); } },
    vscode.workspace.registerTextDocumentContentProvider(SCHEME, {
      provideTextDocumentContent(uri) {
        const text = turns.get(parse(uri)?.key ?? "")?.texts.get(uri.toString());
        if (text === undefined) throw new Error(GONE);
        return text;
      },
    }),
    vscode.commands.registerCommand("t3-vscode.ours.diffs.openFile", guarded("Open File", openFile)),
    vscode.commands.registerCommand("t3-vscode.ours.diffs.revert", guarded("Revert", revert)),
    vscode.commands.registerCommand("t3-vscode.ours.diffs.compare", guarded("Compare with Current File", compare)),
    vscode.commands.registerCommand("t3-vscode.ours.diffs.allChanges", guarded("Show All Changes", allChanges)),
  );
}
