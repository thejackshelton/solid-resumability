/**
 * The demo's own plugins — the three that are about measuring this repository
 * rather than about resumability.
 *
 * What made two variants out of one set of pages used to live here too: the
 * entry swap, the template inlining. Those are `unplugin-solid-resumability`'s
 * now, declared in `build/resumability.mjs`, and what is left is a variant
 * label for the page to print, an API swapped for a fast mock, and a byte
 * accounting sidecar. None of the three would belong in a plugin a consumer
 * installs, and all three are load-bearing for `pnpm measure`.
 */

import { join } from "pathe";

import resumability from "unplugin-solid-resumability/vite";

import { CLICK, REPO_ROOT, RULE } from "./fixtures.mjs";
import { demoResumability } from "./resumability.mjs";

const APP_API = join(REPO_ROOT, "app/src/api.ts");

/** The plugin's page-rewriting stage, as it is named in a build log. */
const HTML_STAGE = "unplugin-solid-resumability:html";

/**
 * The stage that rewrites a served page, addressed by name.
 *
 * Not a demo plugin: it is the very object `build/config.mjs` puts in the
 * resumable builds, pulled out of the array the factory returns so
 * `test/fixtures-page.test.ts` can run the real thing over the real page
 * instead of a second copy of the rewrite. The thirty lines of entry-swapping
 * and mount-filling that used to be here are the plugin's, and a test that
 * re-implemented them would be a test of itself.
 */
/** @returns {import("vite").Plugin} */
export function resumableHtml() {
  const stage = [resumability(demoResumability({ capture: [] }))]
    .flat(Infinity)
    .find((plugin) => plugin?.name === HTML_STAGE);

  if (!stage) throw new Error(`demo: the resumability plugin declared no ${HTML_STAGE} stage`);
  return stage;
}

/**
 * Stamps the variant name into the shared HTML.
 *
 * Cosmetic, and deliberately the same number of bytes' worth of machinery on
 * both sides — a page that could not say which build it is would be a poor
 * demo, and a token that only one variant replaced would be a (tiny) byte
 * difference nobody asked for.
 */
/** @returns {import("vite").Plugin} */
export function variantLabel(variant) {
  return {
    name: "demo-variant-label",
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        return html.replaceAll("__VARIANT__", variant);
      },
    },
  };
}

/**
 * Fills the installed-package mounts with the artifact id the pass emits.
 *
 * `RULE` and `CLICK` derive their ids from the installed `@kobalte/core`
 * barrel, whose defining module is a content-hashed chunk — `fixtures.mjs`
 * reads that name off the barrel precisely so the hash is never written down.
 * A page that spelled the id out would put a second, underived copy of it in a
 * file no derivation reaches, and the next package update would fail the build
 * until both HTML files were hand-edited. The pages carry
 * `__ARTIFACT_<component>__` instead.
 *
 * A token naming a component no installed mount declares throws rather than
 * serving markup with a literal token in it. Runs on both variants, like the
 * variant label: the classic build ignores `data-resume`, but a token only one
 * side replaced would be a byte difference nobody asked for.
 */
/** @returns {import("vite").Plugin} */
export function installedMountIds() {
  const ids = new Map([...RULE, ...CLICK].map((mount) => [mount.component, mount.artifact]));

  return {
    name: "demo-installed-mount-ids",
    // The mount-filling stage is `enforce: "pre"` and selects mounts by the
    // very attribute this fills, so the token has to be gone before it runs.
    // Same bucket, and earlier in the array, is what orders the two.
    enforce: "pre",
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        return html.replace(/__ARTIFACT_([A-Za-z0-9_$]+)__/g, (token, component) => {
          const id = ids.get(component);
          if (id == null) {
            throw new Error(`demo: ${token} names no component any installed mount declares`);
          }
          return id;
        });
      },
    },
  };
}

/**
 * Swaps `app/src/api.ts` for the demo's fast, reliable mock.
 *
 * Interception is by *resolved id*, not by specifier text: `app/src/todos.ts`
 * imports `"./api"`, which only means the app's API module after resolution.
 * Resolving it ourselves and comparing the absolute path is what makes this a
 * swap of exactly one module rather than of anything that happens to be
 * spelled `./api`.
 */
/** @returns {import("vite").Plugin} */
export function apiMock(mockPath) {
  return {
    name: "demo-api-mock",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (!importer || source === mockPath) return null;
      if (!/(^|[./])api(\.ts)?$/.test(source)) return null;

      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (!resolved || resolved.id !== APP_API) return null;
      return mockPath;
    },
  };
}

/**
 * Writes two files next to the build manifest, both of them inputs to
 * `pnpm measure` and neither of them shipped to a browser:
 *
 *   .vite/module-sizes.json   per chunk, the rendered byte length of every
 *                             module inside it
 *   .vite/module-code.json    per module, that rendered code
 *
 * The sizes answer "where did this chunk's bytes come from" without splitting
 * the build into one chunk per question — a split that would itself move
 * bytes (measured: +1.0 kB raw / +0.7 kB gzip on the resumable fixtures page,
 * and it does not even separate the runtime from `@solidjs/signals`, which is
 * why the configs do no manual chunking at all).
 *
 * The code is kept because rendered length is *pre*-minification: it says how
 * a chunk divides, not what each part weighs on the wire. With the code in
 * hand the measurement can minify and gzip any group of modules exactly the
 * way the build did, and report a real number instead of a proportion.
 */
/** @returns {import("vite").Plugin} */
export function moduleSizes() {
  return {
    name: "demo-module-sizes",
    generateBundle(_options, bundle) {
      const chunks = {};
      const code = {};

      for (const [fileName, output] of Object.entries(bundle)) {
        if (output.type !== "chunk") continue;
        const modules = {};
        for (const [id, info] of Object.entries(output.modules)) {
          if (info.renderedLength <= 0) continue;
          modules[id] = info.renderedLength;
          if (typeof info.code === "string") code[id] = info.code;
        }
        chunks[fileName] = {
          name: output.name,
          isEntry: output.isEntry,
          isDynamicEntry: output.isDynamicEntry,
          imports: output.imports,
          dynamicImports: output.dynamicImports,
          modules,
        };
      }

      this.emitFile({
        type: "asset",
        fileName: ".vite/module-sizes.json",
        source: JSON.stringify(chunks, null, 2) + "\n",
      });
      this.emitFile({
        type: "asset",
        fileName: ".vite/module-code.json",
        source: JSON.stringify(code) + "\n",
      });
    },
  };
}
