/** Receives the host composer helper events and writes through his draft store, as his insertReference path does. */
import { readDraft, readDraftSelection, rememberDraftSelection, updateDraft } from "../composerDrafts";
import { addDraftAttachments } from "../composerAttachments";
import { insertComposerReferenceText } from "../../shared/composerAttachments";
import type { OursAddAttachments, OursInsertText } from "../../shared/ours/composer";
import { registerOursEvent } from "./channel";

const FOCUS_RETRY_MS = 2000;
/**
 * His Composer listens for t3-focus-composer only once mounted, and a panel opened for this insert mounts later. So the
 * event repeats on animation frames until a textarea has focus or 2 s pass (decided by the lead, map 0.5).
 */
function focusComposer(draftKey: string, cursor?: number): void {
  const detail = cursor === undefined ? { draftKey } : { draftKey, cursor };
  const until = performance.now() + FOCUS_RETRY_MS;
  const attempt = () => {
    if (document.activeElement instanceof HTMLTextAreaElement || performance.now() > until) return;
    window.dispatchEvent(new CustomEvent("t3-focus-composer", { detail }));
    requestAnimationFrame(attempt);
  };
  attempt();
}

registerOursEvent("insertText", (data) => {
  const { draftKey, text } = data as unknown as OursInsertText;
  if (typeof draftKey !== "string" || typeof text !== "string") return;
  let cursor = 0;
  updateDraft(draftKey, (draft) => {
    const inserted = insertComposerReferenceText(draft.text, text, readDraftSelection(draftKey) ?? { start: draft.text.length, end: draft.text.length });
    cursor = inserted.cursor; rememberDraftSelection(draftKey, { start: cursor, end: cursor });
    return { ...draft, text: inserted.text };
  }, "take-focus");
  focusComposer(draftKey, cursor);
});

registerOursEvent("addAttachments", (data) => {
  const { draftKey, attachments } = data as unknown as OursAddAttachments;
  if (typeof draftKey !== "string" || !Array.isArray(attachments)) return;
  const { length } = readDraft(draftKey).text;
  focusComposer(draftKey, addDraftAttachments(draftKey, attachments, readDraftSelection(draftKey) ?? { start: length, end: length }));
});
