/** Q10 latest: the newest running step of each work group, shown on the collapsed group header. */
import type { TranscriptItem } from "../bridge.js";
import { finalResponseCheckpoints, isWorkItem, transcriptRows } from "../transcriptRows.js";

const running = (row: TranscriptItem) => row.item.status === "running" || row.item.status === "pending";

/** Same label his rows show for that step (TranscriptView TurnContent), shortened for one line. */
export function stepLabel(row: TranscriptItem): string {
  const { item } = row;
  switch (item.type) {
    case "reasoning": return "Thinking";
    case "command_execution": return item.title ?? item.input.split("\n")[0] ?? "Command";
    case "file_change": return item.title ?? `Editing ${item.fileName}`;
    case "file_search": return item.title ?? "Searching files";
    case "web_search": return item.title ?? "Searching the web";
    case "dynamic_tool": return row.toolLabel ?? item.title ?? item.toolName ?? "Tool";
    default: return "Working";
  }
}

/** Display row key (his `data-message-key`) to the label of that group's newest running step. */
export function runningStepLabels(transcript: ReadonlyArray<TranscriptItem>): Map<string, string> {
  const labels = new Map<string, string>();
  for (const group of transcriptRows(finalResponseCheckpoints(transcript))) {
    if (!isWorkItem(group.rows[0]!)) continue;
    const step = group.rows.findLast(running);
    if (step) labels.set(group.key, stepLabel(step).trim() || "Working");
  }
  return labels;
}
