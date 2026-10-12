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
/** Fence info strings are abbreviations; the header names the language the way a person would. */
const CODE_BLOCK_LANGUAGE_NAMES: Readonly<Record<string, string>> = {
  bash: "Shell", c: "C", cmd: "Batch", cpp: "C++", cs: "C#", css: "CSS", diff: "Diff", dockerfile: "Dockerfile",
  go: "Go", graphql: "GraphQL", groovy: "Groovy", h: "C header", hpp: "C++ header", html: "HTML", ini: "INI",
  java: "Java", javascript: "JavaScript", js: "JavaScript", json: "JSON", jsonc: "JSON with comments", jsx: "JavaScript React",
  kt: "Kotlin", kotlin: "Kotlin", latex: "LaTeX", lua: "Lua", make: "Makefile", makefile: "Makefile", markdown: "Markdown",
  md: "Markdown", mermaid: "Mermaid", php: "PHP", pl: "Perl", powershell: "PowerShell", ps1: "PowerShell", py: "Python",
  python: "Python", r: "R", rb: "Ruby", ruby: "Ruby", rs: "Rust", rust: "Rust", scala: "Scala", scss: "SCSS", sh: "Shell",
  shell: "Shell", sql: "SQL", svg: "SVG", swift: "Swift", tex: "LaTeX", text: "Plain text", toml: "TOML", ts: "TypeScript",
  tsx: "TypeScript React", txt: "Plain text", typescript: "TypeScript", vue: "Vue", xml: "XML", yaml: "YAML", yml: "YAML", zsh: "Shell",
};
/** An unnamed fence is plain text, and says so rather than showing an empty strip. */
export function codeBlockLanguageName(language: string | undefined): string {
  const key = language?.trim().toLowerCase();
  return !key ? "Plain text" : CODE_BLOCK_LANGUAGE_NAMES[key] ?? language!.trim();
}
