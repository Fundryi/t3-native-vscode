/** R9 openline: the first changed line of a unified diff, in the new file (one-based), or undefined without a hunk. */
export function firstChangedLine(diff: string): number | undefined {
  const lines = diff.split(/\r?\n/);
  const header = lines.findIndex((line) => /^@@ -\d+(?:,\d+)? \+\d+/.test(line));
  if (header < 0) return undefined;
  // The header's +N is where the context starts, usually three lines above the edit.
  let line = Number(/\+(\d+)/.exec(lines[header]!)![1]);
  for (const text of lines.slice(header + 1)) {
    if (/^[-+@]/.test(text)) break;
    if (!text.startsWith("\\")) line++; // "\ No newline at end of file" is no line
  }
  return Math.max(1, line);
}
