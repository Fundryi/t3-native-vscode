/** C2 importchat: find this folder's Claude Code and Codex chats on disk (read only). No vscode import, so a script can run it. */
import { open, readFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { claudeListed, claudeOpen, claudeSlug, codexListed, codexNames, codexPrompt, isUuid, pathKey, readClaude, readCodexMeta, type Driver } from "./importChatParse.js";

const MAX_CHATS = 50;
const CODEX_DAYS = 30; // as T3's own scanner (AgentSessionScanner.ts)
export interface Chat { readonly driver: Driver; readonly nativeId: string; readonly root: string; readonly file: string; readonly title: string; readonly modifiedMs: number }

// shortcut: the extension host's env, not T3's provider homePath (empty on the owner's PC, fact 8); read homePath if one is ever set.
export const claudeHome = () => process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
export const codexHome = () => process.env.CODEX_HOME || join(homedir(), ".codex");

/** Whole lines from the start (head) or the end (tail) of a file, never more than `bytes`. */
async function lines(file: string, bytes: number, from: "head" | "tail"): Promise<string[]> {
  const handle = await open(file, "r");
  try {
    const size = (await handle.stat()).size, length = Math.min(size, bytes), start = from === "head" ? 0 : size - length;
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, start);
    const parts = buffer.toString("utf8").split("\n");
    if (from === "head" && length < size) parts.pop(); // cut line
    if (from === "tail" && start > 0) parts.shift();
    return parts;
  } finally { await handle.close(); }
}
// A file that vanished or is locked (another process writes it) is left out, never fails the whole list.
const newest = async (files: string[]) => (await Promise.all(files.map(async (file) => ({ file, modifiedMs: (await stat(file).catch(() => undefined))?.mtimeMs ?? -1 }))))
  .filter((item) => item.modifiedMs >= 0).sort((a, b) => b.modifiedMs - a.modifiedMs);
const safeLines = (file: string, bytes: number, from: "head" | "tail") => lines(file, bytes, from).catch(() => [] as string[]);

export async function claudeChats(root: string): Promise<Chat[]> {
  const folder = join(claudeHome(), "projects", claudeSlug(root)); // NTFS: d--GIT-x and D--GIT-x are one folder
  const names = await readdir(folder).catch(() => [] as string[]);
  const files = await newest(names.filter((name) => name.endsWith(".jsonl") && isUuid(name.slice(0, -6))).map((name) => join(folder, name)));
  const chats: Chat[] = [];
  for (const { file, modifiedMs } of files) {
    if (chats.length >= MAX_CHATS) break;
    const session = readClaude(await safeLines(file, 256 * 1024, "head"), await safeLines(file, 64 * 1024, "tail"));
    // The slug folds characters, so check the folder the chat really started in when the file says.
    if (!claudeListed(session) || (session.cwd && pathKey(session.cwd) !== pathKey(root))) continue;
    chats.push({ driver: "claudeAgent", nativeId: basename(file, ".jsonl"), root, file, title: session.title ?? "Untitled", modifiedMs });
  }
  return chats;
}

/** Whether a Claude Code process has this chat open now (its sessions/<pid>.json, with that pid alive). */
export async function claudeRunning(sessionId: string): Promise<boolean> {
  const folder = join(claudeHome(), "sessions"); // also holds <pid>.<hash>.key files: not read
  const names = (await readdir(folder).catch(() => [] as string[])).filter((name) => name.endsWith(".json"));
  const files = await Promise.all(names.map((name) => readFile(join(folder, name), "utf8").catch(() => ""))); // removed on exit meanwhile
  return claudeOpen(files, sessionId, pidAlive);
}
/** Signal 0 only tests the pid (Windows too). EPERM: it lives but is not ours to signal (an elevated Claude). */
const pidAlive = (pid: number): boolean => {
  try { process.kill(pid, 0); return true; } catch (cause) { return (cause as NodeJS.ErrnoException).code === "EPERM"; }
};

/** Rollouts of the last CODEX_DAYS days, from the sessions/YYYY/MM/DD folders. */
async function codexFiles(): Promise<string[]> {
  const base = join(codexHome(), "sessions"), since = new Date(Date.now() - CODEX_DAYS * 86_400_000).toISOString().slice(0, 10);
  const list = (path: string) => readdir(path).catch(() => [] as string[]);
  const files: string[] = [];
  for (const year of await list(base)) for (const month of await list(join(base, year))) for (const day of await list(join(base, year, month))) {
    if (`${year}-${month}-${day}` < since) continue;
    for (const name of await list(join(base, year, month, day))) if (name.startsWith("rollout-") && name.endsWith(".jsonl")) files.push(join(base, year, month, day, name));
  }
  return files;
}
export async function codexChats(roots: ReadonlyArray<string>): Promise<Chat[]> {
  const byKey = new Map(roots.map((root) => [pathKey(root), root]));
  const names = codexNames(await readFile(join(codexHome(), "session_index.jsonl"), "utf8").catch(() => ""));
  const chats: Chat[] = [];
  for (const { file, modifiedMs } of await newest(await codexFiles())) {
    if (chats.length >= MAX_CHATS) break;
    const head = await safeLines(file, 256 * 1024, "head");
    const meta = readCodexMeta(head[0] ?? ""), root = meta && byKey.get(pathKey(meta.cwd));
    if (!meta || !root || !codexListed(meta)) continue;
    chats.push({ driver: "codex", nativeId: meta.id, root, file, title: names.get(meta.id) ?? codexPrompt(head) ?? "Untitled", modifiedMs });
  }
  return chats;
}

