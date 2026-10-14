import test from "node:test";
import assert from "node:assert/strict";
import { parseThreadLink, threadLink } from "./linkParse.js";

test("Thread links accept only /thread/<environment>/<thread>", () => {
  assert.deepEqual(parseThreadLink("/thread/env-1/thr_A-9"), { environmentId: "env-1", threadId: "thr_A-9" });
  for (const path of ["", "/", "/thread/env", "/thread/env/id/extra", "/thread//id", "/other/env/id", "thread/env/id",
    "/thread/env/id.with.dots", "/thread/env/..", "/thread/env/a b", `/thread/env/${"a".repeat(81)}`, "/thread/env/id/"]) {
    assert.equal(parseThreadLink(path), undefined, path);
  }
});

test("A copied link parses back to the same thread", () => {
  const link = { environmentId: "env ?#%", threadId: "abc_123" };
  const uri = new URL(threadLink("vscode-insiders", "pub.ext", link));
  assert.equal(uri.protocol, "vscode-insiders:");
  // VS Code hands the handler a percent-decoded Uri.path.
  assert.deepEqual(parseThreadLink(decodeURIComponent(uri.pathname)), link);
});
