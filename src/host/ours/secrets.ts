/**
 * Q14 secrets, host side. The card's buttons (src/webview/ours/secrets.ts) send "secretAnswer"; the value is typed
 * into a VS Code password box here, so it never passes through the webview, a log line or an error message.
 * The paired client may call secrets.answerRequest: it needs orchestration:operate (server RpcAuthorization.ts),
 * which the standard client scopes include, the same scope his dispatchCommand already uses.
 */
import * as vscode from "vscode";
import { SecretRequestAnswerInput, WS_METHODS } from "@t3tools/contracts";
import { SECRET_REQUEST_DEFAULT_PLACEHOLDER, SECRET_REQUEST_PRIVACY_NOTE, secretRequestFailureMessage } from "@t3tools/client-runtime/secret-request";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { pendingSecretRequests } from "../../shared/ours/secrets.js";
import { log } from "./log.js";
import { registerOursRpc } from "./rpc.js";
import type { OursDeps } from "./types.js";

export function activateSecrets({ client, hostState }: OursDeps): vscode.Disposable {
  // The card's first rows: an editor tab misses the registerView push (createPanel registers before mountPanel adds it).
  const offRows = registerOursRpc("secretRequests", (_params, viewId) => {
    const state = hostState.snapshot(viewId);
    return { revision: state.revision, rows: pendingSecretRequests(state.transcript, state.activeThreadId) };
  });
  const unregister = registerOursRpc("secretAnswer", async (params, viewId) => {
    // Only a request the host itself shows as pending in this view's chat; nothing about it is taken from the webview.
    const state = hostState.snapshot(viewId);
    const row = pendingSecretRequests(state.transcript, state.activeThreadId).find((r) => r.item.id === params.itemId);
    if (!row) throw new Error("This secret request is no longer waiting for an answer.");
    const { item } = row;
    let answer: { type: "save"; secret: string } | { type: "decline" } = { type: "decline" };
    if (params.decline !== true) {
      const secret = await vscode.window.showInputBox({
        title: item.label, prompt: item.reason ? `${item.reason} (${SECRET_REQUEST_PRIVACY_NOTE})` : SECRET_REQUEST_PRIVACY_NOTE,
        placeHolder: item.placeholder ?? SECRET_REQUEST_DEFAULT_PLACEHOLDER, password: true, ignoreFocusOut: true,
        validateInput: (value) => value.trim() ? null : "Enter the secret, or press Escape.",
      });
      if (secret === undefined || !secret.trim()) return { answered: false };
      answer = { type: "save", secret: secret.trim() };
    }
    try {
      // Inside the try: a decode error would print its input, which holds the secret.
      const input = Schema.decodeUnknownSync(SecretRequestAnswerInput)({ threadId: item.threadId, turnItemId: item.id, answer });
      // run and requireSession are private in his T3Client; element access keeps them type-checked without a line in his file.
      const failure = await client["run"](client["requireSession"]().client[WS_METHODS.secretsAnswerRequest](input).pipe(
        Effect.as(null), Effect.catch((error) => Effect.succeed(error))));
      if (failure === null) { log.info(`Secret request ${item.id}: ${answer.type === "save" ? "saved" : "declined"}.`); return { answered: true }; }
      throw failure;
    } catch (cause) {
      // Only the vetted message: secretRequestFailureMessage never echoes the request payload.
      const message = secretRequestFailureMessage(cause);
      log.error(`Secret request ${item.id} failed: ${message}`);
      void vscode.window.showErrorMessage(`T3: ${message}`);
      return { answered: false };
    }
  });
  return new vscode.Disposable(() => { offRows(); unregister(); });
}
