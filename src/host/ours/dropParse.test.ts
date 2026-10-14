import test from "node:test";
import assert from "node:assert/strict";
import { MAX_DROP_ITEMS, parseDrop } from "./dropParse.js";

test("A drop keeps file uris and drive paths, the uri list first", () => {
  const list = "# comment\r\nfile:///d%3A/work/README.md\r\nvscode-remote://ssh/x.ts\r\n\r\nFILE:///home/a/b.png\n";
  assert.deepEqual(parseDrop(list, "C:\\ignored.txt"), ["file:///d%3A/work/README.md", "FILE:///home/a/b.png"]);
  assert.deepEqual(parseDrop("  \n", " D:\\work\\a.ts \nsome words\nd:/work/b.png\n/home/a.ts"), ["D:\\work\\a.ts", "d:/work/b.png"]);
  assert.deepEqual(parseDrop("", "plain text"), []);
});

test("A drop is capped at 50 items and skips overlong lines", () => {
  const many = Array.from({ length: 60 }, (_, index) => `C:\\f${index}.txt`).join("\n");
  assert.equal(parseDrop("", many).length, MAX_DROP_ITEMS);
  assert.deepEqual(parseDrop(`file:///${"a".repeat(2001)}\nfile:///b`, ""), ["file:///b"]);
});
