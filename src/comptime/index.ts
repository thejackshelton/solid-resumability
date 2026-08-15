/**
 * The comptime pass: build-time only, read-only with respect to the components
 * it inspects. Give it an ordinary Solid source file and it decides whether the
 * component is provably resumable, writing static artifacts for the template,
 * state, handlers and wiring when it is.
 *
 *   const { analysis, emitted } = runComptime("src/fixtures/CounterA.tsx");
 *
 * Nothing in this directory ships to a browser and nothing it emits imports a
 * framework; resuming from the artifacts is a separate concern.
 */

import { basename, extname, isAbsolute, join, resolve } from "pathe";

import { classify } from "./classify.ts";
import { emit } from "./emit.ts";
import { loadProject } from "./project.ts";
// `artifactKey` moved to `types.ts` — a true leaf — because the classifier now
// needs it to stamp a claimed child's address into its parent's template, and
// this module imports the classifier. It is re-exported below by `export *`,
// so every importer of `src/comptime/index.ts` is unchanged.
import {
  artifactKey,
  type Analysis,
  type ClassifyOptions,
  type IdentityProp,
  type PassResult,
} from "./types.ts";

export interface ComptimeOptions extends ClassifyOptions {
  /** Project root that module paths are reported relative to. Defaults to cwd. */
  root?: string;
  /** Directory artifacts are written under. Defaults to `<root>/artifacts`. */
  outRoot?: string;
  /** Restrict analysis to one exported component. Defaults to the first that returns JSX. */
  component?: string;
  /** Set false to classify without writing anything. Defaults to true. */
  write?: boolean;
}

/** Classifies a component without touching the filesystem beyond reading sources. */
export function analyzeFixture(entryPath: string, options: ComptimeOptions = {}): Analysis {
  const root = resolve(options.root ?? process.cwd());
  const entry = isAbsolute(entryPath) ? entryPath : join(root, entryPath);
  const project = loadProject(entry, root);
  return classify(project.entry, options.component, options);
}

/**
 * Classify a component as if the named props were already recorded at a call
 * site. Slice B's isolated child re-run consumes this; `analyzeFixture` and
 * `runComptime` also honour `options.recordedProps`.
 */
export function analyzeWithRecordedProps(
  entryPath: string,
  recordedProps: ReadonlyArray<{ name: string; value: string | number | boolean | null }>,
  options: ComptimeOptions = {},
): Analysis {
  return analyzeFixture(entryPath, { ...options, recordedProps });
}

/**
 * Classify a component as if the named props were already recorded as
 * identity at a call site. Slices D/E consume this; `analyzeFixture` and
 * `runComptime` also honour `options.identityProps`.
 */
export function analyzeWithIdentityProps(
  entryPath: string,
  identityProps: ReadonlyArray<IdentityProp>,
  options: ComptimeOptions = {},
): Analysis {
  return analyzeFixture(entryPath, { ...options, identityProps });
}

/** Classifies, and emits artifacts when the verdict is `provable`. */
export function runComptime(entryPath: string, options: ComptimeOptions = {}): PassResult {
  const root = resolve(options.root ?? process.cwd());
  const analysis = analyzeFixture(entryPath, { ...options, root });

  if (analysis.status !== "provable" || options.write === false) {
    return { analysis, emitted: null };
  }

  const outRoot = resolve(options.outRoot ?? join(root, "artifacts"));
  const name = analysis.component || basename(entryPath, extname(entryPath));

  return { analysis, emitted: emit(analysis, join(outRoot, artifactKey(analysis.module, name))) };
}

export { classify, classifyAll, classifySite } from "./classify.ts";
export {
  parameterIsAccessorOnly,
  parameterIsGetterOnly,
  returnedClosure,
  summarize,
  summarizeDerivedAccessor,
  type DerivedAccessorSummary,
  type PureSummary,
} from "./summaries.ts";
export {
  classifyStoreBinding,
  useContextCalls,
  type StoreBinding,
  type StoreOutcome,
  type StoreRefusal,
} from "./stores.ts";
export {
  AMBIENT_MEMBER_CALLS,
  EVENT_TIME_SYNTAX,
  HANDLER_SYNTAX,
  SUMMARY_SYNTAX,
} from "./syntax.ts";
export { findComponent, findComponents, returnedJsx, type ComponentSite } from "./discover.ts";
export { emit } from "./emit.ts";
export { loadProject, loadProjectFrom, type Project } from "./project.ts";
export * from "./types.ts";
