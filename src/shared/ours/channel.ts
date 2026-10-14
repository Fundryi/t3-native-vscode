/**
 * The fork's host-to-webview event name. Not added to his Events (one line he edits often): bridge-client dispatches
 * any event string and postWhenReady only queues and forwards. A direct "ours" as BridgeEvent fails TS2352.
 */
import type { BridgeEvent } from "../bridge.js";

export const OURS_EVENT = "ours" as string as BridgeEvent;
