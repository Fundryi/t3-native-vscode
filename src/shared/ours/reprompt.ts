/**
 * Q11 reprompt: prompt recall over a thread's sent user messages, a trimmed port of T3 Code's
 * apps/web/src/components/chat/composerPromptHistory.ts (no review comments or terminal blocks here).
 */
import type { TranscriptItem } from "../bridge.js";
import { renderedMessageText } from "../assistantQuoteText.js";
import { splitMessageReferences } from "../messageReferences.js";

export interface PromptEntry { readonly id: string; readonly prompt: string }
/** The recall in the box: `recalled` is the text put there; once the box no longer holds it, browsing is over. */
export interface PromptPosition { readonly id: string; readonly recalled: string }

const ULTRATHINK = "Ultrathink:\n";

/** The text the user typed: appended editor snapshots and the ultrathink prefix go, inline file links stay. */
export function recallText(messageText: string): string {
  const text = renderedMessageText(splitMessageReferences(messageText).text).trim();
  return (text.startsWith(ULTRATHINK) ? text.slice(ULTRATHINK.length) : text).trim();
}

/** Oldest first; consecutive equal prompts collapse into the newest; attachment-only sends are skipped. */
export function promptEntries(transcript: ReadonlyArray<TranscriptItem>): PromptEntry[] {
  const entries: PromptEntry[] = [];
  for (const row of transcript) {
    if (row.item.type !== "user_message") continue;
    const prompt = recallText(row.item.text);
    if (!prompt) continue;
    if (entries.at(-1)?.prompt === prompt) entries[entries.length - 1] = { id: row.key, prompt };
    else entries.push({ id: row.key, prompt });
  }
  return entries;
}

/**
 * Null when the key should keep its normal caret move. Backward starts only from an empty box and stops at the
 * oldest entry; forward past the newest entry empties the box and ends browsing.
 */
export function stepPrompt(direction: "backward" | "forward", entries: ReadonlyArray<PromptEntry>, position: PromptPosition | null, current: string): { position: PromptPosition | null; prompt: string } | null {
  const browsing = position !== null && position.recalled === current;
  // The id first; a collapsed duplicate can retire it while the same text lives on under a newer one.
  let at = browsing ? entries.findIndex((entry) => entry.id === position.id) : -1;
  if (browsing && at < 0) at = entries.findLastIndex((entry) => entry.prompt === current);
  if (direction === "backward") {
    if (at < 0 && current.length > 0) return null;
    const entry = entries[at < 0 ? entries.length - 1 : at - 1];
    return entry ? { position: { id: entry.id, recalled: entry.prompt }, prompt: entry.prompt } : null;
  }
  if (at < 0) return null;
  const entry = entries[at + 1];
  return entry ? { position: { id: entry.id, recalled: entry.prompt }, prompt: entry.prompt } : { position: null, prompt: "" };
}

/** The prompt a row answers: the nearest user message at or before `key` that has text (for Retry and "use again"). */
export function promptBefore(transcript: ReadonlyArray<TranscriptItem>, key: string): string | undefined {
  const index = transcript.findIndex((row) => row.key === key);
  for (let at = index; at >= 0; at -= 1) {
    const { item } = transcript[at]!;
    if (item.type !== "user_message") continue;
    const prompt = recallText(item.text);
    if (prompt) return prompt;
  }
  return undefined;
}
