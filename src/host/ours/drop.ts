/**
 * I drop: files dragged from VS Code's Explorer or a tab go into a chat, images T3 can send as attachments, the rest as
 * whole-file references. Two ways in: a Shift-drag onto a chat panel (src/webview/ours/drop.ts asks dropUris, and
 * dropHint when a drag bounced off without Shift) and the "Drop files here" view, which takes a drag without Shift.
 */
import * as vscode from "vscode";
import { stat } from "node:fs/promises";
import { basename } from "node:path";
import { SIDEBAR_VIEW_ID } from "../hostState.js";
import { fileReference, insertAttachments, insertFile, isAttachableImage } from "./composer.js";
import { isDrivePath, parseDrop } from "./dropParse.js";
import { log } from "./log.js";
import { registerOursRpc } from "./rpc.js";
import type { OursDeps } from "./types.js";

const MAX_INPUT_CHARS = 1_000_000;

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
    log.error("Drop: adding the files failed.", cause);
    void vscode.window.showWarningMessage(`T3 VSCode could not add the dropped files: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

export function activateDrop(deps: OursDeps): vscode.Disposable {
  const offDrop = registerOursRpc("dropUris", async (params, viewId) => {
    const lines = parseDrop(dropString(params, "uriList"), dropString(params, "text"));
    log.info(`Drop on ${viewId}: types ${typesText(params.types)}; ${lines.length} file(s).`);
    if (lines.length) await addDropped(deps, viewId, lines);
    return lines.length;
  });
  const offHint = registerOursRpc("dropHint", (params) => {
    log.info(`Drag left the chat at once (no Shift held?), types ${typesText(params.types)}; hint shown.`);
    void vscode.window.showInformationMessage("Hold Shift while dragging files into T3 Code.");
  });

  // One item, not an empty tree: VS Code hides an empty tree behind its welcome text, and the drop target is the tree.
  const item = new vscode.TreeItem("Drop files here");
  item.iconPath = new vscode.ThemeIcon("cloud-upload");
  item.tooltip = "Drop files from the Explorer or a tab here to add them to the T3 prompt. Images go in as attachments.";
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
          // The sidebar has no composer: then the panel of its thread, as his insertReference does.
          const focused = deps.registry.focusedViewId;
          await addDropped(deps, focused === SIDEBAR_VIEW_ID ? await deps.provider.createPanel(SIDEBAR_VIEW_ID) : focused, lines);
        } catch (cause) { log.error("Drop on the Drop files here view failed.", cause); }
      },
    },
  });
  return vscode.Disposable.from(view, { dispose: offDrop }, { dispose: offHint });
}
