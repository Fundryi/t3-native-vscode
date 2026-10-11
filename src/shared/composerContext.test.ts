import test from "node:test";
import assert from "node:assert/strict";
import { EnvironmentId, MessageId, ThreadId } from "@t3tools/contracts";
import { collectAssistantCitations, withAssistantCitationComment } from "@t3tools/shared/assistantCitations";
import { createAssistantTextSelector, findAssistantCitationText } from "../webview/components/t3/assistantTextSelection.js";
import { assistantQuoteLabel, contextIsReferenced, fileReferenceLabel, fileReferenceOccurrences, formatComposerMessage, insertAssistantQuote, insertFileReference, removeContextReference, type FileReference } from "./composerContext.js";
import { stripRenderedAssistantQuotes } from "./assistantQuoteText.js";
import { insertAttachmentReferences } from "./composerAttachments.js";
import { collectComposerContextReferences } from "@t3tools/shared/composerContextReferences";
import { parseDraftTransfer } from "./viewDraft.js";

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
  assert.ok(one.text.includes(assistantQuoteLabel(tricky)));
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
