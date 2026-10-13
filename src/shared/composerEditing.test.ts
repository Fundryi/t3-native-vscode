import assert from "node:assert/strict";
import test from "node:test";
import { changesListStructure, textReplacement, renumberMarkdownList, wrapMarkdownSelection, continueMarkdownList, formatMarkdown, indentMarkdown, protectMarkdownSelection, type MarkdownEdit } from "./composerEditing.js";

const cursor = (text: string) => ({ start: text.length, end: text.length });
const apply = (text: string, edit: MarkdownEdit | null) => { assert.ok(edit); return text.slice(0, edit.start) + edit.text + text.slice(edit.end); };

test("Newline continues ordered, bulleted and task lists without changing existing source", () => {
  for (const [text, expected] of [["9. ninth", "9. ninth\n10. "], ["2) second", "2) second\n3) "], ["  * nested", "  * nested\n  * "], ["- [x] done", "- [x] done\n- [ ] "], ["+ item", "+ item\n+ "]]) {
    assert.equal(apply(text!, continueMarkdownList(text!, cursor(text!))), expected);
  }
  assert.equal(apply("1. first\n2. ", continueMarkdownList("1. first\n2. ", { start: 12, end: 12 })), "1. first\n");
});

test("List assistance ignores prose, escaped markers, quotes, thematic breaks and code fences", () => {
  for (const text of ["plain", "\\1. literal", "> 1. quoted example", "---", "- - -", "```python\n1. literal", "~~~~\n1. literal", "````\n```\n1. literal"]) {
    assert.equal(continueMarkdownList(text, cursor(text)), null, text);
  }
  const closed = "```\n1. literal\n```\n1. real";
  assert.equal(apply(closed, continueMarkdownList(closed, cursor(closed))), closed + "\n2. ");
});

test("List continuation splits a line or replaces selected text without losing its suffix", () => {
  assert.equal(apply("1. first second", continueMarkdownList("1. first second", { start: 8, end: 9 })), "1. first\n2. second");
  assert.equal(continueMarkdownList("1. item", { start: 1, end: 1 }), null);
});

test("Indent/outdent uses the parent marker width, retains selection and excludes the next unselected line", () => {
  const source = "100. parent\n101. child\nlast";
  const edit = indentMarkdown(source, { start: 12, end: 21 });
  const indented = apply(source, edit);
  assert.equal(indented, "100. parent\n     101. child\nlast");
  assert.equal(apply(indented, indentMarkdown(indented, edit!.selection, true)), source);
  const selected = "one\ntwo\nthree";
  assert.equal(apply(selected, indentMarkdown(selected, { start: 0, end: 8 })), "    one\n    two\nthree");
});

test("Tab leaves plain-text focus traversal available and supports code indentation", () => {
  assert.equal(indentMarkdown("plain text", { start: 3, end: 3 }), null);
  const code = "```ts\nconst x = 1;";
  assert.equal(apply(code, indentMarkdown(code, cursor(code))), "```ts\n    const x = 1;");
  assert.equal(apply("\ntext", indentMarkdown("\ntext", { start: 0, end: 0 }, false, true)), "    \ntext");
});

test("Inline formatting and links remain editable Markdown, including embedded backticks", () => {
  assert.equal(apply("hello", formatMarkdown("hello", { start: 0, end: 5 }, "bold")), "**hello**");
  assert.equal(apply("**hello**", formatMarkdown("**hello**", { start: 2, end: 7 }, "bold")), "hello");
  assert.equal(apply("a`b", formatMarkdown("a`b", { start: 0, end: 3 }, "code")), "``a`b``");
  const link = formatMarkdown("paper", { start: 0, end: 5 }, "link");
  const text = apply("paper", link);
  assert.equal(text, "[paper](url)"); assert.equal(text.slice(link.selection.start, link.selection.end), "url");
  const fenced = formatMarkdown("a```b", { start: 0, end: 5 }, "fence");
  assert.equal(apply("a```b", fenced), "````\na```b\n````");
});

test("Formatting expands partial reference selections and moves an empty caret outside tokens", () => {
  const source = "before [image](t3-context:test) after", reference = { start: 7, end: 31 };
  assert.deepEqual(protectMarkdownSelection(source, { start: 10, end: 17 }, [reference]), reference);
  assert.deepEqual(protectMarkdownSelection(source, { start: 15, end: 15 }, [reference]), { start: 31, end: 31 });
  assert.equal(apply(source, formatMarkdown(source, reference, "bold")), "before **[image](t3-context:test)** after");
});


test("Selections wrap with explicit pairs while punctuation and unselected typing remain literal", () => {
  for (const [open, close] of [["\"", "\""], ["'", "'"], ["`", "`"], ["$", "$"], ["(", ")"], ["[", "]"], ["{", "}"]]) {
    assert.equal(apply("term", wrapMarkdownSelection("term", { start: 0, end: 4 }, open!)), `${open}term${close}`);
  }
  for (const char of [":", ";", "x"]) assert.equal(wrapMarkdownSelection("term", { start: 0, end: 4 }, char), null);
  assert.equal(wrapMarkdownSelection("term", { start: 4, end: 4 }, "$"), null);
  assert.equal(apply("term", formatMarkdown("term", { start: 0, end: 4 }, "underline")), "<u>term</u>");
});

test("Numbering repairs nested sequences after structural edits, retaining starting values and prose", () => {
  const text = "Intro\n4. first\n5. inserted\n5. second\n   7) child\n   7) child two\n6. third\n\nSeparate prose";
  assert.equal(apply(text, renumberMarkdownList(text, { start: 25, end: 25 })), "Intro\n4. first\n5. inserted\n6. second\n   7) child\n   8) child two\n7. third\n\nSeparate prose");
  assert.equal(renumberMarkdownList("```\n1. a\n1. b\n```", { start: 10, end: 10 }), null);
  assert.equal(renumberMarkdownList("$$\n1. a\n1. b\n$$", { start: 10, end: 10 }), null);
  assert.equal(continueMarkdownList("$$\n1. math", cursor("$$\n1. math")), null);
  assert.equal(changesListStructure("1. a", "1. a\n2. b", "insertFromPaste"), false);
  assert.equal(changesListStructure("1. a\n2. b", "1. a", "historyUndo"), false);
  assert.equal(changesListStructure("1. a\n2. b", "1. a2. b", "deleteContentBackward"), true);
  assert.equal(changesListStructure("1. a", "1. ab", "insertText"), false);
});

test("A text replacement is the shortest edit between two values, on whole characters", () => {
  const applied = (before: string, after: string) => { const edit = textReplacement(before, after); return before.slice(0, edit.start) + edit.text + before.slice(edit.end); };
  const cases: Array<[string, string, { start: number; end: number; text: string }]> = [
    // Replacement in the middle, as a rewritten quote label.
    ["Before [\u275d1 Explain this](token) after.", "Before [\u275d1 Updated comment](token) after.", { start: 11, end: 23, text: "Updated comment" }],
    // Pure insertion at a caret, as a pasted reference.
    ["Compare here then explain.", "Compare here![image](uri) then explain.", { start: 12, end: 12, text: "![image](uri)" }],
    // Pure deletion, as a removed reference.
    ["Before [quote](token) after.", "Before  after.", { start: 7, end: 21, text: "" }],
    ["head and tail", "new and tail", { start: 0, end: 4, text: "new" }],
    ["head and tail", "head and new", { start: 9, end: 13, text: "new" }],
    ["everything goes", "", { start: 0, end: 15, text: "" }],
    ["", "everything arrives", { start: 0, end: 0, text: "everything arrives" }],
    ["unchanged", "unchanged", { start: 9, end: 9, text: "" }],
    // Repeated text: the prefix and suffix may not overlap, or the edit would delete what it also keeps.
    ["ab", "aab", { start: 1, end: 1, text: "a" }],
    ["aaa", "aa", { start: 2, end: 3, text: "" }],
  ];
  for (const [before, after, expected] of cases) {
    assert.deepEqual(textReplacement(before, after), expected, `${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
    assert.equal(applied(before, after), after);
  }
  // Astral characters: an edit must never land between the halves of a surrogate pair.
  for (const [before, after] of [["a\u{1f600}b", "a\u{1f601}b"], ["\u{1f600}tail", "\u{1f601}tail"], ["head\u{1f600}", "head\u{1f601}"], ["\u{1f600}\u{1f600}", "\u{1f600}\u{1f601}"], ["a\u{1f600}b", "ab"], ["ab", "a\u{1f600}b"]]) {
    const edit = textReplacement(before!, after!);
    assert.equal(applied(before!, after!), after, `${before} -> ${after}`);
    for (const boundary of [edit.start, edit.end]) assert.ok(!lowSurrogateAt(before!, boundary), `${before} -> ${after} splits a pair at ${boundary}`);
    assert.ok(!/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(edit.text), "the replacement itself holds whole characters");
  }
});
const lowSurrogateAt = (value: string, position: number) => { const code = value.charCodeAt(position); return code >= 0xdc00 && code <= 0xdfff; };
