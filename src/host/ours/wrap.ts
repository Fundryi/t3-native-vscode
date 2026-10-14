/**
 * Compose, do not edit (docs/ours/PORT-MAP.md 0.2): replace a public method of an instance he passes us, so his
 * file keeps no hook. Typed by the method itself: a rename or a type-incompatible signature change upstream fails
 * `pnpm run typecheck` (a same-typed parameter reorder does not; re-read those on each merge).
 *
 * If our replacement throws or rejects, his behavior continues: before it called the original, the original runs
 * now; after, his result (or his own error) is returned unchanged. The original never runs twice for one call.
 * `replacement` runs once per call and receives the original for that call, so keep it a plain arrow function.
 * No value import of vscode, so tests can load it.
 */
import { log } from "./log.js";

type Method = (...args: never[]) => unknown;
type His = { readonly value: unknown } | { readonly error: unknown };
const isThenable = (value: unknown): value is PromiseLike<unknown> => typeof (value as PromiseLike<unknown> | null)?.then === "function";

export function wrap<T extends object, K extends keyof T>(target: T, key: K, replacement: (original: T[K]) => T[K]): () => void {
  const method = target[key];
  if (typeof method !== "function") throw new Error(`${String(key)} is not a method.`);
  const bound = (method as Method).bind(target) as (...args: unknown[]) => unknown;
  const wrapped = (...args: unknown[]): unknown => {
    let his: His | undefined;
    const original = (...callArgs: unknown[]) => {
      try {
        const value = bound(...callArgs); his = { value };
        // His async rejection is his error too: recorded before our replacement can rethrow it, so it passes unlogged.
        if (isThenable(value)) value.then(undefined, (error: unknown) => { his = { error }; });
        return value;
      }
      catch (error) { his = { error }; throw error; }
    };
    const fallback = (cause: unknown): unknown => {
      if (his && "error" in his && his.error === cause) throw cause;
      log.error(`Fork wrapper of ${String(key)} failed; his behavior continues.`, cause);
      if (!his) return bound(...args);
      if ("error" in his) throw his.error;
      return his.value;
    };
    try {
      const result = (replacement(original as T[K]) as (...args: unknown[]) => unknown)(...args);
      return isThenable(result) ? Promise.resolve(result).catch(fallback) : result;
    } catch (cause) { return fallback(cause); }
  };
  target[key] = wrapped as T[K];
  // Restores only while ours is still the outermost wrapper; a later wrapper would otherwise lose its own.
  return () => { if (target[key] === wrapped) target[key] = method; };
}
