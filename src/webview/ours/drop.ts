/**
 * I drop, webview side (chat panels only; the sidebar has no composer). VS Code lets a drag from its Explorer or a tab
 * into a webview only while Shift is held. Window capture listeners claim those drags before his composer handler;
 * OS file drops (type Files without VS Code's types) stay with his composer. The host parses the strings (dropParse.ts).
 */
import { oursRequest } from "./channel";

const CODE_TYPES = ["application/vnd.code.uri-list", "resourceurls"];
// Not "files": an OS file drag reaches his composer without Shift, so its quick pass over the panel needs no hint.
const HINT_TYPES = [...CODE_TYPES, "codeeditors"];
const DRIVE_PATH = /^[A-Za-z]:[\\/]/;
const typesOf = (event: DragEvent): string[] => [...(event.dataTransfer?.types ?? [])].map((type) => type.toLowerCase());
const fromCode = (types: ReadonlyArray<string>) => CODE_TYPES.some((type) => types.includes(type));
// text/plain drive paths are the trail when VS Code's own types do not reach the webview; never with OS files.
const mayClaim = (types: ReadonlyArray<string>) => fromCode(types) || (types.includes("text/plain") && !types.includes("files"));
const report = (cause: unknown) => console.error("T3 VSCode (fork): drop failed", cause);

if (document.body.dataset.surface !== "sidebar") {
  let internal = false; // a drag that started in this document (composer text, queue reorder) is never ours
  let entered = 0;
  let hinted = 0;
  window.addEventListener("dragstart", () => { internal = true; }, true);
  window.addEventListener("dragend", () => { internal = false; }, true);
  window.addEventListener("dragover", (event) => {
    if (!event.isTrusted || internal || !event.dataTransfer || !mayClaim(typesOf(event))) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, true);
  window.addEventListener("drop", (event) => {
    const data = event.dataTransfer;
    entered = 0;
    if (!event.isTrusted || internal || !data) return;
    const types = typesOf(event);
    // text/uri-list holds only the first item in Chromium; VS Code's own list and text/plain hold all of them.
    const text = data.getData("text/plain") || data.getData("text/uri-list");
    const claim = fromCode(types) || (mayClaim(types) && DRIVE_PATH.test(text.trimStart()));
    if (claim) { event.preventDefault(); event.stopPropagation(); } // his composer handler never sees it
    else if (types.includes("files")) return; // an OS file drop: his composer attaches it
    // Unclaimed drops still go to the host log, so a drop that did nothing shows what it carried.
    void oursRequest("dropUris", claim ? { types, uriList: data.getData("application/vnd.code.uri-list"), text } : { types }).catch(report);
  }, true);
  // A VS Code drag without Shift bounces off the webview: in and out within 500 ms. Hint at most once per 5 s.
  window.addEventListener("dragenter", (event) => {
    if (event.isTrusted && !internal && HINT_TYPES.some((type) => typesOf(event).includes(type))) entered = Date.now();
  }, true);
  window.addEventListener("dragleave", (event) => {
    if (event.relatedTarget) return; // moved to another element of this page: the drag goes on
    const now = Date.now();
    if (entered && now - entered < 500 && now - hinted >= 5000) { hinted = now; void oursRequest("dropHint", { types: typesOf(event) }).catch(report); }
    entered = 0;
  }, true);
}
