/**
 * P14 worktree: "New Chat in a Worktree..." starts a chat on a fresh git worktree and branch, so a parallel agent never
 * touches the open checkout (Claude Code createWorktree, Codex /worktree). One raw orchestration.launchThread call with
 * workspaceStrategy "worktree", as the T3 client itself does (client-runtime operations/commands.ts startThreadTurn): the
 * server makes the worktree, names the branch when none is given, and sends the first prompt there.
 * Base branches come from vcs.listRefs of T3, so the list is what the server will accept. Model, runtime and interaction
 * mode are the ones the new-chat composer of the view shows (his snapshot draft). Thread Actions "Open Worktree in New
 * Window" lives in threadActions.ts.
 */
import * as vscode from "vscode";
import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import { ORCHESTRATION_V2_WS_METHODS, OrchestrationV2ThreadLaunchInput, VcsListRefsInput, WS_METHODS } from "@t3tools/contracts";
import { deriveThreadTitleSeed } from "@t3tools/client-runtime/operations";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { log } from "./log.js";
import type { OursFeature } from "./types.js";

/** The message of a server error (ThreadLaunchBaseRefError and GitCommandError carry readable ones). */
const failure = (error: unknown) => new Error(typeof (error as { message?: unknown } | null)?.message === "string" ? (error as { message: string }).message : String(error));

export const activateWorktree: OursFeature = ({ client, hostState, registry, provider }) => {
  /** Resolves when his host state lists the thread (openSession needs it), or rejects after 15 s (as importChat.ts). */
  const listed = (threadId: string) => new Promise<void>((resolve, reject) => {
    let done = false, unsubscribe: (() => void) | undefined;
    const finish = (error?: Error) => { if (done) return; done = true; clearTimeout(timer); unsubscribe?.(); if (error) reject(error); else resolve(); };
    const timer = setTimeout(() => finish(new Error("T3 did not list the new chat in time. Open it from the sessions list.")), 15_000);
    // Fires at once, and later inside his connect/emit with no guard: catch everything.
    unsubscribe = hostState.onDidChangeState((state) => {
      try { if (state.threads.some((thread) => thread.id === threadId)) finish(); }
      catch (cause) { log.error("Worktree chat: state listener failed:", cause); }
    });
    if (done) unsubscribe();
  });

  const start = async () => {
    if (!client.connected) { void vscode.window.showWarningMessage("T3 is not connected."); return; }
    let state;
    try { state = hostState.snapshot(registry.focusedViewId); } catch { state = hostState.snapshot(); }
    const { draft } = state;
    if (!draft.modelSelection) throw new Error("No available provider models. Configure a provider in T3 Code, then reconnect.");
    const root = draft.workspaceRoot;
    if (!root) { void vscode.window.showInformationMessage("Open a git folder first: the worktree is made from its repository."); return; }

    // run and requireSession are private in his T3Client; element access keeps them type-checked (as secrets.ts).
    const refsInput = Schema.decodeUnknownSync(VcsListRefsInput)({ cwd: root, refKind: "local", limit: 200 });
    const refs = await client["run"](client["requireSession"]().client[WS_METHODS.vcsListRefs](refsInput).pipe(Effect.mapError(failure)));
    if (!refs.isRepo) { void vscode.window.showInformationMessage(`${basename(root)} is not a git repository, so T3 cannot make a worktree of it.`); return; }
    if (!refs.refs.length) { void vscode.window.showInformationMessage(`${basename(root)} has no branch yet. Make a first commit, then try again.`); return; }
    const rank = (ref: { current: boolean; isDefault: boolean }) => ref.current ? 0 : ref.isDefault ? 1 : 2;
    const base = await vscode.window.showQuickPick([...refs.refs].sort((a, b) => rank(a) - rank(b)).map((ref) => ({
      label: `$(git-branch) ${ref.name}`, name: ref.name,
      description: [ref.current ? "current" : "", ref.isDefault ? "default" : "", ref.worktreePath ? `checked out in ${basename(ref.worktreePath)}` : ""].filter(Boolean).join(", "),
    })), { title: "New Chat in a Worktree (1/3): base branch", placeHolder: `The new worktree of ${basename(root)} starts from this branch`, matchOnDescription: true });
    if (!base) return;
    const branch = await vscode.window.showInputBox({ title: "New Chat in a Worktree (2/3): new branch",
      prompt: "Name of the new branch. Leave empty and T3 names it from your prompt.", placeHolder: "for example feature/login-fix",
      validateInput: (value) => /\s/.test(value.trim()) ? "A branch name has no spaces." : null });
    if (branch === undefined) return;
    const text = await vscode.window.showInputBox({ title: "New Chat in a Worktree (3/3): first prompt", ignoreFocusOut: true,
      prompt: `What should the agent do on its own branch from ${base.name}?`, validateInput: (value) => value.trim() ? null : "Enter the first prompt." });
    if (text === undefined) return;

    const projectId = draft.projectId ?? await client.createProject(root, basename(root));
    const input = Schema.decodeUnknownSync(OrchestrationV2ThreadLaunchInput)({
      commandId: randomUUID(), creationSource: "web", projectId,
      title: deriveThreadTitleSeed({ text, attachments: [] }).trim() || "Worktree chat", generateTitle: true,
      modelSelection: draft.modelSelection, runtimeMode: draft.runtimeMode, interactionMode: draft.interactionMode,
      workspaceStrategy: { type: "worktree", baseRef: base.name, ...(branch.trim() ? { branch: branch.trim() } : {}) },
      initialMessage: { text, attachments: [] },
    });
    log.info(`Worktree chat: launching on ${base.name}${branch.trim() ? ` as ${branch.trim()}` : ""} in ${root}.`);
    const result = await client["run"](client["requireSession"]().client[ORCHESTRATION_V2_WS_METHODS.launchThread](input).pipe(Effect.mapError(failure)));
    await listed(result.threadId);
    await provider.openSession(result.threadId);
    vscode.window.setStatusBarMessage("T3: preparing the worktree; the agent starts there when it is ready.", 8000);
  };

  return vscode.commands.registerCommand("t3-vscode.ours.worktree.new", () => start().catch((cause: unknown) => {
    log.error("Worktree chat failed:", cause);
    void vscode.window.showErrorMessage(`T3: ${cause instanceof Error ? cause.message : String(cause)}`);
  }));
};
