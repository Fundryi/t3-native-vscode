/** Q16 diffs: what "Revert File to Before This Turn" may do. No vscode import, so a node:test can load it. */
export type RevertAction =
  | { readonly kind: "write" | "create"; readonly text: string }
  | { readonly kind: "delete" }
  | { readonly kind: "refuse"; readonly reason: string };

export interface RevertInput {
  readonly before: string;
  readonly after: string;
  readonly oldPath: string;
  readonly newPath: string;
  /** T3's changeType: change, rename-pure, rename-changed, new or deleted. */
  readonly changeType: string;
  /** The file's text now (open buffer or disk); undefined when it does not exist. */
  readonly current: string | undefined;
  readonly dirty: boolean;
}

// T3 reads both sides with `git show`, so they are LF on an autocrlf checkout while the file on disk is CRLF.
export const lf = (text: string) => text.replace(/\r\n/g, "\n");
const refuse = (reason: string): RevertAction => ({ kind: "refuse", reason });

export function revertAction(input: RevertInput): RevertAction {
  if (input.oldPath !== input.newPath) return refuse("This turn renamed the file. Put it back by hand.");
  if (input.dirty) return refuse("The file has unsaved changes. Save or discard them first.");
  if (input.current === undefined) return input.changeType === "deleted" ? { kind: "create", text: input.before } : refuse("The file is no longer on disk.");
  if (lf(input.current) !== lf(input.after)) return refuse("The file changed after this turn, so it was not reverted.");
  return input.changeType === "new" ? { kind: "delete" } : { kind: "write", text: input.before };
}
