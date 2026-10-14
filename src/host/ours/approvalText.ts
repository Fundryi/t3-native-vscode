/** Pure: what the approval toast says and which buttons it offers (B, docs/ours/PORT-MAP.md). No vscode import. */
import type { OrchestrationV2ThreadProjection } from "@t3tools/contracts";
import { derivePendingThreadRequests } from "@t3tools/client-runtime/state/thread-requests";

/** T3's ProviderRequestKind, with the words the toast uses. user_input, dynamic_tool_call and auth_refresh keep his toast. */
const APPROVABLE: Readonly<Record<string, string>> = {
  command: "command", "file-read": "file read", "file-change": "file change", "mcp-elicitation": "MCP question", permission: "permission",
};
export const isApprovable = (kind: string | undefined): boolean => kind !== undefined && Object.hasOwn(APPROVABLE, kind);

export type ApprovalButton = "Approve" | "Deny" | "Show";
export interface ApprovalToast {
  readonly text: string;
  readonly buttons: ReadonlyArray<ApprovalButton>;
  /** Why Approve and Deny are missing, for our log. */
  readonly showOnly?: string;
}

type Projection = Pick<OrchestrationV2ThreadProjection, "runtimeRequests" | "turnItems">;
// As his PendingRequests.tsx: the defaults when the provider offers no options.
const DEFAULT_DECISIONS = ["decline", "acceptForSession", "accept"];
const fold = (text: string) => text.replace(/\s+/g, " ").trim();
// A cut command says so, so nobody approves text they think is complete.
const cut = (text: string, max: number) => text.length > max ? `${text.slice(0, max)}...` : text;

/** The command a command approval is about: the command_execution item with the approval item's native ref. */
function commandOf(projection: Projection, requestId: string): string | undefined {
  const ask = projection.turnItems.findLast((item) => item.type === "approval_request" && item.requestId === requestId);
  const ref = ask?.nativeItemRef;
  if (!ref?.nativeId) return undefined;
  const item = projection.turnItems.findLast((item) => item.type === "command_execution"
    && item.nativeItemRef?.nativeId === ref.nativeId && item.nativeItemRef.driver === ref.driver);
  return item?.type === "command_execution" ? item.input : undefined;
}

export function approvalToast(title: string, kind: string, requestId: string, projection: Projection | null): ApprovalToast {
  const name = `"${title || "Untitled session"}"`;
  const approval = projection ? derivePendingThreadRequests(projection).approvals.find((item) => item.requestId === requestId) : undefined;
  if (!projection || !approval) return { text: `T3: ${name} needs your approval.`, buttons: ["Show"], showOnly: "the request is not pending in its thread" };
  const command = approval.requestKind === "command" ? commandOf(projection, requestId) : undefined;
  // T3's prompt may be a reason instead of the command (Codex and Claude adapters); owner default 5: then Show only.
  const detail = cut(fold(command ?? (approval.detail && approval.requestKind === "command" ? `reason: ${approval.detail}` : approval.detail ?? "")), 200);
  const offered: ReadonlyArray<{ readonly decision: string; readonly label: string; readonly warning?: string | undefined }> = approval.options ?? DEFAULT_DECISIONS.map((decision) => ({ decision, label: decision }));
  const decisions = offered.map((option) => option.decision);
  const buttons: ApprovalButton[] = [...(decisions.includes("accept") ? ["Approve" as const] : []), ...(decisions.includes("decline") ? ["Deny" as const] : [])];
  const showOnly = approval.responseCapability !== "live" ? "T3 cannot pass an answer on right now"
    : !detail ? "no request text" : approval.requestKind === "command" && command === undefined ? "no command item for this command request"
      : !buttons.length ? "the request offers neither accept nor decline" : undefined;
  const app = approval.appName ? ` from ${cut(fold(approval.appName), 60)}` : "";
  // The provider's cautions (such as a prompt injection warning) for the two buttons we show.
  const warnings = offered.filter((option) => option.warning && (option.decision === "accept" || option.decision === "decline"))
    .map((option) => ` Warning (${option.label}): ${fold(option.warning ?? "")}`).join("");
  const text = `T3: ${name} needs approval (${APPROVABLE[approval.requestKind] ?? kind}${app})${detail ? `: ${detail}` : ""}${warnings}`;
  return showOnly ? { text, buttons: ["Show"], showOnly } : { text, buttons: [...buttons, "Show"] };
}

/** T3's refusals for a request that is no longer pending (Orchestrator.ts runtime-request.respond). "Provider session x was not found" is not one. */
export const isAlreadyAnswered = (message: string): boolean => /Runtime request \S+ (?:is resolved|is expired|is cancelled|was not found)/.test(message);

/** For anything we log or show from an error: never a bearer token or a socket ticket. */
export const redact = (text: string): string => text.replace(/(Bearer\s+)\S+/gi, "$1***").replace(/((?:wsTicket|token)=)[^&\s"]+/gi, "$1***");
