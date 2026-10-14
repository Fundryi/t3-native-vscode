/** K layout: where a createPanel call goes. No vscode import, so a node:test can load it. */
export type LayoutMode = "sidebar" | "editor";
export type PanelRoute = "his" | "sidebar" | "his-then-list";

export const layoutMode = (value: unknown): LayoutMode => value === "editor" ? "editor" : "sidebar";

/**
 * A call from the sidebar without a draft (a thread click, his insertReference, our composer helpers) shows the chat in
 * the sidebar. With a draft it is a pop-out (his App openInTab path): his panel opens and the sidebar goes back to the list.
 */
export function panelRoute(mode: LayoutMode, sourceViewId: string, sidebarId: string, hasTransfer: boolean): PanelRoute {
  if (mode !== "sidebar" || sourceViewId !== sidebarId) return "his";
  return hasTransfer ? "his-then-list" : "sidebar";
}
