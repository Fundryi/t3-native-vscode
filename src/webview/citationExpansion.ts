/** Module-level: a virtualized row unmounts when scrolled away, and a search jump must expand a card it does not own. */
import { useSyncExternalStore } from "react";

const expanded = new Set<string>();
const listeners = new Map<string, Set<() => void>>();
function subscribe(key: string, listener: () => void) {
  let subscribers = listeners.get(key); if (!subscribers) { subscribers = new Set(); listeners.set(key, subscribers); }
  subscribers.add(listener); return () => { subscribers!.delete(listener); if (!subscribers!.size) listeners.delete(key); };
}
export const isCitationExpanded = (key: string): boolean => expanded.has(key);
export function setCitationExpanded(key: string, open: boolean): void {
  if (expanded.has(key) === open) return;
  if (open) expanded.add(key); else expanded.delete(key);
  listeners.get(key)?.forEach((listener) => listener());
}
export function useCitationExpanded(key: string): boolean {
  return useSyncExternalStore((listener) => subscribe(key, listener), () => expanded.has(key));
}
