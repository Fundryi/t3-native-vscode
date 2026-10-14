/**
 * I drop: files dragged from VS Code's Explorer or a tab go into a chat, images T3 can send as attachments, the rest as
 * whole-file references. Two ways in: the "Drop files here" view, and Ctrl+C in the Explorer then Ctrl+V in a chat (the
 * drop.copy keybinding remembers the paths, pasteCopied inserts them). A Shift-drag from the Explorer or a tab onto the
 * chat itself worked up to VS Code 1.139.1 and is blocked since 1.140.0 (2026-09-30): Electron 43.7.0 re-enabled
 * Chromium's rule against drags between cross-site frames of one page (electron/electron#53669, crbug.com/59081),
 * and the workbench and the webview frame are such frames (docs/ours/FORK-FEATURES.md I). The webview listeners stay
 * for 1.139.1 and for the day it is fixed. Files from Windows Explorer land (the drag starts outside). dragTrace logs
 * every drag that does reach a chat.
 */
import * as vscode from "vscode";
import { toastWithLogs } from "./logs.js";
import { stat } from "node:fs/promises";
import { basename } from "node:path";
import { SIDEBAR_VIEW_ID } from "../hostState.js";
import { fileReference, insertAttachments, insertFile, isAttachableImage } from "./composer.js";
import { isDrivePath, parseDrop } from "./dropParse.js";
import { log } from "./log.js";
import { registerOursRpc } from "./rpc.js";
import type { OursDeps } from "./types.js";

const MAX_INPUT_CHARS = 1_000_000;
const PASTE_MAX_AGE_MS = 10 * 60_000;

/** Webview input: an absent field is "", anything else must be a string within the cap. */
function dropString(params: Readonly<Record<string, unknown>>, key: string): string {
  const value = params[key] ?? "";
  if (typeof value !== "string" || value.length > MAX_INPUT_CHARS) throw new Error("Invalid drop data.");
  return value;
}
/** Log only: what the drag carried, so the owner's log shows why a drop did nothing. */
const typesText = (value: unknown): string => Array.isArray(value) ? value.slice(0, 32).map(String).join(",").slice(0, 500) : "";

const toUri = (line: string): vscode.Uri | undefined => {
  try { return isDrivePath(line) ? vscode.Uri.file(line) : vscode.Uri.parse(line, true); } catch { return undefined; }
};

/** In drop order: references one by one, then all images in one upload. A missing file or a folder becomes a reference. */
async function addDropped(deps: OursDeps, viewId: string, lines: ReadonlyArray<string>): Promise<void> {
  try {
    const images: vscode.Uri[] = [];
    for (const uri of lines.flatMap((line) => toUri(line) ?? []).filter((uri) => uri.scheme === "file")) {
      const size = await stat(uri.fsPath).then((info) => info.isFile() ? info.size : Infinity, () => Infinity);
      if (isAttachableImage(basename(uri.fsPath), size)) images.push(uri);
      else await insertFile(deps, fileReference(uri), viewId);
    }
    if (images.length) await insertAttachments(deps, viewId, images);
  } catch (cause) {
    toastWithLogs("warning", `T3 VSCode could not add the dropped files: ${cause instanceof Error ? cause.message : String(cause)}`, cause);
  }
}

export function activateDrop(deps: OursDeps): vscode.Disposable {
  const offDrop = registerOursRpc("dropUris", async (params, viewId) => {
    const lines = parseDrop(dropString(params, "uriList"), dropString(params, "text"));
    log.info(`Drop on ${viewId}: types ${typesText(params.types)}; ${lines.length} file(s).`);
    if (lines.length) await addDropped(deps, viewId, lines);
    return lines.length;
  });
  // VS Code's Explorer copy writes only its private "CodeFiles" clipboard format, which no webview or extension can read.
  let copied: { lines: string[]; at: number } | undefined;
  const copy = vscode.commands.registerCommand("t3-vscode.ours.drop.copy", async () => {
    try {
      await vscode.commands.executeCommand("copyFilePath");
      // One path per line; as file: uris, so parseDrop also takes POSIX paths.
      const uris = (await vscode.env.clipboard.readText()).split(/\r?\n/).filter((line) => line.trim()).map((line) => vscode.Uri.file(line.trim()).toString());
      copied = { lines: parseDrop(uris.join("\n"), ""), at: Date.now() };
      log.info(`Explorer copy: ${copied.lines.length} file(s) remembered for a paste into a chat.`);
    } catch (cause) { log.error("Explorer copy: remembering the paths failed.", cause); }
    // Always VS Code's own copy last, so the clipboard ends exactly as without the fork (its buffer replaces our text).
    finally { await Promise.resolve(vscode.commands.executeCommand("filesExplorer.copy")).catch((cause) => log.error("Explorer copy: filesExplorer.copy failed.", cause)); }
  });
  // shortcut: the remembered list goes stale if another app writes a non-text clipboard format after the copy; upgrade when VS Code exposes clipboard resources
  const offPaste = registerOursRpc("pasteCopied", async (_params, viewId) => {
    if (!copied || Date.now() - copied.at >= PASTE_MAX_AGE_MS || await vscode.env.clipboard.readText()) {
      log.info(`Paste on ${viewId} without text: nothing remembered from an Explorer copy.`);
      return 0;
    }
    log.info(`Paste on ${viewId}: ${copied.lines.length} file(s) from the last Explorer copy.`);
    await addDropped(deps, viewId, copied.lines);
    return copied.lines.length;
  });
  // One line per trusted dragenter (at most one per 500 ms) and drop in a chat webview: the evidence for a drop that did nothing.
  const offTrace = registerOursRpc("dragTrace", (params, viewId) => {
    log.info(`Drag trace: ${String(params.event).slice(0, 20)} types=${typesText(params.types)} shift=${params.shift === true} kinds=${typesText(params.kinds)} view=${viewId}`);
  });
  const offHint = registerOursRpc("dropHint", (params) => {
    log.info(`Drag left the chat at once, types ${typesText(params.types)}; hint shown.`);
    void vscode.window.showInformationMessage("VS Code 1.140 and newer block a drop from the Explorer or a tab into any chat (Electron 43.7). Drop it on \"Drop files here\" in the T3 side bar, or select it in the Explorer, press Ctrl+C, then Ctrl+V in the chat.");
  });

  // One item, not an empty tree: VS Code hides an empty tree behind its welcome text, and the drop target is the tree.
  const item = new vscode.TreeItem("Drop files here");
  item.iconPath = new vscode.ThemeIcon("cloud-upload");
  item.description = "drag from the Explorer or a tab";
  item.tooltip = "Drag files from the Explorer or a tab here to add them to the focused T3 chat. Images go in as attachments. A Shift-drag onto the chat itself is blocked by VS Code 1.140 and newer (Electron 43.7); Ctrl+C in the Explorer and Ctrl+V in the chat also works.";
  const view = vscode.window.createTreeView<vscode.TreeItem>("t3-vscode.ours.drop.view", {
    treeDataProvider: { getChildren: (element) => element ? [] : [item], getTreeItem: (element) => element },
    dragAndDropController: {
      dropMimeTypes: ["text/uri-list"],
      dragMimeTypes: [],
      // Any target: the item or the empty space below it (undefined).
      handleDrop: async (_target, dataTransfer) => {
        try {
          const lines = parseDrop(await dataTransfer.get("text/uri-list")?.asString() ?? "", "");
          log.info(`Drop on the Drop files here view: ${lines.length} file(s).`);
          if (!lines.length) return;
          // The sidebar list has no composer: createPanel opens its thread (in the sidebar under K layout, else a panel).
          const focused = deps.registry.focusedViewId;
          await addDropped(deps, focused === SIDEBAR_VIEW_ID ? await deps.provider.createPanel(SIDEBAR_VIEW_ID) : focused, lines);
        } catch (cause) { log.error("Drop on the Drop files here view failed.", cause); }
      },
    },
  });
  return vscode.Disposable.from(view, copy, { dispose: offDrop }, { dispose: offPaste }, { dispose: offHint }, { dispose: offTrace });
}
