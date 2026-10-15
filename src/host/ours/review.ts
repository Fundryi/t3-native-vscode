/**
 * P13 review: /review in the composer (and the Source Control "Review Changes with T3" button) opens a picker:
 * uncommitted changes, against a base branch, a commit, or custom instructions. The prompt names the exact git command
 * and asks for prioritized findings with file:line. t3-vscode.ours.review.delivery: this chat or a new chat.
 * Its own composerSuggestions wrap: Q13's only runs where the plan toggle shows.
 */
import * as vscode from "vscode";
import { SIDEBAR_VIEW_ID } from "../hostState.js";
import { reviewPrompt, withReviewSuggestion, type ReviewTarget } from "../../shared/ours/review.js";
import { log } from "./log.js";
import { toastWithLogs } from "./logs.js";
import { registerOursRpc } from "./rpc.js";
import type { OursDeps, OursFeature } from "./types.js";
import { Declined, wrap } from "./wrap.js";

/** Only what this file calls of the vscode.git API (extensions/git/src/api/git.d.ts). */
interface GitRef { readonly name?: string; readonly type: number }
interface GitCommit { readonly hash: string; readonly message: string }
interface GitRepository {
  readonly rootUri: vscode.Uri;
  readonly state: { readonly HEAD?: { readonly name?: string } };
  getBranches(query: { remote?: boolean }): Promise<GitRef[]>;
  log(options?: { maxEntries?: number }): Promise<GitCommit[]>;
}
interface GitExports { getAPI(version: 1): { readonly repositories: ReadonlyArray<GitRepository> } }

const DELIVERY = "t3-vscode.ours.review.delivery";
const TITLE = "Review with T3";
const TAG = 2; // RefType.Tag

async function repositories(): Promise<ReadonlyArray<GitRepository>> {
  const extension = vscode.extensions.getExtension<GitExports>("vscode.git");
  // getAPI throws while git.enabled is off; then only the targets without a git list are offered.
  try { return extension ? (extension.isActive ? extension.exports : await extension.activate()).getAPI(1).repositories : []; } catch { return []; }
}

type Item<T> = vscode.QuickPickItem & { readonly value: T };

/** undefined: the user cancelled. */
async function chooseTarget(): Promise<{ target: ReviewTarget; root?: string | undefined } | undefined> {
  const repos = await repositories();
  const kinds: Array<Item<ReviewTarget["kind"]>> = [
    { label: "$(diff) Uncommitted changes", description: "staged, unstaged and untracked", value: "uncommitted" },
    ...(repos.length ? [
      { label: "$(git-compare) Against a base branch", description: "git diff <base>...HEAD", value: "branch" as const },
      { label: "$(git-commit) A commit", description: "git show <sha>", value: "commit" as const },
    ] : []),
    { label: "$(edit) Custom instructions", description: "say what to review", value: "custom" },
  ];
  const kind = (await vscode.window.showQuickPick(kinds, { title: TITLE, placeHolder: "What should the agent review?" }))?.value;
  if (!kind) return undefined;
  if (kind === "custom") {
    const instructions = await vscode.window.showInputBox({ title: TITLE, prompt: "What should the agent review, and how?", placeHolder: "For example: the error handling in src/server" });
    return instructions?.trim() ? { target: { kind: "custom", instructions } } : undefined;
  }
  let repo = repos[0];
  if (repos.length > 1) {
    const items = repos.map((item) => ({ label: vscode.workspace.asRelativePath(item.rootUri, true) || item.rootUri.fsPath, description: item.rootUri.fsPath, value: item }));
    repo = (await vscode.window.showQuickPick(items, { title: TITLE, placeHolder: "Which repository?" }))?.value;
    if (!repo) return undefined;
  }
  const root = repos.length > 1 ? repo?.rootUri.fsPath : undefined;
  if (kind === "uncommitted" || !repo) return { target: { kind: "uncommitted" }, root };
  if (kind === "branch") {
    const current = repo.state.HEAD?.name;
    const names = [...new Set((await repo.getBranches({ remote: true }))
      .flatMap((ref) => ref.type !== TAG && ref.name && ref.name !== current && !ref.name.endsWith("/HEAD") ? [ref.name] : []))];
    // The usual bases first; the rest keep git's order.
    const usual = (name: string) => /^([^/]+\/)?(main|master|develop)$/.test(name) ? 0 : 1;
    names.sort((a, b) => usual(a) - usual(b));
    if (!names.length) { void vscode.window.showInformationMessage("This repository has no other branch to review against."); return undefined; }
    const base = await vscode.window.showQuickPick(names, { title: TITLE, placeHolder: current ? `Review ${current} against which branch?` : "Against which branch?" });
    return base ? { target: { kind: "branch", base }, root } : undefined;
  }
  const commits = await repo.log({ maxEntries: 50 });
  if (!commits.length) { void vscode.window.showInformationMessage("This repository has no commits yet."); return undefined; }
  const items = commits.map((item) => ({ label: item.message.split("\n")[0] ?? "", description: item.hash.slice(0, 8), value: item }));
  const commit = await vscode.window.showQuickPick(items, { title: TITLE, placeHolder: "Which commit?", matchOnDescription: true });
  return commit ? { target: { kind: "commit", sha: commit.value.hash, subject: commit.label }, root } : undefined;
}

/**
 * The picker and the send. `viewId`: the chat whose composer ran /review. Without one (the Source Control button),
 * "this chat" goes through `insert` and nothing is sent: the host cannot see that composer's draft.
 */
export async function openReview(deps: OursDeps, from: { viewId?: string; draftInUse?: boolean; insert?: (text: string) => Promise<void> }): Promise<void> {
  try {
    let newChat = vscode.workspace.getConfiguration().get<string>(DELIVERY, "thisChat") === "newChat";
    // His sendMessage clears the chat's composer draft, so never send over one (as Q20 Implement).
    if (!newChat && from.draftInUse) {
      const choice = await vscode.window.showWarningMessage("The composer has text or attachments; sending the review in this chat would clear them.", "Review in a New Chat");
      if (choice !== "Review in a New Chat") return;
      newChat = true;
    }
    // Read this chat's thread before the picker, so a thread switch while it is open does not move the review.
    const hereViewId = from.viewId ?? SIDEBAR_VIEW_ID;
    const hereThreadId = deps.hostState.snapshot(hereViewId).activeThreadId;
    const picked = await chooseTarget();
    if (!picked) return;
    const text = reviewPrompt(picked.target, picked.root);
    if (!newChat && from.viewId === undefined && from.insert) { await from.insert(text); return; }
    if (!newChat) { await deps.hostState.sendMessage(text, hereThreadId, hereViewId); return; }
    const viewId = await deps.provider.createNewPanel(from.viewId ?? deps.registry.focusedViewId);
    await deps.hostState.sendMessage(text, deps.hostState.snapshot(viewId).activeThreadId, viewId);
  } catch (cause) {
    // Declined: C3 one-writer asked and the user said no; it already said why.
    if (!(cause instanceof Declined)) toastWithLogs("error", `T3 VSCode could not start the review: ${cause instanceof Error ? cause.message : String(cause)}`, cause);
  }
}

export const activateReview: OursFeature = (deps) => {
  const unregister = registerOursRpc("reviewOpen", (params, viewId) => {
    // Not awaited: the webview request would otherwise wait on the picker.
    void openReview(deps, { viewId, draftInUse: params.draftInUse === true });
  });
  const unwrap = wrap(deps.hostState, "composerSuggestions", (original) => async (kind, query, atPromptStart, viewId) => {
    const items = await original(kind, query, atPromptStart, viewId);
    if (kind !== "slash-command" || !atPromptStart) return items;
    try { return withReviewSuggestion(items, query); }
    catch (cause) { log.error("Review suggestion failed; his list stays.", cause); return items; }
  });
  return new vscode.Disposable(() => { unwrap(); unregister(); });
};
