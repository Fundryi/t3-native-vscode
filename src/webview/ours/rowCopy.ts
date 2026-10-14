/**
 * Q18 rowCopy, webview side. A copy button on command input, command output and tool output, and the time on hover
 * of a user bubble and an assistant header. Window listeners only, no edit in his TranscriptView.tsx:
 * - One shared floating button: those <pre> scroll in both directions (tokens.css overflow: auto) and React rewrites
 *   their single text child while output streams, so a button inside them would scroll away or vanish.
 * - Times come from the newest state snapshot (rowTime.ts); the DOM only carries the row keys
 *   (data-search-row on every row, data-run-header on a run's assistant header).
 */
import { bridge, Events, Methods } from "../bridge-client";
import type { HostStateSnapshot } from "../../shared/bridge";
import { rowTimeTitle } from "../../shared/ours/rowTime";
import { failed } from "./channel";

const report = failed("rowCopy");
const icon = (paths: string) => `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const COPY = icon('<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>');
const CHECK = icon('<path d="M20 6 9 17l-5-5"/>');
const PRE = "pre.command-input, pre.tool-output";

const style = document.createElement("style");
style.textContent = `.ours-row-copy { position: fixed; z-index: 20; width: 23px; height: 23px; background: var(--code-background); border: 1px solid var(--border); border-radius: 6px; }
.ours-row-copy[hidden] { display: none; }`;
document.head.append(style);

const button = document.createElement("button");
button.className = "icon-button ours-row-copy";
button.hidden = true;
button.innerHTML = COPY;
document.body.append(button);

let current: HTMLElement | null = null;
let reset: ReturnType<typeof setTimeout> | undefined;
const hide = () => { current = null; button.hidden = true; };
const place = () => {
  if (!current?.isConnected) { hide(); return; }
  const pre = current.getBoundingClientRect();
  // Clamp to the transcript, so the button never floats over the composer or above the list.
  const view = current.closest(".transcript-container")?.getBoundingClientRect() ?? new DOMRect(0, 0, innerWidth, innerHeight);
  const top = Math.max(pre.top, view.top) + 4;
  if (top + 23 > Math.min(pre.bottom, view.bottom)) { button.hidden = true; return; }
  button.style.top = `${top}px`;
  // clientLeft + clientWidth ends left of the pre's vertical scrollbar.
  button.style.left = `${pre.left + current.clientLeft + current.clientWidth - 27}px`;
  button.hidden = false;
};
const target = (pre: HTMLElement) => {
  current = pre;
  clearTimeout(reset);
  button.innerHTML = COPY;
  const label = pre.classList.contains("command-input") ? "Copy command" : "Copy output";
  button.title = label;
  button.setAttribute("aria-label", label);
  place();
};

button.addEventListener("click", () => {
  const text = current?.textContent;
  if (!text) return;
  // His copyText writes through vscode.env.clipboard; the snapshot it returns is not ours to apply.
  void bridge.request(Methods.copyText, { text }).then(() => {
    button.innerHTML = CHECK;
    clearTimeout(reset);
    reset = setTimeout(() => { button.innerHTML = COPY; }, 1500);
  }, report);
});
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

window.addEventListener("mouseover", (event) => {
  try {
    const element = event.target instanceof Element ? event.target : null;
    if (!element || element === button || button.contains(element)) return;
    const pre = element.closest<HTMLElement>(PRE);
    if (pre !== current) { if (pre) target(pre); else hide(); }
    showTime(element);
  } catch (cause) { report(cause); }
}, { passive: true });
