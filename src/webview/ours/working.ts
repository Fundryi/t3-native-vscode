/**
 * R4 working, webview side. Window-level only, no line of his TranscriptView.tsx or Composer.tsx:
 * - Next to each of his "Working" labels (inline header, sticky copy, footer) the elapsed time and the current step,
 *   once a second. A sibling span, never inside his label: that label is role="status", a ticking clock in it would
 *   be read out every second.
 * - "Worked 2m 14s" in front of Copy and Fork at the end of a finished response.
 * - "Enter to queue - Esc to stop" while his stop button shows (Q5 escape stops the turn).
 * - A polite live region says "Response finished" (or failed, or stopped) when the shown chat stops working.
 * New file instead of latest.ts so R5 and R9, which edit latest.ts, merge without conflicts.
 * shortcut: anchored on his class names (.working-label, .response-end, .composer-shortcuts, .stop-button,
 * data-message-key); re-check them on each upstream merge, typecheck cannot.
 */
import { bridge, Events, Methods } from "../bridge-client";
import type { HostStateSnapshot } from "../../shared/bridge";
import { clock, currentStep, endPhrase, runStart, runTotal, since } from "../../shared/ours/working";
import { failed } from "./channel";

const report = failed("working");
/** As finished.ts on the host: a thread that streams in bursts flips between working and idle. */
const SETTLE_MS = 2000;

const style = document.createElement("style");
style.textContent = `
.ours-working-time { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 400; }
.ours-working-time[hidden] { display: none; }
.ours-worked { color: var(--muted-foreground); font-size: .6875rem; }
.composer-send-controls:has(.stop-button) .composer-shortcuts > span:first-child::after { content: " - Esc to stop"; }
.ours-live { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }`;
document.head.append(style);

const live = document.createElement("div");
live.className = "ours-live";
live.setAttribute("role", "status");
live.setAttribute("aria-live", "polite");
document.body.append(live);

let snapshot: HostStateSnapshot | undefined;
let fetched = false;
const keep = (next: unknown): boolean => {
  const state = next as HostStateSnapshot | undefined;
  if (!state || !Array.isArray(state.threads) || !Array.isArray(state.transcript)) return false;
  if (snapshot && state.revision < snapshot.revision) return false;
  snapshot = state;
  return true;
};

// His rule (TranscriptView: activeRun, else the run of the acknowledged message) for the shown thread.
const activeRun = (state: HostStateSnapshot): string | null => {
  const ack = state.acknowledgedWorking;
  return state.threads.find((thread) => thread.id === state.activeThreadId)?.activeRunId ?? state.queue?.activeRunId
    ?? (ack ? state.transcript.find((row) => row.item.type === "user_message" && row.item.messageId === ack.messageId)?.item.runId : null) ?? null;
};
const working = (state: HostStateSnapshot) => !!(activeRun(state) || state.acknowledgedWorking);

function workingText(state: HostStateSnapshot): string {
  if (!working(state)) return "";
  const run = activeRun(state);
  const start = state.threads.find((thread) => thread.id === state.activeThreadId)?.workingStartedAt
    ?? state.acknowledgedWorking?.startedAt ?? (run ? runStart(state.transcript, run) : undefined);
  const elapsed = since(start, Date.now());
  return [elapsed === undefined ? "" : clock(elapsed), currentStep(state.transcript, run) ?? ""].filter(Boolean).join(" \u00b7 ");
}

let tick: ReturnType<typeof setInterval> | undefined;
function paint(): void {
  if (!snapshot && !fetched && document.querySelector(".transcript-container")) {
    // His App fetched its first state itself; ours only sees later pushes, so ask once when a chat first shows.
    fetched = true;
    void bridge.request<HostStateSnapshot>(Methods.getState).then((state) => { if (keep(state)) { seed(); schedule(); } }, report);
  }
  const state = snapshot;
  // Only write what differs: every write of ours wakes the MutationObserver below.
  for (const old of document.querySelectorAll<HTMLElement>(".ours-working-time")) {
    if (!old.previousElementSibling?.classList.contains("working-label")) old.remove();
  }
  const labels = document.querySelectorAll<HTMLElement>(".response-header .working-label");
  const text = state ? workingText(state) : "";
  for (const label of labels) {
    let span = label.nextElementSibling as HTMLElement | null;
    if (!span?.classList.contains("ours-working-time")) {
      span = document.createElement("span");
      span.className = "ours-working-time";
      label.after(span);
    }
    if (span.textContent !== text) span.textContent = text;
    if (span.hidden !== !text) span.hidden = !text;
  }
  const run = state ? activeRun(state) : null;
  for (const end of document.querySelectorAll<HTMLElement>(".response-end")) {
    const key = end.closest<HTMLElement>("[data-message-key]")?.dataset.messageKey;
    const row = key && state ? state.transcript.find((candidate) => candidate.key === key) : undefined;
    // shortcut: rows of the run on a history page not loaded yet are not counted; rare (a run across a page cut).
    const total = key && state && row?.item.runId && row.item.runId !== run ? runTotal(state.transcript, key) : undefined;
    let span = end.querySelector<HTMLElement>(":scope > .ours-worked");
    if (total === undefined) { span?.remove(); continue; }
    if (!span) {
      span = document.createElement("span");
      span.className = "ours-worked";
      end.prepend(span);
    }
    const worked = `Worked ${clock(total)}`;
    if (span.textContent !== worked) span.textContent = worked;
  }
  const ticking = !!text && labels.length > 0;
  if (ticking && !tick) tick = setInterval(schedule, 1000);
  else if (!ticking && tick) { clearInterval(tick); tick = undefined; }
}

let frame = 0;
function schedule(): void {
  if (frame) return;
  frame = requestAnimationFrame(() => { frame = 0; try { paint(); } catch (cause) { report(cause); } });
}

// The working-to-idle edge of the shown chat, settled, then announced once.
let edgeThread: string | null | undefined;
let wasWorking = false;
let settle: ReturnType<typeof setTimeout> | undefined;
const stopSettle = () => { clearTimeout(settle); settle = undefined; };
function seed(): void { if (snapshot) { edgeThread = snapshot.activeThreadId; wasWorking = working(snapshot); } }
function edge(state: HostStateSnapshot): void {
  const now = working(state);
  // A chat switch is no ending: start over for the chat now shown.
  if (state.activeThreadId !== edgeThread) { edgeThread = state.activeThreadId; wasWorking = now; stopSettle(); return; }
  if (now) { wasWorking = true; stopSettle(); return; }
  if (!wasWorking) return;
  wasWorking = false;
  stopSettle();
  const threadId = state.activeThreadId;
  settle = setTimeout(() => {
    settle = undefined;
    try {
      const latest = snapshot;
      if (!latest || latest.activeThreadId !== threadId || working(latest) || !document.querySelector(".transcript-container")) return;
      const phrase = endPhrase(latest.threads.find((thread) => thread.id === threadId)?.status);
      // Cleared first, so the same phrase twice in a row is read again.
      live.textContent = "";
      setTimeout(() => { live.textContent = phrase; }, 100);
    } catch (cause) { report(cause); }
  }, SETTLE_MS);
}

bridge.on(Events.stateChanged, (data) => {
  try {
    const first = !snapshot;
    if (!keep(data) || !snapshot) return;
    if (first) seed(); else edge(snapshot);
    schedule();
  } catch (cause) { report(cause); }
});
const root = document.getElementById("root");
if (root) new MutationObserver(schedule).observe(root, { childList: true, subtree: true });
schedule();
