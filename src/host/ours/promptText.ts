/** Pure text helpers of the add-to-prompt feature (D). No vscode import, so promptText.test.ts can load it. */

export const MAX_PROMPT_CHARS = 4000;
const MAX_TODO_LENSES = 50;
const MAX_TODO_FILE_CHARS = 200 * 1024;

// A comment that starts with TODO or FIXME; the comment prefix must follow a line start or a space (no http://, no x--).
const TODO_LINE = /(?:^\s*\*|(?:^|\s)(?:\/\/+|#+|--|\/\*+|<!--))\s*(TODO|FIXME)\b:?\s*(.*)/;

/** Zero-based line numbers of TODO/FIXME comments, at most 50; none for a file over 200 KB. */
export function todoLines(text: string): number[] {
  if (text.length > MAX_TODO_FILE_CHARS) return [];
  const found: number[] = [];
  const lines = text.split(/\r?\n/);
  for (let line = 0; line < lines.length && found.length < MAX_TODO_LENSES; line++) if (TODO_LINE.test(lines[line] ?? "")) found.push(line);
  return found;
}

/** CSI and OSC sequences (VS Code's OSC 633 markers included) and other control characters out, line ends as \n. */
export const plainTerminal = (raw: string): string => raw
  .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]|\x1b[@-Z\\-_]/g, "")
  .replace(/\r\n/g, "\n")
  .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");

/** A fence longer than any backtick run inside, on its own lines (insertText lands mid-line). */
export function fenced(text: string): string {
  const fence = "`".repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map((match) => match[0].length + 1)));
  return `\n${fence}\n${text}\n${fence}\n`;
}

/** A finished terminal command as the composer gets it: command and plain output (last 4000) fenced, then the exit code if not 0. */
export function lastCommandText(run: { readonly commandLine: string; readonly output: string; readonly exitCode: number | null }): string {
  const output = plainTerminal(run.output).replace(/\n+$/, "").slice(-MAX_PROMPT_CHARS);
  return fenced(output ? `$ ${run.commandLine}\n${output}` : `$ ${run.commandLine}`) + (run.exitCode ? `exit ${run.exitCode}\n` : "");
}
