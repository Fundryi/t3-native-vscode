import assert from "node:assert/strict";
import { test } from "node:test";
import { firstChangedLine } from "./openline.js";

test("openline: first changed line skips the hunk's context, new and deleted files land on 1, no hunk gives none", () => {
  assert.equal(firstChangedLine("@@ -1,2 +1,3 @@\n-const thread = oldThread;\n+const thread = createdThread;"), 1);
  assert.equal(firstChangedLine("--- a/x\n+++ b/x\n@@ -10,7 +12,8 @@ function f() {\n a\n b\n\n+added\n c"), 15);
  assert.equal(firstChangedLine("@@ -4 +4 @@\r\n ctx\r\n\\ No newline at end of file\r\n-old"), 5);
  assert.equal(firstChangedLine("@@ -0,0 +1,2 @@\n+a\n+b"), 1);
  assert.equal(firstChangedLine("@@ -1,2 +0,0 @@\n-a\n-b"), 1);
  assert.equal(firstChangedLine("-old\n+new"), undefined);
});
