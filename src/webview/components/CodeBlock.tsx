import { useState, type CSSProperties, type ReactNode } from "react";
import { CheckIcon, CopyIcon, WrapTextIcon } from "lucide-react";
import { useActions } from "../actions";
import { codeBlockLayout } from "../../shared/codeBlock";

/**
 * One grid row per logical line, number and text in the same row: a wrapped line grows its row and keeps its single
 * number, with nothing measured. The numbers are generated content, so they can be neither selected nor searched,
 * while each line keeps its closing newline so the displayed text, and a copied selection, are the source.
 */
export function CodeBlock({ code, language, startLine }: {
  readonly code: string;
  readonly language?: string;
  /** First line's number; defaults to 1. Lets a file-range snippet show its real line numbers. */
  readonly startLine?: number;
}): ReactNode {
  const run = useActions(); const [wrap, setWrap] = useState(true); const [copied, setCopied] = useState(false);
  const { source, lines, first, digits } = codeBlockLayout(code, startLine);
  return <div className="code-block" data-wrap={wrap} role="group" aria-label={language ? `${language} code` : "Code"} style={{ "--code-digits": digits } as CSSProperties}>
    <div className="code-block-header">
      <span className="code-block-language" aria-hidden="true">{language}</span>
      <button type="button" className="icon-button code-block-tool" title="Wrap lines" aria-label="Wrap lines" aria-pressed={wrap} onClick={() => setWrap(!wrap)}><WrapTextIcon size={13} /></button>
      <button type="button" className="icon-button code-block-tool" title="Copy code" aria-label="Copy code" onClick={() => { void run("copyText", { text: source }).then(setCopied); }}>{copied ? <CheckIcon size={13} /> : <CopyIcon size={13} />}</button>
    </div>
    <pre className="code-block-body" tabIndex={wrap ? undefined : 0}><code className={language ? `language-${language}` : undefined}>{lines.map((line, index) => <span className="code-block-line" key={index}><span className="code-block-number" data-line={first + index} aria-hidden="true" /><span className="code-block-text">{line + "\n"}</span></span>)}</code></pre>
  </div>;
}
