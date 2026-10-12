import assert from "node:assert/strict";
import test from "node:test";
import { codeBlockLanguage, codeBlockLayout, codeBlockSource } from "./codeBlock";

test("a fence's language comes from its language class", () => {
  assert.equal(codeBlockLanguage(["language-ts"]), "ts");
  assert.equal(codeBlockLanguage(["math-inline", "language-c++"]), "c++");
  for (const none of [undefined, "language-ts", [], ["language-"], ["lang-ts"], [3]]) assert.equal(codeBlockLanguage(none), undefined);
});
test("only the closing newline is dropped from a fence", () => {
  assert.equal(codeBlockSource("a\nb\n"), "a\nb");
  assert.equal(codeBlockSource("a\n\n"), "a\n");
  assert.equal(codeBlockSource("a\r\n"), "a\r");
  assert.equal(codeBlockSource(""), "");
  assert.equal(codeBlockSource("\n"), "");
});
test("one numbered line per logical line, blanks included", () => {
  assert.deepEqual(codeBlockLayout("a\n\nb\n", undefined), { source: "a\n\nb", lines: ["a", "", "b"], first: 1, digits: 1 });
  assert.deepEqual(codeBlockLayout("a\r\nb", undefined).lines, ["a", "b"]);
  assert.deepEqual(codeBlockLayout("", undefined).lines, [""]);
  assert.equal(codeBlockLayout("a\nb", undefined).source, "a\nb");
});
test("a snippet numbers from its real first line and the gutter fits its last", () => {
  assert.deepEqual(codeBlockLayout("a\nb\nc", 42), { source: "a\nb\nc", lines: ["a", "b", "c"], first: 42, digits: 2 });
  assert.equal(codeBlockLayout("a\nb\nc", 8).digits, 2);
  assert.equal(codeBlockLayout("a\nb\nc", 7).digits, 1);
  assert.equal(codeBlockLayout("a\nb", 99).digits, 3);
  for (const bad of [0, -3, 1.5, NaN, Infinity, 2 ** 60]) assert.equal(codeBlockLayout("a", bad).first, 1);
});
