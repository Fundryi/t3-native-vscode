/**
 * P7 unread, webview side: a dot on session rows whose chat finished since it was last looked at (T3's rule, computed
 * on the host from the live shell, src/host/ours/unread.ts). Mark unread (Q19) brings the dot back; opening the chat
 * (Q9 visit) clears it. DOM only: data-ours-unread and aria-description on his `button.thread[data-thread-id]` rows
 * (ThreadList.tsx), attributes React never sets. The dot sits on .thread-title-line, not .thread-title, where R8's
 * failed dot lives.
 */
import { bridge, Events } from "../bridge-client";
import { failed, oursRequest, unavailable } from "./channel";

const report = failed("unread");
const ROW = "button.thread[data-thread-id]";

const style = document.createElement("style");
style.textContent = `.thread[data-ours-unread] .thread-title-line::before { content: ""; flex: none; width: 7px; height: 7px; border-radius: 50%; background: var(--vscode-notificationsInfoIcon-foreground, var(--primary)); }`;
document.head.append(style);

let unread = new Set<string>();
let asked = false;
let asking = false;
let again = false;
let gone = false; // the host has no fork RPC (his fixtures): stop asking

function ask(): void {
  if (gone) return;
  if (asking) { again = true; return; }
  asking = true; asked = true;
  oursRequest<unknown>("unread.ids").then((reply) => {
    if (!Array.isArray(reply)) return;
    unread = new Set(reply.filter((id): id is string => typeof id === "string"));
    schedule();
  }, (cause: unknown) => { if (unavailable(cause)) gone = true; report(cause); }).finally(() => {
    asking = false;
    if (again) { again = false; ask(); }
  });
}

function paint(): void {
  const rows = document.querySelectorAll<HTMLElement>(ROW);
  // His App gets its first state as a request reply, not a push: ask once when rows first show.
  if (rows.length && !asked) ask();
  for (const row of rows) {
    const on = unread.has(row.dataset.threadId ?? "");
    if (row.hasAttribute("data-ours-unread") === on) continue;
    row.toggleAttribute("data-ours-unread", on);
    if (on) row.setAttribute("aria-description", "Unread"); else row.removeAttribute("aria-description");
  }
}

let frame = 0;
function schedule(): void {
  if (frame) return;
  frame = requestAnimationFrame(() => { frame = 0; try { paint(); } catch (cause) { report(cause); } });
}
// Every shell change (a run finishing, a visit, Mark unread) reaches each view as a state push.
bridge.on(Events.stateChanged, () => { if (document.querySelector(ROW)) ask(); });
new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
