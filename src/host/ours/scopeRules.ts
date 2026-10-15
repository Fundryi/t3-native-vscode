/**
 * P8 scope rules (no vscode import, so tests can load them). Which T3 project roots a window shows besides its own
 * folders: the main checkout of a git worktree folder, the project of a chat whose worktree is a window folder, and
 * the deepest project root that holds a window folder (a window on repo/src).
 */
import { readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

// Same as mcp/discovery.ts key(): Windows paths compare without case and with forward slashes.
const WIN = process.platform === "win32";
export const key = (p: string) => { const s = p.replace(/\\/g, "/").replace(/\/+$/, ""); return WIN ? s.toLowerCase() : s; };

/**
 * Ported from mcp/bridgeSource.ts (R19): the first .git up from dir, when it is a file reading
 * "gitdir: <main>/.git/worktrees/<name>", names the main checkout. A .git directory, any other gitdir (submodule,
 * bare) or an unreadable .git gives null.
 */
export function mainCheckout(dir: string): string | null {
  for (let d = resolve(dir); ; d = dirname(d)) {
    let isFile: boolean | undefined;
    let match: RegExpExecArray | null = null;
    try {
      const st = statSync(join(d, ".git"), { throwIfNoEntry: false });
      isFile = st?.isFile();
      if (isFile) match = /^gitdir:\s*(.+?)\s*$/m.exec(readFileSync(join(d, ".git"), "utf8"));
    } catch { return null; }
    if (isFile !== undefined) {
      if (!isFile) return null;
      const hit = match && /^(.*)\/\.git\/worktrees\/[^/]+$/.exec(resolve(d, match[1]!).replace(/\\/g, "/"));
      return hit ? hit[1]! : null;
    }
    if (dirname(d) === d) return null;
  }
}

interface Project { readonly id: string; readonly workspaceRoot: string }
interface Thread { readonly projectId: string; readonly worktreePath: string | null }

/** The extra roots for these window folders, in order (a) main checkout, (b) worktree chat's project, (c) containing project; no repeats. */
export function extraRoots(folders: ReadonlyArray<string>, projects: ReadonlyArray<Project>, threads: ReadonlyArray<Thread>,
  mainOf: (folder: string) => string | null): string[] {
  const folderKeys = new Set(folders.map(key));
  const seen = new Set(folderKeys);
  const out: string[] = [];
  const add = (root: string | null | undefined) => { if (root && !seen.has(key(root))) { seen.add(key(root)); out.push(root); } };
  for (const folder of folders) add(mainOf(folder));
  const roots = new Map(projects.map((project) => [project.id, project.workspaceRoot]));
  for (const thread of threads) if (thread.worktreePath && folderKeys.has(key(thread.worktreePath))) add(roots.get(thread.projectId));
  for (const folder of folders) {
    const f = key(folder);
    // The deepest root holding the folder; a folder that is itself a project root therefore adds no parent.
    add(projects.map((project) => project.workspaceRoot).filter((root) => f === key(root) || f.startsWith(`${key(root)}/`))
      .sort((a, b) => key(b).length - key(a).length)[0]);
  }
  return out;
}
