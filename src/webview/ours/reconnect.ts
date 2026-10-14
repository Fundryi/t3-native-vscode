/**
 * Q4, webview side: buttons on screens of his that have none, added to the DOM (no line of his App changes).
 * - "Connecting to T3 Code" (his App StatusView without actions): Retry connection, Connection settings.
 * - His setup screen when the server is missing or stopped: Open T3 app (the desktop feature's t3code://new).
 * Never on the pairing screen: a Retry there would queue a second pairing.
 * R12: on "Pairing with T3 Code" a line that it may take up to 45 s (his PAIR_TIMEOUT_MS, src/host/pairing.ts); on
 * Windows his setup screen also names the T3 desktop app (missing or stopped server) and its Install t3 command (cli-missing).
 */
import { bridge, Events, Methods } from "../bridge-client";
import type { HostStateSnapshot } from "../../shared/bridge";
import { oursRequest, failed } from "./channel";

const report = failed("reconnect");

try {
  let phase: string | undefined;
  let kind: string | undefined;
  let startupHint = false;
  const windows = navigator.userAgent.includes("Windows");
  const APP = "On Windows the T3 Code desktop app is the easy way: install it (winget install T3Tools.T3Code) and open it. The app keeps the server running, and VS Code connects by itself as soon as it starts. The t3 command line below is the alternative.";
  const CLI = "Using the T3 app? In T3 open Settings -> General -> About and Install the t3 command, then quit VS Code fully and open it again.";
  const note = (parent: Element | null, text: string | undefined) => {
    const stale = parent?.querySelector(":scope > .ours-setup");
    if (!parent || !text) { stale?.remove(); return; }
    if (stale?.textContent === text) return;
    const element = document.createElement(parent.matches(".status-card") ? "div" : "p");
    element.className = parent.matches(".status-card") ? "status-detail ours-setup" : "ours-setup";
    element.textContent = text;
    if (element.tagName === "P") element.style.marginTop = "8px";
    if (stale) stale.replaceWith(element); else parent.append(element);
  };
  const button = (label: string, onClick: () => Promise<unknown>) => {
    const element = document.createElement("button");
    element.className = "btn"; element.textContent = label;
    element.addEventListener("click", () => { void onClick().catch(report); });
    return element;
  };
  const paint = () => {
    try {
      const connecting = phase === "connecting" || phase === "discovering";
      const stopped = phase === "no-server" && (kind === "missing-runtime" || kind === "server-stopped");
      // React reuses his card and his setup screen across phases (connecting to pairing, one problem to another).
      if (!connecting) document.querySelectorAll("#root .status-card .ours-reconnect").forEach((stale) => stale.remove());
      if (!stopped) document.querySelectorAll("#root .server-setup .ours-reconnect").forEach((stale) => stale.remove());
      // Only into parents whose children React never changes (his static heading, the card's end), so it leaves with them.
      note(document.querySelector("#root .status-view .status-card"), phase === "pairing" ? "Pairing runs the t3 command and can take up to 45 seconds." : undefined);
      note(document.querySelector("#root .server-setup .setup-heading"), !windows ? undefined : stopped && !startupHint ? APP : phase === "error" && kind === "cli-missing" ? CLI : undefined);
      if (connecting) {
        // App never passes actions to this StatusView, so React never inserts into the card after our node.
        const card = document.querySelector("#root .status-view .status-card");
        if (!card || card.querySelector(".status-actions")) return;
        const actions = document.createElement("div");
        actions.className = "status-actions ours-reconnect";
        actions.append(button("Retry connection", () => bridge.request(Methods.reconnect)), button("Connection settings", () => bridge.request(Methods.openSettings)));
        card.append(actions);
      } else if (stopped) {
        const actions = document.querySelector("#root .server-setup .setup-actions");
        if (!actions || actions.querySelector(".ours-reconnect")) return;
        const open = button("Open T3 app (new chat)", () => oursRequest("reconnectOpenApp"));
        open.classList.add("ours-reconnect");
        actions.append(open);
      }
    } catch (cause) { report(cause); }
  };
  let revision = -1;
  const receive = (state: HostStateSnapshot) => {
    if (state.revision < revision) return;
    revision = state.revision; phase = state.phase; kind = state.connectionSetup?.problem?.kind; startupHint = !!state.connectionSetup?.startupHint; paint();
  };
  bridge.on(Events.stateChanged, (data) => receive(data as HostStateSnapshot));
  // His App's own getState reply (and his other snapshot replies) carry the phase too. Listening, not asking: a
  // getState of ours before his App mounts would mark the view ready and flush queued events into no handler.
  window.addEventListener("message", (event: MessageEvent) => {
    // Same sender check as his bridge-client: agent HTML visuals are sandboxed iframes that can postMessage.
    if (event.source && event.source !== window) {
      if (event.origin === "null" || event.origin !== window.location.origin) return;
      if ([...document.querySelectorAll("iframe")].some((frame) => frame.contentWindow === event.source)) return;
    }
    const result = (event.data as { result?: Partial<HostStateSnapshot> } | null)?.result;
    if (result && typeof result.phase === "string" && typeof result.revision === "number") receive(result as HostStateSnapshot);
  });
  // His App renders after the state event; the observer catches the screen once React has put it in.
  const root = document.getElementById("root");
  if (root) new MutationObserver(() => { if (phase !== "ready") paint(); }).observe(root, { childList: true, subtree: true });
} catch (cause) { report(cause); }
