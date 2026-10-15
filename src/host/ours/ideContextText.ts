/** P1 idectx: the editor reference that goes with a composer prompt, in his composer's chip format. No vscode import. */
import { basename } from "node:path";
import { fileReferenceLabel, formatComposerMessage, type FileReference } from "../../shared/composerContext.js";

/** A bigger selection goes as its line range only; the agent reads those lines itself. */
export const MAX_SNAPSHOT = 20_000;

/** From his editorReference: no selection means the file alone; a huge selection keeps its range but drops the text. */
export function ideReference(reference: FileReference): FileReference {
  const { type, uri, path, label } = reference;
  if (!reference.text) return { type, uri, path, label };
  return reference.text.length > MAX_SNAPSHOT ? { ...reference, text: "" } : reference;
}

/** "IDE: foo.ts:12-20" for the chip. */
export const ideChipLabel = (reference: FileReference): string => `IDE: ${fileReferenceLabel({ ...reference, label: basename(reference.path) })}`;

/**
 * The prompt with the reference appended after a blank line, so his transcript shows it as a reference card
 * (messageReferences.ts). Unchanged for a slash command and when the prompt already links that file
 * (an @ mention or Add selection), or names the file and no lines are selected.
 */
export function withIdeReference(text: string, reference: FileReference): string {
  if (text.trimStart().startsWith("/")) return text;
  const { uri } = reference;
  if (text.includes(`${uri})`) || text.includes(`${uri}#`)) return text;
  if (!reference.range && text.includes(reference.label)) return text;
  // His formatter emits nothing for a whole-file chip (no snapshot to attach); as an inline token it becomes the link.
  const block = reference.range ? formatComposerMessage("", [reference]) : formatComposerMessage("@ide", [{ ...reference, inlineText: "@ide" }]);
  return text.trim() ? `${text}\n\n${block}` : block;
}
