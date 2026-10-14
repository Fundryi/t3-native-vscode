/** Host-to-webview payloads of the fork's composer helper, sent as OURS_EVENT. */
import type { DraftAttachment } from "../composerAttachments.js";

export interface OursInsertText { readonly kind: "insertText"; readonly draftKey: string; readonly text: string }
export interface OursUploadResult { readonly attachments: ReadonlyArray<DraftAttachment>; readonly errors: ReadonlyArray<string> }
export interface OursAddAttachments extends OursUploadResult { readonly kind: "addAttachments"; readonly draftKey: string }
