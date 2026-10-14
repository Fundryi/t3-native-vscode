/**
 * Q18 rowCopy, webview side. A copy button on command input, command output and tool output, and the time on hover
 * of a user bubble and an assistant header. Window listeners only, no edit in his TranscriptView.tsx:
 * - One shared floating button: those <pre> scroll in both directions (tokens.css overflow: auto) and React rewrites
 *   their single text child while output streams, so a button inside them would scroll away or vanish.
 * - Times come from the newest state snapshot (rowTime.ts); the DOM only carries the row keys
 *   (data-search-row on every row, data-run-header on a run's assistant header).
 * R16 output adds "Open in editor" next to Copy (host: src/host/ours/output.ts) and makes the boxes keyboard
 * reachable: Tab focuses one (focus shows the buttons and times as hover does), Enter opens it in an editor, and
 * Ctrl+C with no selection inside it copies all of it.
 */
import { bridge, Events, Methods } from "../bridge-client";
import type { HostStateSnapshot } from "../../shared/bridge";
import { rowTimeTitle } from "../../shared/ours/rowTime";
import { failed, oursRequest } from "./channel";

const report = failed("rowCopy");
const icon = (paths: string) => `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const COPY = icon('<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>');
const CHECK = icon('<path d="M20 6 9 17l-5-5"/>');
const OPEN = icon('<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>');
const PRE = "pre.command-input, pre.tool-output";
const kind = (pre: HTMLElement) => pre.classList.contains("command-input") ? "command" : "output";

const style = document.createElement("style");
style.textContent = `.ours-row-buttons { position: fixed; z-index: 20; display: flex; gap: 3px; }
.ours-row-buttons[hidden] { display: none; }
.ours-row-copy { width: 23px; height: 23px; background: var(--code-background); border: 1px solid var(--border); border-radius: 6px; }
pre.command-input:focus-visible, pre.tool-output:focus-visible { outline: 2px solid var(--ring); outline-offset: -2px; }`;
document.head.append(style);

// One fixed container for both buttons, so they show, hide and move together.
const bar = document.createElement("div");
bar.className = "ours-row-buttons";
bar.hidden = true;
const make = (svg: string) => { const element = document.createElement("button"); element.className = "icon-button ours-row-copy"; element.innerHTML = svg; return element; };
const openButton = make(OPEN);
const button = make(COPY);
bar.append(openButton, button);
document.body.append(bar);

let current: HTMLElement | null = null;
let reset: ReturnType<typeof setTimeout> | undefined;
const hide = () => { current = null; bar.hidden = true; };
const place = () => {
  if (!current?.isConnected) { hide(); return; }
  const pre = current.getBoundingClientRect();
  // Clamp to the transcript, so the button never floats over the composer or above the list.
  const view = current.closest(".transcript-container")?.getBoundingClientRect() ?? new DOMRect(0, 0, innerWidth, innerHeight);
  const top = Math.max(pre.top, view.top) + 4;
  if (top + 23 > Math.min(pre.bottom, view.bottom)) { bar.hidden = true; return; }
  bar.style.top = `${top}px`;
  // clientLeft + clientWidth ends left of the pre's vertical scrollbar; two 23 px buttons, a 3 px gap, 4 px margin.
  bar.style.left = `${pre.left + current.clientLeft + current.clientWidth - 53}px`;
  bar.hidden = false;
};
const target = (pre: HTMLElement) => {
  current = pre;
  clearTimeout(reset);
  button.innerHTML = COPY;
  const what = kind(pre);
  for (const [element, label] of [[button, `Copy ${what}`], [openButton, `Open ${what} in editor`]] as const) {
    element.title = label;
    element.setAttribute("aria-label", label);
  }
  place();
};

const copy = (pre: HTMLElement | null) => {
  const text = pre?.textContent;
  if (!text) return;
  // His copyText writes through vscode.env.clipboard; the snapshot it returns is not ours to apply.
  void bridge.request(Methods.copyText, { text }).then(() => {
    if (current !== pre) return;
    button.innerHTML = CHECK;
    clearTimeout(reset);
    reset = setTimeout(() => { button.innerHTML = COPY; }, 1500);
  }, report);
};
const openInEditor = (pre: HTMLElement | null) => {
  const text = pre?.textContent;
  if (!pre || !text) return;
  void oursRequest("outputOpen", { text, what: kind(pre) }).catch(report);
};
button.addEventListener("click", () => copy(current));
openButton.addEventListener("click", () => openInEditor(current));
window.addEventListener("scroll", () => { if (current) place(); }, true); // capture: the list scrolls an inner node
window.addEventListener("resize", () => { if (current) place(); });
document.documentElement.addEventListener("mouseleave", hide);

// Times. The first snapshot and history pages come as replies to his requests, not as events: a missing key asks once.
let latest: HostStateSnapshot | undefined;
let refreshing = false;
const keep = (next: HostStateSnapshot) => { if (!latest || next.revision >= latest.revision) latest = next; };
bridge.on(Events.stateChanged, (data) => keep(data as HostStateSnapshot));
const format = (time: number) => new Date(time).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

const showTime = (element: Element, retry = true) => {
  const bubble = element.closest<HTMLElement>(".user-bubble");
  const header = bubble ? null : element.closest<HTMLElement>(".response-header");
  const host = bubble ?? header;
  if (!host) return;
  const runKey = header?.dataset.runHeader;
  // The sticky and footer "Working" headers carry no row key: no title there.
  const key = runKey ?? host.closest<HTMLElement>("[data-search-row]")?.dataset.searchRow;
  if (!key) return;
  const activeRunId = latest ? latest.threads.find((thread) => thread.id === latest?.activeThreadId)?.activeRunId ?? latest.queue?.activeRunId ?? null : null;
  const title = latest ? rowTimeTitle(latest.transcript, key, runKey ? "run" : "message", format, activeRunId) : undefined;
  if (title !== undefined) { if (host.title !== title) host.title = title; return; }
  if (!retry || refreshing || (latest && latest.transcript.some((row) => row.key === key))) return;
  if (host.hasAttribute("data-ours-asked")) return; // one ask per element, not one per mouseover
  host.setAttribute("data-ours-asked", "");
  refreshing = true;
  void bridge.request<HostStateSnapshot>(Methods.getState).then((state) => { keep(state); if (host.isConnected) showTime(host, false); }, report).finally(() => { refreshing = false; });
};

// Focus does what hover does, so a keyboard user gets the buttons and the times too.
const enter = (event: Event) => {
  try {
    const element = event.target instanceof Element ? event.target : null;
    if (!element || bar.contains(element)) return;
    const pre = element.closest<HTMLElement>(PRE);
    if (pre !== current) { if (pre) target(pre); else hide(); }
    showTime(element);
  } catch (cause) { report(cause); }
};
window.addEventListener("mouseover", enter, { passive: true });
window.addEventListener("focusin", enter);

// Capture phase: runs before VS Code's own keydown listener in this webview (see approvalKeys.ts).
window.addEventListener("keydown", (event) => {
  try {
    const pre = event.target instanceof HTMLElement && event.target.matches(PRE) ? event.target : null;
    if (!pre || event.altKey || event.shiftKey || event.isComposing) return;
    const ctrl = event.ctrlKey || event.metaKey;
    if (!ctrl && event.key === "Enter") openInEditor(pre);
    else if (ctrl && event.key.toLowerCase() === "c") {
      // A selection inside the box copies as usual; none, or one elsewhere left behind by Tab, copies the whole box.
      const selection = getSelection();
      if (selection && !selection.isCollapsed && selection.anchorNode && pre.contains(selection.anchorNode)) return;
      if (current !== pre) target(pre);
      copy(pre);
    } else return;
    event.preventDefault();
    event.stopImmediatePropagation();
  } catch (cause) { report(cause); }
}, true);

// Focusable boxes. Only childList: the attributes set here must not wake the observer again.
const describe = () => {
  for (const pre of document.querySelectorAll<HTMLElement>(PRE)) {
    if (pre.hasAttribute("tabindex")) continue;
    pre.tabIndex = 0;
    pre.setAttribute("role", "group");
    pre.setAttribute("aria-label", `${kind(pre) === "command" ? "Command" : "Output"}. Enter opens it in an editor, Ctrl+C copies all.`);
  }
};
let queued = false;
new MutationObserver(() => {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => { queued = false; try { describe(); } catch (cause) { report(cause); } });
}).observe(document.body, { childList: true, subtree: true });
describe();
