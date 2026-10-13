import test from "node:test";
import assert from "node:assert/strict";
import { EnvironmentId, MessageId, ThreadId } from "@t3tools/contracts";
import { collectAssistantCitations, withAssistantCitationComment } from "@t3tools/shared/assistantCitations";
import { createAssistantTextSelector, findAssistantCitationText } from "../webview/components/t3/assistantTextSelection.js";
import { assistantQuoteLabel, assistantQuoteNumbers, syncAssistantQuoteLabels, contextIsReferenced, fileReferenceLabel, fileReferenceOccurrences, formatComposerMessage, insertAssistantQuote, insertFileReference, removeContextReference, type FileReference } from "./composerContext.js";
import { stripRenderedAssistantQuotes } from "./assistantQuoteText.js";
import { insertAttachmentReferences } from "./composerAttachments.js";
import { collectComposerContextReferences } from "@t3tools/shared/composerContextReferences";
import { parseDraftTransfer } from "./viewDraft.js";
import { citationKey } from "../webview/components/AssistantCitationLink.js";

test("Quotes preserve code whitespace, rendered UTF-16 offsets and exact text through T3 citation encoding", () => {
  const text = "Before 😀\n\nconst  value = 42;\nAfter.";
  const quote = "const  value = 42;";
  const selector = createAssistantTextSelector(text, text.indexOf(quote), text.indexOf(quote) + quote.length)!;
  const citation = withAssistantCitationComment({ version: 1, environmentId: EnvironmentId.make("env"), threadId: ThreadId.make("thread"), messageId: MessageId.make("message"), ...selector }, " Why 42? ");
  const message = formatComposerMessage("Discuss this", [{ type: "assistant", citation }]);
  assert.deepEqual(collectAssistantCitations(message).map((match) => match.citation), [citation]);
  assert.ok(message.includes("Why 42?")); assert.ok(message.includes("const  value = 42;"));
  assert.equal(selector.start, "Before 😀 ".length);
  assert.deepEqual(findAssistantCitationText(text, selector), { start: selector.start, end: selector.end });
  assert.equal(formatComposerMessage("", [{ type: "assistant", citation }]).length > 0, true);
});
test("Repeated quotes use surrounding context, including after offsets drift", () => {
  const text = "First quote and second quote with different context.";
  const start = text.indexOf("quote", 10); const selector = createAssistantTextSelector(text, start, start + 5)!;
  assert.equal(findAssistantCitationText("Prefix. " + text, selector)?.start, start + 8);
  assert.equal(findAssistantCitationText("quote quote", { text: "quote", start: 0, end: 5, prefix: "", suffix: "" }), null);
  assert.equal(createAssistantTextSelector(" \n\t ", 0, 4), null);
});
test("Removing or editing a comment preserves the citation source and exact selection", () => {
  const selector = createAssistantTextSelector("The selected text.", 4, 12)!;
  const citation = { version: 1 as const, environmentId: EnvironmentId.make("env"), threadId: ThreadId.make("thread"), messageId: MessageId.make("message"), ...selector };
  const withComment = withAssistantCitationComment(citation, "A comment\nwith a second line.");
  assert.equal(withComment.comment, "A comment\nwith a second line.");
  assert.deepEqual(withAssistantCitationComment(withComment, "  "), citation);
  assert.deepEqual(collectAssistantCitations(formatComposerMessage("Follow up", [{ type: "assistant", citation: withComment }]))[0]?.citation, withComment);
});

const inlineCitation = { version: 1 as const, environmentId: EnvironmentId.make("env"), threadId: ThreadId.make("thread"), messageId: MessageId.make("message"), text: "Keep the original source.", start: 0, end: 25, prefix: "", suffix: "", comment: "Explain this." };
const inlineQuote = { type: "assistant" as const, contextId: "quote_one", citation: inlineCitation };
const selectedFile = { type: "file", uri: "file:///tmp/project/README.md", path: "/tmp/project/README.md", label: "README.md", range: { start: { line: 43, column: 3 }, end: { line: 47, column: 1 } }, text: "  unsaved selected text\n```\npartial line" } satisfies FileReference;
const quoteCitation = (text: string, comment?: string) => ({ version: 1 as const, environmentId: EnvironmentId.make("env"), threadId: ThreadId.make("thread"), messageId: MessageId.make("message"), text, start: 0, end: text.length, prefix: "", suffix: "", ...(comment === undefined ? {} : { comment }) });

test("Editor references insert readable file/range tokens at the cursor and retain exact unsaved snapshots", () => {
  const inserted = insertFileReference("Before replace after.", [], selectedFile, { start: 7, end: 14 });
  assert.equal(inserted.text, "Before @README.md:43-46  after.");
  assert.equal(inserted.cursor, "Before @README.md:43-46 ".length);
  const sent = formatComposerMessage(inserted.text, inserted.contexts);
  assert.ok(sent.startsWith("Before [@README.md:43-46](file:///tmp/project/README.md#L43-L46)  after."));
  assert.ok(sent.includes("43:3–47:1 (end exclusive)"));
  assert.ok(sent.includes("````\n" + selectedFile.text + "\n````"));
  assert.deepEqual(parseDraftTransfer({ draftKey: "file-chat", draft: { text: inserted.text, contexts: inserted.contexts } }, "file-chat")?.draft.contexts, inserted.contexts);
});

test("Deleting file tokens omits snapshots and cannot accidentally bind a longer range or an image label", () => {
  const inserted = insertFileReference("", [], selectedFile, { start: 0, end: 0 });
  const context = inserted.contexts[0]!;
  assert.equal(contextIsReferenced(inserted.text, context), true);
  assert.equal(formatComposerMessage(removeContextReference(inserted.text, context), inserted.contexts), "");
  assert.equal(contextIsReferenced("@README.md:43-460", context), false);
  assert.equal(fileReferenceOccurrences("[@README.md:43-46](t3-context://v1/image/one)", inserted.contexts).length, 0);
  assert.ok(formatComposerMessage("legacy draft", [selectedFile]).includes(selectedFile.text));
  const duplicate = formatComposerMessage(inserted.text.repeat(2), inserted.contexts);
  assert.equal(duplicate.split("Snapshot from the editor").length, 2);
});

test("Repeated editor references refresh one snapshot and disambiguate paths from different workspace folders", () => {
  const first = insertFileReference("", [], selectedFile, { start: 0, end: 0 });
  const second = insertFileReference(first.text, first.contexts, { ...selectedFile, text: "new unsaved selection" }, { start: first.cursor, end: first.cursor });
  assert.equal(second.contexts.length, 1);
  assert.ok(formatComposerMessage(second.text, second.contexts).includes("new unsaved selection"));
  assert.ok(!formatComposerMessage(second.text, second.contexts).includes(selectedFile.text));
  const other = insertFileReference(second.text, second.contexts, { ...selectedFile, uri: "file:///tmp/other/README.md", path: "/tmp/other/README.md", text: "other file" }, { start: second.cursor, end: second.cursor });
  assert.ok(other.text.includes("@/tmp/other/README.md:43:3-47:1"));
  assert.equal(fileReferenceOccurrences(other.text, other.contexts).length, 3);
  const spaced = insertFileReference("explain", [], { ...selectedFile, label: "notes with spaces.md" }, { start: 7, end: 7 });
  assert.equal(spaced.text, 'explain @"notes with spaces.md:43-46" ');
  assert.equal(fileReferenceOccurrences(spaced.text, spaced.contexts).length, 1);
});

test("Different partial selections on the same source lines preserve their own snapshots", () => {
  const first = insertFileReference("", [], selectedFile, { start: 0, end: 0 });
  const shorter = { ...selectedFile, range: { start: { line: 43, column: 8 }, end: { line: 46, column: 12 } }, text: "different partial selection" } satisfies FileReference;
  const second = insertFileReference(first.text, first.contexts, shorter, { start: first.cursor, end: first.cursor });
  assert.equal(fileReferenceOccurrences(second.text, second.contexts).length, 2);
  const sent = formatComposerMessage(second.text, second.contexts);
  assert.ok(sent.includes(selectedFile.text)); assert.ok(sent.includes(shorter.text));
  const removed = formatComposerMessage(removeContextReference(second.text, second.contexts[1]!), second.contexts);
  assert.ok(removed.includes(selectedFile.text)); assert.ok(!removed.includes(shorter.text));
});

test("Inline quotes replace the prompt selection, retain surrounding text and expand at the same send position", () => {
  const inserted = insertAssistantQuote("Before replace after 😀.", inlineQuote, { start: 7, end: 14 });
  const ref = collectComposerContextReferences(inserted.text)[0]!;
  assert.equal(ref.kind, "assistant-quote");
  assert.equal(inserted.text.slice(0, ref.start), "Before ");
  assert.equal(inserted.text.slice(inserted.cursor), " after 😀.");
  const sent = formatComposerMessage(inserted.text, [inlineQuote]);
  const source = collectAssistantCitations(sent)[0]!;
  assert.deepEqual(source.citation, inlineCitation);
  assert.equal(sent.slice(0, source.start), "Before ");
  assert.ok(sent.slice(source.end).startsWith(" after 😀."));
  assert.ok(!sent.includes("t3-context://v1/assistant-quote"));
});

test("Quotes and images do not split each other's references when inserting or replacing a partial token", () => {
  const first = insertAssistantQuote("Before  after.", inlineQuote, { start: 7, end: 7 });
  const file = { key: "image", contextId: "image_one", name: "plot.png", mimeType: "image/png", sizeBytes: 12 };
  const withImage = insertAttachmentReferences(first.text, [file], { start: 20, end: 20 });
  const refs = collectComposerContextReferences(withImage.text);
  assert.equal(refs.length, 2);
  assert.deepEqual(refs.map(ref => ref.kind), ["assistant-quote", "image"]);
  const replaced = insertAssistantQuote(withImage.text, { ...inlineQuote, contextId: "quote_two" }, { start: refs[1]!.start + 5, end: refs[1]!.start + 9 });
  assert.deepEqual(collectComposerContextReferences(replaced.text).map(ref => ref.contextId), ["quote_one", "quote_two"]);
  assert.equal(replaced.text.slice(replaced.cursor), " after.");
});

test("Deleting inline quotes omits their payload while duplicate references share the preserved source", () => {
  const inserted = insertAssistantQuote("Before  after.", inlineQuote, { start: 7, end: 7 });
  assert.equal(contextIsReferenced(inserted.text, inlineQuote), true);
  const removed = removeContextReference(inserted.text, inlineQuote);
  assert.equal(removed, "Before  after.");
  assert.equal(contextIsReferenced(removed, inlineQuote), false);
  assert.equal(formatComposerMessage(removed, [inlineQuote]), "Before  after.");
  const repeated = formatComposerMessage(`${inserted.text}\n${inserted.text}`, [inlineQuote]);
  assert.equal(collectAssistantCitations(repeated).length, 2);
  assert.equal(repeated.split("> Assistant quote:").length, 2);
  const transferred = parseDraftTransfer({ draftKey: "thread", draft: { text: inserted.text, contexts: [inlineQuote] } }, "thread")!;
  assert.deepEqual(transferred.draft.contexts, [inlineQuote]);
  assert.deepEqual(collectAssistantCitations(formatComposerMessage(transferred.draft.text, transferred.draft.contexts))[0]?.citation, inlineCitation);
  assert.throws(() => parseDraftTransfer({ draftKey: "thread", draft: { text: "", contexts: [{ ...inlineQuote, contextId: "invalid:id" }] } }, "thread"));
});

test("Path suggestions become whole-file references that chip, send as one @ link and survive a handoff", () => {
  const picked: FileReference = { type: "file", uri: "file:///tmp/project/parts/ch1_intro.tex", path: "parts/ch1_intro.tex", label: "parts/ch1_intro.tex" };
  const inserted = insertFileReference("Explain @parts", [], picked, { start: 8, end: 14 });
  assert.equal(inserted.text, "Explain @parts/ch1_intro.tex ");
  const context = inserted.contexts[0] as FileReference;
  assert.equal(contextIsReferenced(inserted.text, context), true);
  assert.equal(fileReferenceLabel(context), "parts/ch1_intro.tex");
  assert.equal(formatComposerMessage(inserted.text, inserted.contexts), "Explain [@parts/ch1_intro.tex](file:///tmp/project/parts/ch1_intro.tex)");
  assert.equal(formatComposerMessage(removeContextReference(inserted.text, context), inserted.contexts), "Explain");
  assert.deepEqual(parseDraftTransfer({ draftKey: "new", draft: { text: inserted.text, contexts: inserted.contexts } }, "new")?.draft.contexts, inserted.contexts);
  const alongside = insertFileReference(inserted.text, inserted.contexts, selectedFile, { start: inserted.cursor, end: inserted.cursor });
  const sent = formatComposerMessage(alongside.text, alongside.contexts);
  assert.equal(sent.split("Snapshot from the editor").length, 2);
  assert.ok(sent.includes("[@parts/ch1_intro.tex](file:///tmp/project/parts/ch1_intro.tex)") && sent.includes("[@README.md:43-46](file:///tmp/project/README.md#L43-L46)"));
});

test("Referenced quotes send one citation link and one verbatim readable block that strips back out", () => {
  const tricky = quoteCitation("Core contributions (one per research question)\n\n> already quoted\na. period [brackets]", "Rewrite 1.2 (briefly).");
  const plain = quoteCitation("A second, plainer quote.");
  const first = { type: "assistant" as const, contextId: "quote_aaaa1111", citation: tricky };
  const second = { type: "assistant" as const, contextId: "quote_bbbb2222", citation: plain };
  const one = insertAssistantQuote("Fix ", first, { start: 4, end: 4 });
  const two = insertAssistantQuote(`${one.text} and `, second, { start: one.text.length + 5, end: one.text.length + 5 });
  assert.ok(one.text.includes(assistantQuoteLabel(tricky, 1)));
  const sent = formatComposerMessage(two.text, [first, second]);
  const citations = collectAssistantCitations(sent);
  assert.deepEqual(citations.map((match) => match.citation), [tricky, plain]);
  assert.equal(sent.split("> Assistant quote:").length, 3);
  // Punctuation stays verbatim; only markup is neutralized, so a quoted `>` cannot nest a blockquote.
  assert.ok(sent.includes("> Core contributions (one per research question)\n> \n> &gt; already quoted\n> a. period [brackets]"));
  assert.ok(sent.includes("Comment: Rewrite 1.2 (briefly)."));
  for (const escape of ["\\(", "\\)", "\\[", "\\]", "\\.", "\\-", "\\#", "\\+", "\\|", "\\~", "\\{", "\\}"]) assert.ok(!sent.includes(escape), `sent text escaped ${escape}`);
  assert.equal(stripRenderedAssistantQuotes(sent), `Fix ${citations[0]!.source} and ${citations[1]!.source}`);
  // A transcript that converted line endings or trimmed trailing spaces must still strip.
  assert.equal(stripRenderedAssistantQuotes(sent.replaceAll("\n", "\r\n").replaceAll("> \r\n", ">\r\n")), `Fix ${citations[0]!.source} and ${citations[1]!.source}`);
  const edited = `${sent}\n\n> Assistant quote:\n> Words the user typed.`;
  assert.ok(stripRenderedAssistantQuotes(edited).endsWith("\n\n> Assistant quote:\n> Words the user typed."));
  assert.equal(stripRenderedAssistantQuotes("Nothing to strip."), "Nothing to strip.");
});

test("A whole-file token cannot claim a longer path that extends it, and a huge quote still strips", () => {
  const menuFile = (path: string): FileReference => ({ type: "file", uri: `file:///w/${path}`, path, label: path });
  const first = insertFileReference("compare ", [], menuFile(".env"), { start: 8, end: 8 });
  const second = insertFileReference(first.text, first.contexts, menuFile(".env.local"), { start: first.cursor, end: first.cursor });
  assert.equal(second.text, "compare @.env @.env.local ");
  const sent = formatComposerMessage(second.text, second.contexts);
  assert.equal(sent, "compare [@.env](file:///w/.env) [@.env.local](file:///w/.env.local)");
  assert.equal(fileReferenceOccurrences(second.text, second.contexts).length, 2);
  for (const pair of [["Dockerfile", "Dockerfile.dev"], ["docs/api", "docs/api.md"], ["src/app", "src/app.tsx"]]) {
    const [short, long] = pair as [string, string];
    const one = insertFileReference("", [], menuFile(short), { start: 0, end: 0 });
    const two = insertFileReference(one.text, one.contexts, menuFile(long), { start: one.cursor, end: one.cursor });
    assert.ok(formatComposerMessage(two.text, two.contexts).includes(`(file:///w/${long})`), `${long} lost its own link`);
  }
  // A quote of several thousand short lines once built a pattern past the regular-expression size limit.
  const many = quoteCitation(Array.from({ length: 4_000 }, () => "x").join("\n"));
  const huge = { type: "assistant" as const, contextId: "quote_cccc3333", citation: many };
  const hugeSent = formatComposerMessage(insertAssistantQuote("Look ", huge, { start: 5, end: 5 }).text, [huge]);
  assert.equal(stripRenderedAssistantQuotes(hugeSent), `Look ${collectAssistantCitations(hugeSent)[0]!.source}`);
});

test("Quote blocks strip whatever the comment or the quoted text looks like", () => {
  const sent = (citation: ReturnType<typeof quoteCitation>, id: string) => {
    const context = { type: "assistant" as const, contextId: id, citation };
    const message = formatComposerMessage(insertAssistantQuote("Fix ", context, { start: 4, end: 4 }).text, [context]);
    return { message, stripped: stripRenderedAssistantQuotes(message) };
  };
  // Shift+Enter in the comment box puts a newline in the comment; it must still line up with the message's lines.
  for (const comment of ["one line", "line1\nline2", "line1\n\nline2", "trailing \nspaces  "]) {
    const { message, stripped } = sent(quoteCitation("q", comment), "quote_dddd4444");
    assert.ok(message.includes(`Comment: ${comment}`), `comment ${JSON.stringify(comment)} missing from the wire`);
    assert.equal(stripped, `Fix ${collectAssistantCitations(message)[0]!.source}`, `comment ${JSON.stringify(comment)} was not stripped`);
  }
  // One quote's rendered lines can repeat inside another's; the longer block has to be removed first.
  const short = { type: "assistant" as const, contextId: "quote_eeee5555", citation: quoteCitation("x") };
  const long = { type: "assistant" as const, contextId: "quote_ffff6666", citation: quoteCitation("Assistant quote:\nx") };
  const both = formatComposerMessage(`Fix ${insertAssistantQuote("", short, { start: 0, end: 0 }).text} and ${insertAssistantQuote("", long, { start: 0, end: 0 }).text}`, [short, long]);
  const links = collectAssistantCitations(both);
  assert.equal(stripRenderedAssistantQuotes(both), `Fix ${links[0]!.source} and ${links[1]!.source}`);
});

const quoteContext = (id: string, text: string, comment?: string) => ({ type: "assistant" as const, contextId: id, citation: quoteCitation(text, comment) });
const draftOf = (quotes: ReadonlyArray<ReturnType<typeof quoteContext>>, joiner = " and ") => {
  let text = "", contexts: ReturnType<typeof quoteContext>[] = [];
  for (const quote of quotes) { text = insertAssistantQuote(text ? text + joiner : "Fix ", quote, { start: text.length + (text ? joiner.length : 4), end: text.length + (text ? joiner.length : 4) }, contexts).text; contexts = [...contexts, quote]; }
  return { text, contexts };
};
const labelsIn = (text: string) => collectComposerContextReferences(text).map((reference) => reference.label);

test("A quote label leads with its number, then the comment, falling back to the quoted text", () => {
  assert.equal(assistantQuoteLabel(quoteCitation("quoted text", "so are you making these chagnes already?"), 1), "❝1 so are you making these chagnes already?");
  assert.equal(assistantQuoteLabel(quoteCitation("Ctrl+click to open; plain click edits; points at the file"), 2), "❝2 “Ctrl+click to open; plain click edits; poi…”");
  assert.equal(assistantQuoteLabel(quoteCitation("quoted text", "   \n\t "), 3), "❝3 “quoted text”");
  assert.equal(assistantQuoteLabel(quoteCitation("quoted text", ""), 3), "❝3 “quoted text”");
  assert.equal(assistantQuoteLabel(quoteCitation("   "), 5), "❝5");
});

test("A long or multi-line comment collapses to a one-line bounded preview that survives a markdown link", () => {
  const long = assistantQuoteLabel(quoteCitation("q", "word ".repeat(50_000)), 1);
  assert.ok(long.endsWith("…") && Array.from(long).length === "❝1 ".length + 42 + 1, long);
  const lines = assistantQuoteLabel(quoteCitation("q", "first line\n\n  second\r\nthird"), 1);
  assert.equal(lines, "❝1 first line second third");
  assert.equal(assistantQuoteLabel(quoteCitation("q", `${"a".repeat(41)}😀😀😀`), 1), `❝1 ${"a".repeat(41)}😀…`);
  assert.equal(assistantQuoteLabel(quoteCitation("q", "x".repeat(42)), 1), `❝1 ${"x".repeat(42)}`);
  assert.equal(assistantQuoteLabel(quoteCitation("q", "x".repeat(43)), 1), `❝1 ${"x".repeat(42)}…`);
  // Brackets and backslashes would end the link label early; the chip and the token must show the same text.
  const awkward = quoteCitation("q", "see [1] and \\path");
  assert.equal(assistantQuoteLabel(awkward, 1), "❝1 see 1 and path");
  const context = { type: "assistant" as const, contextId: "quote_awk1", citation: awkward };
  const inserted = insertAssistantQuote("", context, { start: 0, end: 0 });
  assert.deepEqual(labelsIn(inserted.text), [assistantQuoteLabel(awkward, 1)]);
  assert.equal(syncAssistantQuoteLabels(inserted.text, [context]), null);
});

test("Quote numbers follow order of appearance in the draft and match the transcript's badges", () => {
  const [a, b, c] = [quoteContext("quote_a", "alpha", "first"), quoteContext("quote_b", "beta"), quoteContext("quote_c", "gamma", "third")] as const;
  const all = draftOf([a, b, c]);
  assert.deepEqual(assistantQuoteNumbers(all.text, all.contexts), [1, 2, 3]);
  assert.deepEqual(labelsIn(all.text), ["❝1 first", "❝2 “beta”", "❝3 third"]);
  // The transcript numbers distinct citations by first appearance in the sent text; the draft must agree.
  const transcript = (text: string, contexts: typeof all.contexts) => {
    const numbers = new Map<string, number>();
    for (const { citation } of collectAssistantCitations(formatComposerMessage(text, contexts))) if (!numbers.has(citationKey(citation))) numbers.set(citationKey(citation), numbers.size + 1);
    return contexts.map((context) => numbers.get(citationKey(context.citation)));
  };
  assert.deepEqual(assistantQuoteNumbers(all.text, all.contexts), transcript(all.text, all.contexts));
  // Removing the middle quote renumbers the one after it, in the text and in the numbers.
  const without = { text: removeContextReference(all.text, b), contexts: [a, c] };
  assert.deepEqual(assistantQuoteNumbers(without.text, without.contexts), [1, 2]);
  assert.deepEqual(assistantQuoteNumbers(without.text, without.contexts), transcript(without.text, without.contexts));
  assert.deepEqual(labelsIn(syncAssistantQuoteLabels(without.text, without.contexts)!.text), ["❝1 first", "❝2 third"]);
  // Inserting before the others pushes them down, and a quote added out of order still counts by position.
  const d = quoteContext("quote_d", "delta", "inserted first");
  const front = insertAssistantQuote(all.text, d, { start: 0, end: 0 }, all.contexts);
  assert.equal(labelsIn(front.text)[0], "❝1 inserted first");
  const frontContexts = [...all.contexts, d];
  assert.deepEqual(assistantQuoteNumbers(front.text, frontContexts), [2, 3, 4, 1]);
  assert.deepEqual(assistantQuoteNumbers(front.text, frontContexts), transcript(front.text, frontContexts));
  assert.deepEqual(labelsIn(syncAssistantQuoteLabels(front.text, frontContexts)!.text), ["❝1 inserted first", "❝2 first", "❝3 “beta”", "❝4 third"]);
  // Without the draft's contexts the other tokens are unknown, but still count as distinct quotes before this one.
  assert.equal(labelsIn(insertAssistantQuote(all.text, d, { start: all.text.length, end: all.text.length }).text).at(-1), "❝4 inserted first");
  // An unreferenced quote has no number and the same quote cited twice keeps one.
  assert.deepEqual(assistantQuoteNumbers("no tokens", [a]), [undefined]);
  const twice = { text: `${all.text} again ${collectComposerContextReferences(all.text)[0]!.source}`, contexts: all.contexts };
  assert.deepEqual(assistantQuoteNumbers(twice.text, twice.contexts), [1, 2, 3]);
  assert.deepEqual(assistantQuoteNumbers(twice.text, twice.contexts), transcript(twice.text, twice.contexts));
});

test("Chip-only legacy quotes number after the inline ones, as they are sent", () => {
  const inline = quoteContext("quote_a", "alpha");
  const legacy = { type: "assistant" as const, citation: quoteCitation("legacy") };
  const draft = draftOf([inline]);
  const contexts = [legacy, ...draft.contexts];
  assert.deepEqual(assistantQuoteNumbers(draft.text, contexts), [2, 1]);
  const numbers = new Map<string, number>();
  for (const { citation } of collectAssistantCitations(formatComposerMessage(draft.text, contexts))) if (!numbers.has(citationKey(citation))) numbers.set(citationKey(citation), numbers.size + 1);
  assert.deepEqual(contexts.map((context) => numbers.get(citationKey(context.citation))), [2, 1]);
});

test("Editing a comment rewrites only that token's label and carries the caret through it", () => {
  const [a, b] = [quoteContext("quote_a", "alpha", "old comment"), quoteContext("quote_b", "beta", "keep")] as const;
  const draft = draftOf([a, b]);
  assert.equal(syncAssistantQuoteLabels(draft.text, draft.contexts), null);
  const edited = [{ ...a, citation: { ...a.citation, comment: "a rather different comment" } }, b];
  const synced = syncAssistantQuoteLabels(draft.text, edited)!;
  assert.deepEqual(labelsIn(synced.text), ["❝1 a rather different comment", "❝2 keep"]);
  assert.deepEqual(collectComposerContextReferences(synced.text).map((reference) => reference.contextId), ["quote_a", "quote_b"]);
  assert.equal(synced.text.slice(0, 4), "Fix ");
  assert.equal(syncAssistantQuoteLabels(synced.text, edited), null);
  const [first, second] = collectComposerContextReferences(draft.text);
  const [newFirst, newSecond] = collectComposerContextReferences(synced.text);
  assert.equal(synced.map(2), 2);
  assert.equal(synced.map(first!.start), newFirst!.start);
  assert.equal(synced.map(first!.start + 3), newFirst!.end);
  assert.equal(synced.map(first!.end), newFirst!.end);
  assert.equal(synced.map(second!.start), newSecond!.start);
  assert.equal(synced.map(draft.text.length), synced.text.length);
  // The token's href is untouched and the rest of the text is byte-for-byte as it was.
  assert.equal(synced.text.slice(newFirst!.end), draft.text.slice(first!.end));
  assert.equal(formatComposerMessage(synced.text, edited).includes("a rather different comment"), true);
});

test("Label sync settles for any comment, so a draft can never rewrite itself forever", () => {
  for (const comment of ["[x](y)", "back\\slash", "line\nbreak", "😀".repeat(500), "x".repeat(10_000), " ", "]](t3-context://v1/assistant-quote/other)"]) {
    const quote = quoteContext("quote_a", "alpha", comment);
    const draft = draftOf([quote, quoteContext("quote_b", "beta")]);
    assert.equal(syncAssistantQuoteLabels(draft.text, draft.contexts), null, JSON.stringify(comment).slice(0, 40));
    assert.equal(collectComposerContextReferences(draft.text).length, 2);
  }
});
