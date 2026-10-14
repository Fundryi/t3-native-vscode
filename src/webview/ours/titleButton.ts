/**
 * X3 titlebtn: a sparkle button right after the thread title in his chat header (.chat-heading), which asks the
 * server for a new AI title through Q19's threadActions.run. Shown only when the host lists regenerateTitle for the
 * thread (the server flag threadTitleRegeneration). It spins until the new title arrives in a state push, 45 s at most.
 * DOM only, none of his components change.
 */
import { bridge, Events } from "../bridge-client";
import type { HostStateSnapshot } from "../../shared/bridge";
import { oursRequest, failed } from "./channel";

const report = failed("regenerate title");
const style = document.createElement("style");
style.textContent = `
.ours-title-regen { display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; align-self: center; width: 20px; height: 20px; padding: 0; color: var(--muted-foreground); background: transparent; border: 0; border-radius: 4px; }
.ours-title-regen:hover:not(:disabled) { color: var(--foreground); background: var(--muted); }
.ours-title-regen:disabled { cursor: default; }
.ours-title-regen[aria-busy="true"] svg { animation: ours-title-spin 1s linear infinite; }
@keyframes ours-title-spin { to { transform: rotate(360deg); } }`;
document.head.append(style);

const SPARKLES = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/></svg>';
const SPINNER = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>';

let activeId: string | undefined;
const titles = new Map<string, string>();
const capable = new Map<string, boolean>(); // per thread: does the host offer regenerateTitle
const busy = new Map<string, { readonly oldTitle: string; readonly timer: ReturnType<typeof setTimeout> }>();

const done = (threadId: string) => { const entry = busy.get(threadId); if (!entry) return; clearTimeout(entry.timer); busy.delete(threadId); paint(); };

function paint(): void {
  const heading = document.querySelector<HTMLElement>(".chat-main .chat-heading");
  let button = document.querySelector<HTMLButtonElement>(".ours-title-regen");
  const threadId = heading?.closest<HTMLElement>(".chat-main")?.dataset.threadId;
  if (!heading || !threadId || threadId !== activeId || !capable.get(threadId)) { button?.remove(); return; }
  if (!button || button.parentElement !== heading) {
    button?.remove();
    button = document.createElement("button");
    button.className = "ours-title-regen";
    button.addEventListener("click", (event) => {
      const id = (event.currentTarget as HTMLElement).dataset.threadId;
      if (!id || busy.has(id)) return;
      busy.set(id, { oldTitle: titles.get(id) ?? "", timer: setTimeout(() => done(id), 45_000) });
      paint();
      oursRequest("threadActions.run", { threadId: id, action: "regenerateTitle" }).catch((cause: unknown) => { report(cause); done(id); });
    });
    heading.append(button);
  }
  const running = busy.has(threadId);
  if (button.dataset.threadId === threadId && button.getAttribute("aria-busy") === String(running)) return;
  button.dataset.threadId = threadId;
  button.disabled = running;
  button.setAttribute("aria-busy", String(running));
  button.title = running ? "Regenerating title..." : "Regenerate title";
  button.setAttribute("aria-label", button.title);
  button.innerHTML = running ? SPINNER : SPARKLES;
}

bridge.on(Events.stateChanged, (data) => {
  const state = data as HostStateSnapshot | undefined;
  if (!state || !Array.isArray(state.threads)) return;
  for (const thread of state.threads) {
    titles.set(thread.id, thread.title);
    const entry = busy.get(thread.id);
    if (entry && thread.title !== entry.oldTitle) done(thread.id);
  }
  const id = state.activeThreadId;
  activeId = id && state.phase === "ready" && state.threads.some((thread) => thread.id === id) ? id : undefined;
  // Ask once per thread, and only once the host lists it (its lookup throws for a thread it does not know).
  if (activeId && !capable.has(activeId)) {
    const asked = activeId;
    capable.set(asked, false);
    oursRequest<unknown>("threadActions.list", { threadId: asked }).then((entries) => {
      capable.set(asked, Array.isArray(entries) && entries.some((entry) => typeof entry === "object" && entry !== null && (entry as { id?: unknown }).id === "regenerateTitle"));
      paint();
    }, report); // stays hidden for this thread; a host without the fork RPC answers the same every time
  }
  paint();
});

// His header remounts on a layout or chat switch; put the button back on the next frame.
let queued = false;
new MutationObserver(() => {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => { queued = false; try { paint(); } catch (cause) { report(cause); } });
}).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-thread-id"] });
