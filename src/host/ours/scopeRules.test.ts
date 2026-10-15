import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extraRoots, mainCheckout } from "./scopeRules.js";

test("mainCheckout names the main checkout of a worktree folder and its subfolders, null otherwise", () => {
  const base = mkdtempSync(join(tmpdir(), "t3-scope-"));
  const main = join(base, "repo"), tree = join(base, "wt"), plain = join(base, "plain");
  mkdirSync(join(main, ".git", "worktrees", "wt"), { recursive: true });
  mkdirSync(join(tree, "src"), { recursive: true });
  mkdirSync(join(plain, ".git"), { recursive: true });
  writeFileSync(join(tree, ".git"), `gitdir: ${join(main, ".git", "worktrees", "wt")}\n`);
  const expected = main.replace(/\\/g, "/");
  assert.equal(mainCheckout(tree), expected);
  assert.equal(mainCheckout(join(tree, "src")), expected);
  assert.equal(mainCheckout(plain), null);
  assert.equal(mainCheckout(main), null);
});

test("extraRoots adds the main checkout, a worktree chat's project and the deepest containing project, once each", () => {
  const projects = [{ id: "p1", workspaceRoot: "/git/repo" }, { id: "p2", workspaceRoot: "/git" }, { id: "p3", workspaceRoot: "/git/repo2" },
    { id: "p4", workspaceRoot: "/other" }];
  const threads = [{ projectId: "p4", worktreePath: "/t3/worktrees/x" }, { projectId: "p3", worktreePath: null }];
  const mains: Record<string, string> = { "/t3/worktrees/x": "/git/repo" };
  assert.deepEqual(extraRoots(["/t3/worktrees/x", "/git/repo/src"], projects, threads, (f) => mains[f] ?? null), ["/git/repo", "/other"]);
  // Directory boundary: /git/repo2x is not inside /git/repo2; /git holds it.
  assert.deepEqual(extraRoots(["/git/repo2x"], projects, [], () => null), ["/git"]);
  // A window folder that is a project root adds nothing.
  assert.deepEqual(extraRoots(["/git/repo"], projects, [], () => null), []);
});
