/**
 * R9 openline (docs/ours/FORK-FEATURES.md R9), webview only.
 * - A click on an edited file's name (his FileChange heading sends openLink with the bare name, no line) gets the
 *   first changed line of that row's diff appended, so the editor lands on the change.
 * - A collapsed work group whose newest running step edits a file shows "Editing X" as a link that opens X there
 *   (Q10 drew that label as CSS text, which cannot be clicked).
 * shortcut: anchored on his class names (.file-change, .file-change-heading .text-button, pre.diff,
 * .work-group-toggle, data-message-key); re-check them on each upstream merge, typecheck cannot.
 */
import { bridge, Events, Methods } from "../bridge-client";
import { isObject, type HostStateSnapshot, type TranscriptItem } from "../../shared/bridge";
import { runningSteps, stepLabel } from "../../shared/ours/latest";
import { firstChangedLine } from "../../shared/ours/openline";
import { failed } from "./channel";

const report = failed("openline");
const withLine = (href: string, diff: string | undefined) => { const line = diff ? firstChangedLine(diff) : undefined; return line ? `${href}:${line}` : href; };

// 1. File names. His onClick runs run("openLink"), which calls bridge.request synchronously in the same click
// dispatch, so a capture listener notes the line first and the request below picks it up. His params stay his.
let pending: { href: string; to: string } | undefined;
const his = bridge.request.bind(bridge);
bridge.request = ((method, params, timeoutMs) => {
  try {
    if (pending && method === Methods.openLink && isObject(params) && params.href === pending.href) { params = { ...params, href: pending.to }; pending = undefined; }
  } catch (cause) { report(cause); }
  return his(method, params, timeoutMs);
}) as typeof bridge.request;

document.addEventListener("click", (event) => {
  try {
    const button = event.target instanceof Element ? event.target.closest<HTMLElement>(".file-change-heading .text-button") : null;
    const href = button?.textContent ?? "";
    const to = href && withLine(href, button?.closest(".file-change")?.querySelector("pre.diff")?.textContent ?? undefined);
    if (!to || to === href) return;
    pending = { href, to };
    // Not a microtask: those run between listeners, before React's root handler sees the click.
    setTimeout(() => { pending = undefined; });
  } catch (cause) { report(cause); }
}, true);

// 2. "Editing X" on a collapsed, running work group.
const style = document.createElement("style");
style.textContent = `
.work-group-toggle[aria-expanded="false"][data-ours-running][data-ours-file]::after { content: none; }
.ours-openline { min-width: 0; max-width: 45%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted-foreground); font-size: .6875rem; cursor: pointer; }
.ours-openline:hover { color: var(--foreground); text-decoration: underline; }
.work-group-toggle[aria-expanded="true"] > .ours-openline { display: none; }`;
document.head.append(style);

let snapshot: HostStateSnapshot | undefined;
let fetched = false;
let stepsFor: ReadonlyArray<TranscriptItem> | undefined;
let steps = new Map<string, TranscriptItem>();

function open(this: HTMLElement, event: MouseEvent): void {
  // Before React's root listener: the group must not toggle.
  event.stopPropagation(); event.preventDefault();
  const href = this.dataset.href;
  if (href) bridge.request(Methods.openLink, { href, threadId: snapshot?.activeThreadId }).catch(report);
}

function update(): void {
  const toggles = document.querySelectorAll<HTMLElement>(".transcript-container .work-group-toggle");
  if (!toggles.length) return;
  // App fetched its first state itself; ours only sees later pushes, so ask once when a work group first shows.
  if (!snapshot && !fetched) { fetched = true; void bridge.request<HostStateSnapshot>(Methods.getState).then((state) => { snapshot ??= state; schedule(); }, report); }
  if (snapshot && Array.isArray(snapshot.transcript) && stepsFor !== snapshot.transcript) { stepsFor = snapshot.transcript; steps = runningSteps(snapshot.transcript); }
  for (const toggle of toggles) {
    const step = steps.get(toggle.closest<HTMLElement>("[data-message-key]")?.dataset.messageKey ?? "");
    let span = toggle.querySelector<HTMLElement>(":scope > .ours-openline");
    if (step?.item.type !== "file_change" || !step.item.fileName) { span?.remove(); toggle.removeAttribute("data-ours-file"); continue; }
    if (!span) { span = document.createElement("span"); span.className = "ours-openline"; span.addEventListener("click", open); }
    // Last child: React inserts its own conditional spans before or after; keep ours at the end.
    if (toggle.lastElementChild !== span) toggle.append(span);
    const label = stepLabel(step).trim() || `Editing ${step.item.fileName}`;
    if (span.textContent !== label) span.textContent = label; // unguarded, the write would wake the observer forever
    span.title = `Open ${step.item.fileName}`;
    span.dataset.href = withLine(step.item.fileName, step.item.diffStr);
    toggle.dataset.oursFile = step.item.fileName;
  }
}

let frame = 0;
function schedule(): void {
  if (frame) return;
  frame = requestAnimationFrame(() => { frame = 0; try { update(); } catch (cause) { report(cause); } });
}

bridge.on(Events.stateChanged, (data) => { snapshot = data as HostStateSnapshot; schedule(); });
const root = document.getElementById("root");
if (root) new MutationObserver(schedule).observe(root, { childList: true, subtree: true });
