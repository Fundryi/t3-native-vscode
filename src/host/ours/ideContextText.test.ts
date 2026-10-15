import test from "node:test";
import assert from "node:assert/strict";
import { splitMessageReferences } from "../../shared/messageReferences.js";
import { ideChipLabel, ideReference, MAX_SNAPSHOT, withIdeReference } from "./ideContextText.js";

const base = { type: "file" as const, uri: "file:///repo/src/a.ts", path: "/repo/src/a.ts", label: "src/a.ts" };
const selection = { ...base, range: { start: { line: 12, column: 1 }, end: { line: 21, column: 1 } }, text: "line 12\nline 20\n" };
const link = "file:///repo/src/a.ts";

test("A selection goes as a reference card the transcript splits off again", () => {
  const split = splitMessageReferences(withIdeReference("why does this fail?", ideReference(selection)));
  assert.equal(split.text, "why does this fail?");
  assert.equal(split.references.length, 1);
  assert.equal(split.references[0]!.href, `${link}#L12-L20`);
  assert.equal(ideChipLabel(ideReference(selection)), "IDE: a.ts:12-20");
});

test("No selection sends the file alone; a huge selection keeps only its lines", () => {
  const cursor = ideReference({ ...selection, text: "" });
  assert.equal(cursor.range, undefined);
  assert.equal(withIdeReference("hi", cursor), `hi\n\n[@src/a.ts](${link})`);
  assert.equal(ideChipLabel(cursor), "IDE: a.ts");
  const big = ideReference({ ...selection, text: "x".repeat(MAX_SNAPSHOT + 1) });
  assert.equal(big.text, "");
  assert.ok(withIdeReference("hi", big).endsWith(`${link}#L12-L20)\nFile reference from the editor.`));
});

test("Slash commands and prompts that already link or name the file stay as they are", () => {
  const ref = ideReference(selection);
  assert.equal(withIdeReference("  /compact", ref), "  /compact");
  const linked = withIdeReference("see", ref);
  assert.equal(withIdeReference(linked, ref), linked);
  assert.equal(withIdeReference("fix src/a.ts", ideReference(base)), "fix src/a.ts");
  assert.notEqual(withIdeReference("fix src/a.ts", ref), "fix src/a.ts");
  const other = `[@x](${link}x)`; // a.tsx is another file
  assert.notEqual(withIdeReference(other, ref), other);
  assert.ok(withIdeReference("", ref).startsWith("[@src/a.ts:12-20]"));
});
