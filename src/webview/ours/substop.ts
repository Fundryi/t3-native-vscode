/**
 * R18 substop, webview side: a Stop button on a running subagent card in the parent chat (his SubagentCard.tsx).
 * The card carries no child thread id, so the button finds its row key ([data-search-row], TranscriptView.tsx) in
 * the last snapshot and runs Q19's "stopSubagent" thread action (src/host/ours/threadActions.ts) on that child.
 * The gate matches the host's (threadActionsList.ts), so the host never refuses a button we show.
 */
import { bridge, Events, Methods } from "../bridge-client";
import type { HostStateSnapshot, ThreadSummary } from "../../shared/bridge";
import { threadIsWorking } from "../../shared/sessionTree";
import { oursRequest, failed } from "./channel";

const report = failed("stop subagent");
const ICON = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2"/></svg>';
const busy = new Set<string>();
let latest: HostStateSnapshot | undefined;
let refreshing = false;

/** The running child thread behind a card, or undefined when Stop does not apply (or the row is not known yet). */
function runningChild(card: Element): { child: ThreadSummary; title: string } | undefined {
  const key = card.closest<HTMLElement>("[data-search-row]")?.dataset.searchRow;
  const item = key && latest ? latest.transcript.find((row) => row.key === key)?.item : undefined;
  if (item?.type !== "subagent" || typeof item.childThreadId !== "string") return undefined;
  const child = latest?.threads.find((thread) => thread.id === item.childThreadId);
  return child && child.relationshipToParent === "subagent" && child.parentThreadId && threadIsWorking(child) ? { child, title: child.title || item.title || "Subagent" } : undefined;
}

function sync(): void {
  const cards = document.querySelectorAll(".subagent-entry");
  let missing = false;
  for (const card of cards) {
    const line = card.querySelector(":scope > .subagent-line");
    if (!line) continue;
    const key = card.closest<HTMLElement>("[data-search-row]")?.dataset.searchRow;
    // One ask per card (rowCopy.ts): a history row may never reach a pushed snapshot.
    if (key && !card.hasAttribute("data-ours-asked") && !latest?.transcript.some((row) => row.key === key)) { card.setAttribute("data-ours-asked", ""); missing = true; }
    const found = runningChild(card);
    let button = line.querySelector<HTMLButtonElement>(":scope > .ours-subagent-stop");
    if (!found) { button?.remove(); continue; }
    const { child, title } = found;
    if (!button) {
      button = document.createElement("button");
      button.type = "button"; button.className = "icon-button ours-subagent-stop"; button.innerHTML = ICON;
      // Resolved again on click: his list may reuse this node for another row.
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        const target = runningChild(card)?.child;
        if (!target) return;
        busy.add(target.id); sync();
        // The host runs the stop detached and answers true even if it fails (toast), so re-enable after a while.
        setTimeout(() => { busy.delete(target.id); schedule(); }, 10_000);
        oursRequest("threadActions.run", { threadId: target.id, action: "stopSubagent" }).catch((cause: unknown) => { busy.delete(target.id); sync(); report(cause); });
      });
      // Before his Details chevron, so the chevron keeps the row's end.
      line.insertBefore(button, line.querySelector(":scope > .icon-button"));
    }
    const label = `Stop subagent ${title}`;
    if (button.getAttribute("aria-label") !== label) { button.setAttribute("aria-label", label); button.title = label; }
    button.disabled = busy.has(child.id);
  }
  // An editor tab's first snapshot is a reply to his request, not a push: ask once. A card on screen means his App runs.
  if (missing && !refreshing) {
    refreshing = true;
    void bridge.request<HostStateSnapshot>(Methods.getState).then((state) => { keep(state); }, report).finally(() => { refreshing = false; });
  }
}

let frame = 0;
const schedule = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; try { sync(); } catch (cause) { report(cause); } }); };
function keep(state: unknown): void {
  const next = state as HostStateSnapshot | undefined;
  if (!next || typeof next.revision !== "number" || !Array.isArray(next.transcript) || !Array.isArray(next.threads)) return;
  if (latest && next.revision < latest.revision) return;
  latest = next;
  // A stopped child leaves the busy set once the snapshot shows it idle.
  for (const id of busy) if (!next.threads.some((thread) => thread.id === id && threadIsWorking(thread))) busy.delete(id);
  schedule();
}
bridge.on(Events.stateChanged, keep);
new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
