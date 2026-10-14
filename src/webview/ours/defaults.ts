/**
 * R2 defaults, webview part: the permission picker explains each mode on hover, with the one-line meanings from
 * T3's docs/user/permission-modes.md. Set on hover or focus, because the select remounts when the composer moves
 * its options into the overflow popup.
 */
const MEANINGS: Readonly<Record<string, string>> = {
  "approval-required": "Requests approval for commands and file changes.",
  "auto-accept-edits": "Approves file edits automatically; other actions can still require approval.",
  auto: "Uses the provider's automatic review to approve routine actions and ask about others.",
  "full-access": "Allows commands and edits without approval prompts.",
};

const explain = (event: Event) => {
  const select = event.target instanceof Element ? event.target.closest<HTMLSelectElement>('select[aria-label="Permission mode"]') : null;
  if (!select) return;
  for (const option of select.options) if (MEANINGS[option.value]) option.title = MEANINGS[option.value]!;
  select.title = MEANINGS[select.value] ?? "";
};
for (const type of ["pointerover", "focusin", "change"]) window.addEventListener(type, explain, true);
