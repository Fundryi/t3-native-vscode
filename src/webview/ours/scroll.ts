/**
 * R5 scroll, webview only.
 * 1. Sending jumps down: when this view starts sending and the agent is idle, jump to the latest message at once;
 *    while it works (a steer or a queued message), jump only when a new user message lands in the transcript,
 *    because a queued message shows next to the composer and is on screen already.
 * 2. Switching chats keeps my place: his LegendList remounts per thread (key={id}) and starts at the end
 *    (initialScrollAtEnd), so ours remembers each thread's scroll place and puts it back when that thread's list mounts.
 * shortcut: anchored on his class names (.transcript-list, .chat-main[data-thread-id], data-message-key, .ours-latest
 * from latest.ts); the list is virtual, so the restored place is approximate. Re-check on each upstream merge.
 */
import { bridge, Events } from "../bridge-client";
import { isObject, type HostStateSnapshot } from "../../shared/bridge";
import { failed } from "./channel";

const report = failed("scroll");
const END_DISTANCE = 40; // his "at end" threshold (TranscriptView onScroll)
const ARM_MS = 15_000;
const RESTORE_FRAMES = 60;

const distance = (node: HTMLElement) => node.scrollHeight - node.scrollTop - node.clientHeight;
const listNode = () => document.querySelector<HTMLElement>(".transcript-list");
const threadOf = (node: Element) => node.closest<HTMLElement>(".chat-main")?.dataset.threadId || undefined;

// ---- 1. Jump down on send ----

type Snapshot = Partial<HostStateSnapshot>;
// His working rule (TranscriptView: activeRun or acknowledgedWorking) for the shown thread.
const working = (state: Snapshot) => !!(state.acknowledgedWorking || state.queue?.activeRunId
  || (Array.isArray(state.threads) && state.threads.find((thread) => isObject(thread) && thread.id === state.activeThreadId)?.activeRunId));
function lastUserKey(state: Snapshot): string | undefined {
  if (!Array.isArray(state.transcript)) return undefined;
  for (let index = state.transcript.length - 1; index >= 0; index--) {
    const row: unknown = state.transcript[index];
    if (isObject(row) && isObject(row.item) && row.item.type === "user_message" && typeof row.key === "string") return row.key;
  }
  return undefined;
}

function jump(): void {
  restore = undefined;
  const node = listNode();
  if (!node || distance(node) < END_DISTANCE) return; // at the end his maintainScrollAtEnd follows by itself
  const latest = document.querySelector<HTMLButtonElement>(".ours-latest");
  if (latest) latest.click(); // his latest() when it exists, so his followEnd resumes too
  else node.scrollTop = node.scrollHeight;
}
const jumpSafe = () => { try { jump(); } catch (cause) { report(cause); } };

let lastRevision = -1;
let wasSending = false;
let armed: { until: number; thread: string | undefined; lastUser: string | undefined } | undefined;

bridge.on(Events.stateChanged, (data) => {
  try {
    if (!isObject(data) || typeof data.revision !== "number") return;
    // layout.ts re-delivers the last snapshot on a sidebar flip; an old copy must not re-arm.
    if (data.revision <= lastRevision) return;
    lastRevision = data.revision;
    const state = data as Snapshot;
    const sending = state.sending === true;
    const thread = typeof state.activeThreadId === "string" ? state.activeThreadId : undefined;
    const lastUser = lastUserKey(state);
    if (sending && !wasSending) {
      armed = { until: Date.now() + ARM_MS, thread, lastUser };
      if (!working(state)) requestAnimationFrame(jumpSafe);
    } else if (armed && Date.now() < armed.until && thread === armed.thread && lastUser !== undefined && lastUser !== armed.lastUser) {
      armed = undefined;
      requestAnimationFrame(jumpSafe);
    }
    wasSending = sending;
  } catch (cause) { report(cause); }
});

// ---- 2. Per-thread scroll memory ----

interface Place { top: number; key: string | undefined; offset: number }
const places = new Map<string, Place>();
let restore: { node: HTMLElement; thread: string; place: Place; frames: number; written: number } | undefined;
let seen: HTMLElement | undefined;

function save(node: HTMLElement): void {
  const thread = threadOf(node);
  if (!thread || !node.isConnected || restore?.thread === thread) return;
  if (distance(node) < END_DISTANCE) { places.delete(thread); return; } // at the end: his initial scroll is right
  const top = node.getBoundingClientRect().top;
  let anchor: HTMLElement | undefined;
  for (const row of node.querySelectorAll<HTMLElement>("[data-message-key]")) if (row.getBoundingClientRect().bottom > top) { anchor = row; break; }
  places.set(thread, { top: node.scrollTop, key: anchor?.dataset.messageKey, offset: anchor ? anchor.getBoundingClientRect().top - top : 0 });
}

function step(): void {
  try {
    const job = restore;
    if (!job) return;
    const { node, place } = job;
    // Write only over his jump to the end (or the top before it), or where ours wrote last:
    // a search, citation or message jump that put the list elsewhere wins.
    const free = job.frames === 0 || distance(node) < END_DISTANCE || node.scrollTop < 1 || Math.abs(node.scrollTop - job.written) < 2;
    if (!node.isConnected || !free || ++job.frames > RESTORE_FRAMES) { restore = undefined; return; }
    let target = place.top;
    const anchor = place.key ? node.querySelector<HTMLElement>(`[data-message-key="${CSS.escape(place.key)}"]`) : null;
    if (anchor) target = node.scrollTop + anchor.getBoundingClientRect().top - node.getBoundingClientRect().top - place.offset;
    if (Math.abs(node.scrollTop - target) > 1) node.scrollTop = target;
    job.written = node.scrollTop;
    requestAnimationFrame(step);
  } catch (cause) { restore = undefined; report(cause); }
}

function check(): void {
  try {
    const node = listNode();
    if (!node || node === seen) return;
    seen = node;
    const thread = threadOf(node);
    const place = thread ? places.get(thread) : undefined;
    // Taken now, before his initial scroll to the end fires scroll events on the new list.
    if (thread && place) { restore = { node, thread, place, frames: 0, written: -1 }; requestAnimationFrame(step); }
  } catch (cause) { report(cause); }
}

let pending: HTMLElement | undefined;
// Scroll does not bubble; a capture listener sees the list's scroll from the document.
document.addEventListener("scroll", (event) => {
  if (!(event.target instanceof HTMLElement) || !event.target.classList.contains("transcript-list")) return;
  if (!pending) requestAnimationFrame(() => { const node = pending; pending = undefined; try { if (node) save(node); } catch (cause) { report(cause); } });
  pending = event.target;
}, true);
// The user takes over: stop restoring.
for (const type of ["wheel", "pointerdown", "keydown", "touchstart"]) window.addEventListener(type, () => { restore = undefined; }, { capture: true, passive: true });
const root = document.getElementById("root");
if (root) new MutationObserver(check).observe(root, { childList: true, subtree: true });
