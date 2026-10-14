/**
 * C statusbar (docs/ours/PORT-MAP.md C): one item left of his usage meters says whether a thread of this window runs
 * or waits for you; the T3 sidebar view gets a badge with the number of waiting threads.
 */
import * as vscode from "vscode";
import { activity } from "./activity.js";
import { log } from "./log.js";
import { toastWithLogs } from "./logs.js";
import type { OursDeps } from "./types.js";
import { wrap } from "./wrap.js";

export function activateStatusbar({ hostState, provider }: OursDeps): vscode.Disposable {
  // 101: directly left of his first meter at 100 (usageStatusBar.ts).
  const item = vscode.window.createStatusBarItem("t3-vscode.ours.statusbar", vscode.StatusBarAlignment.Right, 101);
  item.name = "T3 VSCode Activity";
  let view: vscode.WebviewView | undefined;
  let waiting = 0;
  const paintBadge = () => {
    if (view) view.badge = waiting ? { value: waiting, tooltip: `${waiting} T3 thread${waiting === 1 ? " needs" : "s need"} you` } : undefined;
  };
  // His provider keeps the sidebar view private; capture it as VS Code hands it over (map 0.2).
  const unwrap = wrap(provider, "resolveWebviewView", (original) => (...args) => {
    original(...args);
    const resolved = args[0];
    view = resolved;
    resolved.onDidDispose(() => { if (view === resolved) view = undefined; });
    paintBadge();
  });
  const command = vscode.commands.registerCommand("t3-vscode.ours.statusbar.open", async (threadId?: unknown) => {
    try {
      if (typeof threadId === "string") await provider.openSession(threadId);
      else await vscode.commands.executeCommand("t3-vscode.showThreads");
    } catch (cause) { toastWithLogs("error", String(cause), cause); }
  });
  // Runs inside his emit loop (and his connect); never let it throw.
  const unlisten = hostState.onDidChangeState((state) => {
    try {
      const now = activity(state);
      if (now.wait.length !== waiting) { waiting = now.wait.length; paintBadge(); }
      item.text = now.text;
      item.backgroundColor = now.warning ? new vscode.ThemeColor("statusBarItem.warningBackground") : undefined;
      item.command = now.command ? { command: now.command, title: "T3 activity", arguments: [...now.args] } : undefined;
      const tooltip = new vscode.MarkdownString().appendText(now.lines.join("\n")).appendMarkdown("\n\n[Show Logs](command:t3-vscode.ours.log.show)");
      tooltip.isTrusted = { enabledCommands: ["t3-vscode.ours.log.show"] };
      item.tooltip = tooltip;
      item.show();
    } catch (cause) { log.error("Fork status bar update failed.", cause); }
  });
  return vscode.Disposable.from(
    { dispose: () => { unwrap(); unlisten(); waiting = 0; paintBadge(); view = undefined; } },
    command, item,
  );
}
