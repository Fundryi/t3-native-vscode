import assert from "node:assert/strict";
import { test } from "node:test";
import type { TranscriptItem, WireTurnItem } from "../bridge.js";
import { runningStepLabels } from "./latest.js";

const row = (key: string, type: string, fields: Record<string, unknown> = {}): TranscriptItem => ({ key, sourceThreadId: "thread", toolLabel: null, output: null, needsDetail: false,
  item: { id: key, type, status: "completed", text: key, attachments: [], ...fields } as unknown as WireTurnItem });

test("latest: each work group names its newest running step, finished groups and messages none", () => {
  const labels = runningStepLabels([
    row("prompt", "user_message"),
    row("done", "command_execution", { input: "ls" }),
    row("answer", "assistant_message"),
    row("thought", "reasoning", { status: "running" }),
    row("build", "command_execution", { status: "running", input: "pnpm run build\n--verbose" }),
    row("edit", "file_change", { status: "pending", fileName: "a.ts" }),
    row("after", "assistant_message"),
    row("tool", "dynamic_tool", { status: "running", toolName: "mcp.search" }),
  ]);
  assert.deepEqual([...labels], [["thought", "Editing a.ts"], ["tool", "mcp.search"]]);
  assert.equal(runningStepLabels([row("cmd", "command_execution", { status: "running", input: "npm test\nmore" })]).get("cmd"), "npm test");
});
