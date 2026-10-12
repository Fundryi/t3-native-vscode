import { searchPattern } from "../shared/sessionSearch";
import { isCitationExpanded, setCitationExpanded } from "./citationExpansion";
import type { SearchTarget } from "./components/SessionFind";

/** CSS Highlights leaves the markdown/source DOM intact for quotes and citations. */
export function highlightSearchResult(root: HTMLElement, target: SearchTarget): boolean {
  const selector = target.field === "input" ? ".command-input" : target.field === "output" ? ".tool-output" : target.field.startsWith("attachment:") ? ".attachments" : target.field === "text" ? ".markdown" : null;
  const containers = selector ? [...root.querySelectorAll<HTMLElement>(selector)] : [root];
  const nodes: Text[] = [];
  for (const container of containers.length ? containers : [root]) {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, { acceptNode: (node) => node.parentElement?.closest("button,script,style,.katex-mathml,[aria-hidden=true]") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
    while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  }
  const text = nodes.map((node) => node.data).join("");
  const hits = [...text.matchAll(searchPattern(target))];
  const hit = hits[target.occurrence]; if (!hit) return false;
  let offset = 0, start: { node: Text; offset: number } | undefined, end: { node: Text; offset: number } | undefined;
  for (const node of nodes) {
    if (!start && offset + node.length > hit.index) start = { node, offset: hit.index - offset };
    if (!end && offset + node.length >= hit.index + hit[0].length) { end = { node, offset: hit.index + hit[0].length - offset }; break; }
    offset += node.length;
  }
  if (!start || !end) return false;
  const range = document.createRange(); range.setStart(start.node, start.offset); range.setEnd(end.node, end.offset);
  // A clamped quote card or a collapsed reference row hides the hit. Expand it and report failure so
  // the caller's retry re-resolves and scrolls once the grown row has laid out; waiting on the rendered
  // attribute rather than a frame count keeps that honest when React commits late.
  const card = range.startContainer.parentElement?.closest<HTMLElement>(".citation-card, .message-reference");
  const key = card?.dataset.expanded === "true" ? undefined : card?.dataset.citationKey;
  if (key) { if (!isCitationExpanded(key)) setCitationExpanded(key, true); return false; }
  if (typeof Highlight !== "undefined" && CSS.highlights) CSS.highlights.set("t3-session-match", new Highlight(range));
  range.startContainer.parentElement?.scrollIntoView({ block: "center", behavior: "instant" });
  return true;
}
