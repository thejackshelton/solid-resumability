/**
 * The whole configuration surface, declared in one place.
 *
 * The line every field sits on either side of: the consumer declares what only
 * they know, and the pass derives everything the analysis can reach. Verdicts,
 * group membership, removal spans, mount expressions, template bytes and the
 * chunking constraints are derived and never appear here. What appears here is
 * which components to prove, which pages carry them, and the policies that
 * decide how loudly to refuse.
 *
 * Types for stages that land in later slices are declared now, deliberately.
 * A surface that grows one field per slice teaches consumers that the shape is
 * provisional; a surface stated whole tells them where their config is going.
 */

import type { Analysis } from '../../src/comptime/types.ts';

/** The pass's verdict for one component, so a consumer's transform can be typed. */
export type ComptimeAnalysis = Analysis;

/** Everything the plugin is given. `mounts` is the only required field. */
export interface ResumabilityOptions {
  /** Project root. Defaults to the bundler's root, or the process cwd. */
  root?: string;
  /** What module paths are reported relative to. Defaults to `root`. */
  corpusRoot?: string;
  /** Where artifacts are emitted. Defaults to `<root>/artifacts`. */
  artifactDir?: string;
  /** Where generated modules are written. Defaults to `<root>/src/generated`. */
  generatedDir?: string;
  /** The components to prove and resume. */
  mounts: MountDeclaration[];
  /** The HTML entries that participate. */
  pages?: PageDeclaration[];
  policies?: ResumabilityPolicies;
  /**
   * Specifier the generated modules import the browser runtime through.
   * Defaults to this package's own `unplugin-solid-resumability/runtime`.
   *
   * Configurable because a project that consumes the runtime through an
   * installed copy pays for it in its own module graph — a workspace that
   * needs the runtime to resolve somewhere else says so here.
   */
  runtime?: string;
  /** For component shapes the analysis refuses. Not the road most travelled. */
  substitute?: { transform?: (context: SubstitutionContext) => string };
}

/** One component to prove, and where it is mounted. */
export interface MountDeclaration {
  /** Local binding name in `source`. */
  component: string;
  /** Root-relative module path. Read-only: the pass never writes to it. */
  source: string;
  /** Artifact directory name. Defaults to the key the pass derives from `(source, component)`. */
  artifact?: string;
  /** Which `PageDeclaration.id` this mount belongs to. */
  page?: string;
  /** Overrides `policies.expectProvable`. A fallback verdict then fails the build. */
  expectProvable?: boolean;
  /** Emit a rewritten copy of `source` with this component's mount point resumed. */
  substitute?: MountSubstitution;
}

/**
 * What a rewritten module needs that the analysis cannot reach: where it goes,
 * and the glue it calls. Everything else — the removal span, the mount
 * expression, the re-rooted specifiers — is derived.
 */
export interface MountSubstitution {
  /** Where the rewritten module is written. Relative paths land under `generatedDir`. */
  out: string;
  /** The glue the mount point calls to claim its resumed element. */
  claim: {
    /** Exported function name. Defaults to `claim` followed by the component's name. */
    helper?: string;
    /**
     * The module it is imported from: a root-relative path, re-rooted to the
     * generated directory, or a bare specifier, emitted as written.
     */
    module: string;
  };
  /** Prose the generated module opens with. Defaults to a provenance note. */
  banner?: string;
}

/** One HTML entry that participates, and what happens to it. */
export interface PageDeclaration {
  id: string;
  /** Root-relative HTML entry. */
  html: string;
  /** The entry-script swap: the classic module out, the resumable one in. */
  entry?: { from: string; to: string };
  /** Fill this page's declared mount points with their emitted templates. */
  inlineTemplates?: boolean;
  prerender?: PrerenderPolicy | false;
  group?: GroupPolicy | false;
  /**
   * Where this page's fallback branch is, so `policies.fallback: 'auto-omit'`
   * has something to omit. A page that declares none always carries whatever it
   * carries.
   */
  fallback?: PageFallback;
}

/**
 * The one thing about a fallback branch no analysis can reach: which module
 * holds it, and which specifier it reaches the ordinary renderer through.
 *
 * The branch itself is derived — a page is fully provable iff every mount
 * declared against it came back provable — but *where the branch is written* is
 * the consumer's own architecture. A plugin that went looking for
 * `import()` calls that smell like a renderer would be guessing at the one
 * decision it must not guess at.
 */
export interface PageFallback {
  /** Root-relative module carrying the dynamic import. */
  module: string;
  /** The specifier that import names, exactly as the module writes it. */
  specifier: string;
}

/** How a page is captured ahead of time. Consumed by the prerender stage. */
export interface PrerenderPolicy {
  /** CSS selector for the element the captured markup is inlined into. */
  rootSelector?: string;
  /** How many captures to take, each in its own process. Defaults to 2, and they must agree byte for byte. */
  captures?: number;
  /** Require the captured markup to carry each mount's emitted template verbatim. Defaults to true. */
  requireTemplateVerbatim?: boolean;
  /** Substrings the captured shell must contain. The shape assertions, stated by the consumer rather than guessed. */
  expectMarkup?: string[];
  /**
   * The export the built group chunk is rendered through. It takes the root
   * element and returns a disposer.
   *
   * Defaults to `execute`, which is what the generated group module exports —
   * declared here for a page whose group is hand-written and calls it something
   * else.
   */
  execute?: string;
}

/** How the deferred group module for a page is generated. */
export interface GroupPolicy {
  /** Where the generated group module is written. Relative paths are resolved against the root. */
  moduleId: string;
  /** The component the group renders. It has to be exported by one of this page's rewritten modules. */
  entryComponent: string;
  /** Carry focus and selection across the swap from resumed markup to rendered. Defaults to true. */
  carryFocus?: boolean;
  /** Members are derived from shared-state reachability; an override is an escape hatch. */
  members?: string[];
  /**
   * How the generated `execute` finds the element it renders into when its
   * caller names none. Defaults to the page's own `prerender.rootSelector`,
   * since a captured page already had to say where its markup goes; with
   * neither, the generated function takes its root as a required argument.
   */
  rootSelector?: string;
  /**
   * The glue the group calls: one function that builds a mount element from an
   * emitted template (the capture path only — a shipped page finds its mounts
   * in the document), and one that offers a live element to the substituted
   * mount point that claims it.
   *
   * `module` defaults to the module this page's substitution already names,
   * because the two halves of that protocol live together in every project
   * that has written it once.
   */
  glue?: { module?: string; createMount?: string; offerClaim?: string };
  /** The framework call the group renders through. Defaults to Solid's `render`. */
  render?: { module?: string; named?: string };
}

/** The refusals and the defaults, in one object so a project states its stance once. */
export interface ResumabilityPolicies {
  /** A declared mount that classifies fallback fails the build. Defaults to true. */
  expectProvable?: boolean;
  /**
   * When the deferred group is fetched. Defaults to `interaction`.
   * `idle` is refused by name: an idle prefetch spends the user's network on
   * work no one asked for, which is the whole cost this pipeline exists to
   * remove.
   */
  prefetch?: 'interaction' | 'none';
  /**
   * Whether a page always carries the fallback path. Defaults to `always`.
   *
   * `auto-omit` drops the branch from every page that declares one and is
   * FULLY PROVABLE — every mount declared against it came back provable. The
   * dynamic `import()` is rewritten out of the declaring module, so the
   * bundler emits no chunk for it at all: not a smaller chunk, not a stub, no
   * chunk. A page that is fully provable cannot reach that branch, and a branch
   * nothing can reach is bytes the build has no business emitting.
   *
   * Per page, never per project: a mixed page keeps its fallback under the same
   * policy, because its unprovable mounts still need the ordinary renderer.
   */
  fallback?: 'always' | 'auto-omit';
  /** Remove artifact directories no declared mount claims. Defaults to true. */
  pruneStaleArtifacts?: boolean;
  /** Apply the chunking constraints to the consumer's build config. Defaults to true. */
  chunking?: boolean;
}

/** One span of the source module, and what it becomes. */
export interface SubstitutionEdit {
  kind: 'remove-component' | 'replace-mount' | 'reroot-import';
  /** Byte span in the unmodified source. */
  start: number;
  end: number;
  /** What the span becomes. */
  text: string;
  /** What the edit is for, in one line. */
  note: string;
}

/** One rewritten module. `code` is what is written to `path`. */
export interface SubstitutionResult {
  mount: ResolvedMount;
  path: string;
  code: string;
  edits: SubstitutionEdit[];
  /** True when a consumer-supplied transform produced `code`. */
  transformed: boolean;
}

/**
 * What a consumer-supplied substitution transform is handed: the source, the
 * verdict the pass reached, and the edits this stage computed — including the
 * refusal, when the shape is one it declined, since that is the case the hatch
 * exists for. What it returns is written verbatim.
 */
export interface SubstitutionContext {
  /** The unmodified source of the module carrying the mount. */
  source: string;
  /** Absolute path of that module. */
  path: string;
  /** The mount being substituted. */
  mount: ResolvedMount;
  /** Where the rewritten module will be written. */
  outPath: string;
  /** The pass's verdict for this mount. */
  analysis: ComptimeAnalysis;
  /** The edits this stage computed, in source order. Empty when it refused. */
  edits: SubstitutionEdit[];
  /** Why this stage refused, when it did. */
  refusal?: Error;
}

/** A mount with every default filled in. What the stages actually read. */
export interface ResolvedMount {
  component: string;
  /** Root-relative, as declared. */
  source: string;
  /** Absolute path the pass reads. */
  sourcePath: string;
  artifact: string;
  page?: string;
  expectProvable: boolean;
  substitute?: ResolvedSubstitution;
}

/** A substitution with its paths absolute and its defaults filled in. */
export interface ResolvedSubstitution {
  /** Absolute path of the rewritten module. */
  outPath: string;
  /** The glue function the mount point calls. */
  helper: string;
  /** The specifier it is imported through, as the rewritten module will read it. */
  specifier: string;
  /**
   * Absolute path of the glue module, when the declaration named a file rather
   * than a bare specifier. Kept because a second generated module in a second
   * directory has to re-root the same module from where IT sits.
   */
  modulePath?: string;
  /** Consumer prose, when they wrote some. */
  banner?: string;
}

/** A page with every default filled in. */
export interface ResolvedPage {
  id: string;
  html: string;
  htmlPath: string;
  entry?: { from: string; to: string };
  inlineTemplates: boolean;
  prerender: PrerenderPolicy | false;
  group: GroupPolicy | false;
  fallback: ResolvedPageFallback | false;
}

/** A fallback branch with its module resolved to an absolute path. */
export interface ResolvedPageFallback {
  /** Root-relative, as declared. */
  module: string;
  /** Absolute path of the module carrying the branch. */
  modulePath: string;
  specifier: string;
}

/** Policies with every default filled in. */
export interface ResolvedPolicies {
  expectProvable: boolean;
  prefetch: 'interaction' | 'none';
  fallback: 'always' | 'auto-omit';
  pruneStaleArtifacts: boolean;
  chunking: boolean;
}

/** The options every stage is handed. Absolute paths, no optionals, no guessing. */
export interface ResolvedOptions {
  root: string;
  corpusRoot: string;
  artifactDir: string;
  generatedDir: string;
  mounts: ResolvedMount[];
  pages: ResolvedPage[];
  policies: ResolvedPolicies;
  runtime: string;
  substitute: { transform?: (context: SubstitutionContext) => string };
}
