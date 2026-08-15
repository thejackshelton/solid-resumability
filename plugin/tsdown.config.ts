/**
 * Two builds, and the difference between them is the whole point.
 *
 * The build-time half is bundled: the comptime pass and its helpers collapse
 * into one module per entry, so the published tarball carries the pass without
 * carrying a dependency edge back to the repo it was written in. Only the
 * parser toolchain, `pathe` and node's own builtins stay external — they are
 * declared dependencies and a consumer resolves them.
 *
 * The browser half is NOT bundled: one output module per source module,
 * because the module granularity of the resume path is load-bearing. Fusing it
 * into a single file would change which bytes a page pulls eagerly and which
 * arrive on first touch, which is the measurement this whole project exists to
 * make. `unbundle` is the only setting here that a future maintainer must not
 * "simplify".
 */

import { defineConfig } from 'tsdown';

/** Everything a consumer installs. Anything else is inlined at build time and never appears in the manifest. */
const external = [/^yuku-/, 'pathe', 'unplugin', 'jsdom', /^node:/];

/**
 * The two modules of the browser half that are bound to THIS repo and must not
 * ship.
 *
 * `../src/resume/artifacts.ts` globs `artifacts/*` at the repo root, and
 * `../src/resume/index.ts` exists only to join that glob to the resumer. Built
 * into the tarball they emit imports of `../../artifacts/CounterA/*` — a path
 * outside `files: ["dist"]`, so it is not published, so both subpaths fail to
 * resolve for anyone who installs the package. A consumer's artifacts live in
 * the consumer's own tree; that binding is theirs to make.
 *
 * `src/runtime/index.ts` takes the `index` name instead: the same public
 * surface, minus the binding.
 */
const REPO_BOUND = ['!../src/resume/index.ts', '!../src/resume/artifacts.ts'];

/**
 * Keeps the façade a façade.
 *
 * `src/runtime/index.ts` re-exports its siblings by the path TypeScript can
 * follow (`../../../src/resume/registry.ts`), and those siblings are emitted
 * beside it by the block above, one file per source module. This rewrites each
 * such specifier to the emitted name and marks it external, so the façade lands
 * as `export … from "./registry.js"` rather than as a second, fused copy of the
 * browser half — which would double the bytes and, worse, give a page two
 * registries that do not share a store.
 */
const facadeSiblings = {
  name: 'runtime-facade-siblings',
  resolveId(source: string) {
    const sibling = /(?:^|[\\/])src[\\/]resume[\\/]([^\\/]+)\.ts$/.exec(source);
    return sibling === null ? null : { id: `./${sibling[1]}.js`, external: true };
  },
};

export default defineConfig([
  {
    entry: {
      index: 'src/index.ts',
      vite: 'src/vite.ts',
      rollup: 'src/rollup.ts',
      rolldown: 'src/rolldown.ts',
      webpack: 'src/webpack.ts',
      rspack: 'src/rspack.ts',
      esbuild: 'src/esbuild.ts',
      node: 'src/node.ts',
      types: 'src/types.ts',
    },
    outDir: 'dist',
    format: 'esm',
    platform: 'node',
    target: 'node20',
    dts: true,
    external,
    outExtensions: () => ({ js: '.mjs' }),
    clean: false,
    sourcemap: false,
  },
  {
    // The list is a glob, and stays one: a module the browser half gains —
    // `regions.ts`, the keyed-region resolver the resumer reaches by `import()`
    // — is published under `./runtime/*` without a name being added anywhere,
    // and `test/exports.test.ts` proves it landed by comparing what was emitted
    // against what was authored, one module per source module.
    entry: ['../src/resume/*.ts', '!../src/resume/*.d.ts', ...REPO_BOUND],
    outDir: 'dist/runtime',
    format: 'esm',
    platform: 'neutral',
    target: 'es2022',
    unbundle: true,
    dts: false,
    outExtensions: () => ({ js: '.js' }),
    clean: false,
    sourcemap: false,
  },
  {
    // The façade, emitted as `dist/runtime/index.js` — the name the block above
    // no longer claims. Its own entry, because mixing it into that glob would
    // push the common base up to the repo root and nest every emitted module
    // under a directory a consumer's subpath does not name.
    entry: { index: 'src/runtime/index.ts' },
    outDir: 'dist/runtime',
    format: 'esm',
    platform: 'neutral',
    target: 'es2022',
    plugins: [facadeSiblings],
    dts: false,
    outExtensions: () => ({ js: '.js' }),
    clean: false,
    sourcemap: false,
  },
]);
