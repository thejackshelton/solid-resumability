/**
 * Builds all four targets: {classic, resumable} x {fixtures, todos}.
 *
 *   pnpm build     # runs `pnpm emit` first, so the artifacts are current
 *
 * Four builds rather than two because chunk assignment is per build: see the
 * long note in `build/config.mjs`. Each lands in `dist/<variant>/<page>/`
 * with its own `.vite/manifest.json` and `.vite/module-sizes.json`, which is
 * what `pnpm measure` reads.
 */

import { rmSync, writeFileSync } from "node:fs";
import { join } from "pathe";

import { build } from "vite";

import { DEMO_ROOT } from "../build/fixtures.mjs";
import { PAGES, VARIANTS, demoConfig } from "../build/config.mjs";

// `emptyOutDir` only clears the page's own directory, so a stale variant
// directory from an earlier layout would survive. Start from nothing.
rmSync(join(DEMO_ROOT, "dist"), { recursive: true, force: true });

for (const variant of VARIANTS) {
  for (const page of PAGES) {
    process.stdout.write(`\n── ${variant} / ${page} ${"─".repeat(40)}\n`);
    // `configFile: false`: this script *is* the config, and loading
    // `vite.<variant>.config.mjs` on top of it would rebuild both pages.
    await build({ ...demoConfig({ variant, page }), configFile: false });
  }
}

// The resumable todos page is served with its first paint in it, captured from
// the built group chunk — which is why it happens inside the build that
// produced that chunk rather than after all four. The plugin's `closeBundle`
// does it, on the one build whose declaration asks for a capture (see
// `build/resumability.mjs`); nothing else in `dist/` is touched, and the
// classic variant and both fixtures pages come out of the four builds above
// byte for byte.

// `vite preview` serves `dist/<variant>/` as its root, but the measured
// builds land one directory deeper (`dist/<variant>/<page>/`), so `/` would
// be a 404. Give each variant a landing page; excluded from measurement by
// construction, since `measure` reads only the per-page manifests.
for (const variant of VARIANTS) {
  const links = PAGES.map(
    page => `<li><a href="/${page}/${page}.html">${page}.html</a></li>`,
  ).join("\n      ");
  writeFileSync(
    join(DEMO_ROOT, `dist/${variant}/index.html`),
    `<!doctype html>
<meta charset="utf-8">
<title>${variant} demo</title>
<body style="font: 16px/1.6 system-ui; max-width: 40rem; margin: 4rem auto">
  <h1>${variant} build</h1>
  <ul>
      ${links}
  </ul>
  <p>Compare against the other variant's preview (classic: 3010, resumable: 3011 —
  check the terminal: vite hops ports if one is taken). Numbers:
  <code>docs/measurements/demo-baseline.md</code>.</p>
</body>
`,
  );
}
