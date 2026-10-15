/**
 * C3 onewriter: was a Claude Code or Codex session written by another tool after T3 took it over?
 * Reads the newest lines of the session file. No vscode import, so it is tested.
 */

/** The newest foreign write: who wrote it and when (ISO). */
export interface ForeignWrite { readonly writer: string; readonly at: string }

type Verdict = { readonly mine: boolean; readonly writer: string } | undefined;

/**
 * Walks `lines` from the end to the newest record `pick` recognizes. Returns that record's foreign write,
 * null when it is T3's own (or older than `sinceMs`, the time T3 bound the session), and undefined when no line
 * qualifies (the caller reads more of the file). A partial first line just fails to parse.
 */
function newest(lines: ReadonlyArray<string>, sinceMs: number, pick: (record: Record<string, unknown>) => Verdict): ForeignWrite | null | undefined {
  for (let index = lines.length - 1; index >= 0; index--) {
    let record: unknown;
    try { record = JSON.parse(lines[index]!); } catch { continue; }
    if (!record || typeof record !== "object") continue;
    const at = (record as { timestamp?: unknown }).timestamp;
    if (typeof at !== "string") continue;
    const verdict = pick(record as Record<string, unknown>);
    if (!verdict) continue;
    return verdict.mine || !(Date.parse(at) > sinceMs) ? null : { writer: verdict.writer, at };
  }
  return undefined;
}

const CLAUDE_WRITERS: Readonly<Record<string, string>> = { "claude-vscode": "Claude Code in VS Code", cli: "the Claude Code CLI", "claude-desktop": "Claude Desktop" };

/** Claude .jsonl: every turn record carries `entrypoint`; T3 runs the Agent SDK, which writes `sdk-ts` (sdk-*). */
export const foreignClaudeWrite = (lines: ReadonlyArray<string>, sinceMs: number): ForeignWrite | null | undefined => newest(lines, sinceMs, (record) =>
  typeof record.entrypoint === "string" ? { mine: record.entrypoint.startsWith("sdk-"), writer: CLAUDE_WRITERS[record.entrypoint] ?? `Claude Code (${record.entrypoint})` } : undefined);

/** Codex rollout: each turn starts with a turn_context whose turn_id T3 keeps as providerTurns[].nativeTurnRef.nativeId. */
export const foreignCodexWrite = (lines: ReadonlyArray<string>, sinceMs: number, t3TurnIds: ReadonlySet<string>): ForeignWrite | null | undefined => newest(lines, sinceMs, (record) => {
  const turnId = record.type === "turn_context" ? (record.payload as { turn_id?: unknown } | null)?.turn_id : undefined;
  // Compaction runs inside a turn under its own id; skip it so the turn around it decides.
  if (typeof turnId !== "string" || turnId.startsWith("auto-compact")) return undefined;
  return { mine: t3TurnIds.has(turnId), writer: "Codex outside T3" };
});

/** UUIDv7 (Codex thread ids): the creation time in ms, or null for another id shape. */
export function uuidV7Millis(id: string): number | null {
  const hex = id.replaceAll("-", "");
  return /^[0-9a-f]{12}7[0-9a-f]{19}$/i.test(hex) ? Number.parseInt(hex.slice(0, 12), 16) : null;
}
