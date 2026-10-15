/**
 * C2 importchat: "Continue a Claude Code or Codex Chat" (docs/ours/CONTINUITY-SCOPE.md F2). Lists this folder's
 * Claude Code and Codex chats from their files (read only), and opens the picked one as a T3 thread on the same native
 * session: thread.create with importedNativeThread (fact 9), as T3's own ACP import does (apps/server/src/ws.ts).
 * The T3 view starts empty; the agent keeps its whole memory.
 * Claude chats are listed only with t3-vscode.ours.importchat.claude on: by T3's resume rule (fact 15) the first T3
 * message on an imported Claude chat may start a NEW Claude session; that live test has not passed yet.
 * A chat that may still be running in the other tool asks first: two tools writing one chat can split it. Open is known
 * from Claude Code's sessions/<pid>.json (live pid) and Codex's writer lock, and re-checked after "I closed it there".
 * A chat already in T3 (ours, or imported by T3's first-run wizard) opens that thread; an archived one is not re-imported.
 */
import * as vscode from "vscode";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { log } from "./log.js";
import { age, importThreadId, maybeLive, pathKey, type Driver } from "./importChatParse.js";
import { claudeChats, claudeRunning, codexChats, codexHome, type Chat } from "./importChatScan.js";
import type { OursFeature } from "./types.js";

const TOOL: Record<Driver, string> = { claudeAgent: "Claude Code", codex: "Codex" };

export const activateImportChat: OursFeature = ({ client, hostState, provider }) => {
  const claudeOn = () => vscode.workspace.getConfiguration("t3-vscode.ours.importchat").get<boolean>("claude", false);

  /** Resolves when his host state lists the thread (openSession needs it), or rejects after 15 s. */
  const listed = (threadId: string) => new Promise<void>((resolve, reject) => {
    let done = false, unsubscribe: (() => void) | undefined;
    const finish = (error?: Error) => { if (done) return; done = true; clearTimeout(timer); unsubscribe?.(); if (error) reject(error); else resolve(); };
    const timer = setTimeout(() => finish(new Error("T3 did not list the new chat in time. Open it from the sessions list.")), 15_000);
    // Fires at once, and later inside his connect/emit with no guard: catch everything.
    unsubscribe = hostState.onDidChangeState((state) => {
      try { if (state.threads.some((thread) => thread.id === threadId)) finish(); }
      catch (cause) { log.error("Continue a chat: state listener failed:", cause); }
    });
    if (done) unsubscribe();
  });

  /** As T3's own ACP import: the first available instance of that driver with its default model, approval-required. */
  const selection = (driver: Driver) => {
    const instance = client.config?.providers.find((item) => item.driver === driver && item.enabled && item.installed && item.availability !== "unavailable");
    const model = instance?.models.find((item) => item.isDefault) ?? instance?.models[0];
    if (!instance || !model) throw new Error(`T3 has no available ${TOOL[driver]} provider. Enable it in T3 Code, then try again.`);
    const modes = instance.supportedRuntimeModes;
    return { modelSelection: { instanceId: instance.instanceId, model: model.slug }, runtimeMode: !modes?.length || modes.includes("approval-required") ? "approval-required" : modes[0] };
  };

  const projectFor = async (root: string): Promise<string> =>
    hostState.snapshot().projects.find((project) => pathKey(project.workspaceRoot) === pathKey(root))?.id ?? client.createProject(root, basename(root));

  /** T3 thread states by id. The shell snapshot never lists archived threads (ShellStream.ts), so the archive is read too. */
  const t3Threads = async () => {
    const [shell, archive] = await Promise.all([client.snapshotShell(), client.snapshotArchive().catch((cause: unknown) => {
      log.error("Continue a chat: could not read archived T3 chats; an archived import is not detected:", cause); return undefined;
    })]);
    const threads = new Map<string, "active" | "archived" | "deleted">();
    for (const thread of shell.threads) threads.set(thread.id, thread.deletedAt ? "deleted" : "active");
    for (const thread of archive?.threads ?? []) if (!thread.deletedAt && !threads.has(thread.id)) threads.set(thread.id, "archived"); // active wins, as his hostState
    return threads;
  };
  /** This chat's T3 thread: ours (derived id) or the one T3's first-run wizard made (import:<instance id>:<native id>). */
  const existingFor = (threads: ReadonlyMap<string, string>, chat: Chat) => {
    const ids = [importThreadId(chat.driver, chat.nativeId), ...(client.config?.providers ?? [])
      .filter((item) => item.driver === chat.driver).map((item) => `import:${item.instanceId}:${chat.nativeId}`)];
    const active = ids.find((id) => threads.get(id) === "active"), archived = ids.find((id) => threads.get(id) === "archived");
    return active ? { id: active, archived: false } : archived ? { id: archived, archived: true } : undefined;
  };

  /**
   * Open in the other tool now. Codex keeps <thread id>.lock in thread-writer-locks while a process has the chat open;
   * Claude Code keeps sessions/<pid>.json with the session id while its process runs. Both are removed on close.
   */
  const openNow = async (chat: Chat): Promise<boolean> => chat.driver === "codex"
    ? existsSync(join(codexHome(), "thread-writer-locks", `${chat.nativeId}.lock`)) : claudeRunning(chat.nativeId);

  /** One writer per session: a chat that may still be open in the other tool asks before T3 takes it over. */
  const confirmLive = async (chat: Chat): Promise<boolean> => {
    const now = Date.now(), modifiedMs = (await stat(chat.file)).mtimeMs;
    const open = await openNow(chat);
    if (!maybeLive(modifiedMs, now, open)) return true;
    const tool = TOOL[chat.driver];
    const why = open ? `is open in ${tool} right now` : `changed ${age(modifiedMs, now)} and may still be running in ${tool}`;
    const go = "I closed it there, continue";
    log.info(`Continue a chat: ${chat.driver} ${chat.nativeId} ${open ? `is open in ${tool}` : "changed recently"}; asking.`);
    if (await vscode.window.showWarningMessage(`This ${tool} chat ${why}.`,
      { modal: true, detail: `Two tools writing one chat can split it. Stop it and close it in ${tool} first, then continue here.` }, go) !== go) return false;
    // "I closed it" is checked: the lock or the live session file still there means the chat is still open.
    if (await openNow(chat)) {
      log.info(`Continue a chat: ${chat.driver} ${chat.nativeId} is still open in ${tool}; not taken over.`);
      void vscode.window.showWarningMessage(`This chat is still open in ${tool}. Close it there first, then try again.`);
      return false;
    }
    return true;
  };

  const importChat = async (chat: Chat) => {
    const threads = await t3Threads(), existing = existingFor(threads, chat);
    if (existing?.archived) { void vscode.window.showInformationMessage(`This ${TOOL[chat.driver]} chat is archived in T3. Restore it there to continue it.`); return; }
    if (existing) { await provider.openSession(existing.id); return; }
    if (!await confirmLive(chat)) return;
    const { modelSelection, runtimeMode } = selection(chat.driver);
    const projectId = await projectFor(chat.root);
    // Only a deleted earlier import can still hold the derived id here (active and archived returned above); that chat gets a fresh one.
    const derived = importThreadId(chat.driver, chat.nativeId), threadId = threads.has(derived) ? randomUUID() : derived;
    const title = chat.title === "Untitled" ? `${TOOL[chat.driver]} chat` : chat.title;
    log.info(`Continue a chat: importing ${chat.driver} ${chat.nativeId} as thread ${threadId}.`);
    await client.dispatch({ type: "thread.create", commandId: randomUUID(), threadId, projectId, createdBy: "user", creationSource: "web",
      title, modelSelection, runtimeMode, interactionMode: "default", branch: null, worktreePath: null,
      importedNativeThread: { ref: { driver: chat.driver, nativeId: chat.nativeId, strength: "strong" },
        metadata: { itemIdentityVersion: 2, title, updatedAt: new Date(chat.modifiedMs).toISOString() } } });
    await listed(threadId);
    await provider.openSession(threadId);
    vscode.window.setStatusBarMessage(`T3: continuing the ${TOOL[chat.driver]} chat. Its earlier messages stay in ${TOOL[chat.driver]}; the agent remembers them.`, 8000);
  };

  const pick = async () => {
    if (!client.connected) { void vscode.window.showWarningMessage("T3 is not connected."); return; }
    const roots = (vscode.workspace.workspaceFolders ?? []).filter((folder) => folder.uri.scheme === "file").map((folder) => folder.uri.fsPath);
    if (!roots.length) { void vscode.window.showInformationMessage("Open a folder first: this lists the Claude Code and Codex chats of the open folder."); return; }
    const withClaude = claudeOn();
    if (!withClaude) log.info("Continue a chat: Claude Code chats hidden (t3-vscode.ours.importchat.claude is off; T3 may start a new Claude session on the first message).");
    const [threads, chats] = await Promise.all([t3Threads(),
      Promise.all([codexChats(roots), ...(withClaude ? roots.map(claudeChats) : [])]).then((lists) => lists.flat().sort((a, b) => b.modifiedMs - a.modifiedMs))]);
    const now = Date.now();
    const items = chats.map((chat) => {
      const existing = existingFor(threads, chat);
      return { label: `$(${chat.driver === "codex" ? "terminal" : "sparkle"}) ${chat.title}`, chat,
        description: `${TOOL[chat.driver]}, ${age(chat.modifiedMs, now)}${existing?.archived ? ", archived in T3" : existing ? ", already in T3" : ""}`,
        ...(roots.length > 1 ? { detail: chat.root } : {}) };
    });
    const what = withClaude ? "Claude Code or Codex" : "Codex";
    if (!items.length) { void vscode.window.showInformationMessage(`No ${what} chats of this folder found${withClaude ? "" : " (Claude Code chats are off: setting t3-vscode.ours.importchat.claude)"}.`); return; }
    const choice = await vscode.window.showQuickPick(items, { title: `Continue a ${what} chat in T3`, placeHolder: "Newest first. Opens as a T3 chat on the same session.", matchOnDescription: true });
    if (choice) await importChat(choice.chat);
  };

  return vscode.commands.registerCommand("t3-vscode.ours.importchat.pick", () => pick().catch((cause: unknown) => {
    log.error("Continue a chat failed:", cause);
    void vscode.window.showErrorMessage(`T3: ${cause instanceof Error ? cause.message : String(cause)}`);
  }));
};
