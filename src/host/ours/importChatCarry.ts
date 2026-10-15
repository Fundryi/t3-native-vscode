/**
 * C4 carryover: a Claude Code or Codex transcript as one plain-text context message for a new T3 chat (pure, tested).
 * The native session cannot move to another engine (an API-key provider through another agent), so the conversation
 * TEXT moves: user and assistant text in order; tool calls, tool results, thinking, system and injected blocks are left out.
 */
import { records, type Driver } from "./importChatParse.js";

export interface Turn { readonly role: "user" | "assistant"; readonly text: string }
export const CARRY_BUDGET = 60_000;
const TOOL: Record<Driver, string> = { claudeAgent: "Claude Code", codex: "Codex" };

// shortcut: any <tag_x> or <tag-x> block counts as injected (command-name, system-reminder, ide_selection,
// environment_context, task-notification); prose that really contains such a block loses it. Narrow the rule if that bites.
const INJECTED = /<([a-z]+[-_][\w-]*)\b[^>]*>[\s\S]*?<\/\1>/gi;
const clean = (text: string): string => /^#+ AGENTS\.md/i.test(text.trim()) ? "" : text.replace(INJECTED, "").trim();
/** Text parts of a message content (a string or an array of parts); other kinds (tool_use, images, thinking) are skipped. */
const texts = (content: unknown, kinds: ReadonlyArray<string>): string[] => (typeof content === "string" ? [content] : Array.isArray(content)
  ? content.flatMap((part: { type?: unknown; text?: unknown } | null) => kinds.includes(part?.type as string) && typeof part?.text === "string" ? [part.text] : []) : [])
  .map(clean).filter(Boolean);

/** Consecutive turns of one role become one (one Claude message is split over several lines; tools sit between texts). */
function merged(turns: ReadonlyArray<Turn>): Turn[] {
  const out: Turn[] = [];
  for (const turn of turns) {
    const last = out.at(-1);
    if (last?.role === turn.role) out[out.length - 1] = { role: turn.role, text: `${last.text}\n\n${turn.text}` };
    else out.push(turn);
  }
  return out;
}

/** Claude Code .jsonl lines. Prompts typed while a turn ran are queued_command attachments, not user records. */
export function claudeTurns(lines: ReadonlyArray<string>): Turn[] {
  return merged(records(lines).flatMap((item): Turn[] => {
    if (item.isMeta || item.isSidechain) return [];
    const attachment = item.attachment as { type?: unknown; commandMode?: unknown; prompt?: unknown } | undefined;
    const content = item.type === "attachment"
      ? attachment?.type === "queued_command" && attachment.commandMode === "prompt" ? attachment.prompt : undefined
      : (item.message as { content?: unknown } | undefined)?.content;
    const role = item.type === "assistant" ? "assistant" : item.type === "user" || item.type === "attachment" ? "user" : undefined;
    if (!role || content === undefined) return [];
    if (Array.isArray(content) && content.some((part: { type?: unknown } | null) => part?.type === "tool_result")) return [];
    const text = texts(content, ["text"]).join("\n\n");
    return text ? [{ role, text }] : [];
  }));
}

/** Codex rollout lines: response_item messages of the user and the assistant (developer prompts and AGENTS.md left out). */
export function codexTurns(lines: ReadonlyArray<string>): Turn[] {
  return merged(records(lines).flatMap((item): Turn[] => {
    const payload = item.payload as { type?: unknown; role?: unknown; content?: unknown } | undefined;
    if (item.type !== "response_item" || payload?.type !== "message" || (payload.role !== "user" && payload.role !== "assistant")) return [];
    const text = texts(payload.content, ["input_text", "output_text"]).join("\n\n");
    return text ? [{ role: payload.role, text }] : [];
  }));
}

const label = (turn: Turn) => turn.role === "user" ? "User" : "Assistant";

/** The context message: heading, then the newest turns that fit the budget (the newest cut to its end if it alone is too long). */
export function carryText(turns: ReadonlyArray<Turn>, driver: Driver, sessionId: string, modifiedMs: number, budget = CARRY_BUDGET): { text: string; turns: number; firstPrompt?: string } {
  const heading = `Earlier conversation carried over from ${TOOL[driver]} (session ${sessionId}, ${new Date(modifiedMs).toISOString().slice(0, 10)}) for context. Read it, answer with one short line that you are caught up, then wait for my next message.`;
  const blocks: string[] = [];
  let used = 0, cut = false;
  for (const turn of [...turns].reverse()) {
    const block = `${label(turn)}: ${turn.text}`;
    if (used + block.length + 2 > budget) {
      cut = true;
      if (!blocks.length) blocks.push(`${label(turn)}: ...${turn.text.slice(-(budget - 20))}`);
      break;
    }
    blocks.push(block); used += block.length + 2;
  }
  const firstPrompt = turns.find((turn) => turn.role === "user")?.text.replace(/\s+/g, " ").trim();
  return { text: [heading, ...(cut ? ["(earlier part left out)"] : []), ...blocks.reverse()].join("\n\n"), turns: blocks.length, ...(firstPrompt ? { firstPrompt } : {}) };
}
