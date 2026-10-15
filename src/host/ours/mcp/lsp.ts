/** P9: references and workspace symbols from VS Code's language servers. Read-only; nothing is opened in an editor. */
import * as vscode from "vscode";
import { relative } from "node:path";
import { cwdFolder, inside, resolvePath, slash } from "./discovery.js";
import type { McpTool } from "./server.js";

const MAX_ITEMS = 200;
const TIMEOUT = 10000;
const RETRY_AFTER = 1500;

/** Relative to the window folder that holds the cwd when the file is inside it, else absolute. */
const show = (uri: vscode.Uri, cwd: string | null) => {
  const folder = cwdFolder(cwd)?.uri.fsPath;
  return folder && inside(uri.fsPath, folder) ? slash(relative(folder, uri.fsPath)) : slash(uri.fsPath);
};
const at = (range: vscode.Range) => ({ line: range.start.line + 1, column: range.start.character + 1 });
const positive = (value: unknown, name: string) => {
  if (!(Number.isInteger(value) && (value as number) >= 1)) throw new Error(`${name} must be an integer of at least 1.`);
  return value as number;
};

async function ask<T>(command: string, ...args: unknown[]): Promise<T[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`No answer from VS Code's language server within ${TIMEOUT / 1000} s; it may still be starting. Try again.`)), TIMEOUT);
  });
  try { return (await Promise.race([vscode.commands.executeCommand<T[] | undefined>(command, ...args), late])) ?? []; }
  finally { clearTimeout(timer); }
}

/** One short retry when the first answer is empty: loading the file may just have started its language extension. */
async function askTwice<T>(command: string, ...args: unknown[]): Promise<T[]> {
  const first = await ask<T>(command, ...args);
  if (first.length) return first;
  await new Promise((done) => setTimeout(done, RETRY_AFTER));
  return ask<T>(command, ...args);
}

const page = <T>(all: T[], empty: string) => ({ total: all.length, truncated: all.length > MAX_ITEMS, items: all.slice(0, MAX_ITEMS), ...(all.length ? {} : { note: empty }) });

export const lspTools: McpTool[] = [
  {
    name: "references",
    description: "Where a symbol is used, from VS Code's language server (Find All References, the declaration included): path, line and column (1-based) of each reference. Give the line and column (1-based) of the symbol's name. Paths are relative to the window folder that holds your cwd, absolute outside it. At most 200; total counts all. An empty list carries a note: the language server may still be starting.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute, or relative to the folder that holds your cwd." },
        line: { type: "integer", minimum: 1, description: "Line of the symbol, 1-based." },
        column: { type: "integer", minimum: 1, description: "Column on the symbol's name, 1-based." },
      },
      required: ["path", "line", "column"],
      additionalProperties: false,
    },
    run: async ({ path, line, column }, { cwd }) => {
      const l = positive(line, "line");
      const c = positive(column, "column");
      // Loading the document also starts the language extension of its language (onLanguage activation).
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(resolvePath(path, cwd)));
      const position = doc.validatePosition(new vscode.Position(l - 1, c - 1));
      const found = await askTwice<vscode.Location>("vscode.executeReferenceProvider", doc.uri, position);
      const result = page(found.map((r) => ({ path: show(r.uri, cwd), ...at(r.range) })),
        "No references: either the position is not on a symbol, or the language server for this file is not ready yet (still starting); try again in a few seconds.");
      // TypeScript answers from this file alone while it still loads the project (seen live: only the declaration).
      const local = found.length > 0 && found.every((r) => r.uri.toString() === doc.uri.toString());
      return local ? { ...result, note: "Every reference is in this file. If you expected others, the language server may still be loading the project; try again in a few seconds." } : result;
    },
  },
  {
    name: "workspaceSymbols",
    description: "Find classes, functions, variables and other symbols by name across the workspace, from VS Code's language servers (Go to Symbol in Workspace): name, kind, container, path, line and column (1-based). Paths are relative to the window folder that holds your cwd, absolute outside it. At most 200, in the server's ranking; total counts all. A language server answers only after a file of its language was opened in this window (calling references on such a file is enough).",
    inputSchema: { type: "object", properties: { query: { type: "string", minLength: 1, description: "The symbol name or part of it." } }, required: ["query"], additionalProperties: false },
    run: async ({ query }, { cwd }) => {
      if (typeof query !== "string" || !query.trim()) throw new Error("query must be a non-empty string.");
      const found = await askTwice<vscode.SymbolInformation>("vscode.executeWorkspaceSymbolProvider", query);
      const items = found.filter((s) => s.location.uri.scheme === "file").map((s) => ({
        name: s.name, kind: vscode.SymbolKind[s.kind] ?? "Unknown", container: s.containerName || null, path: show(s.location.uri, cwd), ...at(s.location.range),
      }));
      return page(items, "No symbols: either nothing matches, or no language server for these files is ready yet (it starts once a file of its language is opened; references on such a file opens it); try again in a few seconds.");
    },
  },
];
