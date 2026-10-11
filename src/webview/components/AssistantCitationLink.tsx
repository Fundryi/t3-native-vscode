import { createContext, useContext, useState } from "react";
import { ChevronDownIcon, ChevronUpIcon, ExternalLinkIcon } from "lucide-react";
import type { AssistantCitation } from "@t3tools/contracts";

export const citationKey = (citation: AssistantCitation) => [citation.environmentId, citation.threadId, citation.messageId, citation.start, citation.end, citation.text].join("\u0000");
export const AssistantCitationNumbersContext = createContext<ReadonlyMap<string, number> | null>(null);

export function AssistantCitationLink({ citation }: { readonly citation: AssistantCitation }) {
  const [expanded, setExpanded] = useState(false); const number = useContext(AssistantCitationNumbersContext)?.get(citationKey(citation));
  return <span className="citation-card" data-expanded={expanded}>
    <span className="citation-card-quote">
      <span className="citation-card-badge" aria-hidden="true">❝{number}</span>
      <span className="citation-card-text">{citation.text}</span>
      <span className="citation-card-tools">
        <button type="button" className="citation-card-tool" aria-label={expanded ? "Collapse quote" : "Expand quote"} title={expanded ? "Collapse quote" : "Expand quote"} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? <ChevronUpIcon size={13} /> : <ChevronDownIcon size={13} />}</button>
        <button type="button" className="citation-card-tool" aria-label="Open quote source" title="Open quote source" onClick={() => window.dispatchEvent(new CustomEvent("t3-open-citation", { detail: citation }))}><ExternalLinkIcon size={13} /></button>
      </span>
    </span>
    {/* Labelled, and a real node rather than generated content, so the comment stays selectable and attributable to its quote. */}
    {citation.comment === undefined ? null : <span className="citation-card-comment"><span className="citation-card-comment-label">Comment:</span> {citation.comment}</span>}
  </span>;
}
