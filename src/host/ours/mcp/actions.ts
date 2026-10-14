/**
 * What an agent may ask this window to do (legacy extension.js _open and _diff): open, reveal, diff. Paths arrive
 * absolute and already checked to lie inside a window folder (tools.ts act). Each returns ok, or ok false with a reason.
 */
import * as vscode from "vscode";
import { stat } from "node:fs/promises";
import { log } from "../log.js";
import { key } from "./discovery.js";

export type ActionResult = { ok: true } | { ok: false; reason: string };
const OK: ActionResult = { ok: true };
const MEDIA = /\.(png|jpe?g|gif|webp|svg|bmp|ico|pdf|mp4|mp3|wav|webm)$/i;
const position = (n: unknown) => typeof n === "number" && Number.isSafeInteger(n) && n >= 1 && n <= 1000000 ? n : 1;

// An agent could flood tabs or warnings: at most one action per 300 ms, the rest answered busy.
let lastAction = 0;
const busy = () => { if (Date.now() - lastAction < 300) return true; lastAction = Date.now(); return false; };
// Every refusal says so, once per path per 10 s, so one bad path asked again does not stack toasts.
const refusedAt = new Map<string, number>();
function refuse(shown: string): void {
  const now = Date.now();
  for (const [path, at] of refusedAt) if (now - at >= 10000) refusedAt.delete(path);
  if (refusedAt.has(shown)) return;
  refusedAt.set(shown, now);
  void vscode.window.showWarningMessage(`T3 VSCode could not open ${shown}`);
}

export interface OpenOptions { readonly line?: unknown; readonly column?: unknown; readonly preview?: unknown; readonly reveal?: boolean }

/** A folder, or a file with reveal, is selected in the Explorer (a folder also expanded); a file opens at line and column. */
export async function openFile(path: string, options: OpenOptions): Promise<ActionResult> {
  if (busy()) return { ok: false, reason: "busy" };
  const shown = path.slice(0, 300);
  // Device names (nul, con) are neither file nor directory, so they are refused here too.
  const info = await stat(path).catch(() => undefined);
  if (!info || !(info.isFile() || info.isDirectory())) {
    log.info(`Open file: refused or not found: ${shown}`);
    refuse(shown);
    return { ok: false, reason: "refused or not found" };
  }
  const uri = vscode.Uri.file(path);
  try {
    if (info.isDirectory() || options.reveal === true) {
      await vscode.commands.executeCommand("workbench.view.explorer");
      await vscode.commands.executeCommand("revealInExplorer", uri);
      if (info.isDirectory()) await vscode.commands.executeCommand("list.expand");
      return OK;
    }
    if (MEDIA.test(path)) await vscode.commands.executeCommand("vscode.open", uri); // VS Code's own viewer: images show as images
    else {
      const line = position(options.line) - 1; const column = position(options.column) - 1;
      await vscode.window.showTextDocument(uri, { selection: new vscode.Range(line, column, line, column), preview: options.preview === true });
    }
    await vscode.commands.executeCommand("revealInExplorer", uri);
    return OK;
  } catch (cause) {
    log.error(`Open file: ${shown}:`, cause);
    refuse(shown);
    return { ok: false, reason: cause instanceof Error ? cause.message : String(cause) };
  }
}

/**
 * The file's uncommitted change in VS Code's diff view. git.openChange returns silently for a file without a change and
 * throws without the git extension: then the active tab is not this file, and the file itself opens instead.
 */
export async function showDiff(path: string): Promise<ActionResult> {
  if (busy()) return { ok: false, reason: "busy" };
  const shown = path.slice(0, 300);
  const uri = vscode.Uri.file(path);
  const shows = () => {
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    const tabUri = input instanceof vscode.TabInputTextDiff ? input.modified : input instanceof vscode.TabInputText ? input.uri : undefined;
    return !!tabUri && key(tabUri.fsPath) === key(path);
  };
  let why: string;
  try {
    await vscode.commands.executeCommand("git.openChange", uri);
    if (shows()) return OK;
    why = "no diff tab (no uncommitted change)";
  } catch (cause) { why = `git.openChange threw (${cause instanceof Error ? cause.message : String(cause)})`; }
  log.info(`Diff: ${shown}: ${why}, so vscode.open`);
  try {
    await vscode.commands.executeCommand("vscode.open", uri);
    return OK;
  } catch (cause) {
    log.error(`Diff: ${shown}:`, cause);
    return { ok: false, reason: cause instanceof Error ? cause.message : String(cause) };
  }
}
