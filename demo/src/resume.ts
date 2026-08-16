/**
 * The demo's artifact registry: the resume path, pointed at `demo/artifacts/`.
 *
 * Two globs and two imports. The globs are the demo's own chunk graph —
 * `src/resume/artifacts.ts` has the equivalent pair for the toolchain's own
 * artifacts and is deliberately not imported here, because a module holding
 * an eager glob makes those artifacts a static dependency of everything
 * downstream of it. This is the "a real build would generate the same two
 * maps from its chunk graph" case, and it is generated from this build's.
 *
 * What is eager, and therefore on the wire before the user touches anything:
 *
 *   structure.js   cells + cell -> DOM bindings, one per component
 *   wiring.js      locator + event -> handler module, one per component
 *   the resumer    the runtime: `resumer.ts` + `locate.ts` + `cells.ts`
 *                  (the cell kernel) + `registry.ts` + this file
 *
 * What is not eager: `@solidjs/signals`. The resumer defaults to the cell
 * kernel, so this build imports no framework at all on the resume path — the
 * 9.17 kB gzipped that a signals-backed resume path carries is not in the
 * graph.
 *
 * What is NOT eager, and why:
 *
 *   handlers/*.js  one `import()` each, on the first event that needs it —
 *                  the claim of the whole spike, and measured as such.
 *   template.js    the served HTML *is* the template. `demo/build/plugins.mjs`
 *                  inlines it into the page at build time, so shipping a
 *                  second copy in a module would be paying twice for bytes
 *                  the document already carries. The check that the markup
 *                  really is the template therefore belongs to the build (and
 *                  to `test/fixtures-page.test.ts`, which asserts the served
 *                  markup is byte-identical to what `render()` produces)
 *                  rather than to a runtime string compare.
 */

import { createRegistry, type HandlerModule } from "../../src/resume/registry.ts";
import { createResumer } from "../../src/resume/resumer.ts";

/**
 * Eager, and named one artifact kind at a time: no template module is fetched.
 *
 * The `!` patterns are S4's addition and cost this page nothing: the todos
 * page's own artifacts (`app.Header`, the corpus component the comptime pass
 * proves) live under the same root, and a glob that swept them up would put
 * another page's structure and wiring in *this* page's eager payload. The
 * `app.` prefix is the pass's own qualification for a module-local component,
 * so the split needs no list to maintain — `demo/src/todos-resume.ts` globs
 * exactly the complement.
 */
const STATIC_MODULES = import.meta.glob<Record<string, unknown>>(
  [
    "../artifacts/*/structure.js",
    "../artifacts/*/wiring.js",
    "!../artifacts/app.*/**",
    "!../artifacts/*.SeparatorRoot/**",
    "!../artifacts/*.ButtonRoot/**",
    "!../artifacts/*.ButtonRoot~*/**",
    "!../artifacts/*.DialogTrigger/**",
  ],
  { eager: true },
);

/** Lazy by construction: a record of `() => import(...)`, none of them called. */
const HANDLER_MODULES = import.meta.glob<HandlerModule>([
  "../artifacts/*/handlers/*.js",
  "!../artifacts/app.*/**",
  "!../artifacts/*.SeparatorRoot/**",
  "!../artifacts/*.ButtonRoot/**",
  "!../artifacts/*.ButtonRoot~*/**",
  "!../artifacts/*.DialogTrigger/**",
]);

export const registry = createRegistry(STATIC_MODULES, HANDLER_MODULES);

/** Resumes a component from this build's artifacts, or declines with `null`. */
export const resume = createResumer(registry);
