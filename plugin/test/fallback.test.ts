/**
 * Fallback omission: the derivation, the rewrite, and the two refusals.
 *
 * The derivation is the interesting half, and it is checked from both ends. A
 * page whose every declared mount is provable drops its branch; a page with one
 * unprovable mount keeps it, because that mount still needs the ordinary
 * renderer. Neither answer is a heuristic — both come off the pass's own
 * verdicts, which is what makes "auto" safe to write in the policy name.
 *
 * The rewrite is checked as a string, because that is what it is: the branch's
 * `import()` becomes a rejected promise, the module's other imports are
 * untouched, and the specifier is nowhere in the output. That last one is the
 * measurement — a specifier still in the source is a chunk still in the build.
 */

import { readFileSync } from 'node:fs';
import { join, resolve } from 'pathe';
import { describe, expect, it } from 'vitest';

import type { Analysis } from '../../src/comptime/types.ts';
import { resolveOptions, ResumabilityConfigError } from '../src/options.ts';
import type { MountOutcome } from '../src/stages/analyze.ts';
import {
  FallbackOmissionError,
  omitFallbackImport,
  omittedFallbacks,
  runFallbackStage,
} from '../src/stages/fallback.ts';
import type { ResolvedOptions, ResumabilityOptions } from '../src/types.ts';

const REPO_ROOT = resolve(import.meta.dirname, '../..');
const FIXTURE_DIR = 'plugin/test/fixtures/fallback';

const PROVABLE = { status: 'provable' } as unknown as Analysis;
const REFUSED = { status: 'fallback', reasons: [] } as unknown as Analysis;

/** The demo's own shape, in miniature: two mounts on a page that declares a branch. */
function options(overrides: Partial<ResumabilityOptions> = {}): ResolvedOptions {
  return resolveOptions({
    root: REPO_ROOT,
    mounts: [
      { component: 'ProvableCounter', source: 'app/src/fixtures/ProvableCounter.tsx', page: 'page' },
      { component: 'ProvableStepper', source: 'app/src/fixtures/ProvableStepper.tsx', page: 'page' },
    ],
    pages: [
      {
        id: 'page',
        html: 'demo/fixtures.html',
        fallback: { module: `${FIXTURE_DIR}/page.ts`, specifier: './renderer.ts' },
      },
    ],
    policies: { fallback: 'auto-omit' },
    ...overrides,
  });
}

/** Verdicts in the shape the analyze stage hands them on, one per mount. */
function outcomes(resolved: ResolvedOptions, verdicts: Analysis[]): MountOutcome[] {
  return resolved.mounts.map((mount, index) => ({
    mount,
    analysis: verdicts[index]!,
    emittedDir: null,
  }));
}

function refusalFrom(run: () => unknown): Error {
  let thrown: unknown;
  try {
    run();
  } catch (error) {
    thrown = error;
  }
  expect(thrown, 'expected a refusal, got none').toBeInstanceOf(Error);
  return thrown as Error;
}

const PAGE_SOURCE = readFileSync(join(REPO_ROOT, FIXTURE_DIR, 'page.ts'), 'utf8');

describe('the derivation', () => {
  it('omits the branch of a page whose every declared mount is provable', () => {
    const resolved = options();
    const omitted = omittedFallbacks(resolved, outcomes(resolved, [PROVABLE, PROVABLE]));

    expect(omitted).toHaveLength(1);
    expect(omitted[0]!.page.id).toBe('page');
    expect(omitted[0]!.mounts).toEqual(['ProvableCounter', 'ProvableStepper']);
    expect(omitted[0]!.fallback.specifier).toBe('./renderer.ts');
  });

  it('keeps the branch when one declared mount is not provable', () => {
    const resolved = options();
    expect(omittedFallbacks(resolved, outcomes(resolved, [PROVABLE, REFUSED]))).toEqual([]);
  });

  it('keeps the branch under the default policy, however provable the page', () => {
    const resolved = options({ policies: { fallback: 'always' } });
    expect(omittedFallbacks(resolved, outcomes(resolved, [PROVABLE, PROVABLE]))).toEqual([]);
  });

  it('omits nothing for a page the pass never looked at', () => {
    // Trivially all-provable, and that is the trap: no mount was declared
    // against this page, so its provability is a statement about an empty set.
    const resolved = resolveOptions({
      root: REPO_ROOT,
      mounts: [{ component: 'ProvableCounter', source: 'app/src/fixtures/ProvableCounter.tsx' }],
      pages: [
        {
          id: 'page',
          html: 'demo/fixtures.html',
          fallback: { module: `${FIXTURE_DIR}/page.ts`, specifier: './renderer.ts' },
        },
      ],
      policies: { fallback: 'auto-omit' },
    });
    expect(omittedFallbacks(resolved, outcomes(resolved, [PROVABLE]))).toEqual([]);
  });

  it('reports what it dropped, and on how many verdicts', () => {
    const resolved = options();
    const lines: string[] = [];
    const report = runFallbackStage(resolved, outcomes(resolved, [PROVABLE, PROVABLE]), {
      log: (line) => lines.push(line),
    });

    expect(report.omitted).toHaveLength(1);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('page');
    expect(lines[0]).toContain('2 provable mount(s)');
    expect(lines[0]).toContain('./renderer.ts');
  });
});

describe('the rewrite', () => {
  const resolved = options();
  const omission = omittedFallbacks(resolved, outcomes(resolved, [PROVABLE, PROVABLE]))[0]!;
  const rewritten = omitFallbackImport(PAGE_SOURCE, omission);

  it('leaves no reference to the branch module, so no chunk is emitted for it', () => {
    expect(PAGE_SOURCE).toContain("import('./renderer.ts')");
    expect(rewritten).not.toContain('./renderer.ts');
  });

  it('replaces the call with a rejection that names the page and the reason', () => {
    expect(rewritten).toContain('Promise.reject(new Error(');
    // The message is a JS string literal in the emitted source, so the page id
    // arrives escaped — this is the byte the browser would print.
    expect(rewritten).toContain('page \\"page\\" is fully provable');
    expect(rewritten).toContain('omitted at build time');
  });

  it('touches nothing else in the module', () => {
    expect(rewritten).toContain("import { hosts } from './hosts.ts';");
    expect(rewritten).toContain('for (const name of pending) renderFallback(name);');
    // One edit: everything either side of the branch is the author's bytes.
    const [before] = PAGE_SOURCE.split("await import('./renderer.ts')");
    expect(rewritten.startsWith(before!)).toBe(true);
  });

  it('refuses a specifier the module does not import dynamically', () => {
    const error = refusalFrom(() =>
      omitFallbackImport(PAGE_SOURCE, {
        ...omission,
        fallback: { ...omission.fallback, specifier: './hosts.ts' },
      }),
    );
    expect(error).toBeInstanceOf(FallbackOmissionError);
    expect(error.name).toBe('FallbackImportMissing');
    expect(error.message).toContain('./hosts.ts');
  });

  it('refuses a module that imports the branch twice', () => {
    const twice = readFileSync(join(REPO_ROOT, FIXTURE_DIR, 'twice.ts'), 'utf8');
    const error = refusalFrom(() => omitFallbackImport(twice, omission));
    expect(error).toBeInstanceOf(FallbackOmissionError);
    expect(error.name).toBe('FallbackImportAmbiguous');
    expect(error.message).toContain('2 times');
  });
});

describe('refusals in the configuration', () => {
  it('refuses auto-omit that no page gave anything to omit', () => {
    const error = refusalFrom(() =>
      resolveOptions({
        root: REPO_ROOT,
        mounts: [{ component: 'ProvableCounter', source: 'app/src/fixtures/ProvableCounter.tsx' }],
        pages: [{ id: 'page', html: 'demo/fixtures.html' }],
        policies: { fallback: 'auto-omit' },
      }),
    );
    expect(error).toBeInstanceOf(ResumabilityConfigError);
    expect(error.name).toBe('FallbackBranchUndeclared');
    expect(error.message).toContain('auto-omit');
  });

  it('refuses a branch declared in a module that is not there', () => {
    const error = refusalFrom(() =>
      resolveOptions({
        root: REPO_ROOT,
        mounts: [{ component: 'ProvableCounter', source: 'app/src/fixtures/ProvableCounter.tsx' }],
        pages: [
          {
            id: 'page',
            html: 'demo/fixtures.html',
            fallback: { module: `${FIXTURE_DIR}/nowhere.ts`, specifier: './renderer.ts' },
          },
        ],
        policies: { fallback: 'auto-omit' },
      }),
    );
    expect(error).toBeInstanceOf(ResumabilityConfigError);
    expect(error.name).toBe('FallbackModuleMissing');
    expect(error.message).toContain('nowhere.ts');
  });

  it('refuses a branch with no specifier to rewrite', () => {
    const error = refusalFrom(() =>
      resolveOptions({
        root: REPO_ROOT,
        mounts: [{ component: 'ProvableCounter', source: 'app/src/fixtures/ProvableCounter.tsx' }],
        pages: [
          {
            id: 'page',
            html: 'demo/fixtures.html',
            fallback: { module: `${FIXTURE_DIR}/page.ts`, specifier: '' },
          },
        ],
        policies: { fallback: 'auto-omit' },
      }),
    );
    expect(error).toBeInstanceOf(ResumabilityConfigError);
    expect(error.name).toBe('FallbackSpecifierMissing');
  });

  it('leaves a page that declares no branch resolved as `false`', () => {
    const resolved = resolveOptions({
      root: REPO_ROOT,
      mounts: [{ component: 'ProvableCounter', source: 'app/src/fixtures/ProvableCounter.tsx' }],
      pages: [{ id: 'page', html: 'demo/fixtures.html' }],
    });
    expect(resolved.pages[0]!.fallback).toBe(false);
  });
});
