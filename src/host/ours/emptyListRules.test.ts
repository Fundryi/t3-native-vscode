import test from "node:test";
import assert from "node:assert/strict";
import { otherChats } from "./emptyListRules.js";

const thread = (id: string, projectId: string, fields: Record<string, unknown> = {}) =>
  ({ id, projectId, archivedAt: null, deletedAt: null, lineage: { relationshipToParent: null }, ...fields });

test("other-folder chats skip visible projects, archived, deleted and subagent threads", () => {
  const threads = [
    thread("here", "p1"), thread("there", "p2"), thread("fork", "p2", { lineage: { relationshipToParent: "fork" } }),
    thread("archived", "p2", { archivedAt: "x" }), thread("deleted", "p2", { deletedAt: "x" }),
    thread("sub", "p2", { lineage: { relationshipToParent: "subagent" } }),
  ];
  assert.deepEqual(otherChats(threads, new Set(["p1"])).map((item) => item.id), ["there", "fork"]);
  assert.deepEqual(otherChats(threads, new Set(["p1", "p2"])), []);
});
