import { useSyncExternalStore } from "react";

/** Wrap is per block and survives the virtualized transcript unmounting its row, like a quote's expansion. */
const unwrapped = new Set<string>();
const listeners = new Map<string, Set<() => void>>();
function subscribe(key: string, listener: () => void) {
  const group = listeners.get(key) ?? new Set();
  listeners.set(key, group); group.add(listener);
  return () => { group.delete(listener); if (!group.size) listeners.delete(key); };
}
export function isCodeBlockWrapped(key: string): boolean { return !unwrapped.has(key); }
export function setCodeBlockWrapped(key: string, wrapped: boolean): void {
  if (wrapped === isCodeBlockWrapped(key)) return;
  if (wrapped) unwrapped.delete(key); else unwrapped.add(key);
  for (const listener of listeners.get(key) ?? []) listener();
}
export function useCodeBlockWrapped(key: string): boolean {
  return useSyncExternalStore((listener) => subscribe(key, listener), () => isCodeBlockWrapped(key));
}
