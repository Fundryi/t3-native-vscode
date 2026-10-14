/**
 * Q13 plan mode, webview side. A Plan/Build button joins his composer traits (next to the permission select), and
 * picking /plan or /default in his suggestion list switches the mode. Both go through his setModes, which takes a thread
 * or, before the first message, the draft. His Composer stays untouched: the button is placed by a MutationObserver,
 * the slash pick is read from his suggestion markup in capture listeners (his handler still runs and clears the token).
 */
import { bridge, Events, Methods } from "../bridge-client";
import type { HostStateSnapshot } from "../../shared/bridge";
import { oursRequest, registerOursEvent } from "./channel";

const report = (cause: unknown) => console.error("T3 VSCode (fork): plan mode failed", cause);
const PLAN_TITLE = "Plan mode: click to return to normal build mode";
const BUILD_TITLE = "Build mode: click to enter plan mode";

let latest: HostStateSnapshot | undefined;
let reported: boolean | undefined;
/** t3-vscode.ours.planMode.enabled, our stand-in for T3's planModeEnabled (off by default, as there). */
let enabled = false;

/** As T3 web: shown when plan mode is on and the provider allows the toggle, and always while the thread is in plan mode. */
function current() {
  if (!latest) return undefined;
  const state = latest;
  const thread = state.threads.find((item) => item.id === state.activeThreadId);
  const instanceId = (thread?.modelSelection ?? state.draft.modelSelection)?.instanceId;
  const provider = state.providers.find((item) => item.instanceId === instanceId);
  const mode = thread?.interactionMode ?? state.draft.interactionMode;
  return { threadId: thread?.id, mode, visible: (enabled && provider !== undefined && provider.showInteractionModeToggle !== false) || mode === "plan",
    disabled: thread?.providerNativeSubagent === true || thread?.archived === true };
}

function setMode(mode: "plan" | "default"): void {
  const now = current();
  if (!now?.visible || now.disabled || now.mode === mode) return;
  // Never through run or useActions: their result would replace his App state (map 0.4). The next push updates the button.
  void bridge.request(Methods.setModes, { ...(now.threadId ? { threadId: now.threadId } : {}), interactionMode: mode }).catch(report);
}

function render(): void {
  const now = current();
  if (now && now.visible !== reported) { reported = now.visible; void oursRequest("planModeAllowed", { allowed: now.visible }).catch(report); }
  for (const traits of document.querySelectorAll(".composer-traits")) {
    let button = traits.querySelector<HTMLButtonElement>(":scope > .ours-plan-toggle");
    if (!button) {
      button = document.createElement("button");
      button.type = "button"; button.className = "ours-plan-toggle";
      button.addEventListener("click", () => { const mode = current()?.mode; if (mode) setMode(mode === "plan" ? "default" : "plan"); });
      traits.append(button);
    }
    // Only write what changed: a write is a mutation and would wake the observer again.
    const plan = now?.mode === "plan", label = plan ? "Plan" : "Build", hidden = !now?.visible, disabled = now?.disabled === true;
    if (button.textContent !== label) button.textContent = label;
    if (button.hidden !== hidden) button.hidden = hidden;
    if (button.disabled !== disabled) button.disabled = disabled;
    if (button.getAttribute("aria-pressed") !== String(plan)) button.setAttribute("aria-pressed", String(plan));
    if (button.title !== (plan ? PLAN_TITLE : BUILD_TITLE)) button.title = plan ? PLAN_TITLE : BUILD_TITLE;
  }
}

function receive(state: unknown): void {
  const next = state as HostStateSnapshot;
  if (typeof next?.revision !== "number" || !Array.isArray(next.threads)) return;
  if (latest && next.revision < latest.revision) return;
  latest = next;
  try { render(); } catch (cause) { report(cause); }
}

/** The label of the suggestion his Composer is about to apply: /plan, /default, or anything else. */
function pickMode(label: string | null | undefined): void {
  if (label === "/plan") setMode("plan");
  else if (label === "/default") setMode("default");
}

{
  const style = document.createElement("style");
  style.textContent = `
.ours-plan-toggle { border: 0; background: transparent; padding: 4px 2px; border-radius: 3px; font-size: inherit; color: var(--foreground); white-space: nowrap; flex-shrink: 0; }
.ours-plan-toggle:hover:not(:disabled) { background: var(--muted); }
.ours-plan-toggle[aria-pressed="true"] { color: var(--primary); font-weight: 600; }
.ours-plan-toggle[hidden] { display: none; }`;
  document.head.append(style);

  // His App receives the first state as a request result, not a push, so ask once ourselves. Not through getState:
  // that marks the view ready before his App listens, and queued events (a draft hand-over) would be lost.
  bridge.on(Events.stateChanged, receive);
  registerOursEvent("planMode", (data) => { enabled = data.enabled === true; try { render(); } catch (cause) { report(cause); } });
  void oursRequest<{ state: HostStateSnapshot; enabled: boolean }>("planModeState")
    .then((first) => { enabled = first?.enabled === true; receive(first?.state); }, report);

  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; try { render(); } catch (cause) { report(cause); } });
  }).observe(document.body, { childList: true, subtree: true });

  // The same conditions as his suggestion keys (Composer.tsx onKeyDown): Enter or Tab without modifiers while the list is open.
  window.addEventListener("keydown", (event) => {
    try {
      if (event.isComposing || event.keyCode === 229 || event.shiftKey || event.ctrlKey || event.metaKey) return;
      if (event.key !== "Enter" && event.key !== "Tab") return;
      if (!(event.target instanceof HTMLTextAreaElement) || !event.target.closest(".composer-box")) return;
      pickMode(document.querySelector("#composer-suggestions [aria-selected=\"true\"] .suggestion-label")?.textContent);
    } catch (cause) { report(cause); }
  }, true);
  window.addEventListener("click", (event) => {
    try {
      const option = event.target instanceof Element ? event.target.closest("#composer-suggestions [role=\"option\"]") : null;
      if (option) pickMode(option.querySelector(".suggestion-label")?.textContent);
    } catch (cause) { report(cause); }
  }, true);
}
