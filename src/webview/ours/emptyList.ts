/**
 * R19 emptylist, webview side: under his "No active conversations" line in the sessions list (ThreadList.tsx) a
 * Start a chat button, "T3 has N chats in other folders" with Show, and the two keys that matter. Also fixes his
 * footer "Current workspace only" when no folder is open (his filter then shows every T3 project).
 * Host side: src/host/ours/emptyList.ts. DOM only, none of his components change.
 */
import { bridge, Events } from "../bridge-client";
import { isObject } from "../../shared/bridge";
import { oursRequest, failed, unavailable } from "./channel";

const report = failed("empty sessions list");
const style = document.createElement("style");
style.textContent = `
.ours-empty-list { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; padding: 4px 14px 10px; font-size: .6875rem; color: var(--muted-foreground); }
.ours-empty-list > svg { color: var(--muted-foreground); opacity: .8; }
.ours-empty-list p { margin: 0; }
.ours-empty-show { padding: 0; border: 0; background: transparent; color: var(--vscode-textLink-foreground, var(--primary)); font: inherit; text-decoration: underline; cursor: pointer; }
.ours-empty-show:hover { color: var(--vscode-textLink-activeForeground, var(--primary)); }`;
document.head.append(style);

const ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/><path d="M8 12h8"/><path d="M12 8v8"/></svg>';
const FOOTER = "Current workspace only";

let info: { readonly otherChats: number; readonly folderOpen: boolean } | undefined;
let asking = false;
let gone = false; // the host has no fork RPC (his fixtures): stop asking
let block: HTMLElement | undefined;

function ask(): void {
  if (asking || gone) return;
  asking = true;
  oursRequest<unknown>("emptyList.info").then((reply) => {
    if (isObject(reply) && typeof reply.otherChats === "number" && typeof reply.folderOpen === "boolean") { info = { otherChats: reply.otherChats, folderOpen: reply.folderOpen }; schedule(); }
  }, (cause: unknown) => { if (unavailable(cause)) gone = true; report(cause); }).finally(() => { asking = false; });
}

const act = (action: "new" | "show") => () => { oursRequest("emptyList.run", { action }).catch(report); };

function build(): HTMLElement {
  const root = document.createElement("div");
  root.className = "ours-empty-list";
  root.innerHTML = `${ICON}<button type="button" class="btn primary ours-empty-start">Start a chat</button><p class="ours-empty-other" hidden><span></span> <button type="button" class="ours-empty-show">Show</button></p><p>Alt+K adds the selection, Ctrl+Alt+C focuses the chat.</p>`;
  root.querySelector(".ours-empty-start")?.addEventListener("click", act("new"));
  const show = root.querySelector<HTMLButtonElement>(".ours-empty-show");
  show?.addEventListener("click", act("show"));
  show?.setAttribute("aria-label", "Show the chats in other folders");
  return root;
}

function sync(): void {
  // Only the full sessions list: the compact history in a chat tab keeps his plain line.
  const empty = [...document.querySelectorAll(".projects-sidebar .session-list > p.empty-list")].find((p) => p.textContent?.startsWith("No active conversations"));
  if (!empty) { block?.remove(); block = undefined; }
  else {
    if (!block || block.previousElementSibling !== empty) { block?.remove(); block = build(); empty.after(block); ask(); }
    const other = block.querySelector<HTMLElement>(".ours-empty-other");
    const count = info?.otherChats ?? 0;
    if (other) {
      other.hidden = count === 0;
      const text = `T3 has ${count} ${count === 1 ? "chat" : "chats"} in other folders.`;
      const label = other.querySelector("span");
      if (label && label.textContent !== text) label.textContent = text;
    }
  }
  const footer = [...document.querySelectorAll<HTMLElement>(".projects-sidebar .history-settings > span")].find((span) => span.textContent === FOOTER);
  if (footer) {
    // His span holds one constant string, so React never rewrites it.
    if (!info) ask();
    else if (!info.folderOpen) { footer.textContent = "All T3 folders (no folder open)"; footer.title = "Open a folder to see only its chats"; }
  }
}

let frame = 0;
const schedule = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; try { sync(); } catch (cause) { report(cause); } }); };
// The count follows T3: ask again on each pushed state while the empty block shows (one request in flight).
bridge.on(Events.stateChanged, () => { if (block?.isConnected) ask(); });
new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
