/**
 * C1 contnative: "Continue in Claude Code / Codex" and "Copy session ID" (docs/ours/CONTINUITY-SCOPE.md F1).
 * T3 keeps the real Claude session id or Codex thread id of a chat on its active provider thread. The hand-over
 * releases T3's hold on that session (provider-session.detach), then opens it in the extension or types the CLI resume
 * line into a terminal (never runs it). A running chat is never handed over quietly: a modal asks first, and only
 * "Stop and continue" stops the run. Called from threadActions.ts, which owns the menu entries.
 */
import * as vscode from "vscode";
import { randomUUID } from "node:crypto";
import type { ThreadSummary } from "../../shared/bridge.js";
import { log } from "./log.js";
import { nativeTool } from "./threadActionsList.js";
import type { OursDeps } from "./types.js";

type Deps = Pick<OursDeps, "client" | "hostState">;
type Projection = Awaited<ReturnType<OursDeps["client"]["getThreadProjection"]>>;

// A run in one of these holds the session. "queued" does not: after our interrupt the queue is held and stays queued.
const ACTIVE = ["preparing", "starting", "running", "waiting"];
const running = (projection: Projection) => projection.runs.some((run) => ACTIVE.includes(run.status));
const activeProviderThread = (projection: Projection) => projection.providerThreads.find((item) => item.id === projection.thread.activeProviderThreadId);

/** The native session of a chat; throws a readable reason when there is none. The id goes into a URI and a terminal line, so it must be plain. */
async function nativeSession(client: Deps["client"], thread: ThreadSummary) {
  const projection = await client.getThreadProjection(thread.id);
  const provider = activeProviderThread(projection);
  const tool = nativeTool(provider?.driver);
  const id = provider?.nativeThreadRef?.nativeId;
  if (!provider || !tool) throw new Error("This chat is not a Claude Code or Codex chat.");
  if (!id) throw new Error(`This chat has no ${tool} session yet. Send a message first.`);
  if (!/^[A-Za-z0-9-]+$/.test(id)) throw new Error(`T3 reports an unexpected ${tool} session id.`);
  return { driver: provider.driver, tool, id };
}

export async function copySessionId(deps: Deps, thread: ThreadSummary): Promise<void> {
  const { tool, id } = await nativeSession(deps.client, thread);
  await vscode.env.clipboard.writeText(id);
  vscode.window.setStatusBarMessage(`T3: ${tool} session ID copied.`, 3000);
}

async function waitUntilStopped(client: Deps["client"], threadId: string): Promise<Projection | undefined> {
  for (const end = Date.now() + 10_000; Date.now() < end;) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    const projection = await client.getThreadProjection(threadId);
    if (!running(projection)) return projection;
  }
  return undefined;
}

export async function continueNative(deps: Deps, thread: ThreadSummary): Promise<void> {
  const { client, hostState } = deps;
  const { driver, tool, id } = await nativeSession(client, thread);
  const claude = driver === "claudeAgent";
  const extensionId = claude ? "anthropic.claude-code" : "openai.chatgpt";
  const line = claude ? `claude --resume ${id}` : `codex resume ${id}`;
  const title = thread.title || "Untitled";
  // The pick comes first, so Escape leaves the chat untouched.
  const choice = await vscode.window.showQuickPick([
    ...(vscode.extensions.getExtension(extensionId) ? [{ label: `$(link-external) Open in the ${tool} extension`, terminal: false }] : []),
    { label: "$(terminal) Type the resume command in a terminal", description: line, terminal: true },
  ], { title: `Continue in ${tool}: ${title}`, placeHolder: "T3 lets go of the chat, then it opens here" });
  if (!choice) return;

  // Fresh state: the chat may have started a run while the pick was open.
  let projection = await client.getThreadProjection(thread.id);
  if (running(projection)) {
    const stop = "Stop and continue";
    const answer = await vscode.window.showWarningMessage(`"${title}" is still running in T3.`, {
      modal: true,
      detail: `Two tools writing one chat can split it. "${stop}" stops the T3 run first, then opens the chat in ${tool}. Messages queued in T3 stay held.`,
    }, stop);
    if (answer !== stop) return;
    log.info(`Continue in ${tool}: stopping the run of ${thread.id}.`);
    // His Stop button's command, for each active run of the fresh projection (the shell's activeRunId can lag).
    for (const run of projection.runs.filter((item) => ACTIVE.includes(item.status))) {
      await client.dispatch({ type: "run.interrupt", commandId: randomUUID(), threadId: thread.id, runId: run.id, holdQueue: true });
    }
    const stopped = await waitUntilStopped(client, thread.id);
    if (!stopped) throw new Error("T3 could not stop the run in time; nothing was handed over.");
    projection = stopped;
  }

  // Release T3's hold on the session, as T3 does on a workspace change (live sessions only).
  const sessionId = activeProviderThread(projection)?.providerSessionId;
  const session = projection.providerSessions.find((item) => item.id === sessionId);
  if (session && session.status !== "stopped" && session.status !== "error") {
    await client.dispatch({ type: "provider-session.detach", commandId: randomUUID(), threadId: thread.id, providerSessionId: session.id, reason: `Continued in ${tool}.` });
  }
  log.info(`Continue in ${tool}: ${thread.id} handed over (${choice.terminal ? "terminal" : "extension"}).`);

  if (choice.terminal) {
    let cwd: string | undefined;
    try { cwd = hostState.workspaceForThread(thread.id) ?? undefined; } catch { /* the window folder then */ }
    const terminal = vscode.window.createTerminal({ name: tool, ...(cwd ? { cwd } : {}) });
    terminal.show(false);
    terminal.sendText(line, false); // typed, never run: the owner presses Enter
    return;
  }
  if (claude) {
    // The command its /open URI handler runs; direct, so VS Code does not ask "Allow an extension to open this URI?".
    try { await vscode.commands.executeCommand("claude-vscode.primaryEditor.open", id); return; }
    catch (cause) { log.error("Continue in Claude Code: its open command failed; trying its URI.", cause); }
  }
  const uri = vscode.Uri.parse(claude ? `${vscode.env.uriScheme}://anthropic.claude-code/open?session=${id}` : `${vscode.env.uriScheme}://openai.chatgpt/local/${id}`);
  if (!await vscode.env.openExternal(uri)) throw new Error(`${tool} did not open the chat.`);
}
