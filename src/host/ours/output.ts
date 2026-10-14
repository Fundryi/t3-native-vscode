/**
 * R16 output, host side. Request from the webview (src/webview/ours/rowCopy.ts):
 * - outputOpen { text, what }: a command or tool box as an untitled editor tab ("output" as log, else plain text).
 * The text comes from the webview, as for his copyText: an untitled document writes no file.
 */
import * as vscode from "vscode";
import { registerOursRpc } from "./rpc.js";
import type { OursDeps } from "./types.js";

export function activateOutput(_deps: OursDeps): vscode.Disposable {
  const off = registerOursRpc("outputOpen", async (params) => {
    try {
      if (typeof params.text !== "string" || !params.text) throw new Error("There is no text to open.");
      const language = params.what === "output" ? "log" : "plaintext";
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ language, content: params.text }), { preview: false });
    } catch (cause) {
      void vscode.window.showErrorMessage(`T3 VSCode could not open the output: ${cause instanceof Error ? cause.message : String(cause)}`);
      throw cause;
    }
  });
  return { dispose: off };
}
