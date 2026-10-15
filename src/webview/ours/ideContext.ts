/**
 * P1 idectx, webview side (src/host/ours/ideContext.ts answers). DOM only, none of his components change:
 * - Every composer send asks the host for the editor reference and appends it to the text. Only sends from this
 *   webview pass here, so host sends (Q20 Implement, "/goal resume") never get one. Any failure or a slow host
 *   sends the text as typed.
 * - An "IDE: foo.ts:12-20" chip next to the Q20 context chip; a click leaves it out of the next send only.
 */
import { bridge, Events, Methods } from "../bridge-client";
import { isObject, type RpcMethod } from "../../shared/bridge";
import { failed, oursRequest } from "./channel";

interface Chip { readonly label: string; readonly title: string }
const report = failed("IDE context");
/** The send waits at most this long for the host; then it goes without the reference. */
const WAIT_MS = 3000;

const style = document.createElement("style");
style.textContent = `
.ours-ide-chip { font: inherit; font-size: .6875rem; color: var(--muted-foreground); background: none; white-space: nowrap; padding: 1px 6px; border: 1px solid var(--border); border-radius: 9px; cursor: pointer; max-width: 40%; overflow: hidden; text-overflow: ellipsis; }
.ours-ide-chip[aria-pressed="false"] { text-decoration: line-through; opacity: .6; }`;
document.head.append(style);

let chip: Chip | null = null;
let skip = false;

const paint = () => {
  const controls = document.querySelector(".composer-send-controls");
  let element = document.querySelector<HTMLButtonElement>(".ours-ide-chip");
  if (!chip || !controls) { element?.remove(); return; }
  if (!element || element.parentElement !== controls) {
    element?.remove();
    element = document.createElement("button");
    element.type = "button";
    element.className = "ours-ide-chip";
    element.addEventListener("click", () => { skip = !skip; paint(); });
    const meter = controls.querySelector(".ours-context-chip");
    if (meter) meter.after(element); else controls.prepend(element);
  }
  element.textContent = chip.label;
  element.setAttribute("aria-pressed", String(!skip));
  element.title = skip ? `${chip.title} is left out of your next message. Click to include it.` : `${chip.title} goes with your next message. Click to leave it out once.`;
};

const refresh = () => {
  void oursRequest<unknown>("ideContext").then((next) => {
    chip = isObject(next) && typeof next.label === "string" && typeof next.title === "string" ? { label: next.label, title: next.title } : null;
    paint();
  }, report);
};

let timer: ReturnType<typeof setTimeout> | undefined;
bridge.on(Events.stateChanged, () => { clearTimeout(timer); timer = setTimeout(refresh, 400); });
// The usual path: select lines in an editor, then click into the chat.
window.addEventListener("focus", refresh);

const request = bridge.request.bind(bridge);
bridge.request = <T>(method: RpcMethod, params?: unknown, timeoutMs?: number): Promise<T> => {
  if (method !== "sendMessage" || !isObject(params) || typeof params.text !== "string") return request<T>(method, params, timeoutMs);
  const leaveOut = skip;
  skip = false;
  try { paint(); } catch (cause) { report(cause); }
  if (leaveOut) return request<T>(method, params, timeoutMs);
  const withReference = request<unknown>(Methods.ours, { kind: "ideContextText", text: params.text }, WAIT_MS).then(
    (reply) => isObject(reply) && typeof reply.text === "string" ? { ...params, text: reply.text } : params,
    (cause: unknown) => { report(cause); return params; });
  return withReference.then((next) => request<T>(method, next, timeoutMs));
};

// His composer can remount (a chat switch); put the chip back right away.
let queued = false;
new MutationObserver(() => {
  if (queued || !chip || document.querySelector(".composer-send-controls .ours-ide-chip")) return;
  queued = true;
  requestAnimationFrame(() => { queued = false; try { paint(); } catch (cause) { report(cause); } });
}).observe(document.body, { childList: true, subtree: true });
