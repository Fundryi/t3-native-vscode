/** P13 review: the /review suggestion and the review prompt. No vscode import, so the webview and tests can load it. */
import type { ComposerSuggestion } from "../bridge.js";

/** The webview knows our pick by this text: the label changes when the provider has its own /review. */
export const REVIEW_DESCRIPTION = "Review changes: uncommitted, against a branch, or a commit (VS Code picker)";

/**
 * Adds /review: with no query after his /model and /usage-limits; with a query it matches the label only,
 * first when the label starts with the query, else last, so Enter on "/st" still picks his /status.
 * Next to a provider /review it is labelled "/review (VS Code)".
 */
export function withReviewSuggestion(items: ReadonlyArray<ComposerSuggestion>, query: string): ComposerSuggestion[] {
  const label = items.some((item) => item.id === "command:review") ? "/review (VS Code)" : "/review";
  const wanted = query.replace(/^\/+/, "").trim().toLowerCase();
  const name = label.slice(1).toLowerCase();
  if (wanted && !name.includes(wanted)) return [...items];
  // kind "command" with an empty value: his chooseSuggestion only clears the typed token; src/webview/ours/review.ts acts on the pick.
  const ours: ComposerSuggestion = { id: "ours:review", kind: "command", value: "", label, description: REVIEW_DESCRIPTION };
  if (wanted) return name.startsWith(wanted) ? [ours, ...items] : [...items, ours];
  const at = items.findIndex((item) => item.kind !== "model" && item.kind !== "usage");
  return at < 0 ? [...items, ours] : [...items.slice(0, at), ours, ...items.slice(at)];
}

export type ReviewTarget =
  | { readonly kind: "uncommitted" }
  | { readonly kind: "branch"; readonly base: string }
  | { readonly kind: "commit"; readonly sha: string; readonly subject: string }
  | { readonly kind: "custom"; readonly instructions: string };

const SHAPE = "Do not change any files. Report only real problems in these changes (bugs, security, data loss, broken behavior, missing error handling), no style nits. "
  + "List the findings ordered by priority, P0 (critical) to P3 (low). For each: the priority, a short title, the location as file:line (path relative to the repository root), what is wrong and why it matters, and a suggested fix. "
  + "If there are none, say so. End with one line: the verdict, correct or needs changes.";

/** The prompt names the exact git command, so the agent reviews exactly what was picked. `root` only when several repositories are open. */
export function reviewPrompt(target: ReviewTarget, root?: string): string {
  const where = root ? ` in the repository at ${root}` : "";
  const what = target.kind === "uncommitted"
    ? `Review my uncommitted changes${where} (staged, unstaged and untracked). Get them with \`git status --porcelain\` and \`git diff HEAD\`, and read the untracked files.`
    : target.kind === "branch"
      ? `Review the changes of the current branch against ${target.base}${where}. Get them with \`git diff ${target.base}...HEAD\` (commits: \`git log --oneline ${target.base}..HEAD\`). Review only those changes.`
      : target.kind === "commit"
        ? `Review the commit ${target.sha.slice(0, 12)} "${target.subject}"${where}. Get it with \`git show ${target.sha}\`. Review only that commit.`
        : `Review the code${where} as follows: ${target.instructions.trim()}`;
  return `${what}\n\n${SHAPE}`;
}
