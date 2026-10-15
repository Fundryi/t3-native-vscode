import test from "node:test";
import assert from "node:assert/strict";
import { claudeListed, claudeOpen, claudeSlug, codexListed, codexNames, codexPrompt, importThreadId, isUuid, maybeLive, pathKey, readClaude, readCodexMeta } from "./importChatParse.js";

const line = (value: unknown) => JSON.stringify(value);

test("Claude: slug, the first entrypoint and cwd, and the newest title", () => {
  assert.equal(claudeSlug("d:\\GIT\\t3-native-vscode"), "d--GIT-t3-native-vscode");
  const head = [
    line({ type: "queue-operation" }), "{broken",
    line({ type: "user", entrypoint: "claude-vscode", cwd: "d:\\GIT\\x", isMeta: true, message: { content: "<command-name>skill</command-name>" } }),
    line({ type: "user", entrypoint: "sdk-ts", message: { content: [{ type: "tool_result", content: "x" }] } }),
    line({ type: "user", message: { content: [{ type: "text", text: "<ide_selection>a</ide_selection>" }, { type: "text", text: " Fix   the\nbug " }] } }),
  ];
  assert.deepEqual(readClaude(head, []), { entrypoint: "claude-vscode", cwd: "d:\\GIT\\x", title: "Fix the bug" });
  const tail = [line({ type: "ai-title", aiTitle: "Old" }), line({ type: "ai-title", aiTitle: "New" }), "partial{"];
  assert.equal(readClaude(head, tail).title, "New");
  assert.equal(readClaude(head, [...tail, line({ type: "custom-title", customTitle: "Mine" })]).title, "Mine");
  // T3 starts its Claude chats through the SDK: those are already T3 threads.
  assert.equal(claudeListed(readClaude([line({ entrypoint: "sdk-ts" })], [])), false);
  assert.equal(claudeListed(readClaude([line({ entrypoint: "cli" })], [])), true);
  assert.equal(claudeListed(readClaude([], [])), true);
});

test("Codex: session_meta, which chats are listed, names and prompts", () => {
  const meta = (originator: string, source: unknown) => readCodexMeta(line({ type: "session_meta", payload: { id: "01a1", cwd: "D:\\GIT\\x", originator, source } }))!;
  assert.deepEqual(meta("Codex Desktop", "vscode"), { id: "01a1", cwd: "D:\\GIT\\x", originator: "Codex Desktop", source: "vscode" });
  assert.equal(readCodexMeta(line({ type: "response_item", payload: { id: "x", cwd: "y" } })), undefined);
  assert.equal(readCodexMeta("{"), undefined);
  assert.equal(codexListed(meta("codex_vscode", "vscode")), true);
  assert.equal(codexListed(meta("codex-tui", "cli")), true);
  assert.equal(codexListed(meta("T3 Code", "vscode")), false);
  assert.equal(codexListed(meta("Claude Code", "vscode")), false);
  assert.equal(codexListed(meta("codex_exec", "exec")), false);
  assert.equal(codexListed(meta("codex-tui", { subagent: {} })), false);
  assert.deepEqual([...codexNames([line({ id: "a", thread_name: "One" }), "", line({ id: "a", thread_name: "Two" }), line({ id: "b" })].join("\n"))], [["a", "Two"]]);
  const user = (text: string) => line({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text }] } });
  assert.equal(codexPrompt([user("# AGENTS.md instructions"), user("<environment_context>x</environment_context>"), user("Add a test")]), "Add a test");
});

test("Paths, ids and the running guess", () => {
  assert.equal(pathKey("D:\\GIT\\x\\", true), pathKey("d:/GIT/x", true));
  assert.notEqual(pathKey("/home/a/X", false), pathKey("/home/a/x", false));
  const id = importThreadId("codex", "01a1");
  assert.equal(id, importThreadId("codex", "01a1"));
  assert.notEqual(id, importThreadId("claudeAgent", "01a1"));
  assert.ok(isUuid(id), id);
  assert.equal(isUuid("../x"), false);
  assert.equal(maybeLive(1_000, 1_000 + 30_000), true);
  assert.equal(maybeLive(1_000, 1_000 + 10 * 60_000), false);
  assert.equal(maybeLive(1_000, 1_000 + 10 * 60_000, true), true);
  // Claude Code's sessions/<pid>.json: open only while that pid lives.
  const sid = "11111111-2222-4333-8444-555555555555", alive = (pid: number) => pid === 4242;
  const file = (sessionId: string, pid: unknown) => line({ pid, sessionId, cwd: "/x", kind: "interactive" });
  assert.equal(claudeOpen([file("aaaaaaaa-2222-4333-8444-555555555555", 4242), file(sid, 4242)], sid, alive), true);
  assert.equal(claudeOpen([file(sid, 7)], sid, alive), false); // stale file, Claude gone
  assert.equal(claudeOpen([file("aaaaaaaa-2222-4333-8444-555555555555", 4242)], sid, alive), false);
  assert.equal(claudeOpen([file(sid, "4242"), file(sid, 0), "{broken", ""], sid, () => true), false);
});
