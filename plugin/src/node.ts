/**
 * The node-side helpers, for code that runs beside the build rather than
 * inside it: a consumer's own tests, a post-build script, a bundler with no
 * hook to hang a stage on.
 *
 * Every stage body this package has is exported from here, because a stage is
 * a function and a hook is only a place to call it from. That is what makes
 * "bundler-neutral" a property rather than a slogan — a target with no
 * suitable hook loses the automation, never the capability.
 *
 * The artifact readers are the generalized form of the accessors a project
 * writes by hand: same three questions (where does this component's artifacts
 * live, what does its manifest say, what markup was emitted), with the
 * artifact root passed in rather than baked to one project's directory.
 */

import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join } from 'pathe';

import type { CarriedChild, CarriedRegion } from './html.ts';

export { artifactKey } from '../../src/comptime/index.ts';
export {
  assertPageFeaturesSupported,
  componentRootIn,
  declaresPageFeatures,
  emptyElementHtml,
  HtmlRewriteError,
  pageEdits,
  pageForRequest,
  RESUME_ATTRIBUTE,
  rewritePageHtml,
} from './html.ts';
export type {
  CarriedChild,
  CarriedRegion,
  EntrySwapEdit,
  HtmlEdit,
  HtmlRefusalName,
  PageTemplate,
  ShellInlineEdit,
  TemplateCheckEdit,
  TemplateInlineEdit,
} from './html.ts';
export { resolveOptions, ResumabilityConfigError, DEFAULT_RUNTIME_SPECIFIER } from './options.ts';
export type { RefusalName } from './options.ts';
export { runAnalyzeStage, UnprovableMountError } from './stages/analyze.ts';
export type { AnalyzeReport, AnalyzeStageOptions, MountOutcome } from './stages/analyze.ts';
export {
  captureShell,
  CAPTURE_FLAG,
  CAPTURE_MODULE_PATH,
  CAPTURE_PAYLOAD_MARK,
} from './stages/capture.ts';
export type { CaptureRequest } from './stages/capture.ts';
export { applyChunkingConstraints } from './stages/chunking.ts';
export type { ChunkingConfig, ChunkingOutput } from './stages/chunking.ts';
export {
  FallbackOmissionError,
  omitFallbackImport,
  omittedFallbacks,
  runFallbackStage,
} from './stages/fallback.ts';
export type { FallbackRefusalName, FallbackReport, OmittedFallback } from './stages/fallback.ts';
export { generateGroupModule, GroupGenerationError, runGroupStage } from './stages/group.ts';
export type {
  GeneratedGroup,
  GroupReport,
  GroupRefusalName,
  GroupStageOptions,
} from './stages/group.ts';
export { prerenderPages, prerenderPlugin, PrerenderError } from './stages/prerender.ts';
export type {
  PrerenderContext,
  PrerenderedPage,
  PrerenderInput,
  PrerenderRefusalName,
  PrerenderReport,
  TemplateReader,
} from './stages/prerender.ts';
export { runSubstituteStage, substituteModule, SubstitutionError } from './stages/substitute.ts';
export type {
  SubstituteReport,
  SubstituteStageOptions,
  SubstitutionRefusalName,
} from './stages/substitute.ts';
export type * from './types.ts';

/** Either the artifact directory name, or anything carrying one — a mount declaration, say. */
export type ArtifactRef = string | { artifact: string };

/**
 * The emitted template, as the artifact module states it, and the three things
 * the same artifacts say about what the build did NOT write into it: the keyed
 * regions whose items belong to a store that does not exist yet, the bindings
 * whose text a captured paint measures, and the children the component composed
 * by ADDRESS rather than by absorbing them.
 *
 * All three belong here rather than in a second reader because all three are
 * read for the same reason — deciding what a mount's markup is owed, and by
 * whom — and a caller that had to ask twice would be a caller that could ask
 * once and get half an answer.
 */
export interface EmittedTemplate {
  html: string;
  root: string;
  /** The keyed regions the component declares. Any at all makes its mount a carried one. */
  regions: CarriedRegion[];
  /** Locators of the bindings whose text is measured rather than folded at build time. */
  measured: string[];
  /** The element-shaped holes the component left for children it addressed. */
  claimed: CarriedChild[];
}

function keyOf(ref: ArtifactRef): string {
  return typeof ref === 'string' ? ref : ref.artifact;
}

/** Where one component's artifacts live under `artifactRoot`. */
export function artifactDir(artifactRoot: string, ref: ArtifactRef): string {
  return join(artifactRoot, keyOf(ref));
}

/** Where one component's manifest is, under its own artifact directory. */
export function manifestPath(directory: string): string {
  return join(directory, 'manifest.json');
}

/** The emitted manifest, parsed. */
export function readManifest<T = unknown>(artifactRoot: string, ref: ArtifactRef): T {
  return JSON.parse(readFileSync(manifestPath(artifactDir(artifactRoot, ref)), 'utf8')) as T;
}

/**
 * The emitted markup, read out of the artifact module itself rather than out
 * of the manifest — it is the module the build inlines, so it is the module
 * the build should read. The cache-busting query is what makes a re-emit
 * visible to a process that already imported the old one.
 */
export async function readTemplate(
  artifactRoot: string,
  ref: ArtifactRef,
): Promise<EmittedTemplate> {
  const directory = artifactDir(artifactRoot, ref);
  const url = pathToFileURL(join(directory, 'template.js')).href;
  const module = (await import(`${url}?t=${Date.now()}`)) as { html: string; root: string };
  return { html: module.html, root: module.root, ...(await readEmittedShape(directory)) };
}

/** One emitted binding, as far as "did the build write this text" goes. */
interface EmittedBinding {
  locator: string;
  initialTextFrom?: string;
}

/**
 * What the emitted artifacts say about the bytes the build left to someone
 * else.
 *
 * Two files, and which one each answer comes out of is the point rather than an
 * implementation detail. A region and a measured text are read out of
 * `structure.js` — the same module the resume path reads them from — so a page
 * is checked against the record the page itself runs on. A claimed child is
 * read out of `manifest.json`, because the resume path does not read it at all:
 * nothing that runs at first paint asks where a nested mount is, it is found by
 * the same attribute walk that finds a root one. An address only the build
 * consults is an address that stays off the eager path.
 *
 * An artifact emitted before regions existed says nothing, and one emitted
 * before addressing existed says nothing about children; both get the empty
 * answer that means "this mount is the pass's to fill".
 */
async function readEmittedShape(
  directory: string,
): Promise<{ regions: CarriedRegion[]; measured: string[]; claimed: CarriedChild[] }> {
  const claimed = claimedChildrenIn(directory);

  const path = join(directory, 'structure.js');
  if (!existsSync(path)) return { regions: [], measured: [], claimed };

  const url = pathToFileURL(path).href;
  const structure = (await import(`${url}?t=${Date.now()}`)) as {
    keyedRegions?: CarriedRegion[];
    bindings?: EmittedBinding[];
  };

  return {
    regions: (structure.keyedRegions ?? []).map((region) => ({
      id: region.id,
      container: region.container,
      keyAttribute: region.keyAttribute,
    })),
    measured: (structure.bindings ?? [])
      .filter((binding) => binding.initialTextFrom === 'capture')
      .map((binding) => binding.locator),
    claimed,
  };
}

/**
 * One claimed child as the manifest wrote it. Locator and artifact are what
 * the markup fill uses; `recordedProps` and `identityProps` are the classify
 * contracts the isolated child re-run must honour. Dropping either field
 * would publish a child under a different record than the parent stamped.
 */
export type ManifestIdentityProp = {
  name: string;
  role: 'attribute' | 'spread-of-identifier';
  bindingClass: 'own-props-parameter' | 'derived-rest-props-result';
  source: { name: string; path: Array<string | number> };
};

export type ManifestClaimedChild = CarriedChild & {
  recordedProps?: ReadonlyArray<{ name: string; value: string | number | boolean | null }>;
  identityProps?: ReadonlyArray<ManifestIdentityProp>;
};

/**
 * The children one artifact directory says it addressed, read out of its
 * manifest. Absence of `recordedProps` is today's BARE contract. Absence of
 * `identityProps` is the pre-v2 contract: no caller-dependent cargo at the
 * address. Resume never reads this list.
 *
 * A directory with no manifest, or a manifest from before addressing existed,
 * answers empty. That is the same answer a component that composes nothing
 * gives, and it means the same thing here: this template describes every byte
 * of its own subtree.
 */
export function claimedChildrenIn(directory: string): ManifestClaimedChild[] {
  const path = manifestPath(directory);
  if (!existsSync(path)) return [];

  const manifest = JSON.parse(readFileSync(path, 'utf8')) as {
    claimedChildren?: Array<{
      locator: string;
      artifact: string;
      recordedProps?: Array<{ name: string; value: string | number | boolean | null }>;
      identityProps?: ManifestIdentityProp[];
    }>;
  };

  return (manifest.claimedChildren ?? []).map((child) => ({
    locator: child.locator,
    artifact: child.artifact,
    ...(child.recordedProps !== undefined && child.recordedProps.length > 0
      ? { recordedProps: child.recordedProps }
      : {}),
    ...(child.identityProps !== undefined && child.identityProps.length > 0
      ? { identityProps: child.identityProps }
      : {}),
  }));
}
