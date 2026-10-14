/**
 * The one webview-to-host method of the fork (Methods.ours). His bridge.ts header promises no generic RPC tunnel,
 * so the kind set stays closed: only registered kinds run, and each handler validates its own params.
 * No value import of vscode and no import of index.ts or a feature: his host tests load this file through bridge.ts.
 */
export type OursRpcHandler = (params: Readonly<Record<string, unknown>>, viewId: string) => unknown;

const handlers = new Map<string, OursRpcHandler>();

/** Returns the unregister function. A duplicate kind throws, so two features can never share one. */
export function registerOursRpc(kind: string, handler: OursRpcHandler): () => void {
  if (handlers.has(kind)) throw new Error(`The ours request kind "${kind}" is already registered.`);
  handlers.set(kind, handler);
  return () => { if (handlers.get(kind) === handler) handlers.delete(kind); };
}

/** viewId comes from his attach, never from params (the webview is a trust boundary). */
export async function oursRpc(params: Readonly<Record<string, unknown>>, viewId: string): Promise<unknown> {
  const handler = typeof params.kind === "string" ? handlers.get(params.kind) : undefined;
  if (!handler) throw new Error("Unknown fork request.");
  return handler(params, viewId);
}
