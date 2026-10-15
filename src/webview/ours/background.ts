/**
 * P2 bgwork, webview side (src/host/ours/background.ts answers). A one-line banner right above his .composer-box when
 * the chat finished its turn but left work running ("Running: npm run dev", "Waiting on 2 subagents"), with Stop.
 * DOM only: React anchors on its own nodes, so a foreign node before the box stays put; an observer puts it back when
 * his composer remounts (a chat switch). The banner leaves by itself once the server reports the work ended.
 */
import { bridge, Events } from "../bridge-client";
import { isObject } from "../../shared/bridge";
import { oursRequest, failed } from "./channel";

interface Work { readonly threadId: string; readonly title: string; readonly labels: ReadonlyArray<string>; readonly waiting: boolean }
const report = failed("background work");

const style = document.createElement("style");
style.textContent = `
.ours-background { display: flex; align-items: center; gap: 8px; padding: 4px 6px; font-size: .6875rem; color: var(--muted-foreground); }
.ours-background-dot { flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--foreground); }
.ours-background[data-waiting] .ours-background-dot { animation: ours-background-pulse 1.6s ease-in-out infinite; }
.ours-background-text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ours-background .btn { padding: 1px 8px; font-size: .6875rem; }
@keyframes ours-background-pulse { 50% { opacity: .3; } }
@media (prefers-reduced-motion: reduce) { .ours-background[data-waiting] .ours-background-dot { animation: none; } }`;
document.head.append(style);

const banner = document.createElement("div");
banner.className = "ours-background";
banner.setAttribute("role", "status");
const dot = document.createElement("span");
dot.className = "ours-background-dot";
dot.setAttribute("aria-hidden", "true");
const text = document.createElement("span");
text.className = "ours-background-text";
const stop = document.createElement("button");
stop.type = "button";
stop.className = "btn";
banner.append(dot, text, stop);

let work: Work | null = null;
let stopping = false;

const isWork = (value: unknown): value is Work => isObject(value) && typeof value.threadId === "string" && typeof value.title === "string"
  && Array.isArray(value.labels) && value.labels.every((label) => typeof label === "string") && typeof value.waiting === "boolean";

function place(): void {
  const column = work ? document.querySelector(".composer-column") : null;
  const box = column?.querySelector(":scope > .composer-box");
  if (!column || !box) { banner.remove(); return; }
  if (box.previousSibling !== banner) column.insertBefore(banner, box);
}

function render(): void {
  if (work) {
    // A single named item is already in the title (as T3 web).
    const line = work.labels.length > 1 ? `${work.title}: ${work.labels.join(", ")}` : work.title;
    text.textContent = line;
    text.title = line;
    banner.toggleAttribute("data-waiting", work.waiting);
    stop.textContent = stopping ? "Stopping..." : "Stop";
    stop.disabled = stopping;
    stop.title = "Stop the work this chat left running";
  }
  place();
}

function refresh(): void {
  // A host without the fork RPC (his fixtures) answers with something else: no banner.
  void oursRequest<unknown>("background.tasks").then((next) => { work = isWork(next) ? next : null; render(); }, report);
}

stop.addEventListener("click", () => {
  if (!work || stopping) return;
  stopping = true; render();
  // Accepted is not ended (T3 web ChatView): the button comes back for a retry, the banner leaves when the work ends.
  void oursRequest("background.stop", { threadId: work.threadId }).catch(report).finally(() => { stopping = false; render(); refresh(); });
});

let timer: ReturnType<typeof setTimeout> | undefined;
// State pushes come many times a second while a turn streams; one request per quiet 400 ms is enough.
bridge.on(Events.stateChanged, () => { clearTimeout(timer); timer = setTimeout(refresh, 400); });
// An editor tab gets no first push: ask once.
refresh();
let queued = false;
new MutationObserver(() => {
  if (!work || queued) return;
  queued = true;
  requestAnimationFrame(() => { queued = false; try { place(); } catch (cause) { report(cause); } });
}).observe(document.body, { childList: true, subtree: true });
