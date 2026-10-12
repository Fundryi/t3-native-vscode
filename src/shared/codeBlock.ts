/** The language a fence names, from the `language-*` class the markdown pipeline puts on its `<code>`. */
export function codeBlockLanguage(className: unknown): string | undefined {
  if (!Array.isArray(className)) return undefined;
  for (const name of className) if (typeof name === "string" && name.length > 9 && name.startsWith("language-")) return name.slice(9);
  return undefined;
}
/** The newline that closes a fence's last line is not a line of the code, and is not copied. */
export function codeBlockSource(code: string): string { return code.endsWith("\n") ? code.slice(0, -1) : code; }
/** Digits of the widest number, so the gutter is sized by the data and never measured. */
export function codeBlockLayout(code: string, startLine: number | undefined): { readonly source: string; readonly lines: ReadonlyArray<string>; readonly first: number; readonly digits: number } {
  const source = codeBlockSource(code); const lines = source.split(/\r?\n/);
  const first = Number.isSafeInteger(startLine) && startLine! >= 1 ? startLine! : 1;
  return { source, lines, first, digits: String(first + lines.length - 1).length };
}
