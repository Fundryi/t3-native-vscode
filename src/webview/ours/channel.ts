/** Webview side of the fork's channel: OURS_EVENT in, Methods.ours out. */
import { bridge, Methods } from "../bridge-client";
import { isObject } from "../../shared/bridge";
import { OURS_EVENT } from "../../shared/ours/channel";

type OursEventHandler = (data: Readonly<Record<string, unknown>>) => void;
const handlers = new Map<string, OursEventHandler>();

bridge.on(OURS_EVENT, (data) => {
  if (!isObject(data) || typeof data.kind !== "string") return;
  // One broken handler never breaks his bridge dispatch loop.
  try { handlers.get(data.kind)?.(data); } catch (cause) { console.error(`T3 VSCode (fork): ${data.kind} failed`, cause); }
});

/** One handler per kind; a duplicate throws, so two features can never share one. */
export function registerOursEvent(kind: string, handler: OursEventHandler): void {
  if (handlers.has(kind)) throw new Error(`The ours event kind "${kind}" is already registered.`);
  handlers.set(kind, handler);
}

/** Never through useActions or run: they treat every result as a HostStateSnapshot. */
export const oursRequest = <T>(kind: string, params: Readonly<Record<string, unknown>> = {}): Promise<T> => bridge.request<T>(Methods.ours, { ...params, kind });

/** A host without the fork RPC (his fixtures, an older host) answers "Unknown fork request."; that is not an error worth his console. */
export const unavailable = (cause: unknown): boolean => cause instanceof Error && /Unknown fork request/.test(cause.message);
export const failed = (what: string) => (cause: unknown): void => { if (!unavailable(cause)) console.error(`T3 VSCode (fork): ${what} failed`, cause); };
