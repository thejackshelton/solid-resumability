/**
 * Everything the build needs on disk before a bundler starts.
 *
 *   pnpm emit
 *
 * Three stage bodies of `unplugin-solid-resumability`, run with no bundler
 * around them: the pass over the five declared components (pruning first,
 * refusing last), the rewrite of the corpus module the todos page resumes out
 * of, and that page's deferral group module. They are the same three the
 * plugin's `buildStart` runs — the same functions, over the same declaration —
 * which is the point of every stage body being a plain function of explicit
 * inputs. `pnpm build` runs this first so `pnpm test` and `pnpm typecheck` have
 * the generated modules without a bundler having to run.
 *
 * It is a hard error for a declared component to come back `fallback`. They are
 * the positive controls of the coverage baseline: if the pass stops proving
 * them, the demo is not the thing it claims to be and should fail loudly rather
 * than build a page with a hole in it. That refusal is the plugin's
 * (`policies.expectProvable`, on by default), and it fires here exactly as it
 * fires in a build.
 */

import { relative } from "pathe";

import {
  resolveOptions,
  runAnalyzeStage,
  runGroupStage,
  runSubstituteStage,
} from "unplugin-solid-resumability/node";

import { REPO_ROOT } from "../build/fixtures.mjs";
import { demoResumability } from "../build/resumability.mjs";

// No page is captured here: capturing runs a built chunk, and nothing is built
// yet. `scripts/build.mjs` gets that for free, from the same declaration.
const options = resolveOptions(demoResumability({ capture: [] }));

const { outcomes, pruned } = runAnalyzeStage(options);
for (const stale of pruned) {
  console.log(`pruned    ${relative(REPO_ROOT, stale)}/ — no declared mount claims it`);
}

const { results } = runSubstituteStage(options, outcomes);
runGroupStage(options, results);
