/**
 * Normalization and refusal.
 *
 * Every stage downstream reads `ResolvedOptions` and nothing else: absolute
 * paths, no optionals, no defaults left to be applied twice in two places by
 * two people who disagree. Everything a stage would otherwise have to guess is
 * decided here, once, at construction time.
 *
 * The refusals are the more interesting half. A build tool that silently
 * accepts a configuration it cannot honour spends the user's afternoon; each
 * refusal below throws before a single file is read, carries its own error
 * name so a caller can branch on it, and says what to do instead.
 */

import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'pathe';

import { artifactKey } from '../../src/comptime/index.ts';
import type {
  MountDeclaration,
  PageDeclaration,
  ResolvedMount,
  ResolvedOptions,
  ResolvedPage,
  ResolvedPageFallback,
  ResolvedPolicies,
  ResolvedSubstitution,
  ResumabilityOptions,
} from './types.ts';

/**
 * A configuration the plugin will not act on.
 *
 * `name` is the refusal's own name rather than the class's, so a test or a
 * caller can assert which rule fired without matching on prose that may be
 * reworded.
 */
export class ResumabilityConfigError extends Error {
  constructor(name: RefusalName, message: string) {
    super(message);
    this.name = name;
  }
}

/** Every way this plugin declines a configuration. */
export type RefusalName =
  | 'NoMountsDeclared'
  | 'MountSourceMissing'
  | 'ArtifactKeyCollision'
  | 'DuplicatePageId'
  | 'MountPageUnknown'
  | 'PrerenderWithoutGroup'
  | 'PrefetchIdleRefused'
  | 'FallbackBranchUndeclared'
  | 'FallbackModuleMissing'
  | 'FallbackSpecifierMissing'
  | 'SubstituteOutMissing'
  | 'ClaimGlueUndeclared'
  | 'PageFeaturesUnsupported';

function refuse(name: RefusalName, message: string): never {
  throw new ResumabilityConfigError(name, message);
}

/** This package's own runtime, which is what an ordinary consumer wants. */
export const DEFAULT_RUNTIME_SPECIFIER = 'unplugin-solid-resumability/runtime';

const DEFAULT_POLICIES: ResolvedPolicies = {
  expectProvable: true,
  prefetch: 'interaction',
  fallback: 'always',
  pruneStaleArtifacts: true,
  chunking: true,
};

/**
 * Fills in every default and refuses everything unworkable.
 *
 * `bundlerRoot` is what the bundler believes the project root is; an explicit
 * `options.root` wins over it, and the process cwd is the last resort.
 */
export function resolveOptions(
  options: ResumabilityOptions,
  bundlerRoot?: string,
): ResolvedOptions {
  const root = resolve(options.root ?? bundlerRoot ?? process.cwd());
  const corpusRoot = absoluteUnder(root, options.corpusRoot ?? root);
  const artifactDir = absoluteUnder(root, options.artifactDir ?? join(root, 'artifacts'));
  const generatedDir = absoluteUnder(root, options.generatedDir ?? join(root, 'src/generated'));

  const policies = resolvePolicies(options.policies);
  const pages = resolvePages(options.pages ?? [], root, policies);
  const mounts = resolveMounts(options.mounts, root, generatedDir, policies, pages);

  return {
    root,
    corpusRoot,
    artifactDir,
    generatedDir,
    mounts,
    pages,
    policies,
    runtime: options.runtime ?? DEFAULT_RUNTIME_SPECIFIER,
    substitute: options.substitute ?? {},
  };
}

function resolvePolicies(declared: ResumabilityOptions['policies']): ResolvedPolicies {
  const policies = { ...DEFAULT_POLICIES, ...declared };

  // Stated as a refusal rather than left undocumented: a rejected policy that
  // is merely absent gets re-invented by the next person who reads the code.
  if ((policies.prefetch as string) === 'idle') {
    refuse(
      'PrefetchIdleRefused',
      "policies.prefetch: 'idle' is refused. An idle prefetch spends network on a group the " +
        'user may never open, which is the cost this pipeline exists to remove (zero-eager ' +
        "§4.5). Use 'interaction' to fetch on first touch, or 'none' to fetch only on demand.",
    );
  }

  return policies;
}

function resolvePages(
  declared: PageDeclaration[],
  root: string,
  policies: ResolvedPolicies,
): ResolvedPage[] {
  const seen = new Set<string>();

  // A policy that cannot act on anything is the worst kind of green: the build
  // reports the omission it was asked for and emits every byte it was asked to
  // drop. Said once, here, rather than per page — one page declaring a branch
  // is enough for the policy to mean something.
  if (policies.fallback === 'auto-omit' && !declared.some((page) => page.fallback !== undefined)) {
    refuse(
      'FallbackBranchUndeclared',
      "policies.fallback: 'auto-omit' is declared but no page says where its fallback branch " +
        'is. The derivation is the pass\'s (a page may omit the branch iff every mount declared ' +
        'against it is provable); WHICH module holds the branch and WHICH specifier reaches the ' +
        'ordinary renderer is yours. Declare `fallback: { module, specifier }` on the page that ' +
        "carries it, or use 'always'.",
    );
  }

  return declared.map((page) => {
    if (seen.has(page.id)) {
      refuse(
        'DuplicatePageId',
        `two pages declare the id ${JSON.stringify(page.id)}. Page ids address a page from a ` +
          'mount declaration, so they have to be unique.',
      );
    }
    seen.add(page.id);

    const prerender = page.prerender ?? false;
    const group = page.group ?? false;

    // Prerender captures the page by running its group in a headless DOM. With
    // no group there is nothing to run, so a page asking for both would sit
    // there capturing an empty shell and calling it a success.
    if (prerender !== false && group === false) {
      refuse(
        'PrerenderWithoutGroup',
        `page ${JSON.stringify(page.id)} declares prerender but no group. Prerendering runs the ` +
          'page\'s group module to capture its markup; declare `group`, or drop `prerender`.',
      );
    }

    return {
      id: page.id,
      html: page.html,
      htmlPath: absoluteUnder(root, page.html),
      entry: page.entry,
      inlineTemplates: page.inlineTemplates ?? false,
      prerender,
      group,
      fallback: resolveFallback(page, root),
    };
  });
}

/**
 * The declared fallback branch, made absolute and checked for existence.
 *
 * Checked here for the same reason a mount source is: a typo in the config
 * should read as a typo in the config, and not as a transform that quietly
 * matched nothing and left the branch in the build.
 */
function resolveFallback(page: PageDeclaration, root: string): ResolvedPageFallback | false {
  const declared = page.fallback;
  if (declared === undefined) return false;

  if (!declared.module) {
    refuse(
      'FallbackModuleMissing',
      `page ${JSON.stringify(page.id)} declares a fallback branch with no \`module\`. The branch ` +
        'is a dynamic import in one of your own modules; name the module that writes it.',
    );
  }

  if (!declared.specifier) {
    refuse(
      'FallbackSpecifierMissing',
      `page ${JSON.stringify(page.id)} declares a fallback branch with no \`specifier\`. Omission ` +
        'rewrites one `import()` and leaves every other import in that module alone, so it has ' +
        'to be told which one.',
    );
  }

  const modulePath = absoluteUnder(root, declared.module);
  if (!existsSync(modulePath)) {
    refuse(
      'FallbackModuleMissing',
      `page ${JSON.stringify(page.id)} declares its fallback branch in ` +
        `${JSON.stringify(declared.module)}, which does not exist (looked at ${modulePath}). ` +
        'Fallback modules are resolved against the project root.',
    );
  }

  return { module: declared.module, modulePath, specifier: declared.specifier };
}

function resolveMounts(
  declared: MountDeclaration[],
  root: string,
  generatedDir: string,
  policies: ResolvedPolicies,
  pages: ResolvedPage[],
): ResolvedMount[] {
  if (!declared || declared.length === 0) {
    refuse(
      'NoMountsDeclared',
      'no mounts declared. The mount list is the whole input to the pass: without it there is ' +
        'nothing to prove and nothing to emit.',
    );
  }

  const pageIds = new Set(pages.map((page) => page.id));
  const byArtifact = new Map<string, ResolvedMount>();

  return declared.map((mount) => {
    const sourcePath = absoluteUnder(root, mount.source);

    // Checked here rather than at the pass, so a typo in the config reads as a
    // typo in the config instead of as a parser failure ten frames down.
    if (!existsSync(sourcePath)) {
      refuse(
        'MountSourceMissing',
        `mount ${JSON.stringify(mount.component)} declares source ${JSON.stringify(mount.source)}, ` +
          `which does not exist (looked at ${sourcePath}). Sources are resolved against the ` +
          'project root.',
      );
    }

    if (mount.page !== undefined && !pageIds.has(mount.page)) {
      refuse(
        'MountPageUnknown',
        `mount ${JSON.stringify(mount.component)} belongs to page ${JSON.stringify(mount.page)}, ` +
          `which no page declares. Declared pages: ${[...pageIds].join(', ') || '(none)'}.`,
      );
    }

    const resolved: ResolvedMount = {
      component: mount.component,
      source: mount.source,
      sourcePath,
      artifact: mount.artifact ?? artifactKey(mount.source, mount.component),
      page: mount.page,
      expectProvable: mount.expectProvable ?? policies.expectProvable,
      substitute: resolveSubstitution(mount, root, generatedDir),
    };

    // The artifact key is short rather than injective on purpose, so two
    // same-named components in same-named files can land on one directory.
    // That is a build error, not a merge: the second emit would overwrite the
    // first and the page would resume the wrong component.
    const collision = byArtifact.get(resolved.artifact);
    if (collision) {
      refuse(
        'ArtifactKeyCollision',
        `mounts ${JSON.stringify(collision.source)} (${collision.component}) and ` +
          `${JSON.stringify(resolved.source)} (${resolved.component}) both claim the artifact ` +
          `directory ${JSON.stringify(resolved.artifact)}. Give one of them an explicit ` +
          '`artifact` name.',
      );
    }
    byArtifact.set(resolved.artifact, resolved);

    return resolved;
  });
}

/**
 * Where a rewritten module goes, and the glue it calls.
 *
 * The helper's name is derived from the component's, because a project that
 * names its glue after the component it claims should not have to say so
 * twice. The specifier is re-rooted here rather than in the stage: the
 * directory the rewritten module sits in is a configuration fact, and the
 * stage has enough to derive already.
 */
function resolveSubstitution(
  mount: MountDeclaration,
  root: string,
  generatedDir: string,
): ResolvedSubstitution | undefined {
  const declared = mount.substitute;
  if (declared === undefined) return undefined;

  if (!declared.out) {
    refuse(
      'SubstituteOutMissing',
      `mount ${JSON.stringify(mount.component)} declares a substitution with no \`out\`. The ` +
        'rewritten module needs a path; relative ones land under `generatedDir`.',
    );
  }

  if (!declared.claim?.module) {
    refuse(
      'ClaimGlueUndeclared',
      `mount ${JSON.stringify(mount.component)} declares a substitution with no ` +
        '`claim.module`. The rewritten mount point calls glue that publishes the live store and ' +
        'claims the resumed element; which module exports it is yours to say.',
    );
  }

  const outPath = absoluteUnder(generatedDir, declared.out);
  const modulePath = absoluteUnder(root, declared.claim.module);
  const named = existsSync(modulePath);

  return {
    outPath,
    helper: declared.claim.helper ?? `claim${mount.component}`,
    specifier: named ? relativeSpecifier(dirname(outPath), modulePath) : declared.claim.module,
    modulePath: named ? modulePath : undefined,
    banner: declared.banner,
  };
}

/** A path under the root, re-rooted to the directory a generated module sits in. */
function relativeSpecifier(fromDir: string, target: string): string {
  const rerooted = relative(fromDir, target);
  return rerooted.startsWith('.') ? rerooted : `./${rerooted}`;
}

/**
 * A declared path made absolute against a root, for stages that resolve
 * configuration of their own. Exported so there is one answer to "where does
 * this path land" rather than one per stage.
 */
export function resolveUnder(root: string, path: string): string {
  return absoluteUnder(root, path);
}

function absoluteUnder(root: string, path: string): string {
  return isAbsolute(path) ? resolve(path) : resolve(join(root, path));
}
