/**
 * The plugin itself: one factory, several bundlers.
 *
 * The factory returns an *array* of plugins rather than one. Each stage owns
 * its own object, its own name and its own hook, so a build log names the
 * stage that spoke and a stage that has nothing to do on a given bundler
 * simply is not there. Nothing is bundler-specific except the trigger: every
 * stage body is a plain function of explicit inputs, exported from `./node`
 * for anyone whose bundler has no hook to hang it on.
 *
 * What this version wires: option normalization, the analyze-and-emit pass,
 * substitution, group generation, fallback omission, the chunking constraints,
 * the page rewrites and the captured first paint.
 */

import { createUnplugin, type UnpluginFactory, type UnpluginOptions } from 'unplugin';

import {
  assertPageFeaturesSupported,
  declaresPageFeatures,
  pageHtmlPlugin,
} from './html.ts';
import { readTemplate } from './node.ts';
import { resolveOptions } from './options.ts';
import { runAnalyzeStage, type MountOutcome } from './stages/analyze.ts';
import { chunkingPlugin } from './stages/chunking.ts';
import { fallbackPlugin, runFallbackStage } from './stages/fallback.ts';
import { runGroupStage } from './stages/group.ts';
import { prerenderPlugin } from './stages/prerender.ts';
import { runSubstituteStage } from './stages/substitute.ts';
import type { ResolvedOptions, ResumabilityOptions } from './types.ts';

export const unpluginFactory: UnpluginFactory<ResumabilityOptions, true> = (options, meta) => {
  // Normalized once, in the factory body, before any hook can run. A stage
  // that had to normalize for itself would be a second place for a default to
  // drift.
  let resolved: ResolvedOptions = resolveOptions(options);

  // The pass's verdicts, kept for the one stage that runs after `buildStart`
  // and needs them: fallback omission is a `transform`, and what it may omit is
  // decided by what the pass proved.
  let outcomes: MountOutcome[] = [];

  // Before a file is read: a page that declares rewrites on a target with no
  // hook that serves a page would come up, serve the classic page, and pass
  // every check the consumer knows to run.
  assertPageFeaturesSupported(resolved.pages, meta.framework);

  const pass: UnpluginOptions = {
    name: 'unplugin-solid-resumability:analyze',
    enforce: 'pre',

    vite: {
      // The bundler's root wins over the process cwd, and loses to an explicit
      // `root` option — so re-resolving here is free when the consumer stated
      // one and correct when they did not.
      configResolved(config: { root?: string }) {
        resolved = resolveOptions(options, config.root);
      },
    },

    buildStart() {
      // Registering the sources makes an edit to a proven component re-emit its
      // artifacts on the dev server, instead of serving yesterday's markup.
      for (const mount of resolved.mounts) this.addWatchFile(mount.sourcePath);

      // Substitution runs here rather than in a plugin of its own because it
      // consumes these verdicts, and because two plugins' `buildStart` hooks
      // are not ordered with respect to each other. The generated modules have
      // to exist before module resolution begins.
      const report = runAnalyzeStage(resolved);
      outcomes = report.outcomes;
      const substituted = runSubstituteStage(resolved, report.outcomes);

      // Same pass, and last: the group module imports what substitution just
      // emitted, and the module graph these builds are measured against names
      // it by path, so it has to be a real file before resolution begins.
      runGroupStage(resolved, substituted.results);

      // Says which pages are dropping their branch, before any of them is
      // transformed. An omission nobody announced is an omission nobody checks.
      runFallbackStage(resolved, report.outcomes);
    },
  };

  const plugins: UnpluginOptions[] = [pass];
  if (resolved.policies.chunking) plugins.push(chunkingPlugin(resolved));

  // Only when something could be omitted. A project on the default policy gets
  // no transform hook at all.
  if (resolved.policies.fallback === 'auto-omit') {
    plugins.push(fallbackPlugin({ options: () => resolved, outcomes: () => outcomes }));
  }

  // Only when a page asked for one. A build whose pages declare nothing gets
  // no HTML hook at all, which is one fewer thing in the consumer's log.
  if (resolved.pages.some((page) => declaresPageFeatures(page))) {
    plugins.push(pageHtmlPlugin({ options: () => resolved, readTemplate }));
  }

  // The capture runs the built chunk, so its trigger is the one that fires
  // after every chunk is on disk. A page that asked for no first paint gets no
  // such hook, and no child process spent proving nothing.
  if (resolved.pages.some((page) => page.prerender !== false)) {
    plugins.push(prerenderPlugin({ options: () => resolved, readTemplate }));
  }

  return plugins;
};

export const unplugin = /* #__PURE__ */ createUnplugin(unpluginFactory);

export default unplugin;

export {
  assertPageFeaturesSupported,
  declaresPageFeatures,
  emptyElementHtml,
  HtmlRewriteError,
  pageEdits,
  pageForRequest,
  pageHtmlPlugin,
  RESUME_ATTRIBUTE,
  rewritePageHtml,
} from './html.ts';
export type { HtmlEdit, HtmlRefusalName, PageTemplate } from './html.ts';
export { resolveOptions, ResumabilityConfigError, DEFAULT_RUNTIME_SPECIFIER } from './options.ts';
export type { RefusalName } from './options.ts';
export { runAnalyzeStage, UnprovableMountError } from './stages/analyze.ts';
export type { AnalyzeReport, MountOutcome } from './stages/analyze.ts';
export {
  captureShell,
  CAPTURE_FLAG,
  CAPTURE_MODULE_PATH,
  CAPTURE_PAYLOAD_MARK,
} from './stages/capture.ts';
export type { CaptureRequest } from './stages/capture.ts';
export { applyChunkingConstraints } from './stages/chunking.ts';
export {
  fallbackPlugin,
  FallbackOmissionError,
  omitFallbackImport,
  omittedFallbacks,
  runFallbackStage,
} from './stages/fallback.ts';
export type { FallbackRefusalName, FallbackReport, OmittedFallback } from './stages/fallback.ts';
export { generateGroupModule, GroupGenerationError, runGroupStage } from './stages/group.ts';
export type { GeneratedGroup, GroupReport, GroupRefusalName } from './stages/group.ts';
export { prerenderPages, prerenderPlugin, PrerenderError } from './stages/prerender.ts';
export type {
  PrerenderedPage,
  PrerenderInput,
  PrerenderRefusalName,
  PrerenderReport,
} from './stages/prerender.ts';
export { runSubstituteStage, substituteModule, SubstitutionError } from './stages/substitute.ts';
export type { SubstituteReport, SubstitutionRefusalName } from './stages/substitute.ts';
export type * from './types.ts';
