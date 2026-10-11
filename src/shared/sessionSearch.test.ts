import test from "node:test";
import assert from "node:assert/strict";
import { EnvironmentId, MessageId, ThreadId } from "@t3tools/contracts";
import { parseSearchFilters, findSessionMatches, searchableFields, type SessionSearchOptions } from "./sessionSearch.js";
import { sessionSearchPreview } from "./sessionSearchPresentation.js";
import { quoteDisplayText, renderedMessageText } from "./assistantQuoteText.js";
import { formatComposerMessage, insertAssistantQuote } from "./composerContext.js";
import type { TranscriptItem, WireTurnItem } from "./bridge.js";
const options: SessionSearchOptions = { query: "rate", caseSensitive: false, wholeWord: false, scope: "all" };
const row = (fields: unknown, output: string | null = null): TranscriptItem => ({ key: "thread:item", sourceThreadId: "thread", item: fields as WireTurnItem, needsDetail: false, output, toolLabel: null });
test("Session find counts each literal occurrence, preserves source offsets and supports Unicode word boundaries", () => {
  const item = row({ type: "assistant_message", text: "Rate rate rates αrate rate_ $\\eta=0.01$ [a+b]" });
  assert.equal(findSessionMatches(item, options).total, 5);
  const exact = findSessionMatches(item, { ...options, wholeWord: true });
  assert.deepEqual(exact.matches.map((match) => [match.start, match.end]), [[0, 4], [5, 9]]);
  assert.equal(findSessionMatches(item, { ...options, caseSensitive: true }).total, 4);
  assert.equal(findSessionMatches(item, { ...options, query: "[a+b]" }).total, 1);
  assert.equal(findSessionMatches(item, { ...options, query: "\\eta" }).total, 1);
  assert.equal(findSessionMatches(item, { ...options, query: "" }).total, 0);
});
test("Message-only find excludes activity while all-text includes command input, output and attachment names", () => {
  const command = row({ type: "command_execution", input: "echo rate" }, "rate rate");
  assert.equal(findSessionMatches(command, options).total, 3);
  assert.equal(findSessionMatches(command, { ...options, scope: "messages" }).total, 0);
  const attached = row({ type: "user_message", text: "See figure", attachments: [{ name: "rate.png" }] });
  assert.equal(findSessionMatches(attached, { ...options, scope: "messages" }).matches[0]!.field, "attachment:0");
  const bounded = findSessionMatches(row({ type: "assistant_message", text: "rate ".repeat(50) }), options, 3);
  assert.equal(bounded.total, 50); assert.equal(bounded.matches.length, 3);
});


test("Source/content filters intersect, while multiple content kinds use OR", () => {
  const message = row({ type: "user_message", text: "rate $x$", attachments: [{ name: "plot.png", mimeType: "image/png" }] });
  assert.equal(findSessionMatches(message, { ...options, sources: ["assistant"] }).total, 0);
  assert.equal(findSessionMatches(message, { ...options, sources: [] }).total, 0);
  assert.equal(findSessionMatches(message, { ...options, sources: ["user"], content: ["figures", "code"] }).total, 1);
  assert.equal(findSessionMatches(message, { ...options, content: ["equations"] }).total, 1);
  assert.equal(findSessionMatches(message, { ...options, content: ["code"] }).total, 0);
  assert.equal(findSessionMatches(row({ type: "reasoning", text: "rate" }), { ...options, sources: ["thought"] }).total, 1);
  assert.throws(() => parseSearchFilters({ sources: ["arbitrary"] }), /Invalid search/);
  assert.throws(() => parseSearchFilters({ content: "figures" }), /Invalid search/);
});

const quoteContext = (contextId: string, text: string, comment?: string) =>
  ({ type: "assistant" as const, contextId, citation: { version: 1 as const, environmentId: EnvironmentId.make("env"), threadId: ThreadId.make("thread"), messageId: MessageId.make("message"), text, start: 0, end: text.length, prefix: "", suffix: "", ...(comment === undefined ? {} : { comment }) } });
const quoted = (prose: string, ...contexts: ReturnType<typeof quoteContext>[]) =>
  formatComposerMessage(contexts.reduce((text, context) => insertAssistantQuote(text.length ? `${text} ` : text, context, { start: text.length + 1, end: text.length + 1 }).text, prose), contexts);
const userText = (text: string) => searchableFields(row({ type: "user_message", text, attachments: [] }), "all")[0]!.text;

test("A quoted user message is searched as the transcript renders it, not as the wire text", () => {
  const drifts = quoteContext("quote_aaaa1111", "Base rate drifts", "Check the rate twice");
  const one = quoted("Why does rate move?", drifts);
  // The readable block and the percent-encoded href are gone; the card's quote and labelled comment remain.
  assert.equal(userText(one), "Why does rate move? Base rate drifts\nComment: Check the rate twice");
  const item = row({ type: "user_message", text: one, attachments: [] });
  // Five on the wire, three on screen, and in the order the rendered DOM concatenates them.
  assert.equal([...one.matchAll(/rate/giu)].length, 5);
  assert.deepEqual(findSessionMatches(item, options).matches.map((match) => [match.start, match.occurrence]), [[9, 0], [25, 1], [56, 2]]);
  const focused = findSessionMatches(item, options).matches[2]!;
  const preview = sessionSearchPreview(userText(one), focused);
  assert.equal(preview.text.slice(focused.start - preview.start, focused.end - preview.start), "rate");
  assert.equal(findSessionMatches(item, { ...options, query: "Comment: Check" }).total, 1);
  assert.equal(findSessionMatches(item, { ...options, query: "t3-citation" }).total, 0);
  assert.equal(findSessionMatches(item, { ...options, query: "Assistant quote:" }).total, 0);

  const second = quoteContext("quote_bbbb2222", "Second rate note");
  const two = quoted("Compare", drifts, second);
  assert.equal(userText(two), "Compare Base rate drifts\nComment: Check the rate twice Second rate note");
  assert.equal(findSessionMatches(row({ type: "user_message", text: two, attachments: [] }), options).total, 3);

  const bare = quoted("Only", quoteContext("quote_cccc3333", "a rate without comment"));
  assert.equal(userText(bare), "Only a rate without comment");

  // Assistant prose carries no citation links of its own; it must still be indexed verbatim.
  assert.equal(searchableFields(row({ type: "assistant_message", text: one }), "all")[0]!.text, one);
  assert.equal(findSessionMatches(row({ type: "assistant_message", text: one }), options).total, 5);
});

test("Copying a quoted message yields the readable quote, not the citation URL", () => {
  const citation = { version: 1 as const, environmentId: EnvironmentId.make("env"), threadId: ThreadId.make("thread"), messageId: MessageId.make("message"), text: "Base rate drifts", start: 0, end: 16, prefix: "", suffix: "", comment: "Check it twice" };
  const context = { type: "assistant" as const, contextId: "quote_aa11bb22", citation };
  const wire = formatComposerMessage(insertAssistantQuote("Why? ", context, { start: 5, end: 5 }).text, [context]);
  const copied = renderedMessageText(wire);
  assert.equal(copied, "Why? Base rate drifts\nComment: Check it twice");
  for (const hidden of ["t3-citation", "Assistant quote:", "%20", "+drifts"]) assert.ok(!copied.includes(hidden), `copy leaked ${hidden}`);
  assert.equal(renderedMessageText("No quotes here."), "No quotes here.");
});

test("A quote card spends neither preview line on a blank and keeps its structure when expanded", () => {
  // The capture emits a newline per block boundary plus markdown's filler between blocks, so a
  // quote of a paragraph followed by a list really does arrive with four blank lines in it.
  const spanning = "Here is the plan.\n\n\n\n\nFirst step\n\n\nSecond step";
  assert.equal(quoteDisplayText(spanning, false), "Here is the plan. First step Second step");
  assert.equal(quoteDisplayText(spanning, true), "Here is the plan.\n\nFirst step\n\nSecond step");
  // A quote of a table, blockquote or loose list starts on filler, which used to eat a whole preview line.
  for (const leading of ["\nSolo line", "\n\n\nSolo line", "   \nSolo line"]) {
    assert.equal(quoteDisplayText(leading, false), "Solo line");
    assert.equal(quoteDisplayText(leading, true), "Solo line");
  }
  // A deliberate paragraph break is two newlines and must survive; so must code indentation.
  assert.equal(quoteDisplayText("para one\n\npara two", true), "para one\n\npara two");
  assert.equal(quoteDisplayText("  indented\n\n  more", true), "  indented\n\n  more");
  assert.equal(quoteDisplayText("single\nbreak", true), "single\nbreak");
  // Whitespace-only differences must not move a word, or search highlighting would pick the wrong hit.
  const words = (text: string) => text.split(/\s+/).filter(Boolean);
  for (const expanded of [false, true]) assert.deepEqual(words(quoteDisplayText(spanning, expanded)), words(spanning));
});
