import test from "node:test";
import assert from "node:assert/strict";
import { fenced, lastCommandText, plainTerminal, todoLines } from "./promptText.js";

test("TODO lenses match comment TODOs only", () => {
  const text = ["// TODO: one", "x = 1 # FIXME two", "/* TODO three */", "<!-- FIXME four -->", " * TODO five", "-- TODO six",
    "see http://TODO.example", "x--TODO", "const TODO = 1", "TODOS // nothing"].join("\r\n");
  assert.deepEqual(todoLines(text), [0, 1, 2, 3, 4, 5]);
  assert.equal(todoLines("// TODO\n".repeat(80)).length, 50);
  assert.deepEqual(todoLines(`// TODO big\n${"x".repeat(200 * 1024)}`), []);
});

test("Terminal output loses escape sequences, and a fence outgrows backticks inside", () => {
  assert.equal(plainTerminal("\x1b]633;C\x07\x1b[31mred\x1b[0m\r\nok\x07"), "red\nok");
  assert.equal(fenced("a ``` b"), "\n````\na ``` b\n````\n");
  assert.equal(lastCommandText({ commandLine: "npm test", output: "\x1b[32mfail\x1b[0m\r\n\r\n", exitCode: 1 }), "\n```\n$ npm test\nfail\n```\nexit 1\n");
  assert.equal(lastCommandText({ commandLine: "ls", output: "", exitCode: 0 }), "\n```\n$ ls\n```\n");
  assert.equal(lastCommandText({ commandLine: "cat big", output: `head${"x".repeat(5000)}`, exitCode: null }), `\n\`\`\`\n$ cat big\n${"x".repeat(4000)}\n\`\`\`\n`);
});
