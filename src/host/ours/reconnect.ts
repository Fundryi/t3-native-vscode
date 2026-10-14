/**
 * Q4: reconnect by itself after T3 restarts. His recoverConnection gives up after 3 tries over 6 s
 * (hostState.ts recoverConnection); then the view stays on his setup screen until a click.
 * While that screen shows a server problem (never pairing or cli-missing), this retries on a change of
 * <home>/userdata/server-runtime.json, every 10 s and on window focus, through his own hostState.reconnect().
 */
import * as vscode from "vscode";
import { join } from "node:path";
import { discoverServer } from "../serverDiscovery.js";
import { SecretCredentialStore } from "../sessionStore.js";
import { log } from "./log.js";
import { registerOursRpc } from "./rpc.js";
import type { OursDeps } from "./types.js";

const AUTO_KINDS = new Set(["missing-runtime", "server-stopped", "unreachable", "connection"]);
const POLL_MS = 10_000;

export function activateReconnect({ context, hostState }: OursDeps): vscode.Disposable {
  const credentials = new SecretCredentialStore(context.secrets);
  const disposables: vscode.Disposable[] = [];
  let home: string | undefined;
  let dead = false, ready = false, busy = false, disposed = false;
  let failures = 0, lastTry = 0;

  const attempt = async (force: boolean): Promise<void> => {
    if (!dead || busy || disposed || !home) return;
    // A server that is found but still fails to connect backs off to 80 s; real signals (file, focus) do not wait.
    if (!force && Date.now() - lastTry < POLL_MS * 2 ** Math.min(failures, 3) - 1000) return;
    busy = true; lastTry = Date.now();
    try {
      // Without a stored credential for this server his connect(false) runs `t3 pair`; a poll must never run the CLI.
      const stored = await credentials.get();
      if (!stored) return;
      // Probe first, so his setup screen does not blink to "Connecting" every tick while T3 is down.
      const found = await discoverServer(home);
      if (!found.ok || found.server.descriptor.environmentId !== stored.environmentId || !dead || disposed) return;
      log.info("Reconnect: T3 answers again, reconnecting.");
      await hostState.reconnect();
      if (!ready) failures += 1;
    } catch (cause) { log.error("Reconnect attempt failed:", cause); }
    finally { busy = false; }
  };

  const watch = (folder: string) => {
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(folder), "server-runtime.json"));
    // T3 may write the file before it listens: try now and once more a little later.
    const changed = () => { for (const delay of [500, 3000]) setTimeout(() => void attempt(true), delay); };
    disposables.push(watcher, watcher.onDidCreate(changed), watcher.onDidChange(changed));
  };

  // Runs inside his emit loop (and his connect); never let it throw.
  const unlisten = hostState.onDidChangeState((state) => {
    try {
      ready = state.phase === "ready";
      if (ready) failures = 0;
      dead = (state.phase === "no-server" || state.phase === "error") && AUTO_KINDS.has(state.connectionSetup?.problem?.kind ?? "");
      if (home === undefined) { home = state.home; watch(join(home, "userdata")); }
    } catch (cause) { log.error("Reconnect state listener failed:", cause); }
  });
  const timer = setInterval(() => void attempt(false), POLL_MS);
  disposables.push(
    vscode.window.onDidChangeWindowState((state) => { if (state.focused) void attempt(true); }),
    { dispose: registerOursRpc("reconnectOpenApp", () => vscode.commands.executeCommand("t3-vscode.ours.desktop.open")) },
  );
  return new vscode.Disposable(() => {
    disposed = true; clearInterval(timer); unlisten();
    for (const disposable of disposables) disposable.dispose();
  });
}
