// R12: pairing falls back to the T3 desktop app's launcher in <home>/bin when `t3` is not on PATH.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PairingError, runPairingCommand, type PairingCommandRuntime } from "../pairing.js";

const enoent = () => Object.assign(new Error("spawn t3 ENOENT"), { code: "ENOENT" });

function runtime(launcherFails = false) {
  const resolved: string[] = [];
  const value: PairingCommandRuntime = {
    resolve: (command, args) => { resolved.push(command); return { command, args: [...args], shell: false }; },
    shell: async () => { throw new Error("not used"); },
    direct: async (command) => {
      if (command === "t3") throw enoent();
      if (launcherFails) throw Object.assign(new Error("Command failed"), { code: 1, stderr: "Fixture server unavailable" });
      return { stdout: "Token: 23456789ABCD\n" };
    },
  };
  return { resolved, value };
}

test("Pairing without t3 on PATH uses <home>/bin launcher once, and keeps cli-missing when there is none", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "t3-r12-"));
  t.after(() => rm(home, { recursive: true, force: true }));

  const none = runtime();
  await assert.rejects(runPairingCommand(home, none.value), (error: unknown) => error instanceof PairingError && error.kind === "cli-missing");
  assert.deepEqual(none.resolved, ["t3"]);

  const launcher = join(home, "bin", process.platform === "win32" ? "t3.cmd" : "t3");
  await mkdir(join(home, "bin"));
  await writeFile(launcher, "");
  const found = runtime();
  assert.match(await runPairingCommand(home, found.value), /Token: 23456789ABCD/);
  assert.deepEqual(found.resolved, ["t3", launcher]);

  const broken = runtime(true);
  await assert.rejects(runPairingCommand(home, broken.value),
    (error: unknown) => error instanceof PairingError && error.kind === "pairing" && error.message.includes("Fixture server unavailable"));
  assert.deepEqual(broken.resolved, ["t3", launcher]);
});
