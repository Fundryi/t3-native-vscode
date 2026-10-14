/**
 * Q20 contextMeter, webview side (src/host/ours/contextMeter.ts answers). DOM only, none of his components change:
 * - A "62% context" chip at the start of his composer send controls, refreshed after state changes.
 * - Implement and Open as markdown buttons in the header of each proposed plan card. The transcript list is
 *   virtualized, so an observer adds them to every card that mounts; the row key comes from his data-search-row.
 */
import { bridge, Events } from "../bridge-client";
import { readDraft } from "../composerDrafts";
import type { HostStateSnapshot } from "../../shared/bridge";
import { oursRequest } from "./channel";

interface Meter { readonly label: string; readonly title: string; readonly percent: number | null }
const report = (cause: unknown) => console.error("T3 VSCode (fork): context meter failed", cause);

const style = document.createElement("style");
style.textContent = `
.ours-context-chip { font-size: .6875rem; color: var(--muted-foreground); white-space: nowrap; padding: 1px 6px; border: 1px solid var(--border); border-radius: 9px; }
.ours-context-chip[data-level="high"] { color: var(--foreground); border-color: var(--foreground); }
.ours-plan-actions { display: flex; gap: 10px; font-size: .75rem; }
@container (max-width: 570px) { .ours-context-word { display: none; } }`;
document.head.append(style);

{
  let meter: Meter | null = null;
  const paint = () => {
    const controls = document.querySelector(".composer-send-controls");
    let chip = document.querySelector<HTMLElement>(".ours-context-chip");
    if (!meter || !controls) { chip?.remove(); return; }
    if (!chip || chip.parentElement !== controls) {
      chip?.remove();
      chip = document.createElement("span");
      chip.className = "ours-context-chip";
      controls.prepend(chip);
    }
    // "62% context": the word hides in a narrow composer, as his shortcut hints do.
    const [value = "", ...rest] = meter.label.split(" ");
    const word = document.createElement("span");
    word.className = "ours-context-word";
    word.textContent = rest.length ? ` ${rest.join(" ")}` : "";
    chip.replaceChildren(value, word);
    chip.title = meter.title;
    chip.dataset.level = meter.percent !== null && meter.percent >= 80 ? "high" : "normal";
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let threadId: string | undefined;
  // State pushes come many times a second while a turn streams; one request per quiet 400 ms is enough.
  bridge.on(Events.stateChanged, (data) => {
    threadId = (data as HostStateSnapshot | undefined)?.activeThreadId;
    clearTimeout(timer);
    timer = setTimeout(() => { void oursRequest<Meter | null>("contextUsage").then((next) => { meter = next; paint(); }, report); }, 400);
  });

  const button = (label: string, title: string, kind: string) => {
    const element = document.createElement("button");
    element.className = "text-button";
    element.textContent = label;
    element.title = title;
    element.addEventListener("click", () => {
      // His sendMessage clears the chat's composer draft and releases its attachments, so never send over a draft.
      const draft = kind === "planImplement" && threadId ? readDraft(threadId) : undefined;
      const draftInUse = !!(draft && (draft.text.trim() || draft.contexts.length || draft.attachments?.length));
      // Read at click time: a row element may be reused for another item.
      const key = element.closest<HTMLElement>("[data-search-row]")?.dataset.searchRow;
      if (!key) return;
      element.disabled = true;
      void oursRequest(kind, { key, draftInUse }).catch(report).finally(() => { element.disabled = false; });
    });
    return element;
  };
  const decorate = () => {
    for (const header of document.querySelectorAll<HTMLElement>(".plan-card > header")) {
      if (header.querySelector(".ours-plan-actions")) continue;
      if (!header.closest("[data-search-row]")) continue;
      const actions = document.createElement("span");
      actions.className = "ours-plan-actions";
      actions.append(button("Implement", "Switch to default mode and send this plan to implement it", "planImplement"),
        button("Open as markdown", "Open this plan in an editor", "planOpen"));
      header.append(actions);
    }
    // His composer can remount (a chat switch); put the chip back right away instead of waiting for the next state.
    if (meter && !document.querySelector(".composer-send-controls .ours-context-chip")) paint();
  };
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; try { decorate(); } catch (cause) { report(cause); } });
  }).observe(document.body, { childList: true, subtree: true });
}
