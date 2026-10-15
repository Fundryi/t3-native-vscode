/**
 * C3 onewriter (docs/ours/CONTINUITY-SCOPE.md F4): one writer per session. Before a send on an idle Claude Code or
 * Codex chat, check the session file on disk; if another tool (the Claude Code panel or CLI, the Codex extension or
 * CLI) wrote to it after T3 took the session, ask "This chat was used elsewhere. Continue here?". Cancel keeps the
 * text in the box (the send rejects with Declined, so his composer does not clear it).
 * Wraps hostState.sendMessage (docs/ours/PORT-MAP.md 0.2). Every failure of the check sends as before.
 */
import * as vscode from "vscode";
import { DateTime } from "effect";
import { access, open, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { log } from "./log.js";
import { foreignClaudeWrite, foreignCodexWrite, uuidV7Millis, type ForeignWrite } from "./oneWriterRules.js";
import type { OursDeps, OursFeature } from "./types.js";
import { Declined, wrap } from "./wrap.js";

// shortcut: T3 may run a provider with its own homePath (CLAUDE_CONFIG_DIR / CODEX_HOME); we only see the extension
// host's env and the default home. Read T3's provider settings if the owner ever sets a homePath.
const claudeHome = () => process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
const codexHome = () => process.env.CODEX_HOME || join(homedir(), ".codex");

/** Claude: <config>/projects/<slug>/<id>.jsonl. Scans every project folder, so slug and drive-letter case never matter. */
async function claudeFile(id: string): Promise<string | undefined> {
  const projects = join(claudeHome(), "projects");
  const paths = (await readdir(projects).catch(() => [] as string[])).map((folder) => join(projects, folder, `${id}.jsonl`));
  const found = await Promise.all(paths.map((path) => access(path).then(() => true, () => false)));
  return paths.find((_, index) => found[index]);
}

/** Codex: <home>/sessions/YYYY/MM/DD/rollout-<time>-<id>.jsonl in LOCAL date folders; the id is a UUIDv7 that dates it. */
async function codexFile(id: string): Promise<string | undefined> {
  // shortcut: an id that is not a UUIDv7 (older Codex) is not looked up; walk all date folders if those matter.
  const created = uuidV7Millis(id);
  if (created === null) return undefined;
  for (const offset of [0, -1, 1]) {
    const day = new Date(created + offset * 86_400_000);
    const folder = join(codexHome(), "sessions", String(day.getFullYear()), String(day.getMonth() + 1).padStart(2, "0"), String(day.getDate()).padStart(2, "0"));
    const name = (await readdir(folder).catch(() => [] as string[])).find((file) => file.endsWith(`-${id}.jsonl`));
    if (name) return join(folder, name);
  }
  return undefined;
}

/** Reads the last 1 MiB, then the whole file if no record there decides (a long Codex turn can be bigger). */
async function decide(path: string, rule: (lines: string[]) => ForeignWrite | null | undefined): Promise<ForeignWrite | null> {
  const file = await open(path, "r");
  try {
    const size = (await file.stat()).size;
    for (const window of [1 << 20, size]) {
      const length = Math.min(window, size);
      const buffer = Buffer.alloc(length);
      await file.read(buffer, 0, length, size - length);
      const verdict = rule(buffer.toString("utf8").split("\n"));
      if (verdict !== undefined || length === size) return verdict ?? null;
    }
    return null;
  } finally { await file.close(); }
}

/** The newest foreign write on this chat's session, or null (not a Claude/Codex chat, T3 is running it, no file, T3 wrote last). */
async function foreignWrite({ client }: OursDeps, threadId: string): Promise<ForeignWrite | null> {
  const projection = await client.getThreadProjection(threadId);
  const provider = projection.providerThreads.find((thread) => thread.id === projection.thread.activeProviderThreadId);
  const nativeId = provider?.nativeThreadRef?.nativeId;
  if (!provider || !nativeId) return null;
  // A live T3 turn holds the session; queue and steer are T3 talking to itself.
  if (projection.providerTurns.some((turn) => turn.status === "running" || turn.status === "pending")) return null;
  // T3 bound the session here: anything older is the chat's history from before an import, not a second writer.
  const since = DateTime.toEpochMillis(provider.createdAt);
  if (provider.driver === "claudeAgent") {
    const path = await claudeFile(nativeId);
    return path ? decide(path, (lines) => foreignClaudeWrite(lines, since)) : null;
  }
  if (provider.driver === "codex") {
    const path = await codexFile(nativeId);
    const t3Turns = new Set(projection.providerTurns.flatMap((turn) => turn.nativeTurnRef?.nativeId ? [turn.nativeTurnRef.nativeId] : []));
    return path ? decide(path, (lines) => foreignCodexWrite(lines, since, t3Turns)) : null;
  }
  return null;
}

/** Never throws: a failed check is logged and the message goes out as before. */
async function usedElsewhere(deps: OursDeps, threadId: string): Promise<ForeignWrite | null> {
  try { return await foreignWrite(deps, threadId); }
  catch (cause) { log.error("onewriter: could not check whether this chat was used elsewhere; sending.", cause); return null; }
}

export const activateOneWriter: OursFeature = (deps) => ({ dispose: wrap(deps.hostState, "sendMessage", (original) => async (text, targetThreadId, viewId, mode, ...rest) => {
  // Only a plain send on an existing chat starts a T3 turn on the session; a new chat has no session yet.
  if (targetThreadId !== undefined && (mode ?? "auto") === "auto") {
    const foreign = await usedElsewhere(deps, targetThreadId);
    if (foreign) {
      const when = new Date(foreign.at).toLocaleString();
      const choice = await vscode.window.showWarningMessage("This chat was used elsewhere. Continue here?", {
        modal: true,
        detail: `${foreign.writer} wrote to it at ${when}, after T3's last turn. If it is still open there, close it first: two tools writing one chat can split it.`,
      }, "Continue");
      if (choice !== "Continue") throw new Declined("Not sent: this chat was used elsewhere. Your message is still in the box.");
      log.info(`onewriter: sending on ${targetThreadId} after a write by ${foreign.writer} at ${foreign.at} (the owner chose Continue)`);
    }
  }
  return original(text, targetThreadId, viewId, mode, ...rest);
}) });
