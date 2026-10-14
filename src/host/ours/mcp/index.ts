/**
 * Feature A: the VS Code context server. Agents T3 starts reach this window through ~/.t3-vscode/bridge.js (stdio),
 * which finds the window by its discovery file and forwards to the loopback MCP server here. Uses no T3 surface.
 */
import * as vscode from "vscode";
import { randomBytes } from "node:crypto";
import { log } from "../log.js";
import type { OursDeps } from "../types.js";
import { isRemote, prepareHome, publishWindow } from "./discovery.js";
import { startMcpServer } from "./server.js";
import { activateSetup } from "./setup.js";
import { createTools } from "./tools.js";

export function activateMcp(deps: OursDeps): vscode.Disposable {
  const disposables: vscode.Disposable[] = [activateSetup(deps)];
  prepareHome();
  if (isRemote()) {
    log.info(`Context server: not started, this window is remote or virtual (${vscode.env.remoteName || "non-file folders"}).`);
    return vscode.Disposable.from(...disposables);
  }
  const { tools, meta, dispose: disposeTools } = createTools();
  disposables.push({ dispose: disposeTools });
  let disposed = false;
  const token = randomBytes(32).toString("hex");
  const version = String(deps.context.extension.packageJSON.version ?? "0.0.0");
  startMcpServer({ token, tools, meta, version }).then((server) => {
    if (disposed) return server.close();
    disposables.push(publishWindow(server.port, token), { dispose: () => server.close() });
  }, (cause: unknown) => log.error("Context server failed to start:", cause));
  return { dispose: () => { disposed = true; vscode.Disposable.from(...disposables).dispose(); } };
}
