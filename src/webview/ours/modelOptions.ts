/**
 * P15 modelopts, webview only. Every model option T3 sends except effort (his Composer shows that one) joins his
 * composer traits: a select per select option (Claude "Context Window" 200k/1M, Codex "Service Tier" Standard/Fast) and
 * a toggle per boolean (Claude "Fast Mode"). Written through his setModelOption, which takes a thread or the draft.
 * Compact width: his traits div moves into his "..." popup, and ours with it (placed by the same observer).
 * shortcut: anchored on his .composer-traits / .composer-controls / .composer-options-popup; re-check on upstream merges.
 */
import { bridge, Events, Methods } from "../bridge-client";
import type { HostStateSnapshot } from "../../shared/bridge";
import type { ProviderOptionDescriptor } from "@t3tools/contracts";
import { getProviderOptionCurrentValue, getProviderOptionDescriptors } from "@t3tools/shared/model";
import { effortDescriptor } from "../../shared/modelOptions";
import { failed } from "./channel";

const report = failed("model options");
let latest: HostStateSnapshot | undefined;
let fetched = false;
let busy = 0;

function current() {
  if (!latest) return undefined;
  const state = latest;
  const thread = state.threads.find((item) => item.id === state.activeThreadId);
  const selection = thread?.modelSelection ?? state.draft.modelSelection;
  const model = state.providers.find((item) => item.instanceId === selection?.instanceId)?.models.find((item) => item.slug === selection?.model);
  const effort = effortDescriptor(model, selection)?.id;
  const descriptors = getProviderOptionDescriptors({ caps: model?.capabilities ?? {}, selections: selection?.options })
    .filter((descriptor) => descriptor.id !== effort && (descriptor.type === "boolean" || descriptor.options.length > 0));
  return { threadId: thread?.id, descriptors, disabled: busy > 0 || !selection || thread?.providerNativeSubagent === true };
}

function set(optionId: string, value: string | boolean): void {
  const now = current();
  if (!now || now.disabled) return;
  busy++; render();
  // Never through run or useActions: their result would replace his App state. The busy flip rebuilds the controls,
  // so a refused change snaps back to the host's value.
  void bridge.request(Methods.setModelOption, { ...(now.threadId ? { threadId: now.threadId } : {}), optionId, value })
    .catch(report).finally(() => { busy--; try { render(); } catch (cause) { report(cause); } });
}

function control(descriptor: ProviderOptionDescriptor, disabled: boolean): HTMLElement {
  const value = getProviderOptionCurrentValue(descriptor);
  if (descriptor.type === "boolean") {
    const button = document.createElement("button");
    button.type = "button"; button.className = "ours-modelopt ours-modelopt-toggle"; button.disabled = disabled;
    button.textContent = descriptor.label; button.title = descriptor.description ?? descriptor.label;
    button.setAttribute("aria-pressed", String(value === true));
    button.addEventListener("click", () => set(descriptor.id, value !== true));
    return button;
  }
  const label = document.createElement("label");
  label.className = "ours-modelopt"; label.title = descriptor.description ?? descriptor.label;
  const name = document.createElement("span");
  name.className = "ours-modelopt-name"; name.textContent = descriptor.label;
  const select = document.createElement("select");
  select.setAttribute("aria-label", descriptor.label); select.disabled = disabled;
  if (value === undefined) { const none = new Option("Default", "", true, true); none.disabled = true; select.append(none); }
  for (const choice of descriptor.options) {
    const option = new Option(choice.label, choice.id);
    if (choice.description) option.title = choice.description;
    select.append(option);
  }
  select.value = typeof value === "string" ? value : "";
  select.addEventListener("change", () => set(descriptor.id, select.value));
  label.append(name, select);
  return label;
}

function render(): void {
  const all = document.querySelectorAll(".composer-traits");
  if (!all.length) return;
  // His App fetched its first state itself; once his composer is on screen he listens, so ours can ask once.
  if (!latest && !fetched) { fetched = true; void bridge.request<HostStateSnapshot>(Methods.getState).then(receive, report); }
  const now = current();
  const key = now ? JSON.stringify([now.threadId, now.disabled, now.descriptors]) : "";
  for (const traits of all) {
    let box = traits.querySelector<HTMLElement>(":scope > .ours-modelopts");
    if (box?.dataset.key === key) continue;
    if (!box) { box = document.createElement("span"); box.className = "ours-modelopts"; traits.append(box); }
    box.dataset.key = key;
    box.replaceChildren(...(now?.descriptors ?? []).map((descriptor) => control(descriptor, now!.disabled)));
  }
}

function receive(state: unknown): void {
  const next = state as HostStateSnapshot;
  if (typeof next?.revision !== "number" || !Array.isArray(next.threads) || !Array.isArray(next.providers)) return;
  if (latest && next.revision < latest.revision) return;
  latest = next;
  try { render(); } catch (cause) { report(cause); }
}

{
  const style = document.createElement("style");
  // Inline, his width measure does not count ours: our controls shrink before anything overflows (his keep their width).
  style.textContent = `
.ours-modelopts { display: contents; }
.ours-modelopt { display: inline-flex; align-items: center; gap: 4px; min-width: 0; flex-shrink: 1; color: var(--muted-foreground); }
.ours-modelopt select { min-width: 0; max-width: 100%; text-overflow: ellipsis; }
.ours-modelopt-name { display: none; font-size: 0.6875rem; }
.composer-options-popup .ours-modelopt-name { display: inline; }
.composer-controls > .composer-traits:has(.ours-modelopt) { flex-shrink: 1; min-width: 0; }
.ours-modelopt-toggle { border: 0; background: transparent; padding: 4px 2px; border-radius: 3px; font-size: inherit; color: var(--muted-foreground); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ours-modelopt-toggle:hover:not(:disabled) { background: var(--muted); }
.ours-modelopt-toggle[aria-pressed="true"] { color: var(--primary); font-weight: 600; }
.composer-options-popup .ours-modelopt-toggle { text-align: left; }`;
  document.head.append(style);

  bridge.on(Events.stateChanged, receive);
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; try { render(); } catch (cause) { report(cause); } });
  }).observe(document.body, { childList: true, subtree: true });
}
