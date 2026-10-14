import assert from "node:assert/strict";
import { test } from "node:test";
import { revertAction } from "./diffsRevert.js";

const base = { before: "a\n", after: "b\n", oldPath: "x.ts", newPath: "x.ts", changeType: "change", current: "b\n", dirty: false };

test("diffs: revert writes the before text only while the file still matches the turn", () => {
  assert.deepEqual(revertAction(base), { kind: "write", text: "a\n" });
  assert.deepEqual(revertAction({ ...base, current: "b\r\n" }), { kind: "write", text: "a\n" }); // CRLF checkout
  assert.equal(revertAction({ ...base, current: "c\n" }).kind, "refuse");
  assert.equal(revertAction({ ...base, dirty: true }).kind, "refuse");
  assert.equal(revertAction({ ...base, newPath: "y.ts" }).kind, "refuse");
  assert.equal(revertAction({ ...base, current: undefined }).kind, "refuse");
});

test("diffs: a created file is deleted, a deleted file comes back", () => {
  assert.deepEqual(revertAction({ ...base, before: "", changeType: "new" }), { kind: "delete" });
  assert.deepEqual(revertAction({ ...base, changeType: "deleted", after: "", current: undefined }), { kind: "create", text: "a\n" });
  assert.equal(revertAction({ ...base, changeType: "deleted", after: "", current: "new text" }).kind, "refuse");
});
