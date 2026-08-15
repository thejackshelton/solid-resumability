/**
 * Builds a linked yuku-analyzer project from an entry file. Cross-module
 * resolution earns its keep for one reason: when a value escapes a component,
 * the refusal has to say WHERE IT WENT. That is `Symbol.definition()`, which
 * resolves only once the importee is in the analyzed file set and
 * `Analyzer.link()` has run.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "pathe";

import { Analyzer, type Module } from "yuku-analyzer";

/** Extension probe order, matching the analyzer's own default resolver. */
const EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", ".mts", ".mjs", ".cts", ".cjs"];

/** Analyzer module paths are root-relative and posix-shaped (pathe's `relative`
 * is posix on every platform), so they stay stable across machines. */
function toModulePath(root: string, absolute: string): string {
  return relative(root, absolute);
}

function probe(base: string): string | null {
  if (existsSync(base) && statSync(base).isFile()) return base;
  for (const ext of EXTENSIONS) {
    const candidate = base + ext;
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  for (const ext of EXTENSIONS) {
    const candidate = join(base, "index" + ext);
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

export interface Project {
  analyzer: Analyzer;
  root: string;
  entry: Module;
  /** Every module added, keyed by its root-relative path, in insertion order. */
  modules: Map<string, Module>;
}

/**
 * Adds the entry file and, transitively, every relative import and relative
 * re-export on disk. Bare specifiers (`solid-js`) stay external on purpose:
 * the pass treats the framework as an opaque boundary, exactly as a real
 * build would.
 */
export function loadProject(entryAbsolutePath: string, root: string): Project {
  return loadProjectFrom([entryAbsolutePath], root);
}

/**
 * The same walk seeded with several entries at once. The coverage tool needs the
 * whole corpus in ONE linked project: `Symbol.definition()` is what lets a
 * refusal say which module a signal escaped into, and it resolves only across
 * files the analyzer linked. Entry order fixes module order, which is what makes
 * a report from this project deterministic.
 */
export function loadProjectFrom(entryAbsolutePaths: string[], root: string): Project {
  const analyzer = new Analyzer();
  const rootDir = resolve(root);
  const queue = entryAbsolutePaths.map((path) => resolve(path));
  const added = new Set<string>();
  const modules = new Map<string, Module>();
  let entry: Module | undefined;

  const enqueueRelative = (fromAbsolute: string, specifier: string | null): void => {
    if (specifier == null || !specifier.startsWith(".")) return;
    const resolved = probe(resolve(dirname(fromAbsolute), specifier));
    if (resolved !== null) queue.push(resolved);
  };

  while (queue.length > 0) {
    const absolute = queue.shift()!;
    if (added.has(absolute)) continue;
    added.add(absolute);

    const modulePath = toModulePath(rootDir, absolute);
    const module = analyzer.addFile(modulePath, readFileSync(absolute, "utf8"));
    modules.set(modulePath, module);
    entry ??= module;

    // Import records and re-export records both name a module edge.
    // `export * from "./x"` is an export record, not an import; walking
    // imports alone left the module behind a barrel outside the analyzed
    // set, so `definition()` returned null for every name that arrived
    // that way.
    for (const record of module.imports) enqueueRelative(absolute, record.specifier);
    for (const record of module.exports) enqueueRelative(absolute, record.specifier);
  }

  // Explicit link so import -> export resolution (and its diagnostics) happen
  // here rather than lazily inside a query later.
  analyzer.link();

  return { analyzer, root: rootDir, entry: entry!, modules };
}
