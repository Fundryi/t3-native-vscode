/** Thread deep links: vscode://<extension id>/thread/<environmentId>/<threadId>. No vscode import, so it is testable. */
const THREAD_ID = /^[A-Za-z0-9_-]{1,80}$/;
const PATH = /^\/thread\/([^/]+)\/([^/]+)$/;

export interface ThreadLink { readonly environmentId: string; readonly threadId: string }

/**
 * `path` is vscode.Uri.path, which VS Code has already percent-decoded (so no decode here; an environment id with
 * a "/" cannot round-trip, T3's are UUIDs). Any web page can open a vscode:// link: accept the one shape only.
 */
export function parseThreadLink(path: string): ThreadLink | undefined {
  const match = PATH.exec(path);
  return match && THREAD_ID.test(match[2]!) ? { environmentId: match[1]!, threadId: match[2]! } : undefined;
}

export function threadLink(uriScheme: string, extensionId: string, link: ThreadLink): string {
  return `${uriScheme}://${extensionId}/thread/${encodeURIComponent(link.environmentId)}/${encodeURIComponent(link.threadId)}`;
}
