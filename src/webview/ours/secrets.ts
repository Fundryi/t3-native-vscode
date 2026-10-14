/**
 * Q14 secrets, webview side: a card above the composer for each secret request the agent is waiting on in this chat.
 * "Enter secret..." opens a VS Code password box on the host (src/host/ours/secrets.ts), so the value never enters the
 * webview. His Composer is keyed by thread and remounts, so an observer puts the card back as the first child of his
 * .composer-column (React only anchors on its own nodes, so a foreign first child stays put). The card leaves by
 * itself once the server reports the request saved, declined or ended.
 */
import { SECRET_REQUEST_PRIVACY_NOTE } from "@t3tools/client-runtime/secret-request";
import { bridge, Events } from "../bridge-client";
import type { HostStateSnapshot } from "../../shared/bridge";
import { pendingSecretRequests, type SecretRequestRow } from "../../shared/ours/secrets";
import { oursRequest } from "./channel";

const report = (cause: unknown) => console.error("T3 VSCode (fork): secret request failed", cause);
const container = document.createElement("div");
container.className = "pending-requests ours-secret-requests";
const busy = new Set<string>();
let rows: SecretRequestRow[] = [];

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) => {
  const node = document.createElement(tag); node.className = className; if (text !== undefined) node.textContent = text; return node;
};

function answer(itemId: string, decline: boolean): void {
  busy.add(itemId); render();
  void oursRequest("secretAnswer", { itemId, decline }).catch(report).finally(() => { busy.delete(itemId); render(); });
}

function render(): void {
  container.replaceChildren(...rows.map(({ item }) => {
    const card = element("div", "approval-card");
    card.append(element("div", "request-heading", "The agent asks for a secret"), element("strong", "", item.label));
    if (item.reason) card.append(element("p", "", item.reason));
    card.append(element("p", "subtle", SECRET_REQUEST_PRIVACY_NOTE));
    const actions = element("div", "request-actions");
    const decline = element("button", "btn", "Decline"), save = element("button", "btn primary", busy.has(item.id) ? "Waiting..." : "Enter secret...");
    for (const button of [decline, save]) { button.type = "button"; button.disabled = busy.has(item.id); }
    decline.addEventListener("click", () => answer(item.id, true));
    save.addEventListener("click", () => answer(item.id, false));
    actions.append(decline, save); card.append(actions); return card;
  }));
  place();
}

function place(): void {
  const column = rows.length ? document.querySelector(".composer-column") : null;
  if (!column) { container.remove(); return; }
  if (column.firstChild !== container) column.insertBefore(container, column.firstChild);
}

let revision = -1;
// Host pushes only, through his bridge: it drops messages from child iframes (agent HTML in HtmlVisual), so a forged
// message cannot block or fake the card. Every state change pushes a stateChanged (hostState emit -> bridge.pushState).
bridge.on(Events.stateChanged, (data) => {
  try {
    const state = data as HostStateSnapshot | undefined;
    if (!state || typeof state.revision !== "number" || !Array.isArray(state.transcript) || state.revision < revision) return;
    revision = state.revision;
    rows = pendingSecretRequests(state.transcript, state.activeThreadId); render();
  } catch (cause) { report(cause); }
});
// Initial rows once: an editor tab gets no first push. Not Methods.getState, which marks the view ready (host/bridge.ts)
// and would release queued events before his App listens.
void oursRequest<{ revision: number; rows: SecretRequestRow[] }>("secretRequests").then((initial) => {
  if (initial.revision < revision) return;
  revision = initial.revision; rows = initial.rows; render();
}).catch(report);
new MutationObserver(() => { if (rows.length) place(); }).observe(document.body, { childList: true, subtree: true });
