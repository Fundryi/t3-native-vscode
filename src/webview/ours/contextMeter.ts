/**
 * Q20 contextMeter, webview side (src/host/ours/contextMeter.ts answers). DOM only, none of his components change:
 * - A "62% context" chip at the start of his composer send controls, refreshed after state changes.
 * - Implement and Open as markdown buttons in the header of each proposed plan card. The transcript list is
 *   virtualized, so an observer adds them to every card that mounts; the row key comes from his data-search-row.
 */
import { bridge, Events } from "../bridge-client";
import { readDraft } from "../composerDrafts";
import type { HostStateSnapshot } from "../../shared/bridge";
import { oursRequest, failed } from "./channel";

interface Meter { readonly label: string; readonly title: string; readonly percent: number | null }
const report = failed("context meter");

const style = document.createElement("style");
style.textContent = `
.ours-context-chip { font-size: .6875rem; color: var(--muted-foreground); white-space: nowrap; padding: 1px 6px; border: 1px solid var(--border); border-radius: 9px; }
.ours-context-chip[data-level="high"] { color: var(--vscode-editorWarning-foreground, var(--foreground)); border-color: currentColor; }
.ours-context-chip[data-level="full"] { color: var(--vscode-editorError-foreground, var(--foreground)); border-color: currentColor; }
.ours-plan-actions { display: flex; gap: 10px; font-size: .75rem; }
@container (max-width: 570px) { .ours-context-word { display: none; } }`;
document.head.append(style);

{
  let meter: Meter | null = null;
  const paint = () => {
    const controls = document.querySelector(".composer-send-controls");
    let chip = document.querySelector<HTMLElement>(".ours-context-chip");
    if (!meter || typeof meter.label !== "string" || !controls) { chip?.remove(); return; }
    if (!chip || chip.parentElement !== controls) {
      chip?.remove();
      chip = document.createElement("span");
      chip.className = "ours-context-chip";
      chip.tabIndex = 0;
      controls.prepend(chip);
    }
    // "62% context": the word hides in a narrow composer, as his shortcut hints do.
    const [value = "", ...rest] = meter.label.split(" ");
    const word = document.createElement("span");
    word.className = "ours-context-word";
    word.textContent = rest.length ? ` ${rest.join(" ")}` : "";
    chip.replaceChildren(value, word);
    chip.title = meter.title;
    const percent = typeof meter.percent === "number" ? Math.round(meter.percent) : null;
    chip.dataset.level = percent === null ? "normal" : percent >= 95 ? "full" : percent >= 80 ? "high" : "normal";
    // R15: a meter for screen readers; a tokens-only label (no window size) has no value, so it gets no meter role.
    if (percent === null) {
      for (const name of ["role", "aria-valuenow", "aria-valuemin", "aria-valuemax", "aria-valuetext"]) chip.removeAttribute(name);
      chip.setAttribute("aria-label", `Context used: ${meter.title}`);
    } else {
      chip.setAttribute("role", "meter");
      chip.setAttribute("aria-label", "Context used");
      chip.setAttribute("aria-valuemin", "0");
      chip.setAttribute("aria-valuemax", "100");
      chip.setAttribute("aria-valuenow", String(percent));
      chip.setAttribute("aria-valuetext", `${percent}%, ${meter.title}`);
    }
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
    // R15: Implement is the card's main action, so it looks like one.
    element.className = kind === "planImplement" ? "btn primary" : "text-button";
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
