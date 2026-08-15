/**
 * The corpus-fidelity test's handle on the substitution. Nothing else.
 *
 * The rewrite itself is gone from this repository's demo: the 140 lines of
 * string surgery that used to live here — cut `function Header(…)` at its
 * column-0 brace, replace `<Header />`, rewrite two relative imports — are now
 * `unplugin-solid-resumability`'s AST substitution stage, which derives all
 * three edits from the analysis and reproduces those bytes exactly
 * (`plugin/test/substitute.test.ts` anchors it to the sha256 the architecture
 * ruling quotes). What survives here is the two paths and the one call that
 * `demo/test/todos-resume.test.tsx` needs to ask the question it asks: does the
 * module on disk still regenerate from the corpus, byte for byte?
 *
 * That question is worth keeping on the demo's side rather than the plugin's,
 * because it is the demo asserting something about its OWN generated file — the
 * plugin proves its stage is the rewrite, and this proves the demo is shipping
 * what that stage produces today rather than a copy that drifted.
 */

import { readFileSync } from "node:fs";

import { analyzeFixture } from "../../src/comptime/index.ts";
import { resolveOptions, substituteModule } from "unplugin-solid-resumability/node";

import { demoResumability } from "./resumability.mjs";

const options = resolveOptions(demoResumability({ capture: [] }));
const mount = options.mounts.find((declared) => declared.substitute !== undefined);

if (mount === undefined) {
  throw new Error("substitute: the demo declares no substituted mount");
}

/** The corpus module the substitution reads. Never written to. */
export const APP_SOURCE = mount.sourcePath;

/** Where the emission lands. Inside `demo/`, so the corpus stays frozen. */
export const GENERATED_APP = mount.substitute.outPath;

/**
 * The rewrite, over the corpus module as it is on disk.
 *
 * `source` is taken so the caller states which bytes it means, and checked
 * rather than used: the stage reads the module it was declared against, and a
 * caller asking about different bytes would be asking a question this cannot
 * answer.
 */
export function substituteHeader(source) {
  if (source !== readFileSync(APP_SOURCE, "utf8")) {
    throw new Error(`substitute: the source given is not the current contents of ${APP_SOURCE}`);
  }

  const analysis = analyzeFixture(APP_SOURCE, {
    root: options.corpusRoot,
    component: mount.component,
  });

  return substituteModule(options, mount, analysis).code;
}
