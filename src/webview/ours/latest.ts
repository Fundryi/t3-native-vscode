/**
 * Q10 latest, webview only. His MessageNavigator shows "Latest" only with two or more exchanges and the navigator on,
 * so ours draws one "Latest" button whenever the transcript is scrolled up, with a pulsing dot while the agent works.
 * A click goes through his hidden button when it exists (his latest() also resumes following), else scrolls to the end.
 * Also: a pulse on his "Working" labels, and the newest running step on a collapsed work group header.
 * shortcut: anchored on his class names (.transcript-container, .transcript-list, .work-group-toggle,
 * data-message-key); re-check them on each upstream merge, typecheck cannot.
 */
import { bridge, Events, Methods } from "../bridge-client";
import type { HostStateSnapshot, TranscriptItem } from "../../shared/bridge";
import { runningStepLabels } from "../../shared/ours/latest";

const report = (cause: unknown) => console.error("T3 VSCode (fork): latest failed", cause);
const END_DISTANCE = 40; // his "at end" threshold (TranscriptView onScroll)

const style = document.createElement("style");
style.textContent = `
@keyframes ours-pulse { 50% { opacity: .35; } }
.response-header .working-label, .thread-working svg, .ours-latest[data-working] .ours-latest-dot { animation: ours-pulse 1.6s ease-in-out infinite; }
.transcript-container .message-nav-latest:not(.ours-latest) { display: none; }
.ours-latest[hidden] { display: none; }
.ours-latest-dot { display: none; width: 6px; height: 6px; border-radius: 50%; background: var(--primary); }
.ours-latest[data-working] .ours-latest-dot { display: inline-block; }
.work-group-toggle[aria-expanded="false"][data-ours-running]::after { content: attr(data-ours-running); min-width: 0; max-width: 45%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted-foreground); font-size: .6875rem; }`;
document.head.append(style);

const button = document.createElement("button");
button.type = "button";
button.className = "message-nav-latest btn ours-latest";
button.hidden = true;
button.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></svg>Latest<span class="ours-latest-dot" aria-hidden="true"></span>`;

let snapshot: HostStateSnapshot | undefined;
let fetched = false;
let labelsFor: ReadonlyArray<TranscriptItem> | undefined;
let labels = new Map<string, string>();

// His working rule (TranscriptView: activeRun or acknowledgedWorking) for the shown thread.
const working = (state: HostStateSnapshot) => !!(state.threads.find((thread) => thread.id === state.activeThreadId)?.activeRunId || state.queue?.activeRunId || state.acknowledgedWorking);
const scroller = (container: Element) => container.querySelector<HTMLElement>(".transcript-list");
const distance = (node: HTMLElement) => node.scrollHeight - node.scrollTop - node.clientHeight;

function update(): void {
  const container = document.querySelector<HTMLElement>(".transcript-container");
  if (!container) { button.remove(); return; }
  // App fetched its first state itself; ours only sees later pushes, so ask once when a chat first shows.
  if (!snapshot && !fetched) { fetched = true; void bridge.request<HostStateSnapshot>(Methods.getState).then((state) => { snapshot ??= state; schedule(); }, report); }
  // Last child: React only inserts before its own nodes, so it never moves or drops ours from there.
  if (container.lastElementChild !== button) container.append(button);
  const node = scroller(container);
  const scrolledUp = !!node && distance(node) >= END_DISTANCE;
  const busy = scrolledUp && !!snapshot && working(snapshot);
  button.hidden = !scrolledUp;
  button.toggleAttribute("data-working", busy);
  button.setAttribute("aria-label", busy ? "Jump to latest message, the agent is still working" : "Jump to latest message");
  button.title = busy ? "Jump to latest message (still working)" : "Jump to latest message";
  if (snapshot && labelsFor !== snapshot.transcript) { labelsFor = snapshot.transcript; labels = runningStepLabels(snapshot.transcript); }
  for (const toggle of container.querySelectorAll<HTMLElement>(".work-group-toggle")) {
    const label = labels.get(toggle.closest<HTMLElement>("[data-message-key]")?.dataset.messageKey ?? "");
    if (label === undefined) toggle.removeAttribute("data-ours-running");
    else if (toggle.dataset.oursRunning !== label) toggle.dataset.oursRunning = label;
  }
}

let frame = 0;
function schedule(): void {
  if (frame) return;
  frame = requestAnimationFrame(() => { frame = 0; try { update(); } catch (cause) { report(cause); } });
}

button.addEventListener("click", () => {
  try {
    const container = button.parentElement;
    const his = container?.querySelector<HTMLButtonElement>(".message-nav-latest:not(.ours-latest)");
    if (his) { his.click(); return; }
    // No navigator (one exchange, or the setting off): scroll the list; his onScroll resumes following at the end.
    let tries = 0;
    const step = () => {
      const node = container && scroller(container);
      if (!node) return;
      node.scrollTop = node.scrollHeight;
      // Rows measured late can grow the list after the jump; keep going for a few frames.
      if (distance(node) >= END_DISTANCE && ++tries < 20) requestAnimationFrame(step);
    };
    step();
  } catch (cause) { report(cause); }
});

bridge.on(Events.stateChanged, (data) => { snapshot = data as HostStateSnapshot; schedule(); });
// Scroll does not bubble; a capture listener sees the list's scroll from the document.
document.addEventListener("scroll", (event) => { if (event.target instanceof HTMLElement && event.target.classList.contains("transcript-list")) schedule(); }, true);
window.addEventListener("resize", schedule);
const root = document.getElementById("root");
if (root) new MutationObserver(schedule).observe(root, { childList: true, subtree: true });
