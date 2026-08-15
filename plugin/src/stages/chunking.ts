/**
 * The two chunking constraints the resumed page depends on.
 *
 * Neither is a preference. `manifest` is how the later stages find the chunk a
 * generated module compiled to — without it there is nothing to look the
 * deferred group up in. `experimentalMinChunkSize: 0` keeps authored chunk
 * boundaries: the bundler's small-chunk merging would otherwise fuse handler
 * chunks into each other, and a merged handler chunk is a handler that loads
 * because a *different* button was pressed. Neither constraint can move a byte
 * from lazy to eager; they only stop lazy bytes from being pooled.
 *
 * Applied by mutating the config in place rather than by returning a partial,
 * and only ever field by field. A consumer who already named their manifest
 * keeps their name; a consumer with several outputs gets the constraint on
 * each of them and loses none of their own settings.
 */

import type { UnpluginOptions } from 'unplugin';

import type { ResolvedOptions } from '../types.ts';

/** The narrow shape this stage touches. Structural on purpose: it costs no dependency on a bundler's types. */
export interface ChunkingConfig {
  build?: {
    manifest?: boolean | string;
    rollupOptions?: {
      output?: ChunkingOutput | ChunkingOutput[];
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/** Open on purpose: every other field of an output is the consumer's and is passed through untouched. */
export interface ChunkingOutput {
  experimentalMinChunkSize?: number;
  [key: string]: unknown;
}

/**
 * Merges the constraints into `config`, returning it for callers who prefer a
 * value. Safe to run twice on one config.
 */
export function applyChunkingConstraints<T extends ChunkingConfig>(config: T): T {
  const build = (config.build ??= {});

  // Truthy already means a manifest is being written, possibly under a name
  // the consumer chose. Only the absence is ours to fill.
  if (!build.manifest) build.manifest = true;

  const rollupOptions = (build.rollupOptions ??= {});
  if (rollupOptions.output === undefined) rollupOptions.output = {};
  const declared = rollupOptions.output;
  const outputs: ChunkingOutput[] = Array.isArray(declared) ? declared : [declared];

  // Unconditional: a nonzero floor is exactly the merging this constraint
  // exists to prevent, so honouring a consumer's value here would honour it
  // into a broken build.
  for (const output of outputs) output.experimentalMinChunkSize = 0;

  return config;
}

/** The stage as a plugin fragment: a Vite `config` hook and nothing else. */
export function chunkingPlugin(options: ResolvedOptions): UnpluginOptions {
  return {
    name: 'unplugin-solid-resumability:chunking',
    enforce: 'pre',
    vite: {
      // Typed `unknown` and narrowed here rather than taken as the bundler's
      // own config type: this package declares no bundler dependency, and the
      // two fields it touches are the two it declares.
      config(config: unknown) {
        if (!options.policies.chunking) return;
        applyChunkingConstraints(config as ChunkingConfig);
      },
    },
  };
}
