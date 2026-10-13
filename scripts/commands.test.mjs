/** Every contributed command must be registered, or it appears in the palette and fails when chosen. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
const source = await readFile(new URL("src/extension.ts", root), "utf8");

test("Contributed commands are registered, including the usage refresh", () => {
  const declared = manifest.contributes.commands.map((command) => command.command);
  const registered = [...source.matchAll(/registerCommand\("([^"]+)"/g)].map((match) => match[1]);
  // Only this direction is a defect: a command invoked in code need not be in the palette, but a
  // palette entry with no handler fails when chosen.
  for (const command of declared) assert.ok(registered.includes(command), `${command} is in the palette but never registered`);
  // Refreshing the meters is distinct from choosing which account the status bar shows.
  assert.ok(declared.includes("t3-vscode.refreshUsage"));
  assert.ok(declared.includes("t3-vscode.configureUsage"));
});
