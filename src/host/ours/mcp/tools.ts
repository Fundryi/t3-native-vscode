/** The ten context tools of this window (legacy context.js), with their caps, and the meta block every result carries. */
import * as vscode from "vscode";
import { terminalRuns } from "../terminalRuns.js";
import { openFile, showDiff, type ActionResult } from "./actions.js";
import { cwdFolder, folders, inside, key, label, resolvePath, slash, workspaceFile } from "./discovery.js";
import type { McpMeta, McpTool } from "./server.js";

const MAX_TEXT = 8192;
const MAX_TABS = 200;
const MAX_DIAG_DEFAULT = 100;
const MAX_DIAG = 500;
const MAX_MESSAGE = 500;
const MAX_GIT_FILES = 200;
const MAX_REPOS = 20;
const MAX_EXTENSIONS = 300;
const MAX_RUNS = 20;
const MAX_REASON = 300;

type Args = Readonly<Record<string, unknown>>;
const pos = (p: vscode.Position) => ({ line: p.line + 1, character: p.character + 1 });
const iso = (time: number | null) => time === null ? null : new Date(time).toISOString();
const atLeastOne = (value: unknown, name: string) => { if (value !== undefined && !(Number.isInteger(value) && (value as number) >= 1)) throw new Error(`${name} must be an integer of at least 1.`); };
const noArgs = { type: "object", properties: {}, additionalProperties: false } as const;
const pathArg = { type: "string", description: "Absolute, or relative to the folder that holds your cwd." };

const SEVERITY = ["error", "warning", "info", "hint"]; // index = vscode.DiagnosticSeverity
const GIT_STATUS = ["modified", "added", "deleted", "renamed", "copied", "modified", "deleted", "untracked", "ignored", "intent-to-add", "intent-to-rename",
  "type-changed", "added-by-us", "added-by-them", "deleted-by-us", "deleted-by-them", "both-added", "both-deleted", "both-modified"]; // index = git.d.ts Status

/** The few members of the built-in Git extension's API 1 (git.d.ts) these tools read. */
interface GitChange { readonly uri: vscode.Uri; readonly renameUri?: vscode.Uri; readonly status: number }
interface GitRepository {
  readonly rootUri: vscode.Uri;
  readonly state: {
    readonly HEAD?: { readonly name?: string; readonly upstream?: { readonly remote: string; readonly name: string }; readonly ahead?: number; readonly behind?: number };
    readonly indexChanges: ReadonlyArray<GitChange>; readonly workingTreeChanges: ReadonlyArray<GitChange>;
    readonly mergeChanges?: ReadonlyArray<GitChange>; readonly untrackedChanges?: ReadonlyArray<GitChange>;
  };
}
interface GitExports { getAPI(version: 1): { readonly repositories: ReadonlyArray<GitRepository> } }

function diagnostics({ path, minSeverity, max }: Args, cwd: string | null) {
  const file = path === undefined ? null : key(resolvePath(path, cwd));
  const min = minSeverity === undefined ? 3 : SEVERITY.indexOf(String(minSeverity));
  if (min < 0) throw new Error("minSeverity must be error, warning, info or hint.");
  atLeastOne(max, "max");
  const limit = Math.min(max === undefined ? MAX_DIAG_DEFAULT : max as number, MAX_DIAG);
  let total = 0;
  const items = [];
  for (const [uri, list] of vscode.languages.getDiagnostics()) {
    if (uri.scheme !== "file" || (file && key(uri.fsPath) !== file)) continue;
    for (const d of list) {
      if (d.severity > min) continue;
      total++;
      if (items.length >= limit) continue; // keep counting for total, stop building
      const code = typeof d.code === "object" ? d.code.value : d.code;
      items.push({ path: slash(uri.fsPath), line: d.range.start.line + 1, column: d.range.start.character + 1, severity: SEVERITY[d.severity] ?? "hint",
        message: d.message.slice(0, MAX_MESSAGE), source: d.source ?? null, code: code ?? null });
    }
  }
  return { total, truncated: total > items.length, items };
}

function openTabs() {
  const all = [];
  let total = 0;
  for (const group of vscode.window.tabGroups.all) {
    total += group.tabs.length;
    for (const tab of group.tabs) {
      if (all.length >= MAX_TABS) break;
      const input = tab.input;
      const kind = input instanceof vscode.TabInputText ? "text" : input instanceof vscode.TabInputTextDiff ? "diff" : "other";
      const uri = input instanceof vscode.TabInputText ? input.uri : input instanceof vscode.TabInputTextDiff ? input.modified : null;
      all.push({ path: uri?.scheme === "file" ? slash(uri.fsPath) : null, label: tab.label, group: group.viewColumn, active: tab.isActive, dirty: tab.isDirty, kind, first: group.isActive && tab.isActive });
    }
  }
  // The tab the user looks at goes first; the rest keep VS Code's order (sort is stable).
  const tabs = all.sort((a, b) => Number(b.first) - Number(a.first)).map(({ first: _first, ...tab }) => tab);
  return { total, truncated: total > tabs.length, tabs };
}

async function gitState({ path }: Args, cwd: string | null) {
  const target = path === undefined ? null : resolvePath(path, cwd);
  const extension = vscode.extensions.getExtension<GitExports>("vscode.git");
  let api: ReturnType<GitExports["getAPI"]> | null;
  try { api = extension ? (extension.isActive ? extension.exports : await extension.activate()).getAPI(1) : null; } catch { api = null; } // getAPI throws while git.enabled is off
  if (!api) return { available: false };
  let repos = [...api.repositories];
  // With a path: only the deepest repository that holds it.
  if (target) repos = repos.filter((r) => inside(target, r.rootUri.fsPath)).sort((a, b) => b.rootUri.fsPath.length - a.rootUri.fsPath.length).slice(0, 1);
  const files = (list: ReadonlyArray<GitChange>, room: number) => list.slice(0, room).map((c) => ({ path: slash((c.renameUri ?? c.uri).fsPath), status: GIT_STATUS[c.status] ?? "unknown" }));
  return {
    available: true,
    truncated: repos.length > MAX_REPOS,
    repos: repos.slice(0, MAX_REPOS).map((r) => {
      const s = r.state;
      const head = s.HEAD; // undefined in a repository without commits
      const changes = [...(s.mergeChanges ?? []), ...s.workingTreeChanges, ...(s.untrackedChanges ?? [])];
      // shortcut: 200 files per repository in total, staged first; split the cap if agents miss changes behind a large index.
      const staged = files(s.indexChanges, MAX_GIT_FILES);
      return {
        root: slash(r.rootUri.fsPath), branch: head?.name ?? null, upstream: head?.upstream ? `${head.upstream.remote}/${head.upstream.name}` : null,
        ahead: head?.ahead ?? null, behind: head?.behind ?? null,
        staged, changes: files(changes, MAX_GIT_FILES - staged.length), truncated: s.indexChanges.length + changes.length > MAX_GIT_FILES,
      };
    }),
  };
}

function extensions({ query }: Args) {
  if (query !== undefined && typeof query !== "string") throw new Error("query must be a string.");
  const q = (query ?? "").toLowerCase();
  const root = vscode.env.appRoot;
  // packageJSON is VS Code's extension description and carries isBuiltin; without it, an extension inside the install folder counts as built in.
  const builtin = (e: vscode.Extension<unknown>) => typeof e.packageJSON.isBuiltin === "boolean" ? e.packageJSON.isBuiltin as boolean : !!root && inside(e.extensionPath, root);
  const items = vscode.extensions.all.filter((e) => !builtin(e))
    .map((e) => ({ id: e.id, name: String(e.packageJSON.displayName || e.packageJSON.name || e.id), version: (e.packageJSON.version as string | undefined) ?? null, active: e.isActive }))
    .filter((x) => !q || x.id.toLowerCase().includes(q) || x.name.toLowerCase().includes(q))
    .sort((a, b) => a.id.localeCompare(b.id));
  return { total: items.length, truncated: items.length > MAX_EXTENSIONS, items: items.slice(0, MAX_EXTENSIONS) };
}

function terminalOutput({ count, terminal }: Args) {
  if (count !== undefined && !(Number.isInteger(count) && (count as number) >= 1 && (count as number) <= MAX_RUNS)) throw new Error("count must be an integer from 1 to 20.");
  if (terminal !== undefined && typeof terminal !== "string") throw new Error("terminal must be a string.");
  const t = (terminal ?? "").toLowerCase();
  const items = terminalRuns().filter((r) => !t || r.terminal.toLowerCase().includes(t)).slice(-((count as number | undefined) ?? 5)).reverse();
  return { supported: true, items: items.map((r) => ({ ...r, cwd: r.cwd === null ? null : slash(r.cwd), startedAt: iso(r.startedAt), endedAt: iso(r.endedAt) })) };
}

/** An action runs only inside a window folder and is never retried. */
async function act(run: (path: string) => Promise<ActionResult>, path: unknown, cwd: string | null): Promise<ActionResult> {
  const target = resolvePath(path, cwd);
  if (!folders().some((f) => inside(target, f.uri.fsPath))) return { ok: false, reason: "outside the workspace folders" };
  try {
    const result = await run(target);
    return result.ok ? result : { ok: false, reason: result.reason.slice(0, MAX_REASON) };
  } catch (cause) { return { ok: false, reason: (cause instanceof Error ? cause.message : String(cause)).slice(0, MAX_REASON) }; }
}

export function createTools(): { tools: McpTool[]; meta: McpMeta; dispose(): void } {
  // The last file editor; kept while focus sits in a webview such as a T3 chat panel.
  let last: { doc: vscode.TextDocument; sel: vscode.Selection } | null = null;
  const relevant = (doc: vscode.TextDocument) => doc.uri.scheme === "file" && !!vscode.workspace.getWorkspaceFolder(doc.uri);
  const track = (editor: vscode.TextEditor | undefined, sel?: vscode.Selection) => { if (editor && relevant(editor.document)) last = { doc: editor.document, sel: sel ?? editor.selection }; };
  track(vscode.window.activeTextEditor);
  const subscriptions = vscode.Disposable.from(
    vscode.window.onDidChangeActiveTextEditor((editor) => track(editor)), // undefined when focus moves into a webview: keep the last one
    // A background editor may move the remembered document's selection, never become the remembered document.
    vscode.window.onDidChangeTextEditorSelection((e) => { if (e.textEditor === vscode.window.activeTextEditor || last?.doc === e.textEditor.document) track(e.textEditor, e.selections[0]); }),
    vscode.workspace.onDidCloseTextDocument((doc) => { if (last?.doc === doc) last = null; }),
  );

  const tools: McpTool[] = [
    {
      name: "workspace",
      description: "Folders of the VS Code window this agent belongs to, its .code-workspace file, and which folder holds your cwd.",
      inputSchema: noArgs,
      run: (_args, { cwd }) => {
        const hit = cwdFolder(cwd);
        return { folders: folders().map((f) => ({ name: f.name, path: slash(f.uri.fsPath) })), workspaceFile: workspaceFile(), cwd: cwd && slash(cwd), cwdFolder: hit ? slash(hit.uri.fsPath) : null };
      },
    },
    {
      name: "activeFile",
      description: "The file the user last worked in inside this VS Code window: path, language, cursor and selected text (lines and characters 1-based). path is null when there is none.",
      inputSchema: noArgs,
      run: () => {
        if (!last || last.doc.isClosed || !relevant(last.doc)) { last = null; return { path: null }; }
        const { doc, sel } = last;
        const range = doc.validateRange(sel); // the document may have changed since the selection event
        let text = doc.getText(range);
        const truncated = text.length > MAX_TEXT;
        if (truncated) text = text.slice(0, MAX_TEXT);
        return {
          path: slash(doc.uri.fsPath), languageId: doc.languageId, dirty: doc.isDirty,
          cursor: pos(doc.validatePosition(sel.active)), selection: { start: pos(range.start), end: pos(range.end), text, truncated },
        };
      },
    },
    {
      name: "openTabs",
      description: "Tabs open in all editor groups of this VS Code window: path (file tabs; for a diff the modified side), label, group (view column), active, dirty, kind (text, diff, other). The tab the user looks at comes first. At most 200.",
      inputSchema: noArgs,
      run: () => openTabs(),
    },
    {
      name: "diagnostics",
      description: "Problems panel entries of this VS Code window: path, line and column (1-based), severity, message, source, code. A relative path resolves against the window folder that holds your cwd. Default 100 entries, at most 500; total counts all matches.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Only this file; absolute, or relative to the folder that holds your cwd." },
          minSeverity: { type: "string", enum: SEVERITY, description: "Lowest severity to include. Default hint (everything)." },
          max: { type: "integer", minimum: 1, maximum: MAX_DIAG, description: "Entries to return. Default 100; larger values are capped at 500." },
        },
        additionalProperties: false,
      },
      run: (args, { cwd }) => diagnostics(args, cwd),
    },
    {
      name: "gitState",
      description: "Branch, upstream, ahead/behind, staged and changed files per repository of this VS Code window, from the built-in Git extension (the Source Control view). available is false when the Git extension is off. At most 20 repositories and 200 files per repository.",
      inputSchema: { type: "object", properties: { path: { type: "string", description: "Only the repository that holds this path; absolute, or relative to the folder that holds your cwd." } }, additionalProperties: false },
      run: (args, { cwd }) => gitState(args, cwd),
    },
    {
      name: "extensions",
      description: "Extensions the user installed in this VS Code window (built-in ones left out): id, name, version, active. Sorted by id, at most 300; total counts all matches.",
      inputSchema: { type: "object", properties: { query: { type: "string", description: "Only extensions whose id or name contains this text, case-insensitive." } }, additionalProperties: false },
      run: (args) => extensions(args),
    },
    {
      name: "terminalOutput",
      description: "The last commands the user ran in the terminals of this VS Code window, newest first: terminal name, cwd, commandLine, exitCode, startedAt, endedAt and the last 8192 characters of raw output (with terminal escape codes; truncated says when older output was dropped). Only terminals with shell integration, and only commands that finished since this window opened; the last 20 are kept. Nothing is run.",
      inputSchema: {
        type: "object",
        properties: {
          count: { type: "integer", minimum: 1, maximum: MAX_RUNS, description: "Commands to return. Default 5, at most 20." },
          terminal: { type: "string", description: "Only terminals whose name contains this text, case-insensitive." },
        },
        additionalProperties: false,
      },
      run: (args) => terminalOutput(args),
    },
    {
      name: "openFile",
      description: "Open a file in this VS Code window with the cursor at a line and column (1-based), and select it in the Explorer; a folder is revealed in the Explorer instead. Only paths inside the window folders. Returns ok, or ok false with a reason (busy means another open ran in the last 300 ms). Never retried.",
      inputSchema: {
        type: "object",
        properties: {
          path: pathArg,
          line: { type: "integer", minimum: 1, description: "Line for the cursor. Default 1." },
          column: { type: "integer", minimum: 1, description: "Column for the cursor. Default 1." },
          preview: { type: "boolean", description: "Open as a preview tab that the next open replaces. Default false." },
        },
        required: ["path"],
        additionalProperties: false,
      },
      run: ({ path, line, column, preview }, { cwd }) => {
        atLeastOne(line, "line");
        atLeastOne(column, "column");
        if (preview !== undefined && typeof preview !== "boolean") throw new Error("preview must be a boolean.");
        return act((target) => openFile(target, { line, column, preview }), path, cwd);
      },
    },
    {
      name: "revealInExplorer",
      description: "Select a file or folder in the Explorer of this VS Code window (a folder is also expanded). Only paths inside the window folders. Returns ok, or ok false with a reason. Never retried.",
      inputSchema: { type: "object", properties: { path: pathArg }, required: ["path"], additionalProperties: false },
      run: ({ path }, { cwd }) => act((target) => openFile(target, { reveal: true }), path, cwd),
    },
    {
      name: "showDiff",
      description: "Show the uncommitted change of a file in the diff editor of this VS Code window (the Source Control view's diff); a file without a change opens as is. Only paths inside the window folders. Returns ok, or ok false with a reason. Never retried.",
      inputSchema: { type: "object", properties: { path: pathArg }, required: ["path"], additionalProperties: false },
      run: ({ path }, { cwd }) => act(showDiff, path, cwd),
    },
  ];

  const meta: McpMeta = (cwd, fallback, worktree) => {
    // fallback: the bridge found no single window for the cwd and took the last focused one (decision 10).
    // worktree (R19): the window of the main checkout of the git worktree that holds the cwd. bound: reached through --workspace.
    // The bridge's fallback flag wins over the cwd match: in a tie every window holds the cwd, and decision 10 wants the note anyway.
    const match = !cwd ? "none" : fallback ? "fallback" : cwdFolder(cwd) ? "cwd" : worktree ? "worktree" : "bound";
    const note = match === "fallback" ? (cwdFolder(cwd) ? `Several VS Code windows have ${cwd} open; this is the one the owner used last.` : `No VS Code window has ${cwd} open; this is the window the owner used last.`)
      : match === "worktree" ? `Your cwd ${cwd} is a git worktree and this window has its main checkout open; gitState describes the main checkout, because VS Code knows only the repositories it has open.`
        : null;
    return { window: { label: label(), workspaceFile: workspaceFile(), folders: folders().map((f) => slash(f.uri.fsPath)) }, match, ...(note ? { note } : {}) };
  };

  return { tools, meta, dispose: () => subscriptions.dispose() };
}
