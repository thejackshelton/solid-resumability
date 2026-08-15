/**
 * Fallback omission: the branch a fully provable page cannot take, removed.
 *
 * A resumable page carries two paths. Components the pass proved are resumed
 * from artifacts against markup already in the document; components it refused
 * are rendered the ordinary way, which means the ordinary renderer has to be
 * reachable. Reachable is the operative word — the branch is written as a
 * dynamic `import()` precisely so the renderer is a chunk the page fetches only
 * if it needs one.
 *
 * On a page where every declared mount came back provable, it never needs one.
 * The branch is unreachable code, and the chunk behind it is a file the build
 * emits for a fetch that cannot happen. `policies.fallback: 'auto-omit'` is the
 * answer, and the derivation under it is one line:
 *
 *   A page may omit its fallback branch IFF every mount declared against it is
 *   provable.
 *
 * Sound in both directions. If every mount is provable, every mount on the page
 * resumes and the branch's guard is never entered — so removing it removes
 * nothing the page could reach. If any mount is not provable, the page
 * needs the renderer for that mount and the branch stays. The verdicts are the
 * pass's own, taken from the same analysis the artifacts came out of, so this
 * is not a heuristic about what a page *probably* needs.
 *
 * ── What omission actually is ─────────────────────────────────────────────
 * The `import()` call is rewritten out of the declaring module, in `transform`,
 * before the bundler resolves it. Nothing imports the fallback module any more,
 * so no chunk is emitted for it: not a smaller chunk, not a stub that throws,
 * NO CHUNK. That distinction is the whole measurement — a stub would still be a
 * dynamic entry, still be in the manifest, still be a file the page names.
 *
 * What replaces it is a rejected promise carrying the reason. The branch is
 * unreachable *by the derivation*, not by construction: a document that grew a
 * mount nobody declared would reach it, and the honest answer to that is a page
 * that fails loudly rather than one that silently renders nothing. The refusal
 * names the page, so the message is a repair instruction.
 *
 * ── Why the consumer names the module ─────────────────────────────────────
 * Everything about WHETHER to omit is derived. Everything about WHERE the
 * branch is written is declared: `page.fallback = { module, specifier }`. A
 * stage that went hunting for `import()` calls that looked like a renderer
 * would be guessing at the one thing it must not guess at, and the failure mode
 * of a wrong guess is a page that lost an import it needed. So the specifier is
 * matched exactly, once, and anything else is a refusal by name.
 */

import { relative } from 'pathe';
import type { UnpluginOptions } from 'unplugin';

import type { ResolvedOptions, ResolvedPage, ResolvedPageFallback } from '../types.ts';
import type { MountOutcome } from './analyze.ts';

/** Every way this stage declines to omit a branch. */
export type FallbackRefusalName = 'FallbackImportMissing' | 'FallbackImportAmbiguous';

/**
 * A fallback branch this stage will not rewrite.
 *
 * `name` is the refusal's own rather than the class's, so a caller can branch
 * on which rule fired without matching on prose that may be reworded.
 */
export class FallbackOmissionError extends Error {
  readonly page: string;

  constructor(name: FallbackRefusalName, message: string, page: string) {
    super(message);
    this.name = name;
    this.page = page;
  }
}

/** One page whose fallback branch the build is dropping, and where it is written. */
export interface OmittedFallback {
  page: ResolvedPage;
  fallback: ResolvedPageFallback;
  /** Every mount declared against the page, all of them provable. */
  mounts: string[];
}

/**
 * The derivation, run over the pass's own verdicts.
 *
 * A page qualifies when the policy asks for omission, the page says where its
 * branch is, at least one mount is declared against it, and every one of those
 * mounts came back provable. The "at least one" clause is not pedantry: a page
 * with no declared mounts is trivially all-provable, and dropping the renderer
 * from a page the pass never looked at would be an omission derived from
 * nothing.
 */
export function omittedFallbacks(
  options: ResolvedOptions,
  outcomes: MountOutcome[],
): OmittedFallback[] {
  if (options.policies.fallback !== 'auto-omit') return [];

  const omitted: OmittedFallback[] = [];

  for (const page of options.pages) {
    if (page.fallback === false) continue;

    const mine = outcomes.filter((outcome) => outcome.mount.page === page.id);
    if (mine.length === 0) continue;
    if (mine.some((outcome) => outcome.analysis.status !== 'provable')) continue;

    omitted.push({
      page,
      fallback: page.fallback,
      mounts: mine.map((outcome) => outcome.mount.component),
    });
  }

  return omitted;
}

/**
 * A dynamic import of one exact specifier, in either quoting the author may
 * have used.
 *
 * Written against the call rather than against the module: `import("./x.ts")`
 * is the whole form, and a static `import … from "./x.ts"` in the same file
 * would be a different claim about the same module — one this stage has no
 * business rewriting, because a static import is not a branch.
 */
function importCallOf(specifier: string): RegExp {
  const quoted = specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\bimport\\(\\s*(['"\`])${quoted}\\1\\s*\\)`, 'g');
}

/**
 * The rewrite, as a function of the source, so a test can run it without a
 * bundler and the build and the tests cannot diverge.
 *
 * Exactly one occurrence, or a refusal. Zero means the specifier the page
 * declared is not the specifier the module writes — a config that would
 * otherwise report an omission it did not make. More than one means two
 * branches share a specifier, and which of them is THE fallback branch is not
 * decidable from here.
 */
export function omitFallbackImport(code: string, omission: OmittedFallback): string {
  const { specifier } = omission.fallback;
  const found = [...code.matchAll(importCallOf(specifier))];

  if (found.length === 0) {
    throw new FallbackOmissionError(
      'FallbackImportMissing',
      `page ${JSON.stringify(omission.page.id)} declares its fallback branch as ` +
        `\`import(${JSON.stringify(specifier)})\` in ${omission.fallback.module}, and that ` +
        'module contains no such call. Omission rewrites the call it was told about and nothing ' +
        'else, so a specifier that matches nothing is a configuration error rather than a ' +
        'no-op — the build would report an omission it did not make.',
      omission.page.id,
    );
  }

  if (found.length > 1) {
    throw new FallbackOmissionError(
      'FallbackImportAmbiguous',
      `${omission.fallback.module} imports ${JSON.stringify(specifier)} dynamically ` +
        `${found.length} times, so which call is page ${JSON.stringify(omission.page.id)}'s ` +
        'fallback branch is not decidable. One branch per page: reach the renderer through a ' +
        'single import, or give the branch its own module.',
      omission.page.id,
    );
  }

  const match = found[0]!;
  const start = match.index!;
  return (
    code.slice(0, start) +
    refusalExpression(omission) +
    code.slice(start + match[0].length)
  );
}

/**
 * What the branch becomes: a promise that rejects with the reason it is gone.
 *
 * Deliberately an expression of the same shape the call had, so `await` on it
 * still reads as `await`, and deliberately short — this lands in the page's
 * EAGER chunk, and a paragraph of prose there would be bytes charged to every
 * visitor to explain a branch none of them will take.
 */
function refusalExpression(omission: OmittedFallback): string {
  const reason =
    `page "${omission.page.id}" is fully provable, so its fallback branch was omitted at build time`;
  return `Promise.reject(new Error(${JSON.stringify(reason)}))`;
}

export interface FallbackReport {
  omitted: OmittedFallback[];
}

/**
 * The stage's own plugin: one `transform`, universal across bundlers.
 *
 * `transform` is one of the six hooks unplugin abstracts, so this needs no
 * per-bundler key — the branch is removed the same way under vite, rollup,
 * webpack and the rest. `enforce: 'pre'` so the module arrives as its author
 * wrote it; a specifier already rewritten by somebody else's resolver is not
 * the specifier the page declared.
 */
export function fallbackPlugin(input: {
  options: () => ResolvedOptions;
  outcomes: () => MountOutcome[];
}): UnpluginOptions {
  return {
    name: 'unplugin-solid-resumability:fallback',
    enforce: 'pre',

    transform(code: string, id: string) {
      // An id comparison per module, and nothing else until one matches: the
      // omissions are re-derived here rather than captured because the pass
      // that produces the verdicts runs in a `buildStart` this hook cannot
      // order itself against, and a stale capture would omit on last build's
      // answer.
      const mine = omittedFallbacks(input.options(), input.outcomes()).find(
        (omission) => normalize(id) === normalize(omission.fallback.modulePath),
      );
      if (mine === undefined) return undefined;

      return { code: omitFallbackImport(code, mine), map: null };
    },
  };
}

/** Bundler ids arrive with query strings and platform separators; module identity has neither. */
function normalize(id: string): string {
  return id.split('?')[0]!.replace(/\\/g, '/');
}

/**
 * The stage body, for a consumer whose bundler has no hook to hang it on and
 * for the build log: which pages dropped their branch, and on whose verdicts.
 */
export function runFallbackStage(
  options: ResolvedOptions,
  outcomes: MountOutcome[],
  stage: { log?: (line: string) => void } = {},
): FallbackReport {
  const log = stage.log ?? ((line: string) => console.log(line));
  const omitted = omittedFallbacks(options, outcomes);

  for (const omission of omitted) {
    log(
      `omitted      ${omission.page.id} fallback (${omission.mounts.length} provable mount(s)) -> ` +
        `${relative(options.root, omission.fallback.modulePath)} imports ` +
        `${JSON.stringify(omission.fallback.specifier)} no more`,
    );
  }

  return { omitted };
}
