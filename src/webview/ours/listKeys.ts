/**
 * R14 keys2, webview side (docs/ours/FORK-FEATURES.md R14). Reports focus for the host's t3-vscode.ours.inT3 context
 * (Ctrl+Alt+C out, Ctrl+N), and keys for his sessions list (ThreadList.tsx): Up, Down, Home, End move over the rows,
 * F2 renames (his prompt), Delete archives (host, so the R11 Undo applies), Ctrl+F focuses "Search threads".
 * F2 in a chat renames it (his header rename is double-click only, ChatView.tsx:67). Window listeners only.
 */
import { bridge, Methods } from "../bridge-client";
import { failed, oursRequest } from "./channel";

const reportFocus = failed("focus report");
const report = failed("sessions list keys");
const ROW = "button.thread[data-thread-id]";
const SEARCH = 'input[aria-label="Search threads"]';

let focused = false;
const tell = (now: boolean) => { if (now === focused) return; focused = now; oursRequest("keys.focus", { focused: now }).catch(reportFocus); };
window.addEventListener("focus", () => tell(true));
window.addEventListener("pointerdown", () => tell(true));
window.addEventListener("blur", () => tell(false));
if (document.hasFocus()) tell(true);

const rename = (threadId: string) => { bridge.request(Methods.threadAction, { threadId, action: "rename" }).catch(report); };
// Closed shelves (<details>) keep their rows in the DOM; only rows with a box count.
const rowsOf = (list: Element) => [...list.querySelectorAll<HTMLElement>(ROW)].filter((row) => row.getClientRects().length > 0);
const plain = (event: KeyboardEvent) => !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;

// Capture, so it runs before his ChatView capture handler: in a chat Ctrl+F stays his find, unless focus is in his History popup.
window.addEventListener("keydown", (event) => {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== "f" || !(event.target instanceof Element)) return;
  const history = event.target.closest(".compact-history");
  const search = (history ?? (document.querySelector(".chat-view") ? null : document))?.querySelector<HTMLInputElement>(SEARCH);
  if (search) { event.preventDefault(); event.stopPropagation(); search.focus(); search.select(); }
}, true);

window.addEventListener("keydown", (event) => {
  if (event.defaultPrevented || !plain(event) || !(event.target instanceof Element)) return;
  const target = event.target;
  const list = target.closest(".compact-history, .projects-sidebar");
  const row = target.closest<HTMLElement>(ROW);
  if (row && list) {
    const rows = rowsOf(list), index = rows.indexOf(row);
    const next = event.key === "ArrowDown" ? rows[index + 1] : event.key === "ArrowUp" ? rows[index - 1] : event.key === "Home" ? rows[0] : event.key === "End" ? rows.at(-1) : undefined;
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) { event.preventDefault(); next?.focus(); return; }
    const threadId = row.dataset.threadId!;
    if (event.key === "F2") { event.preventDefault(); rename(threadId); return; }
    if (event.key === "Delete") {
      event.preventDefault();
      // The archived row unmounts; keep focus in the list on its neighbour.
      const neighbour = (rows[index + 1] ?? rows[index - 1])?.dataset.threadId;
      oursRequest<boolean>("keys.archive", { threadId }).then((archived) => {
        if (archived !== true || !neighbour) return;
        setTimeout(() => list.querySelector<HTMLElement>(`${ROW}[data-thread-id="${CSS.escape(neighbour)}"]`)?.focus(), 0);
      }).catch(report);
    }
    return;
  }
  // Down in the search box goes to the first row.
  if (event.key === "ArrowDown" && list && target.matches(SEARCH)) { const first = rowsOf(list)[0]; if (first) { event.preventDefault(); first.focus(); } return; }
  if (event.key === "F2" && !list && !target.closest(".composer-suggestions, [role=menu], [role=dialog]")) {
    const threadId = target.closest(".chat-view")?.querySelector<HTMLElement>(".chat-main")?.dataset.threadId;
    if (threadId) { event.preventDefault(); rename(threadId); }
  }
});
