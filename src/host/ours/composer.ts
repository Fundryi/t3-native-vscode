/** Puts text, file references and attachments into a chat composer (used by A, D and I). */
import * as vscode from "vscode";
import { readFile, stat } from "node:fs/promises";
import { basename, relative } from "node:path";
import { isProviderSendTurnSupportedImageMimeType, PROVIDER_SEND_TURN_MAX_FILE_BYTES, PROVIDER_SEND_TURN_MAX_IMAGE_BYTES } from "@t3tools/contracts";
import { Events } from "../../shared/bridge.js";
import { attachmentMimeType } from "../../shared/composerAttachments.js";
import type { FileReference } from "../../shared/composerContext.js";
import { OURS_EVENT } from "../../shared/ours/channel.js";
import type { OursAddAttachments, OursInsertText, OursUploadResult } from "../../shared/ours/composer.js";
import { SIDEBAR_VIEW_ID } from "../hostState.js";
import type { OursDeps } from "./types.js";

/** A whole-file reference, labelled like his editorReference: relative to its folder with "/", else the basename. */
export function fileReference(uri: vscode.Uri): FileReference {
  const root = vscode.workspace.getWorkspaceFolder(uri)?.uri.fsPath;
  return { type: "file", uri: uri.toString(), path: uri.fsPath, label: root ? relative(root, uri.fsPath).replaceAll("\\", "/") : basename(uri.fsPath) };
}

/** Into a known view as his insertReference does (extension.ts:255-256); without one, through his own path. */
export async function insertFile(deps: OursDeps, reference: FileReference, viewId?: string): Promise<void> {
  if (viewId === undefined) return deps.provider.insertReference(reference);
  const draftKey = await touchComposer(deps, viewId);
  deps.registry.postWhenReady(viewId, Events.insertReference, { draftKey, reference });
}

/** Into the focused chat; from the sidebar through createPanel (K layout keeps it in the sidebar, else a panel). */
export async function insertText(deps: OursDeps, text: string): Promise<void> {
  const focused = deps.registry.focusedViewId;
  const viewId = focused === SIDEBAR_VIEW_ID ? await deps.provider.createPanel(SIDEBAR_VIEW_ID) : focused;
  const draftKey = await touchComposer(deps, viewId);
  deps.registry.postWhenReady(viewId, OURS_EVENT, { kind: "insertText", draftKey, text } satisfies OursInsertText);
}

/** An image T3 sends as an image (gif, jpeg, png, webp up to 10 MiB). Check it BEFORE uploading; anything else becomes a reference. */
export const isAttachableImage = (name: string, sizeBytes: number): boolean =>
  isProviderSendTurnSupportedImageMimeType(attachmentMimeType(name)) && sizeBytes <= PROVIDER_SEND_TURN_MAX_IMAGE_BYTES;

/**
 * Uploads local files as his pickAttachments does (host/bridge.ts:146-151). His uploadAttachment accepts any file up to
 * 50 MB as type "file" and images only up to 10 MiB. Errors are per file.
 */
export async function uploadFiles({ hostState }: OursDeps, viewId: string, files: ReadonlyArray<vscode.Uri>): Promise<OursUploadResult> {
  const attachments = []; const errors: string[] = [];
  const threadId = hostState.snapshot(viewId).activeThreadId;
  for (const file of files) {
    try {
      if (file.scheme !== "file") throw new Error("Choose a file on this machine.");
      const info = await stat(file.fsPath);
      if (!info.isFile() || info.size > PROVIDER_SEND_TURN_MAX_FILE_BYTES) throw new Error("Choose a file of at most 50 MB.");
      attachments.push(await hostState.uploadAttachment(basename(file.fsPath), "", await readFile(file.fsPath), viewId, threadId));
    } catch (cause) { errors.push(`${basename(file.fsPath)}: ${cause instanceof Error ? cause.message : String(cause)}`); }
  }
  return { attachments, errors };
}

/** Uploads into the given chat view and adds the chips there; failed files also show as one warning. */
export async function insertAttachments(deps: OursDeps, viewId: string, files: ReadonlyArray<vscode.Uri>): Promise<OursUploadResult> {
  const result = await uploadFiles(deps, viewId, files);
  const draftKey = deps.hostState.snapshot(viewId).activeThreadId ?? "new";
  if (result.attachments.length) deps.registry.postWhenReady(viewId, OURS_EVENT, { kind: "addAttachments", draftKey, ...result } satisfies OursAddAttachments);
  if (result.errors.length) void vscode.window.showWarningMessage(`T3 VSCode could not attach: ${result.errors.join("; ")}`);
  return result;
}

/** As his extension.ts:254-255: mark the composer of the thread touched, then return the draft key the webview uses. */
async function touchComposer({ hostState }: OursDeps, viewId: string): Promise<string> {
  const threadId = hostState.snapshot(viewId).activeThreadId;
  if (threadId) await hostState.composerState(threadId, undefined, true, viewId);
  return hostState.snapshot(viewId).activeThreadId ?? "new";
}
