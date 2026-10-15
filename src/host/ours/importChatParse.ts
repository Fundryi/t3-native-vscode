/**
 * C2 importchat: the pure rules of "Continue a Claude Code or Codex chat in T3" (no vscode import, so it is tested).
 * Formats read from the files on disk (docs/ours/CONTINUITY-SCOPE.md facts 20-23, 27-28):
 * Claude: <config>/projects/<slug>/<uuid>.jsonl, records with entrypoint, cwd, isMeta, isSidechain, ai-title, custom-title.
 * Codex: sessions/YYYY/MM/DD/rollout-*.jsonl, first record session_meta {id, cwd, originator, source};
 * thread names in session_index.jsonl ({id, thread_name}, appended, the last line wins).
 */
import { createHash } from "node:crypto";

export type Driver = "claudeAgent" | "codex";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Claude Code turns a folder into its projects/ folder name this way (fact 21). */
export const claudeSlug = (cwd: string): string => cwd.replace(/[^a-zA-Z0-9]/g, "-");
/** Comparable folder: one separator style, no trailing separator, case-folded on Windows. */
export function pathKey(path: string, windows = process.platform === "win32"): string {
  const plain = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return windows ? plain.toLowerCase() : plain;
}
export const isUuid = (id: string): boolean => UUID.test(id);

export const records = (lines: ReadonlyArray<string>): Record<string, unknown>[] => lines.flatMap((line) => {
  try { const value: unknown = JSON.parse(line); return value && typeof value === "object" ? [value as Record<string, unknown>] : []; }
  catch { return []; }
});
const str = (value: unknown): string | undefined => typeof value === "string" && value.trim() ? value.trim() : undefined;
/** A user prompt worth a title: not an injected block (<command-...>, <environment_context>, # AGENTS.md ...). */
const promptText = (value: unknown): string | undefined => {
  const parts = typeof value === "string" ? [value] : Array.isArray(value)
    ? value.flatMap((part: { type?: unknown; text?: unknown } | null) => (part?.type === "text" || part?.type === "input_text") && typeof part.text === "string" ? [part.text] : []) : [];
  const text = parts.map((part) => part.trim()).find((part) => part && !part.startsWith("<") && !part.startsWith("#"));
  return text?.replace(/\s+/g, " ").slice(0, 120);
};

export interface ClaudeSession { readonly entrypoint?: string; readonly cwd?: string; readonly title?: string }
/** head: the first lines of the .jsonl, tail: its last lines (titles are appended as the chat goes on). */
export function readClaude(head: ReadonlyArray<string>, tail: ReadonlyArray<string>): ClaudeSession {
  const first = records(head);
  const entrypoint = first.map((item) => str(item.entrypoint)).find(Boolean);
  const cwd = first.map((item) => str(item.cwd)).find(Boolean);
  const named = records(tail).reverse();
  const title = named.map((item) => item.type === "custom-title" ? str(item.customTitle) : undefined).find(Boolean)
    ?? named.map((item) => item.type === "ai-title" ? str(item.aiTitle) : undefined).find(Boolean)
    ?? first.map((item) => item.type === "user" && !item.isMeta && !item.isSidechain ? promptText((item.message as { content?: unknown } | undefined)?.content) : undefined).find(Boolean);
  return { ...(entrypoint ? { entrypoint } : {}), ...(cwd ? { cwd } : {}), ...(title ? { title } : {}) };
}
/** Chats T3 (or another SDK caller) started carry an sdk-* entrypoint; the Claude Code panel hides them too (fact 23). */
export const claudeListed = (session: ClaudeSession): boolean => !session.entrypoint?.startsWith("sdk-");

export interface CodexMeta { readonly id: string; readonly cwd: string; readonly originator: string; readonly source: unknown }
export function readCodexMeta(firstLine: string): CodexMeta | undefined {
  const [record] = records([firstLine]);
  const payload = record?.type === "session_meta" ? record.payload as Record<string, unknown> | undefined : undefined;
  const id = str(payload?.id), cwd = str(payload?.cwd);
  return id && cwd ? { id, cwd, originator: str(payload?.originator) ?? "", source: payload?.source } : undefined;
}
/**
 * Interactive chats only (source "vscode" or "cli", not exec runs or subagents). Skipped originators: "T3 Code"
 * (T3 already has that chat, fact 28) and "Claude Code" (jobs the Codex plugin ran for Claude, the programmatic
 * kind, as Claude's sdk-* sessions).
 */
export const codexListed = (meta: CodexMeta): boolean =>
  (meta.source === "vscode" || meta.source === "cli") && meta.originator !== "T3 Code" && meta.originator !== "Claude Code";
/** First real user prompt of a rollout, for chats without a name in session_index.jsonl. */
export const codexPrompt = (lines: ReadonlyArray<string>): string | undefined => records(lines).map((item) => {
  const payload = item.payload as { type?: unknown; role?: unknown; content?: unknown } | undefined;
  return item.type === "response_item" && payload?.type === "message" && payload.role === "user" ? promptText(payload.content) : undefined;
}).find(Boolean);
export function codexNames(index: string): Map<string, string> {
  const names = new Map<string, string>();
  for (const item of records(index.split("\n"))) {
    const id = str(item.id), name = str(item.thread_name);
    if (id && name) names.set(id, name);
  }
  return names;
}

/**
 * The T3 thread id for an imported chat, the same every time, so a second pick finds the first import instead of
 * making a second thread on one native session. UUID-shaped (his links accept it).
 */
export function importThreadId(driver: Driver, nativeId: string): string {
  const hex = createHash("sha256").update(`t3-vscode.ours.importchat:${driver}:${nativeId}`).digest("hex");
  const variant = ((parseInt(hex[16]!, 16) & 3) | 8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Claude Code keeps <config>/sessions/<pid>.json ({sessionId, pid, ...}) while a chat is open and removes it on exit.
 * files: their contents. A file whose pid is dead (Claude crashed) does not count.
 * shortcut: a crashed Claude's pid reused by another process reads as open (the Codex lock has the same limit); compare procStart if that bites.
 */
export type ClaudeOpen = "busy" | "idle" | null;
/** "busy": a turn runs there (its status field); "idle": the chat is open but waiting; null: not open. */
export const claudeOpen = (files: ReadonlyArray<string>, sessionId: string, alive: (pid: number) => boolean): ClaudeOpen => {
  const live = records(files).filter((item) => item.sessionId === sessionId && typeof item.pid === "number" && item.pid > 0 && alive(item.pid));
  return live.length === 0 ? null : live.some((item) => item.status === "busy") ? "busy" : "idle";
};

/**
 * Open in the other tool (Claude session file, Codex writer lock), or written in the last 2 minutes. The age guess stays
 * as a second signal: Claude builds or runs that keep no session file would otherwise pass unseen; it only adds a question.
 */
export const LIVE_MS = 2 * 60_000;
export const maybeLive = (modifiedMs: number, now: number, open = false): boolean => open || now - modifiedMs < LIVE_MS;

export function age(modifiedMs: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - modifiedMs) / 1000));
  if (seconds < 60) return `${seconds} s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)} h ago`;
  return `${Math.round(seconds / 86_400)} d ago`;
}
