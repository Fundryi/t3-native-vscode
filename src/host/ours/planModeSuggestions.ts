/** Q13 plan mode: the /plan and /default built-ins T3 web shows next to /model (ChatComposer.tsx). No vscode import. */
import type { ComposerSuggestion } from "../../shared/bridge.js";

// kind "command" with an empty value: his chooseSuggestion then only clears the typed token, and src/webview/ours/planMode.ts
// switches the mode when it sees the label picked.
const PLAN_ITEMS: ReadonlyArray<ComposerSuggestion> = [
  { id: "ours:plan", kind: "command", value: "", label: "/plan", description: "Switch this thread into plan mode" },
  { id: "ours:default", kind: "command", value: "", label: "/default", description: "Switch this thread back to normal build mode" },
];

/** Adds /plan and /default after his /model and /usage-limits; a provider command of the same name gives way, as his do. */
export function withPlanSuggestions(items: ReadonlyArray<ComposerSuggestion>, query: string): ComposerSuggestion[] {
  const wanted = query.replace(/^\/+/, "").trim().toLowerCase();
  const ours = PLAN_ITEMS.filter((item) => !wanted || item.label.slice(1).includes(wanted) || item.description.toLowerCase().includes(wanted));
  if (!ours.length) return [...items];
  const rest = items.filter((item) => item.id !== "command:plan" && item.id !== "command:default");
  const at = rest.findIndex((item) => item.kind !== "model" && item.kind !== "usage");
  return at < 0 ? [...rest, ...ours] : [...rest.slice(0, at), ...ours, ...rest.slice(at)];
}
