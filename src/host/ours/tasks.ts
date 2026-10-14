/** E: the scripts of each folder's t3.json as VS Code tasks of type "t3", run in a terminal at the folder like T3 runs them. */
import * as vscode from "vscode";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { parseT3ProjectFile } from "@t3tools/shared/t3ProjectFile";
import { log } from "./log.js";

const MAX_FILE_BYTES = 256 * 1024;

async function folderTasks(folder: vscode.WorkspaceFolder): Promise<vscode.Task[]> {
  const root = folder.uri.fsPath;
  const file = join(root, "t3.json");
  try {
    if ((await stat(file)).size > MAX_FILE_BYTES) { log.info(`${file} is larger than 256 KB; no T3 tasks listed.`); return []; }
    // Lenient JSONC as T3 reads it; null when invalid, including more than 50 scripts (the schema rejects, never trims).
    const project = parseT3ProjectFile(await readFile(file, "utf8"));
    if (!project) { log.info(`${file} is not a valid T3 project file (JSONC, at most 50 scripts, each with a name and a command); no T3 tasks listed.`); return []; }
    return (project.scripts ?? []).map(({ name, command }) => {
      // T3 runs a script at the project root with T3CODE_PROJECT_ROOT set (shared/projectScripts.ts projectScriptRuntimeEnv).
      const task = new vscode.Task({ type: "t3", script: name }, folder, name, "T3", new vscode.ShellExecution(command, { cwd: root, env: { T3CODE_PROJECT_ROOT: root } }));
      task.detail = `t3.json (scripts kept only in T3's settings are not listed): ${command}`;
      return task;
    });
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "ENOENT") log.error(`Could not read ${file}:`, cause);
    return [];
  }
}

export function activateTasks(): vscode.Disposable {
  return vscode.tasks.registerTaskProvider("t3", {
    provideTasks: async () => (await Promise.all((vscode.workspace.workspaceFolders ?? []).filter((folder) => folder.uri.scheme === "file").map(folderTasks))).flat(),
    resolveTask: () => undefined,
  });
}
