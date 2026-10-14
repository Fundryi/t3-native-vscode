/**
 * I drop, webview side (chat views only: a panel, or the sidebar while K layout shows a chat there).
 * VS Code's rules (docs/ours/FORK-FEATURES.md I): a drag that started in the workbench (Explorer, a tab) reaches this
 * document only while Shift is held; an OS file drag (items all of kind "file") is blocked by VS Code's webview wrapper
 * unless this page preventDefaults its dragenter and keeps its dragover from the wrapper, as Codex does. Window capture
 * listeners run before his composer handler and before the wrapper's own listeners. VS Code drags are claimed here
 * (the host parses the strings, dropParse.ts); OS file drops stay with his composer. Every trusted dragenter and drop
 * goes to the host log as one "Drag trace" line, so a failed drop shows what arrived.
 * A paste without text and without files asks the host for the paths of the last Explorer Ctrl+C (pasteCopied).
 */
import { oursRequest, failed } from "./channel";
import { showShiftHint } from "./shiftHint";

const CODE_TYPES = ["application/vnd.code.uri-list", "resourceurls"];
// Not "files": an OS file drag reaches his composer without Shift, so its quick pass over the panel needs no hint.
const HINT_TYPES = [...CODE_TYPES, "codeeditors"];
const DRIVE_PATH = /^[A-Za-z]:[\\/]/;
const typesOf = (event: DragEvent): string[] => [...(event.dataTransfer?.types ?? [])].map((type) => type.toLowerCase());
const fromCode = (types: ReadonlyArray<string>) => CODE_TYPES.some((type) => types.includes(type));
// text/plain drive paths are the trail when VS Code's own types do not reach the webview; never with OS files.
const mayClaim = (types: ReadonlyArray<string>) => fromCode(types) || (types.includes("text/plain") && !types.includes("files"));
// A drag carrying these never started in this document (our only draggables set text or application/x-t3-queued-run).
const foreign = (types: ReadonlyArray<string>) => fromCode(types) || types.includes("codeeditors") || types.includes("files");
const report = failed("drop");
// Read on every event: K layout flips the sidebar between its list ("sidebar") and a chat.
const noChat = () => document.body.dataset.surface === "sidebar";
const trace = (event: DragEvent) => void oursRequest("dragTrace", {
  event: event.type, types: typesOf(event), shift: event.shiftKey,
  // VS Code's wrapper and Codex branch on item kinds ("file" vs "string"), so the log shows them too.
  kinds: [...(event.dataTransfer?.items ?? [])].map((item) => `${item.kind}:${item.type.toLowerCase()}`),
}).catch(report);

{
  let internal = false; // a drag that started in this document (composer text, queue reorder) is never ours
  let entered = 0;
  let hinted = 0;
  let traced = 0;
  window.addEventListener("dragstart", () => { internal = true; }, true);
  window.addEventListener("dragend", () => { internal = false; }, true);
  window.addEventListener("dragover", (event) => {
    if (noChat() || !event.isTrusted || internal || !event.dataTransfer) return;
    const types = typesOf(event);
    // An OS file drag: keep the wrapper from posting "drag" (VS Code then blocks this frame without Shift); his
    // composer's onDragOver only preventDefaults, which this does for him.
    if (types.includes("files") && !fromCode(types)) {
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "copy";
      return;
    }
    if (!mayClaim(types)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, true);
  window.addEventListener("drop", (event) => {
    const data = event.dataTransfer;
    entered = 0;
    if (event.isTrusted) trace(event);
    const wasInternal = internal;
    internal = false; // dragend may never come (the source left the page); the next drag starts clean
    if (noChat() || !event.isTrusted || wasInternal || !data) return;
    const types = typesOf(event);
    // text/uri-list holds only the first item in Chromium; VS Code's own list and text/plain hold all of them.
    const text = data.getData("text/plain") || data.getData("text/uri-list");
    const claim = fromCode(types) || (mayClaim(types) && DRIVE_PATH.test(text.trimStart()));
    if (claim) { event.preventDefault(); event.stopPropagation(); } // his composer handler never sees it
    // Unclaimed drops (an OS file drop too, which his composer attaches) still go to the host log, to show what arrived.
    void oursRequest("dropUris", claim ? { types, uriList: data.getData("application/vnd.code.uri-list"), text } : { types }).catch(report);
  }, true);
  // A VS Code drag without Shift bounces off the webview: in and out within 500 ms. Note over the composer on every
  // bounce (Q21), the toast at most once per 5 s.
  window.addEventListener("dragenter", (event) => {
    if (!event.isTrusted) return;
    const now = Date.now();
    if (now - traced >= 500) { traced = now; trace(event); }
    const types = typesOf(event);
    if (foreign(types)) internal = false;
    if (noChat() || internal) return;
    // An OS file drag: without this VS Code's wrapper posts "drag-start" and VS Code blocks this frame (Codex does the same).
    if (types.includes("files") && !fromCode(types)) event.preventDefault();
    if (HINT_TYPES.some((type) => types.includes(type))) entered = now;
  }, true);
  window.addEventListener("dragleave", (event) => {
    if (event.relatedTarget) return; // moved to another element of this page: the drag goes on
    const now = Date.now();
    if (entered && now - entered < 500) {
      showShiftHint();
      if (now - hinted >= 5000) { hinted = now; void oursRequest("dropHint", { types: typesOf(event) }).catch(report); }
    }
    entered = 0;
  }, true);
  // No isTrusted check: Ctrl+V reaches a webview through VS Code's paste plumbing, and a fake paste only re-adds copied paths.
  window.addEventListener("paste", (event) => {
    const data = event.clipboardData;
    if (noChat() || !data || data.files.length || data.getData("text/plain")) return; // his handlers paste text and images
    event.preventDefault();
    void oursRequest("pasteCopied").catch(report);
  }, true);
}
