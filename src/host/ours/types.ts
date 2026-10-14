/** What activateOurs hands every fork feature. Type-only, so testable modules can import it without vscode. */
import type * as vscode from "vscode";
import type { WebviewRegistry } from "../bridge.js";
import type { HostState } from "../hostState.js";
import type { InputNotificationTracker } from "../inputNotifications.js";
import type { T3Client } from "../t3Client.js";
import type { FileReference } from "../../shared/composerContext.js";
import type { DraftTransfer } from "../../shared/viewDraft.js";

/** His T3WebviewProvider is not exported; a class instance with private fields still satisfies this shape. */
export interface OursProvider {
  openSession(threadId: string): Promise<string>;
  insertReference(reference: FileReference): Promise<void>;
  createPanel(sourceViewId?: string, transfer?: DraftTransfer): Promise<string>;
  createNewPanel(sourceViewId?: string): Promise<string>;
  /** A method, not readonly: C wraps it (see docs/ours/PORT-MAP.md 0.2). */
  resolveWebviewView(webviewView: vscode.WebviewView): void;
}

export interface OursDeps {
  readonly context: vscode.ExtensionContext;
  readonly client: T3Client;
  readonly hostState: HostState;
  readonly registry: WebviewRegistry;
  readonly provider: OursProvider;
  readonly notifications: InputNotificationTracker;
}

/** A fork feature: synchronous, registers everything it needs and returns one Disposable. */
export type OursFeature = (deps: OursDeps) => vscode.Disposable;
