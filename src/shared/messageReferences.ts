import { formatComposerMessage, type FileReference } from "./composerContext.js";

/** One attached editor reference of a sent message, as a transcript row can show it. */
export interface MessageReference {
  /** Content identity, so an expanded row survives the virtualized transcript unmounting it. */
  readonly key: string;
  /** The text the generated link rendered as, `@` included, so search keeps finding the same words. */
  readonly label: string;
  readonly href: string;
  /** The generated range/source line, verbatim; empty when the reference emitted none. */
  readonly detail: string;
  readonly snapshot: string;
  readonly lines: number;
  readonly startLine?: number;
  readonly language?: string;
  readonly summary: string;
  readonly preview: string;
}
export interface SentMessage { readonly text: string; readonly references: ReadonlyArray<MessageReference> }

const LINK = /^\[@((?:[^[\]\\]|\\.)*)\]\((file:[^\s()]*)\)$/;
const ANCHOR = /#L(\d+)(?:-L(\d+))?$/;
const SNAPSHOT_FENCE = /^`{3,}$/;
const DETAIL_RANGE = /^Selected range: (\d+):(\d+)[–-](\d+):(\d+)\b/;
const LANGUAGES: Record<string, string> = { ts: "typescript", mts: "typescript", cts: "typescript", tsx: "tsx", js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "jsx", py: "python", rb: "ruby", rs: "rust", go: "go", java: "java", kt: "kotlin", swift: "swift", c: "c", h: "c", cc: "cpp", cpp: "cpp", hpp: "cpp", cs: "csharp", sh: "bash", bash: "bash", zsh: "bash", ps1: "powershell", tex: "latex", bib: "bibtex", md: "markdown", mdx: "markdown", json: "json", jsonc: "json", yml: "yaml", yaml: "yaml", toml: "toml", ini: "ini", css: "css", scss: "scss", html: "html", xml: "xml", sql: "sql", lua: "lua", php: "php", r: "r", dart: "dart", vue: "vue", svelte: "svelte" };

const withoutReturn = (line: string): string => line.endsWith("\r") ? line.slice(0, -1) : line;
const lastSelectedLine = (range: NonNullable<FileReference["range"]>): number => range.end.column === 1 && range.end.line > range.start.line ? range.end.line - 1 : range.end.line;
/** A markdown fence the message itself opens; a backtick fence's info string cannot contain backticks. */
function opensFence(line: string): string {
  const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
  return !match || (match[1]![0] === "`" && match[2]!.includes("`")) ? "" : match[1]!;
}
function closesFence(line: string, open: string): boolean {
  const match = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
  return !!match && match[1]![0] === open[0] && match[1]!.length >= open.length;
}
function describe(label: string, snapshot: string | undefined): Pick<MessageReference, "lines" | "summary" | "preview" | "language"> {
  const lines = snapshot ? snapshot.split("\n").length : 0;
  const first = (snapshot ?? "").split("\n").find((line) => line.trim()) ?? "";
  const preview = first.trim(), language = LANGUAGES[/\.([A-Za-z0-9]+)(?::|$)/.exec(label)?.[1]?.toLowerCase() ?? ""];
  return { lines, summary: snapshot === undefined ? "file reference" : `${lines} line${lines === 1 ? "" : "s"}`, preview: preview.length > 72 ? `${preview.slice(0, 72)}…` : preview, ...(language ? { language } : {}) };
}
/**
 * The block starting at `at`, if the formatter regenerates it byte for byte from the fields the block
 * itself carries. Every reading of the lines is tried and the formatter decides, so parsing stays loose
 * and attribution stays exact: prose that merely looks like a section regenerates as something else.
 */
function sectionAt(lines: ReadonlyArray<string>, at: number): { reference: Omit<MessageReference, "key">; end: number } | null {
  const link = LINK.exec(lines[at] ?? ""); if (!link) return null;
  const title = link[1]!.replace(/\\(.)/g, "$1"), href = link[2]!;
  const anchor = ANCHOR.exec(href), uri = anchor ? href.slice(0, anchor.index) : href;
  const fenced = (open: number): { detail: string; snapshot: string; end: number } | null => {
    if (!SNAPSHOT_FENCE.test(lines[open] ?? "")) return null;
    // The formatter makes the fence longer than any backtick run inside, so the first equal line closes it.
    const close = lines.indexOf(lines[open]!, open + 1);
    return close < 0 ? null : { detail: open === at + 1 ? "" : lines[at + 1]!, snapshot: lines.slice(open + 1, close).join("\n"), end: close };
  };
  const readings = [fenced(at + 1), lines[at + 1] === undefined || SNAPSHOT_FENCE.test(lines[at + 1]!) ? null : { detail: lines[at + 1]!, snapshot: undefined, end: at + 1 }, fenced(at + 2)];
  for (const reading of readings) {
    if (!reading) continue;
    const { detail, snapshot, end } = reading;
    if (end + 1 < lines.length && lines[end + 1] !== "") continue;
    const detailed = DETAIL_RANGE.exec(detail);
    // A link anchor carries lines only; any columns that reproduce it will do, and the formatter checks them.
    const range = detailed ? { start: { line: +detailed[1]!, column: +detailed[2]! }, end: { line: +detailed[3]!, column: +detailed[4]! } }
      : anchor ? { start: { line: +anchor[1]!, column: 1 }, end: { line: +(anchor[2] ?? anchor[1]!), column: 2 } } : undefined;
    const suffix = range ? `:${range.start.line}${lastSelectedLine(range) > range.start.line ? `-${lastSelectedLine(range)}` : ""}` : "";
    if (!title.endsWith(suffix)) continue;
    const label = title.slice(0, title.length - suffix.length);
    const candidate: FileReference = { type: "file", uri, path: label, label, ...(range ? { range } : {}), ...(snapshot === undefined ? {} : { text: snapshot }) };
    if (formatComposerMessage("", [candidate]) !== lines.slice(at, end + 1).join("\n")) continue;
    return { end, reference: { label: `@${title}`, href, detail, snapshot: snapshot ?? "", ...(range ? { startLine: range.start.line } : {}), ...describe(label, snapshot) } };
  }
  return null;
}
/**
 * Split a sent message into the prose the user typed and the reference sections the composer appended.
 * Nothing is dropped that `formatComposerMessage` does not regenerate exactly, and a message with no
 * attributable section is returned untouched: a payload rendered twice is survivable, eating the user's
 * own words is not. Scanned line by line rather than with a pattern built from a snapshot, which a few
 * thousand short lines grew past the regular-expression size limit.
 */
export function splitMessageReferences(text: string): SentMessage {
  if (!text.includes("](file:")) return { text, references: [] };
  const lines = text.split("\n").map(withoutReturn);
  const found: Array<{ start: number; end: number; reference: Omit<MessageReference, "key"> }> = [];
  let open = "";
  for (let at = 0; at < lines.length; at += 1) {
    if (open) { if (closesFence(lines[at]!, open)) open = ""; continue; }
    // Sections are joined with a blank line, so one always starts a block; a block inside a fence the
    // message itself opened is the user's code, and removing lines from it would break their markdown.
    const section = at === 0 || lines[at - 1] === "" ? sectionAt(lines, at) : null;
    if (section) { found.push({ start: at, end: section.end, reference: section.reference }); at = section.end; continue; }
    open = opensFence(lines[at]!);
  }
  if (!found.length) return { text, references: [] };
  let kept = lines;
  for (const section of [...found].reverse()) {
    let start = section.start, end = section.end + 1;
    while (start > 0 && lines[start - 1] === "") start -= 1;
    while (end < kept.length && lines[end] === "") end += 1;
    kept = [...kept.slice(0, start), "", ...kept.slice(end)];
  }
  const seen = new Map<string, number>();
  return { text: kept.join("\n").trim(), references: found.map(({ reference }) => {
    const identity = [reference.href, reference.detail, reference.snapshot].join("\u0000");
    const nth = seen.get(identity) ?? 0; seen.set(identity, nth + 1);
    return { ...reference, key: nth ? `${identity}\u0000${nth}` : identity };
  }) };
}
