/**
 * Q14 secrets: which secret requests the active chat can answer. Host (trust check) and webview (card) share it.
 * A request inherited from another thread (a fork) is answered only where it was asked, as T3 does
 * (vendored secretRequestDisplay: "pending-elsewhere").
 */
import type { TranscriptItem, WireTurnItem } from "../bridge.js";

export type SecretRequestRow = TranscriptItem & { readonly item: Extract<WireTurnItem, { readonly type: "secret_request" }> };

export const pendingSecretRequests = (transcript: ReadonlyArray<TranscriptItem>, activeThreadId: string | undefined): SecretRequestRow[] =>
  transcript.filter((row): row is SecretRequestRow =>
    row.item.type === "secret_request" && row.item.secretStatus === "pending" && activeThreadId !== undefined && row.sourceThreadId === activeThreadId);
