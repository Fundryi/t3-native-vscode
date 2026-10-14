/**
 * R8 errors, webview side. A turn error gets a heading line above it (what kind of failure, whether it is retrying,
 * Copy error, Show Logs), its text is clamped to 4 lines with "Show more"; a click on "N failed" opens the failed
 * steps; a session row whose last run failed gets a red dot. No line of his changed:
 * - The heading is a PREVIOUS sibling of his `.turn-error`: React rewrites the error's only text child, and
 *   reprompt.ts already keeps its Retry button as the NEXT sibling (a second "after" insert would make both fight).
 * - The error div itself only gets data-ours-* attributes, which React never touches.
 * - Failure class and retry come from the newest state snapshot by row key (data-search-row), as in rowCopy.ts.
 */
import { bridge, Events, Methods } from "../bridge-client";
import type { HostStateSnapshot } from "../../shared/bridge";
import { errorView } from "../../shared/ours/errors";
import { failed, oursRequest } from "./channel";

const report = failed("errors");
const ERROR = "[data-search-row] > .turn-error";

const style = document.createElement("style");
style.textContent = `.ours-error-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 8px; margin: 10px 0 -6px; font-size: 0.75rem; }
.ours-error-title { color: var(--destructive); font-weight: 600; }
.ours-error-detail { color: var(--muted-foreground); }
.ours-error-actions { display: flex; gap: 10px; margin-left: auto; }
.ours-error-actions .text-button { font-size: 0.75rem; }
.ours-error-actions [hidden] { display: none; }
${ERROR} { white-space: pre-wrap; overflow-wrap: anywhere; }
${ERROR}[data-ours-clamp] { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 4; overflow: hidden; overflow: clip; overflow-clip-margin: content-box; }
.work-group-failures { cursor: pointer; }
.work-group-failures:hover { text-decoration: underline; }
.thread[data-ours-failed] .thread-title::before { content: ""; display: inline-block; width: 6px; height: 6px; margin-right: 5px; border-radius: 50%; background: var(--destructive); vertical-align: middle; }`;
document.head.append(style);

let latest: HostStateSnapshot | undefined;
const asked = new Set<string>();
const keep = (next: unknown) => {
  const state = next as HostStateSnapshot | undefined;
  if (!state || typeof state.revision !== "number" || !Array.isArray(state.transcript) || !Array.isArray(state.threads)) return;
  if (!latest || state.revision >= latest.revision) latest = state;
  schedule();
};
// His App gets the first state and history pages as request replies, not pushes: ask once per unknown key. Only once a
// row of his is on screen, so his App already listens (getState marks the view ready).
const ask = (key: string) => {
  if (asked.has(key)) return;
  asked.add(key);
  void bridge.request<HostStateSnapshot>(Methods.getState).then(keep, report);
};
const activeRunId = (state: HostStateSnapshot) => state.threads.find((thread) => thread.id === state.activeThreadId)?.activeRunId ?? state.queue?.activeRunId ?? null;
const format = (time: number) => new Date(time).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

const button = (label: string, title: string, onClick: (head: HTMLElement) => void) => {
  const element = document.createElement("button");
  element.type = "button";
  element.className = "text-button";
  element.textContent = label;
  element.title = title;
  element.addEventListener("click", () => {
    try { const head = element.closest<HTMLElement>(".ours-error-head"); if (head) onClick(head); } catch (cause) { report(cause); }
  });
  return element;
};
const errorOf = (head: HTMLElement) => head.nextElementSibling instanceof HTMLElement && head.nextElementSibling.matches(ERROR) ? head.nextElementSibling : null;
const errorText = (head: HTMLElement) => head.dataset.oursCopy || errorOf(head)?.textContent || "";

function createHead(): HTMLElement {
  const head = document.createElement("div");
  head.className = "ours-error-head";
  const title = document.createElement("span");
  title.className = "ours-error-title";
  const detail = document.createElement("span");
  detail.className = "ours-error-detail";
  const actions = document.createElement("span");
  actions.className = "ours-error-actions";
  const more = button("Show more", "Show the whole error", (owner) => {
    const error = errorOf(owner);
    if (!error) return;
    const open = !error.hasAttribute("data-ours-open");
    error.toggleAttribute("data-ours-open", open);
    error.toggleAttribute("data-ours-clamp", !open);
    schedule();
  });
  more.classList.add("ours-error-more");
  more.hidden = true;
  let reset: ReturnType<typeof setTimeout> | undefined;
  const copy = button("Copy error", "Copy the error text", (owner) => {
    const text = errorText(owner);
    if (!text) return;
    // His copyText writes through vscode.env.clipboard; the snapshot it returns is not ours to apply.
    void bridge.request(Methods.copyText, { text }).then(() => {
      copy.textContent = "Copied";
      clearTimeout(reset);
      reset = setTimeout(() => { copy.textContent = "Copy error"; }, 1500);
    }, report);
  });
  const logs = button("Show Logs", "Open the T3 VSCode (fork) log with this error in it", (owner) => {
    void oursRequest("errors.showLogs", { text: errorText(owner) }).catch(report);
  });
  actions.append(more, copy, logs);
  head.append(title, detail, actions);
  return head;
}

let tick: ReturnType<typeof setTimeout> | undefined;
function decorate(): void {
  for (const head of document.querySelectorAll<HTMLElement>(".ours-error-head")) if (!errorOf(head)) head.remove();
  let live = false;
  for (const error of document.querySelectorAll<HTMLElement>(ERROR)) {
    const key = error.parentElement?.dataset.searchRow ?? "";
    const view = latest ? errorView(latest.transcript, key, activeRunId(latest), Date.now(), format) : undefined;
    if (!view && key) ask(key);
    live ||= !!view?.live;
    const previous = error.previousElementSibling;
    const head = previous instanceof HTMLElement && previous.classList.contains("ours-error-head") ? previous : createHead();
    if (head !== previous) error.before(head);
    const signature = `${view?.heading ?? ""}\n${view?.detail ?? ""}`;
    if (head.dataset.oursSignature !== signature) {
      head.dataset.oursSignature = signature;
      head.querySelector(".ours-error-title")!.textContent = view?.heading ?? "Error";
      head.querySelector(".ours-error-detail")!.textContent = view?.detail ?? "";
    }
    if (view) { if (head.dataset.oursCopy !== view.copy) head.dataset.oursCopy = view.copy; } else delete head.dataset.oursCopy;
    const open = error.hasAttribute("data-ours-open");
    if (!open && !error.hasAttribute("data-ours-clamp")) error.setAttribute("data-ours-clamp", "");
    const more = head.querySelector<HTMLButtonElement>(".ours-error-more")!;
    const hidden = !open && error.scrollHeight <= error.clientHeight + 1;
    if (more.hidden !== hidden) more.hidden = hidden;
    const label = open ? "Show less" : "Show more";
    if (more.textContent !== label) more.textContent = label;
  }
  // The retry countdown changes with time, not with the DOM.
  clearTimeout(tick);
  tick = live ? setTimeout(schedule, 1000) : undefined;
  const rows = document.querySelectorAll<HTMLElement>("button.thread[data-thread-id]");
  if (rows.length && !latest) ask("");
  for (const row of rows) {
    const isFailed = latest?.threads.find((thread) => thread.id === row.dataset.threadId)?.status === "failed";
    if (row.hasAttribute("data-ours-failed") !== isFailed) row.toggleAttribute("data-ours-failed", isFailed);
  }
}

let frame = 0;
function schedule(): void {
  if (frame) return;
  frame = requestAnimationFrame(() => { frame = 0; try { decorate(); } catch (cause) { report(cause); } });
}
bridge.on(Events.stateChanged, keep);
new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
window.addEventListener("resize", schedule);

// "N failed" sits inside his group toggle: open the group (never close it from here), then each failed step.
window.addEventListener("click", (event) => {
  try {
    const badge = event.target instanceof Element ? event.target.closest(".work-group-failures") : null;
    const toggle = badge?.closest<HTMLElement>(".work-group-toggle");
    const group = toggle?.closest<HTMLElement>(".work-group");
    if (!toggle || !group) return;
    if (toggle.getAttribute("aria-expanded") === "true") { event.preventDefault(); event.stopPropagation(); }
    requestAnimationFrame(() => {
      try {
        const steps = [...group.querySelectorAll<HTMLButtonElement>(".work-entry.failed > button[aria-expanded]")];
        for (const step of steps) if (step.getAttribute("aria-expanded") === "false") step.click();
        steps[0]?.scrollIntoView({ block: "nearest" });
      } catch (cause) { report(cause); }
    });
  } catch (cause) { report(cause); }
}, true);
