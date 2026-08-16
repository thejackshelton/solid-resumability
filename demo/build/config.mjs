/**
 * The build config, parameterised by variant and page.
 *
 * Both variants build the same pages from the same root with the same
 * plugin pipeline, the same minifier and the same target. Anything that could
 * move bytes lives here so it cannot differ between them by accident; the
 * per-variant halves add only what has to differ.
 *
 * ── Why each page is built on its own ──────────────────────────────────────
 * `pnpm build` runs one build per (variant, page), each into its own
 * `dist/<variant>/<page>/`. That is not how one would ship a multi-page site;
 * it is how one has to *measure* one, because rollup assigns a module to a
 * chunk by which entry points reach it, so building two pages together lets
 * one page's dependencies decide the other page's chunk boundaries.
 *
 * That effect is large enough here to swallow the whole result. Built
 * together, the todos page reaches all of `@solidjs/signals` (stores,
 * reconcile, async) through the package's `export *` barrel; the fixtures
 * page reaches the barrel too, for `createSignal` alone, and inherits a
 * shared chunk carrying the lot — 54 kB where the page's own needs are 17 kB.
 * Measured that way the resumable page pays for a page the user is not
 * looking at. Per-page builds remove the artefact from *both* sides equally:
 * the classic fixtures page likewise stops carrying anything the todos page
 * dragged in. What is left is the thing under test.
 */

import { join } from "pathe";

import solid from "@solidjs/vite-plugin";
import resumability from "unplugin-solid-resumability/vite";

import { DEMO_ROOT } from "./fixtures.mjs";
import { apiMock, moduleSizes, variantLabel } from "./plugins.mjs";
import { demoResumability } from "./resumability.mjs";

export const VARIANTS = ["classic", "resumable"];
export const PAGES = ["fixtures", "todos", "rule", "click"];

const PORTS = { classic: 3010, resumable: 3011 };

/**
 * `page` selects a single-page production build; omitting it gives the
 * two-page config the dev server and `vite preview` use.
 */
export function demoConfig({ variant, page }) {
  const resumable = variant === "resumable";
  const inputs = page ? [page] : PAGES;

  return {
    root: DEMO_ROOT,
    // Relative asset URLs: the measured builds land one directory deep
    // (`dist/<variant>/<page>/`) but `vite preview` serves `dist/<variant>/`
    // as the site root, so an absolute `/assets/…` would 404 and the page
    // would render as an empty shell. Same bytes either way up to the URL
    // strings themselves, on both variants equally.
    base: "./",
    // The pages import `app/**` and `src/**`, both outside the vite root.
    // Read-only, and only the dev server needs telling that it is allowed.
    server: { fs: { allow: [".."] }, port: PORTS[variant] },
    preview: { port: PORTS[variant] },
    plugins: [
      variantLabel(variant),
      apiMock(join(DEMO_ROOT, "src/api-mock.ts")),
      // The entire difference between the two variants, and the demo's only
      // claim on it is the declaration in `resumability.mjs`. The pass proves
      // the five declared components and emits their artifacts, rewrites the
      // corpus module the todos page resumes out of, generates that page's
      // deferral group, swaps both entry scripts, fills the fixtures page's
      // mounts with their emitted markup, and — in the build that produced the
      // group chunk — captures the todos page's first paint and inlines it.
      ...(resumable ? [resumability(demoResumability({ capture: inputs }))] : []),
      // The same pipeline `app/` builds with: native JSX compiler, native
      // lazy / refresh passes.
      solid(),
      moduleSizes(),
    ],
    resolve: {
      // `src/resume/*` resolves its bare imports from the repo root's
      // `node_modules`, which holds the same pinned versions as
      // `demo/node_modules` (the toolchain project is the root package).
      // Without this the resumable build would carry two copies of
      // @solidjs/signals —
      // and a measurement of two copies of a runtime is a measurement of a
      // packaging mistake.
      dedupe: ["@solidjs/signals", "solid-js", "@solidjs/web"],
    },
    build: {
      outDir: page ? `dist/${variant}/${page}` : `dist/${variant}`,
      emptyOutDir: true,
      // The plugin sets this too, on the resumable side, because the capture
      // has to look the group's chunk up somewhere. It is stated here as well
      // because the CLASSIC build has no plugin in it and `pnpm measure` reads
      // both variants' manifests — a control build that stopped writing one
      // would take the comparison with it.
      manifest: true,
      target: "es2022",
      // Vite's defaults, stated rather than assumed, because the whole
      // comparison is in bytes. Sourcemaps stay off on both sides: they would
      // land in dist and confuse a naive byte count.
      minify: "esbuild",
      cssMinify: true,
      sourcemap: false,
      rollupOptions: {
        input: Object.fromEntries(inputs.map(name => [name, join(DEMO_ROOT, `${name}.html`)])),
        output: {
          // Keep authored chunk boundaries: rollup's small-chunk merging
          // would otherwise fuse handler chunks into each other, and a merged
          // handler chunk is a handler that loads because a *different*
          // button was pressed. Nothing here can move a byte from lazy to
          // eager — it only stops lazy bytes from being pooled.
          //
          // The plugin applies the same constraint on the resumable side; both
          // variants state it here so the one setting that decides how a build
          // divides cannot differ between them by accident.
          experimentalMinChunkSize: 0,
        },
      },
    },
  };
}
