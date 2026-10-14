/**
 * Parses what a drag carried into a T3 chat (outside input from the webview or a TreeView drop). No vscode import, so
 * it is tested. Returns `file:` uris and Windows drive paths as given; the caller turns them into vscode.Uri.
 */
export const MAX_DROP_ITEMS = 50;
const MAX_LINE_CHARS = 2000;
const DRIVE_PATH = /^[A-Za-z]:[\\/]/;

/** A Windows absolute path such as VS Code puts into text/plain; vscode.Uri.parse would read its drive as a scheme. */
export const isDrivePath = (line: string): boolean => DRIVE_PATH.test(line);

/** The uri list when it has content (it carries every item), else the text/plain lines. Overlong lines are skipped, not cut. */
export function parseDrop(uriList: string, text: string): string[] {
  return (uriList.trim() ? uriList : text).split(/\r?\n/).map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && line.length <= MAX_LINE_CHARS && (/^file:/i.test(line) || isDrivePath(line)))
    .slice(0, MAX_DROP_ITEMS);
}
