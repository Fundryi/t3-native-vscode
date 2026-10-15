/**
 * P6 goal, webview side (src/host/ours/goal.ts answers). One line right above his composer box while the chat has a
 * native /goal: "Pursuing goal, 12k tokens, 4m", the objective, and Resume / Clear once the chat is idle, as T3 web's
 * goal row (ChatView.tsx goalBannerItem). DOM only: the bar sits before his .composer-box (Q14 secrets owns the
 * column's first child), and an observer puts it back when his composer remounts.
 */
import { bridge, Events } from "../bridge-client";
import { readDraft } from "../composerDrafts";
import { oursRequest, failed } from "./channel";

interface Goal { readonly threadId: string; readonly title: string; readonly objective: string; readonly usage: string | null; readonly canResume: boolean; readonly actions: boolean }
const report = failed("goal bar");

const style = document.createElement("style");
style.textContent = `
.ours-goal-bar { display: flex; align-items: center; gap: 8px; font-size: .75rem; padding: 4px 6px; margin-bottom: 4px; border: 1px solid var(--border); border-radius: 6px; }
.ours-goal-text { flex: 1; min-width: 0; display: flex; gap: 6px; }
.ours-goal-title { white-space: nowrap; font-weight: 600; }
.ours-goal-objective { color: var(--muted-foreground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }`;
document.head.append(style);

const bar = document.createElement("div");
bar.className = "ours-goal-bar";
bar.setAttribute("role", "status");
let goal: Goal | null = null;
let busy = false;

const valid = (value: unknown): value is Goal => {
  const candidate = value as Partial<Goal> | null;
  return !!candidate && typeof candidate.threadId === "string" && typeof candidate.title === "string" && typeof candidate.objective === "string"
    && (candidate.usage === null || typeof candidate.usage === "string") && typeof candidate.canResume === "boolean" && typeof candidate.actions === "boolean";
};

function run(command: "resume" | "clear", threadId: string): void {
  // His sendMessage clears the chat's composer draft and releases its attachments, so never send over a draft.
  const draft = readDraft(threadId);
  const draftInUse = !!(draft.text.trim() || draft.contexts.length || draft.attachments?.length);
  busy = true; render();
  void oursRequest("goal.run", { command, draftInUse }).catch(report).finally(() => { busy = false; void refresh(); });
}

function render(): void {
  if (!goal) { bar.remove(); return; }
  const { threadId } = goal;
  const title = document.createElement("span");
  title.className = "ours-goal-title";
  // Usage stays in the title, as T3 web does, so a long objective cannot clip it.
  title.textContent = goal.usage ? `${goal.title} \u00b7 ${goal.usage}` : goal.title;
  const objective = document.createElement("span");
  objective.className = "ours-goal-objective";
  objective.textContent = goal.objective;
  const text = document.createElement("span");
  text.className = "ours-goal-text";
  text.title = goal.objective;
  text.append(title, objective);
  const buttons: HTMLButtonElement[] = [];
  if (goal.actions) {
    const button = (label: string, command: "resume" | "clear", hint: string) => {
      const element = document.createElement("button");
      element.type = "button"; element.className = "text-button"; element.textContent = label; element.title = hint; element.disabled = busy;
      element.addEventListener("click", () => run(command, threadId));
      buttons.push(element);
    };
    if (goal.canResume) button("Resume", "resume", "Send /goal resume: the agent works on the goal again");
    button("Clear", "clear", "Send /goal clear: the agent drops the goal");
  }
  bar.replaceChildren(text, ...buttons);
  place();
}

function place(): void {
  const box = goal ? document.querySelector(".composer-column > .composer-box") : null;
  if (!box) { bar.remove(); return; }
  if (box.previousElementSibling !== bar) box.before(bar);
}

const refresh = () => oursRequest<unknown>("goal").then((next) => { goal = valid(next) ? next : null; render(); }, report);
let timer: ReturnType<typeof setTimeout> | undefined;
// State pushes come many times a second while a turn streams; one request per quiet 400 ms is enough.
bridge.on(Events.stateChanged, () => { clearTimeout(timer); timer = setTimeout(() => void refresh(), 400); });
// Once at load: an editor tab gets no first push.
void refresh();
new MutationObserver(() => { if (goal) place(); }).observe(document.body, { childList: true, subtree: true });
