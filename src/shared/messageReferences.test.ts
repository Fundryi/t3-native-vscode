import test from "node:test";
import assert from "node:assert/strict";
import { EnvironmentId, MessageId, ThreadId } from "@t3tools/contracts";
import { collectAssistantCitations } from "@t3tools/shared/assistantCitations";
import { formatComposerMessage, insertAssistantQuote, insertFileReference, type ComposerContext, type FileReference } from "./composerContext.js";
import { stripRenderedAssistantQuotes } from "./assistantQuoteText.js";
import { splitMessageReferences } from "./messageReferences.js";
import { messageExchanges } from "./messageNavigation.js";
import type { TranscriptItem } from "./bridge.js";

const tex = (text: string, range: FileReference["range"] = { start: { line: 42, column: 271 }, end: { line: 42, column: 291 } }): FileReference =>
  ({ type: "file", uri: "file:///tmp/project/parts/background.tex", path: "parts/background.tex", label: "background.tex", range, text });
const wholeFile: FileReference = { type: "file", uri: "file:///tmp/project/src/app.tsx", path: "src/app.tsx", label: "src/app.tsx" };
const quote = (text: string, comment?: string) => ({ version: 1 as const, environmentId: EnvironmentId.make("env"), threadId: ThreadId.make("thread"), messageId: MessageId.make("message"), text, start: 0, end: text.length, prefix: "", suffix: "", ...(comment === undefined ? {} : { comment }) });
/** Fixtures come from the real composer: a hand-written section would only prove the test's own guess. */
function send(prose: string, references: ReadonlyArray<FileReference>) {
  let draft: { text: string; cursor: number; contexts: ReadonlyArray<ComposerContext> } = { text: prose, cursor: prose.length, contexts: [] };
  for (const reference of references) draft = insertFileReference(draft.text, draft.contexts, reference, { start: draft.cursor, end: draft.cursor });
  return { draft, message: formatComposerMessage(draft.text, draft.contexts) };
}

test("A message without an attributable section is returned untouched", () => {
  for (const text of ["Just prose.", "", "Look at [@background.tex](file:///tmp/project/parts/background.tex) when you can.", "Selected range: 1:1–2:1 (end exclusive). Snapshot from the editor, including unsaved changes."]) {
    const split = splitMessageReferences(text);
    assert.equal(split.text, text); assert.deepEqual(split.references, []);
  }
  // A whole-file reference from the @ menu appends no section at all, so its link stays prose.
  const { message } = send("Explain ", [wholeFile]);
  assert.equal(message, "Explain [@src/app.tsx](file:///tmp/project/src/app.tsx)");
  assert.deepEqual(splitMessageReferences(message), { text: message, references: [] });
});

test("One reference leaves the typed prose and its link, and carries the snapshot to its own row", () => {
  const snapshot = "\\section{Background}\n  Prior work shows\nmore.";
  const { message } = send("Rewrite", [tex(snapshot)]);
  const split = splitMessageReferences(message);
  assert.equal(split.text, "Rewrite [@background.tex:42](file:///tmp/project/parts/background.tex#L42)");
  assert.equal(split.references.length, 1);
  const [reference] = split.references;
  assert.equal(reference!.label, "@background.tex:42");
  assert.equal(reference!.href, "file:///tmp/project/parts/background.tex#L42");
  assert.equal(reference!.detail, "Selected range: 42:271–42:291 (end exclusive). Snapshot from the editor, including unsaved changes.");
  assert.equal(reference!.snapshot, snapshot);
  assert.equal(reference!.lines, 3); assert.equal(reference!.summary, "3 lines");
  assert.equal(reference!.preview, "\\section{Background}");
  assert.equal(reference!.startLine, 42); assert.equal(reference!.language, "latex");
  assert.ok(!split.text.includes("Selected range") && !split.text.includes(snapshot));
});

test("Several references keep their own rows, identities and order", () => {
  const { message } = send("Compare", [tex("first snapshot"), tex("second snapshot", { start: { line: 7, column: 1 }, end: { line: 9, column: 1 } }), wholeFile]);
  const split = splitMessageReferences(message);
  assert.deepEqual(split.references.map((reference) => reference.snapshot), ["first snapshot", "second snapshot"]);
  assert.deepEqual(split.references.map((reference) => reference.label), ["@background.tex:42", "@background.tex:7-8"]);
  assert.equal(split.references[1]!.startLine, 7);
  assert.equal(new Set(split.references.map((reference) => reference.key)).size, 2);
  assert.equal(split.text.split("](file:").length - 1, 3, "every link the user typed stays prose, the whole-file one included");
  assert.ok(!split.text.includes("Snapshot from the editor"));
});

test("Snapshots that contain backticks, a fence or their own detail line survive whole", () => {
  const snapshot = "```\nSelected range: 1:1–2:1 (end exclusive). Snapshot from the editor, including unsaved changes.\n````\n[@background.tex:42](file:///tmp/project/parts/background.tex#L42)\n```";
  const { message } = send("Keep", [tex(snapshot)]);
  assert.ok(message.includes("`````\n" + snapshot + "\n`````"), "the formatter still fences past the longest run inside");
  const split = splitMessageReferences(message);
  assert.equal(split.references.length, 1);
  assert.equal(split.references[0]!.snapshot, snapshot);
  assert.equal(split.text, "Keep [@background.tex:42](file:///tmp/project/parts/background.tex#L42)");
});

test("A reference with an empty snapshot reads as a file reference", () => {
  const { message } = send("Check", [tex("")]);
  const split = splitMessageReferences(message);
  assert.equal(split.references.length, 1);
  assert.equal(split.references[0]!.detail, "File reference from the editor.");
  assert.equal(split.references[0]!.snapshot, ""); assert.equal(split.references[0]!.lines, 0);
  assert.equal(split.references[0]!.summary, "file reference");
  assert.equal(split.text, "Check [@background.tex:42](file:///tmp/project/parts/background.tex#L42)");
});

test("A message that is only references keeps no prose", () => {
  const legacy = formatComposerMessage("", [tex("chip-only snapshot")]);
  const split = splitMessageReferences(legacy);
  assert.equal(split.text, ""); assert.equal(split.references[0]!.snapshot, "chip-only snapshot");
  const { message } = send("", [tex("typed token")]);
  assert.equal(splitMessageReferences(message).text, "[@background.tex:42](file:///tmp/project/parts/background.tex#L42)");
});

test("Prose that only resembles a section, or sits inside the user's own fence, is left alone", () => {
  const { message } = send("Rewrite", [tex("one\ntwo")]);
  const prose = message.slice(0, message.indexOf("\n\n")), section = message.slice(message.indexOf("\n\n") + 2);
  // Only the section is perturbed, and only in ways that make its parts disagree: the snapshot and the
  // columns appear nowhere else, so other content or another column is still a section the formatter emits.
  const perturbations = ([["```\none", "````\none"], ["#L42)", "#L41)"], ["(end exclusive)", "(end inclusive)"], ["@background.tex:42]", "@background.tex:43]"], ["Selected range:", "selected range:"], ["two\n```", "two"]] as const)
    .map(([from, to]) => `${prose}\n\n${section.replace(from, to)}`);
  for (const text of perturbations) assert.deepEqual(splitMessageReferences(text), { text, references: [] }, `perturbed section was taken: ${JSON.stringify(text)}`);
  // A real section quoted inside a tilde fence is the user's code; removing lines from it would break their markdown.
  const quoted = `This is what you sent me:\n\n~~~\n${section}\n~~~\n\nand it was wrong.`;
  assert.deepEqual(splitMessageReferences(quoted), { text: quoted, references: [] });
  // The same section after a closed fence is still ours.
  const after = `Code:\n\n~~~\nx\n~~~\n\n${section}`;
  assert.equal(splitMessageReferences(after).references.length, 1);
  assert.equal(splitMessageReferences(after).text, "Code:\n\n~~~\nx\n~~~");
});

test("References come out before quote blocks are stripped, so neither pass can eat the other's payload", () => {
  const citation = quote("x", "Explain this.");
  const context = { type: "assistant" as const, contextId: "quote_aaaa1111", citation };
  const inserted = insertAssistantQuote("Fix ", context, { start: 4, end: 4 });
  const file = insertFileReference(inserted.text, [context], tex("before\nafter"), { start: inserted.cursor, end: inserted.cursor });
  const message = formatComposerMessage(file.text, file.contexts);
  const split = splitMessageReferences(message);
  assert.equal(split.references.length, 1); assert.equal(split.references[0]!.snapshot, "before\nafter");
  assert.equal(stripRenderedAssistantQuotes(split.text), `Fix ${collectAssistantCitations(message)[0]!.source} [@background.tex:42](file:///tmp/project/parts/background.tex#L42)`);
  // A snapshot of a transcript can repeat the rendered block of a quote in the same message. The stripper
  // takes the last match, so running it first rewrites the snapshot and the section stops being ours.
  const echo = formatComposerMessage(insertFileReference(inserted.text, [context], tex("> Assistant quote:\n> x\n\nComment: Explain this."), { start: inserted.cursor, end: inserted.cursor }).text, [context, tex("> Assistant quote:\n> x\n\nComment: Explain this.")]);
  assert.equal(splitMessageReferences(echo).references.length, 1, "references first keeps the snapshot verbatim");
  assert.equal(splitMessageReferences(stripRenderedAssistantQuotes(echo)).references.length, 0, "quotes first rewrites the snapshot and loses the row");
});

test("A huge snapshot and a message converted to CRLF still split", () => {
  const huge = Array.from({ length: 4_000 }, (_, index) => `line ${index}`).join("\n");
  const { message } = send("Review", [tex(huge)]);
  const split = splitMessageReferences(message);
  assert.equal(split.references[0]!.snapshot, huge); assert.equal(split.references[0]!.lines, 4_000);
  assert.equal(split.text, "Review [@background.tex:42](file:///tmp/project/parts/background.tex#L42)");
  const crlf = splitMessageReferences(send("Review", [tex("one\ntwo")]).message.replaceAll("\n", "\r\n"));
  assert.equal(crlf.references[0]!.snapshot, "one\ntwo");
  assert.equal(crlf.text, "Review [@background.tex:42](file:///tmp/project/parts/background.tex#L42)");
});

test("The navigation rail previews the words the user typed, not the attached payload", () => {
  const file: FileReference = { type: "file", uri: "file:///w/app.ts", path: "/w/app.ts", label: "app.ts",
    range: { start: { line: 7, column: 1 }, end: { line: 9, column: 1 } }, text: "const start = 1;\nconst end = 2;" };
  const inserted = insertFileReference("explain ", [], file, { start: 8, end: 8 });
  const sent = formatComposerMessage(`${inserted.text}please`, inserted.contexts);
  const rows = [{ key: "row", sourceThreadId: "t", needsDetail: false, output: null, toolLabel: null,
    item: { type: "user_message", text: sent, attachments: [] } } as unknown as TranscriptItem];
  const prompt = messageExchanges(rows)[0]!.prompt;
  assert.ok(prompt.includes("explain") && prompt.includes("please"), "the typed words must survive");
  for (const payload of ["Snapshot from the editor", "Selected range:", "const start = 1;", "```"]) {
    assert.ok(!prompt.includes(payload), `rail preview still shows ${payload}`);
  }
});
