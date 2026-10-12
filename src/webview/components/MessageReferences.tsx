import { ChevronDownIcon, ChevronUpIcon, ExternalLinkIcon, FileCode2Icon } from "lucide-react";
import type { MessageReference } from "../../shared/messageReferences";
import { setCitationExpanded, useCitationExpanded } from "../citationExpansion";
import { useActions } from "../actions";
import { CodeBlock } from "./CodeBlock";

/** The store is keyed text, not quote-specific; namespacing by message keeps rows and cards apart. */
const rowKey = (scope: string, reference: MessageReference) => `reference\u0000${scope}\u0000${reference.key}`;

function ReferenceRow({ reference, scope, threadId }: { readonly reference: MessageReference; readonly scope: string; readonly threadId: string }) {
  const key = rowKey(scope, reference); const expanded = useCitationExpanded(key); const run = useActions();
  const toggle = () => setCitationExpanded(key, !expanded);
  return <div className="message-reference" data-expanded={expanded} data-citation-key={key}>
    {/* A role, not a <button>: session search skips text inside buttons, and the path has to stay findable. */}
    <div className="message-reference-head" role="button" tabIndex={0} aria-expanded={expanded} aria-label={`${expanded ? "Collapse" : "Expand"} reference ${reference.label}`}
      onClick={toggle} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggle(); } }}>
      <FileCode2Icon size={13} aria-hidden="true" />
      <span className="message-reference-path">{reference.label}</span>
      {/* Generated, so it is hidden from the search walker: counting it would shift every later match. */}
      <span className="message-reference-summary" aria-hidden="true">{reference.summary}{reference.preview ? ` · ${reference.preview}` : ""}</span>
      <button type="button" className="icon-button message-reference-tool" aria-label={`Open ${reference.label}`} title="Open in the editor"
        onClick={(event) => { event.stopPropagation(); void run("openLink", { href: reference.href, threadId }); }}><ExternalLinkIcon size={13} /></button>
      {expanded ? <ChevronUpIcon size={13} aria-hidden="true" /> : <ChevronDownIcon size={13} aria-hidden="true" />}
    </div>
    {/* Mounted whether or not the row is open, and collapsed by CSS: search counts occurrences in the DOM,
        and a hit inside a snapshot has to resolve to a range the highlighter can hold. */}
    <div className="message-reference-body">
      {reference.detail ? <p className="message-reference-detail">{reference.detail}</p> : null}
      {reference.snapshot ? <CodeBlock code={reference.snapshot} {...(reference.language ? { language: reference.language } : {})} {...(reference.startLine ? { startLine: reference.startLine } : {})} /> : null}
    </div>
  </div>;
}

/**
 * The reference sections of a sent message, as collapsed rows under the prose the user typed. The
 * container keeps the `markdown` class because code-block styling is scoped under it and the session
 * search highlighter walks `.markdown` containers in document order, which is the order the rows and
 * the message's own text have.
 */
export function MessageReferences({ references, scope, threadId }: { readonly references: ReadonlyArray<MessageReference>; readonly scope: string; readonly threadId: string }) {
  if (!references.length) return null;
  return <div className="markdown message-references">{references.map((reference) => <ReferenceRow key={reference.key} reference={reference} scope={scope} threadId={threadId} />)}</div>;
}
