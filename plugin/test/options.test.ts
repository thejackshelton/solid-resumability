/**
 * Defaults, and the four configurations this plugin declines to act on.
 *
 * The defaults matter because every stage reads the resolved object and only
 * the resolved object: a default that drifted here would drift everywhere at
 * once, silently. The refusals matter more. Each one throws before a file is
 * read, carries its own error name, and says what to do instead — a build tool
 * that quietly accepts a configuration it cannot honour spends someone's
 * afternoon.
 */

import { join, resolve } from 'pathe';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_RUNTIME_SPECIFIER,
  ResumabilityConfigError,
  resolveOptions,
} from '../src/options.ts';
import { applyChunkingConstraints, type ChunkingConfig } from '../src/stages/chunking.ts';
import type { MountDeclaration } from '../src/types.ts';

const REPO_ROOT = resolve(import.meta.dirname, '../..');

const ONE_MOUNT: MountDeclaration[] = [
  { component: 'ProvableCounter', source: 'app/src/fixtures/ProvableCounter.tsx' },
];

/** Asserts the refusal fired, and that it fired under the name the caller expected. */
function refusalFrom(run: () => unknown): ResumabilityConfigError {
  let thrown: unknown;
  try {
    run();
  } catch (error) {
    thrown = error;
  }
  expect(thrown, 'expected a refusal, got none').toBeInstanceOf(ResumabilityConfigError);
  return thrown as ResumabilityConfigError;
}

describe('defaults', () => {
  const resolved = resolveOptions({ root: REPO_ROOT, mounts: ONE_MOUNT });

  it('puts artifacts and generated modules where the convention says', () => {
    expect(resolved.artifactDir).toBe(join(REPO_ROOT, 'artifacts'));
    expect(resolved.generatedDir).toBe(join(REPO_ROOT, 'src/generated'));
  });

  it('reports module paths relative to the project root unless told otherwise', () => {
    expect(resolved.corpusRoot).toBe(REPO_ROOT);
    expect(resolveOptions({ root: REPO_ROOT, corpusRoot: '..', mounts: ONE_MOUNT }).corpusRoot).toBe(
      resolve(REPO_ROOT, '..'),
    );
  });

  it('expects every declared mount to be provable, fetches on first touch, keeps the fallback path', () => {
    expect(resolved.policies).toEqual({
      expectProvable: true,
      prefetch: 'interaction',
      fallback: 'always',
      pruneStaleArtifacts: true,
      chunking: true,
    });
  });

  it('points generated modules at this package own runtime', () => {
    expect(resolved.runtime).toBe(DEFAULT_RUNTIME_SPECIFIER);
    expect(DEFAULT_RUNTIME_SPECIFIER).toBe('unplugin-solid-resumability/runtime');
  });

  it('derives the artifact key from the source and the component name', () => {
    expect(resolved.mounts[0]!.artifact).toBe('ProvableCounter');
    expect(resolved.mounts[0]!.sourcePath).toBe(
      join(REPO_ROOT, 'app/src/fixtures/ProvableCounter.tsx'),
    );
    expect(resolved.mounts[0]!.expectProvable).toBe(true);

    const qualified = resolveOptions({
      root: REPO_ROOT,
      mounts: [{ component: 'PropsPairParent', source: 'app/src/fixtures/PropsPair.tsx' }],
    });
    expect(qualified.mounts[0]!.artifact).toBe('PropsPair.PropsPairParent');
  });

  it('lets a mount override the provability policy', () => {
    const relaxed = resolveOptions({
      root: REPO_ROOT,
      mounts: [{ ...ONE_MOUNT[0]!, expectProvable: false }],
      policies: { expectProvable: true },
    });
    expect(relaxed.mounts[0]!.expectProvable).toBe(false);
  });
});

describe('refusals', () => {
  it('refuses an idle prefetch by name', () => {
    const error = refusalFrom(() =>
      resolveOptions({
        root: REPO_ROOT,
        mounts: ONE_MOUNT,
        policies: { prefetch: 'idle' as 'none' },
      }),
    );
    expect(error.name).toBe('PrefetchIdleRefused');
    expect(error.message).toContain('zero-eager');
    expect(error.message).toContain('interaction');
  });

  it('refuses a mount whose source is not there', () => {
    const error = refusalFrom(() =>
      resolveOptions({
        root: REPO_ROOT,
        mounts: [{ component: 'Missing', source: 'app/src/fixtures/NotAFile.tsx' }],
      }),
    );
    expect(error.name).toBe('MountSourceMissing');
    expect(error.message).toContain('app/src/fixtures/NotAFile.tsx');
  });

  it('refuses two mounts that would land on one artifact directory', () => {
    const error = refusalFrom(() =>
      resolveOptions({
        root: REPO_ROOT,
        mounts: [
          { component: 'ProvableCounter', source: 'app/src/fixtures/ProvableCounter.tsx' },
          {
            component: 'ProvableStepper',
            source: 'app/src/fixtures/ProvableStepper.tsx',
            artifact: 'ProvableCounter',
          },
        ],
      }),
    );
    expect(error.name).toBe('ArtifactKeyCollision');
    expect(error.message).toContain('ProvableCounter');
  });

  it('refuses a page that asks to be prerendered with no group to render', () => {
    const error = refusalFrom(() =>
      resolveOptions({
        root: REPO_ROOT,
        mounts: ONE_MOUNT,
        pages: [{ id: 'catalogue', html: 'index.html', prerender: { captures: 2 } }],
      }),
    );
    expect(error.name).toBe('PrerenderWithoutGroup');
    expect(error.message).toContain('catalogue');
  });

  it('refuses an empty mount list, and a mount pointing at a page nobody declared', () => {
    expect(refusalFrom(() => resolveOptions({ root: REPO_ROOT, mounts: [] })).name).toBe(
      'NoMountsDeclared',
    );
    expect(
      refusalFrom(() =>
        resolveOptions({
          root: REPO_ROOT,
          mounts: [{ ...ONE_MOUNT[0]!, page: 'nowhere' }],
        }),
      ).name,
    ).toBe('MountPageUnknown');
  });
});

describe('the chunking constraints', () => {
  it('merge into a config rather than replacing it', () => {
    const config: ChunkingConfig = {
      build: {
        outDir: 'dist/somewhere',
        rollupOptions: { output: { entryFileNames: 'kept.js' } },
      },
    };
    applyChunkingConstraints(config);

    expect(config.build!.manifest).toBe(true);
    expect(config.build!.outDir).toBe('dist/somewhere');
    expect(config.build!.rollupOptions!.output).toEqual({
      entryFileNames: 'kept.js',
      experimentalMinChunkSize: 0,
    });
  });

  it('keep a manifest name the consumer chose, and reach every declared output', () => {
    const config: ChunkingConfig = {
      build: {
        manifest: 'my-manifest.json',
        rollupOptions: { output: [{ format: 'es' }, { format: 'es' }] },
      },
    };
    applyChunkingConstraints(config);

    expect(config.build!.manifest).toBe('my-manifest.json');
    expect(config.build!.rollupOptions!.output).toEqual([
      { format: 'es', experimentalMinChunkSize: 0 },
      { format: 'es', experimentalMinChunkSize: 0 },
    ]);
  });

  it('apply to an empty config too', () => {
    const config: ChunkingConfig = {};
    applyChunkingConstraints(config);
    expect(config).toEqual({
      build: { manifest: true, rollupOptions: { output: { experimentalMinChunkSize: 0 } } },
    });
  });
});
