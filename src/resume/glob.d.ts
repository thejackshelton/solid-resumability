/** `import.meta.glob`, in the two forms `artifacts.ts` uses. Vite's own types cannot be referenced here: vite is a transitive dependency of vitest and pnpm does not hoist it. Semantics are vite's. */
interface ImportMeta {
  /** Eager modules become static imports of the caller; the lazy form yields `() => import(...)` thunks. */
  glob<T = unknown>(pattern: string, options: { eager: true }): Record<string, T>;
  glob<T = unknown>(pattern: string, options?: { eager?: false }): Record<string, () => Promise<T>>;
}
