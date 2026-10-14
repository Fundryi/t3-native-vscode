/** R15 announce: the sentence a screen reader hears when an approval, question or secret card appears. */
export interface CardAnnouncement {
  /** "Approval needed", "Question" or "Secret requested". */
  readonly kind: string;
  readonly title: string;
  /** Button or option labels in Alt+1..9 order; empty when Alt+N does not reach this card (macOS, another card first). */
  readonly keys: readonly string[];
}

const clean = (text: string) => text.replace(/\s+/g, " ").replace(/(\.{3}|\u2026)$/, "").trim();

export function announcementText({ kind, title, keys }: CardAnnouncement): string {
  const body = clean(title).slice(0, 200);
  const head = `${kind}: ${body}${/[.?!:]$/.test(body) ? "" : "."}`;
  const hints = keys.slice(0, 9).map((label, index) => `Alt+${index + 1} ${clean(label)}`);
  return hints.length ? `${head} ${hints.join(", ")}.` : head;
}
