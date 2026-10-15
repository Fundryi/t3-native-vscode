import assert from "node:assert/strict";
import { test } from "node:test";
import { foreignClaudeWrite, foreignCodexWrite, uuidV7Millis } from "./oneWriterRules.js";

const since = Date.parse("2026-10-15T10:00:00Z");
const claude = (entrypoint: string, timestamp: string) => JSON.stringify({ type: "user", entrypoint, timestamp });
const turn = (turn_id: string, timestamp: string) => JSON.stringify({ timestamp, type: "turn_context", payload: { turn_id } });

test("onewriter: Claude, the newest entrypoint record decides; trailing records without one are skipped", () => {
  const tail = ['{"type":"ai-title"}', '{"type":"cost-state","sessionId":"x"}'];
  assert.equal(foreignClaudeWrite(['{"partial', claude("sdk-ts", "2026-10-15T10:05:00Z"), ...tail], since), null);
  assert.deepEqual(foreignClaudeWrite([claude("sdk-ts", "2026-10-15T10:05:00Z"), claude("claude-vscode", "2026-10-15T10:06:00Z"), ...tail], since),
    { writer: "Claude Code in VS Code", at: "2026-10-15T10:06:00Z" });
  // Used elsewhere, then continued in T3: T3 wrote last, no question.
  assert.equal(foreignClaudeWrite([claude("cli", "2026-10-15T10:06:00Z"), claude("sdk-ts", "2026-10-15T10:07:00Z")], since), null);
  // An imported chat: its own history predates T3's binding.
  assert.equal(foreignClaudeWrite([claude("claude-vscode", "2026-10-15T09:00:00Z")], since), null);
  assert.equal(foreignClaudeWrite(tail, since), undefined);
});

test("onewriter: Codex, the newest turn_context decides by its turn id; compaction is skipped", () => {
  const ours = new Set(["t3-a"]);
  assert.equal(foreignCodexWrite([turn("t3-a", "2026-10-15T10:01:00Z"), turn("auto-compact-0", "2026-10-15T10:02:00Z"), '{"type":"event_msg"}'], since, ours), null);
  assert.deepEqual(foreignCodexWrite([turn("t3-a", "2026-10-15T10:01:00Z"), turn("other", "2026-10-15T10:03:00Z")], since, ours), { writer: "Codex outside T3", at: "2026-10-15T10:03:00Z" });
  assert.equal(foreignCodexWrite([turn("before-import", "2026-10-15T09:00:00Z")], since, new Set()), null);
  assert.equal(foreignCodexWrite(['{"type":"session_meta"}'], since, ours), undefined);
});

test("onewriter: UUIDv7 creation time of a Codex thread id", () => {
  assert.equal(new Date(uuidV7Millis("019b7ca9-8c88-7abc-8def-0123456789ab")!).toISOString().slice(0, 16), "2026-01-02T03:04");
  assert.equal(uuidV7Millis("12345678-9abc-4def-8123-456789abcdef"), null);
});
