/**
 * `pnpm coverage` — walk the corpus, classify every component, write the
 * baseline.
 *
 *   pnpm coverage                       # the default corpus, app/src
 *   pnpm coverage app/src               # any corpus directory
 *   pnpm coverage app/src --out docs/coverage
 *
 * Output is deterministic: two consecutive runs over an unchanged corpus
 * produce byte-identical `coverage.json`. `baseline.md` additionally carries a
 * generation date, which defaults to today in UTC and can be pinned with
 * `COVERAGE_DATE=YYYY-MM-DD`.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "pathe";
import { fileURLToPath } from "node:url";

import { renderBaseline } from "./markdown.ts";
import { buildReport } from "./report.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
/** src/coverage -> the repo root that holds `app/`, `src/`, `docs/`. */
const ROOT = resolve(HERE, "../..");

const DEFAULT_CORPUS = join(ROOT, "app/src");
const DEFAULT_OUT = join(ROOT, "docs/coverage");
const COMMAND = "pnpm coverage";

/**
 * Written once, attached twice: `MainSection` and `Footer` are the same case,
 * and saying it twice in slightly different words would invite the reader to
 * hunt for a difference that isn't there.
 */
const GUARD_ONLY_NOTE = [
  "Proved, not mounted. The analyzer proves `MainSection` and `Footer`; the demo does not",
  "substitute them out, and both statements are true at once. Their bodies stay in the",
  "group because what flips their guard is a store write, and a store write is the",
  "group's — a resumed page never has to build this markup, so there is nothing here for",
  "an activation to do. The guard-only artifact is the whole of what the verdict claims.",
].join(" ");

/**
 * What this repo's own numbers mean, in this repo's own words.
 *
 * `report.ts` and `markdown.ts` know nothing about TodoMVC and should not: they
 * count components and render tables for whatever corpus they are pointed at.
 * The three sentences below are the part that is about *this* corpus, and this
 * is the only file in the coverage tool that is allowed to hold them.
 *
 * They are keyed by component id, and a key the corpus no longer contains is a
 * hard failure of `pnpm coverage` — which is the point. A qualification that
 * outlives the thing it qualifies is worse than no qualification.
 */
const NOTES: Record<string, string> = {
  // Architectural residue, not a queue of work. The distinction matters,
  // because "expensive" invites someone to pay for it and this cannot be
  // bought.
  "app/src/app.tsx#App": [
    "Architectural residue. `App`'s mount point is where `createTodos()` is provided —",
    "the provider call *is* the frame — so a resumed `App` has no frame in which to create",
    "the store, and every component below it would be reaching for a store that does not",
    "exist yet. 5/5 is therefore incoherent with the substitution model, not merely",
    "expensive: there is no amount of analyzer work that makes a component provable when",
    "proving it would mean substituting out the one call the page is built around. Its two",
    "codes are the symptom, not the cause — closing them would not move this.",
  ].join(" "),

  // The same sentence for both, because it is the same fact about both: the
  // analyzer's verdict and the demo's substitution list are two different
  // questions, and only the first one is what this number counts.
  "app/src/app.tsx#MainSection": GUARD_ONLY_NOTE,
  "app/src/app.tsx#Footer": GUARD_ONLY_NOTE,

  // Kept separate from `MainSection` on purpose: a verdict that follows from a
  // neighbour's is a verdict nobody checked.
  "app/src/app.tsx#TodoItem": [
    "A props-boundary fallback. No call site this pass admits binds `TodoItem`'s props: the",
    "keyed region's item slot binds a *body parameter*, never a child component's props, so",
    "this verdict is its own and does not follow from `MainSection`'s. Read it as the props",
    "boundary the pass has not crossed rather than as five unrelated defects — the `Props*`",
    "fixtures hold the same rule, and they are where the boundary can be moved one shape at",
    "a time.",
  ].join(" "),
};

function parseArguments(argv: string[]): { corpus: string; out: string } {
  let corpus = DEFAULT_CORPUS;
  let out = DEFAULT_OUT;
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out") {
      const value = argv[++i];
      if (value === undefined) throw new Error("--out needs a directory");
      out = isAbsolute(value) ? value : resolve(process.cwd(), value);
      continue;
    }
    positional.push(argv[i]);
  }

  if (positional.length > 1) throw new Error(`expected at most one corpus directory, got ${positional.length}`);
  if (positional.length === 1) {
    corpus = isAbsolute(positional[0]) ? positional[0] : resolve(process.cwd(), positional[0]);
  }

  return { corpus, out };
}

/** Reads the exact dependency pins the baseline was measured against. */
function readToolchain(): Record<string, string> {
  const app = JSON.parse(readFileSync(join(ROOT, "app/package.json"), "utf8"));
  const tool = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const appDeps: Record<string, string> = { ...app.dependencies, ...app.devDependencies };

  const pins: Record<string, string> = {};
  for (const name of ["solid-js", "@solidjs/web", "@solidjs/vite-plugin", "typescript", "vite"]) {
    if (appDeps[name] !== undefined) pins[name] = appDeps[name];
  }
  // The analyzer is an exact registry pin in this tool's own manifest, so the
  // manifest is the pin — no resolution or install layout is involved.
  pins["yuku-analyzer"] = tool.dependencies["yuku-analyzer"];
  return pins;
}

function isoDate(): string {
  const pinned = process.env.COVERAGE_DATE;
  if (pinned !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(pinned)) return pinned;
  return new Date().toISOString().slice(0, 10);
}

const { corpus, out } = parseArguments(process.argv.slice(2));

const report = buildReport({
  corpusDir: corpus,
  root: ROOT,
  fixtureDirectory: "fixtures",
  toolchain: readToolchain(),
  // The notes are statements about THIS corpus, so they travel with it: over
  // any other tree their ids name nothing and the staleness gate would stop a
  // run that has done nothing wrong. Over the default corpus the gate is live,
  // which is where it is wanted — that is the run that regenerates the
  // committed baseline.
  notes: corpus === DEFAULT_CORPUS ? NOTES : undefined,
});

mkdirSync(out, { recursive: true });
writeFileSync(join(out, "coverage.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
writeFileSync(join(out, "baseline.md"), renderBaseline(report, { command: COMMAND, date: isoDate() }), "utf8");

const app = report.segments.app;
const fixtures = report.segments.fixtures;
console.log(
  `coverage  app ${app.provable}/${app.components} provable (${(app.provableFraction * 100).toFixed(1)}%), ` +
    `fixtures ${fixtures.provable}/${fixtures.components} (${(fixtures.provableFraction * 100).toFixed(1)}%)`,
);
console.log(`          -> ${join(out, "coverage.json")}`);
console.log(`          -> ${join(out, "baseline.md")}`);
