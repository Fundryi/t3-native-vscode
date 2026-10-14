/**
 * This window as agents see it: its folders and paths (helpers shared by tools and actions), the bridge file, and the
 * discovery file <HOME>/windows/<exthost pid>.json the bridge reads (legacy context.js). Names and folders stay as the
 * old extension had them, so the owner's live entries (`node ~/.t3-vscode/bridge.js`) work with no edit.
 */
import * as vscode from "vscode";
import { mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
import { log } from "../log.js";
import { BRIDGE_SOURCE } from "./bridgeSource.js";

export const HOME = process.env.T3VSCODE_HOME || join(homedir(), ".t3-vscode");
const DIR = join(HOME, "windows");
const FILE = join(DIR, `${process.pid}.json`);
export const BRIDGE = join(HOME, "bridge.js");
const MAX_FOLDERS = 50;
const WIN = process.platform === "win32";

/** Upper-case drive letter: VS Code reports d:\, a process cwd D:\. Output then spells every path the same way. */
export const slash = (p: string) => p.replace(/\\/g, "/").replace(/^[a-z]:/, (drive) => drive.toUpperCase());
export const key = (p: string) => { const s = slash(p).replace(/\/+$/, ""); return WIN ? s.toLowerCase() : s; };
export const inside = (p: string, root: string) => { const c = key(p); const k = key(root); return c === k || c.startsWith(`${k}/`); };

export const folders = () => (vscode.workspace.workspaceFolders ?? []).filter((f) => f.uri.scheme === "file").slice(0, MAX_FOLDERS);
export const workspaceFile = () => { const uri = vscode.workspace.workspaceFile; return uri?.scheme === "file" ? slash(uri.fsPath) : null; };
export const label = () => { const file = workspaceFile(); return file ? basename(file, ".code-workspace") : folders()[0]?.name ?? ""; };
/** The bridge and this server live on this machine only. */
export const isRemote = () => !!vscode.env.remoteName || (vscode.workspace.workspaceFolders ?? []).some((f) => f.uri.scheme !== "file");

/** The deepest folder that holds cwd on a directory boundary. */
export function cwdFolder(cwd: string | null): vscode.WorkspaceFolder | undefined {
  if (!cwd) return undefined;
  return folders().filter((f) => inside(cwd, f.uri.fsPath)).sort((a, b) => b.uri.fsPath.length - a.uri.fsPath.length)[0];
}

/** A relative path resolves only against the folder that holds the cwd; no such folder is an error, never folder zero. */
export function resolvePath(p: unknown, cwd: string | null): string {
  if (typeof p !== "string" || !p.trim()) throw new Error("path must be a non-empty string.");
  if (isAbsolute(p)) return resolve(p);
  const folder = cwdFolder(cwd);
  if (!folder) throw new Error(`No folder of this VS Code window holds your cwd, so the relative path ${p} has no base; pass an absolute path.`);
  return resolve(folder.uri.fsPath, p);
}

function alive(pid: unknown): boolean {
  if (!Number.isInteger(pid) || (pid as number) <= 0) return false; // kill(0, 0) signals our own process group and succeeds
  try { process.kill(pid as number, 0); return true; } catch (cause) { return (cause as NodeJS.ErrnoException).code === "EPERM"; }
}

/** A reader never sees half a token or port: write a temp file next to the target, then rename over it. */
function writeAtomic(file: string, text: string): void {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, text, { mode: 0o600 });
  renameSync(tmp, file);
}

/** Sweeps discovery files of dead windows and writes bridge.js when its content differs. */
export function prepareHome(): void {
  try {
    mkdirSync(DIR, { recursive: true, mode: 0o700 });
    for (const name of readdirSync(DIR).filter((n) => n.endsWith(".json"))) {
      try {
        const { pid } = JSON.parse(readFileSync(join(DIR, name), "utf8")) as { pid?: unknown };
        if (Number.isInteger(pid) && pid !== process.pid && !alive(pid)) unlinkSync(join(DIR, name)); // crash leftover
      } catch { /* malformed or racing another window: leave it */ }
    }
    let current: string | undefined;
    try { current = readFileSync(BRIDGE, "utf8"); } catch { /* first run */ }
    if (current !== BRIDGE_SOURCE) writeAtomic(BRIDGE, BRIDGE_SOURCE);
  } catch (cause) { log.error(`Context server: setup in ${HOME} failed:`, cause); }
}

/** Publishes this window for the server at `port`; rewritten on focus and folder change, removed on dispose and exit. */
export function publishWindow(port: number, token: string): vscode.Disposable {
  const startedAt = new Date().toISOString();
  let focusedAt = vscode.window.state.focused ? startedAt : null;
  const unpublish = () => { try { unlinkSync(FILE); } catch { /* already gone */ } };
  const publish = () => {
    const list = folders();
    if (!list.length) return unpublish(); // nothing to match an agent's cwd against
    try {
      mkdirSync(DIR, { recursive: true, mode: 0o700 });
      writeAtomic(FILE, JSON.stringify({ version: 1, pid: process.pid, port, token, label: label(), workspaceFile: workspaceFile(), folders: list.map((f) => slash(f.uri.fsPath)), focusedAt, startedAt }));
    } catch (cause) { log.error(`Context server: could not write ${FILE}:`, cause); }
  };
  publish();
  log.info(`Context server on 127.0.0.1:${port}, discovery ${FILE}`);
  process.on("exit", unpublish);
  return vscode.Disposable.from(
    vscode.window.onDidChangeWindowState((state) => { if (state.focused) { focusedAt = new Date().toISOString(); publish(); } }),
    vscode.workspace.onDidChangeWorkspaceFolders(publish),
    { dispose: () => { process.removeListener("exit", unpublish); unpublish(); } },
  );
}
