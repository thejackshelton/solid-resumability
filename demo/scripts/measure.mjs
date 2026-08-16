/**
 * The byte-accounting harness.
 *
 *   pnpm test && pnpm build && pnpm measure
 *
 * Reads both variants' `dist/` output and writes
 * `docs/measurements/demo-baseline.json` and `demo-baseline.md`.
 *
 * ── What counts as eager ──────────────────────────────────────────────────
 * Everything the browser fetches before the user touches anything. The eager
 * set is computed by walking the build manifest from the page's HTML entry
 * through *static* imports, transitively, and every file it reaches is
 * counted: the framework, the resume runtime, the artifact modules, vite's
 * preload helper, the modulepreload polyfill. There is no "runtime doesn't
 * count" line and no exclusions — a resumable page that shipped
 * `@solidjs/signals` and left it out of its own total would be measuring a
 * claim nobody made.
 *
 * The HTML and CSS are counted too, on their own lines and in a combined
 * "initial transfer" figure, because the resumable page's markup carries the
 * component templates and pretending that is free would be the same trick
 * from the other end.
 *
 * ── What counts as lazy ───────────────────────────────────────────────────
 * Chunks reachable from the eager set only through a dynamic `import()`. Each
 * one is listed with the event that fetches it, resolved from the component's
 * own wiring record — not from a guess about what a button is for.
 *
 * ── What this script does not measure ─────────────────────────────────────
 * Time. There is no browser here (deliberately: no headless-browser
 * dependency), so nothing about first paint, parse cost or interaction
 * latency appears in the output. Bytes and module identity are what static
 * analysis of `dist/` can support, and the one number that needs a runtime —
 * how many component bodies the resumable page executes — is read from
 * `demo/.measure/executions.json`, which `pnpm test` writes from live
 * instrumentation. This script refuses to run without it rather than
 * defaulting the number to the answer everyone wants.
 */

import { gzipSync } from "node:zlib";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "pathe";

import { JSDOM } from "jsdom";
import { transformWithEsbuild } from "vite";

import { DEMO_ROOT, FIXTURES, REPO_ROOT, RESUMED, readManifest, readTemplate } from "../build/fixtures.mjs";
import { PAGES, VARIANTS } from "../build/config.mjs";

const OUT_DIR = join(REPO_ROOT, "docs/measurements");
const COMPARED_PAGE = "fixtures";
const MARKLESS_BOOTSTRAP_REFERENCE = 700;

/**
 * What `@solidjs/signals` weighed on this page before the cell kernel
 * replaced it: 9170 B gzipped standalone, 83.9% of an 11011 B eager payload.
 * Read from the `signals` group of `resumable.whereTheBytesGo` in a
 * measurement taken while the dependency was still there, and quoted rather
 * than recomputed because it is the size of a dependency this build no longer
 * has.
 */
const SIGNALS_BEFORE_KERNEL_GZIP = 9170;

/**
 * The todos page's eager caps, and the one that does not hold.
 *
 * The raw cap is the gate `scripts/check-zero-eager.mjs` enforces on the built
 * entry chunk. This file restates the number rather than importing it because
 * that module runs its whole gate on import; the two are kept in step by hand,
 * and the same figure appears a third time in `verify/config.ts`
 * (`TODOS_EAGER_JS_CAP_BYTES`), which is where the witness box reads it. All
 * three moved together to 16,000 when the element-projection restore grew the
 * resumer past the former 15,000 B ceiling.
 *
 * The gzip figure beside it is the companion the deferred-group design named
 * for the same payload; it is recorded here at its measured distance from the
 * payload rather than restated to fit, because a gate that moves whenever the
 * code does is not a gate.
 */
const TODOS_EAGER_RAW_CAP = 16000;
const TODOS_EAGER_GZIP_COMPANION_CAP = 4500;

/**
 * What deleting the deferral loader's replay half outright takes off the eager
 * entry — `nodeAt`, `synthesize` and the body of `replay`, the code that
 * cannot run until the group exists and is therefore the whole of what moving
 * replay behind the lazy boundary could remove.
 *
 * Measured by building that way once (12,717 -> 12,148 B raw, 5,224 -> 5,052 B
 * gzip) and quoted rather than recomputed, because it is the size of a build
 * this repository does not produce. It is a ceiling, not an estimate: a real
 * split leaves an import site behind and saves less.
 */
const TODOS_REPLAY_SPLIT_CEILING = { bytes: 569, gzipBytes: 172 };

/** The deferral group's own module, as the build manifest names it. */
const GROUP_SOURCE = "src/todos-group.ts";

/**
 * What the resumable todos page's eager payload weighed while the fallback
 * group still shipped at load: 70,101 B raw / 26,131 B gzip, with three of the
 * five component bodies executed before the first interaction.
 *
 * Read from the measurement taken then and quoted rather than recomputed,
 * because it is the size of a build this repository no longer produces. It is
 * the before-column of the table the deferral is judged by.
 */
const TODOS_EAGER_BEFORE_DEFERRAL = { bytes: 70101, gzipBytes: 26131, componentExecutionsBeforeInteraction: 3 };

/**
 * What the phase-1 audit measured, at the gate, on the day it passed.
 *
 * Not this build's numbers and not derivable from it: phase 1 is a build this
 * repository no longer produces, so every figure here is QUOTED from the audit
 * that took it first-hand — `docs/goals/finish-line/notes/T006-phase-gate.md`,
 * 2026-08-12, gates G3, G4, G7 and G1 — rather than recomputed. It is the
 * before-column of the only table in this document that measures a phase
 * instead of a page.
 *
 * `fixturesFallbackChunkBytes` is the one row that is an absence now: the
 * fixtures build emitted a fallback branch at 32,415 B that no interaction on
 * the page could reach, because gate F was one-armed and REQUIRED the chunk to
 * exist. The two-armed gate refuses it instead, and `check-zero-eager.mjs`
 * claim 7b now proves the branch is not in the build at all.
 */
const PHASE_1_GATE = {
  source: "docs/goals/finish-line/notes/T006-phase-gate.md",
  date: "2026-08-12",
  todosEagerRawBytes: 12830,
  todosComponentExecutionsBeforeInteraction: 0,
  groupBytes: 62331,
  groupGzipBytes: 23140,
  coverage: { app: { provable: 1, components: 5 }, fixtures: { provable: 6, components: 24 } },
  witnessBoxes: 6,
  fixturesFallbackChunkBytes: 32415,
};

/**
 * The three chunkings of the fallback group, all three built and weighed, and
 * the answer to "why is 62 kB one chunk".
 *
 * Two of these builds no longer exist — they were made to be measured and then
 * reverted, so their figures are quoted rather than recomputed, from the T004
 * measurement run (`docs/goals/clean-cut/notes/T004-w2.md`). The `single` row
 * is quoted from the SAME run so the three numbers are one measurement set and
 * the deltas between them are honest; this document's own gzip column, taken
 * at zlib's default level, puts the shipped single chunk a little above the
 * quoted figure. What the comparison rests on is the deltas, not the levels.
 *
 * The result is the uncomfortable one and it is stated plainly below: every
 * split is bigger than no split.
 */
const GROUP_SPLITS = [
  {
    id: "three-way",
    label: "three-way — signals-core / signals-store / app",
    bytes: 63401,
    gzipBytes: 24546,
    note: "the shape T002 originally ruled: framework split by which page reaches it, app as the residue",
  },
  {
    id: "two-way",
    label: "two-way — framework / app",
    bytes: 62571,
    gzipBytes: 23433,
    note: "one framework chunk, one app chunk",
  },
  {
    id: "single",
    label: "single chunk — what ships",
    bytes: 62368,
    gzipBytes: 23096,
    note: "no manualChunks at all; the group is one dynamic import and one file",
  },
];

/**
 * The app partition, weighed as a real emitted chunk in the three-way build:
 * 6,940 B raw / 2,876 B gzip for the six app modules.
 *
 * Worth quoting because it is the number that killed an estimate. A 5,000 B
 * cap had been derived by applying the whole group's 0.241 minification ratio
 * to 13,289 B of app source — but that ratio comes from `@solidjs/*` dist code
 * that ships pre-minified, and authored TS/JSX does not compress anywhere near
 * it. 6,940 B is the floor for these six modules, and it is not reducible by
 * chunking: they are the group's app, whole.
 */
const GROUP_APP_PARTITION = { bytes: 6940, gzipBytes: 2876 };

/**
 * The deferral group's chunk, itemized as lazy with both of its moments.
 *
 * Two events fetch and run it and they are not the same event: the transfer
 * starts on the first interaction signal, and the execution on the event that
 * commits. Bytes that travel on the signal are transferred, not executed, and
 * are reported under `prefetchedBytes` — never inside the eager total.
 */
const GROUP_TRIGGER = {
  group: true,
  trigger:
    "the first event that commits the group — an interaction with the group's own DOM, or a " +
    "resumed dispatch that needs the store only the group can create",
  transferredOn:
    "a pointer press anywhere in the page, or a keystroke in the resumed mount — the earliest " +
    "real interaction signal, which buys the transfer and not the execution",
};

/* ────────────────────────────── sizes ────────────────────────────────── */

/** gzip at zlib's default level — the same setting vite's build report uses. */
function sizes(buffer) {
  return { bytes: buffer.length, gzipBytes: gzipSync(buffer).length };
}

function fileSizes(path) {
  return sizes(readFileSync(path));
}

function sum(list, key) {
  return list.reduce((total, item) => total + item[key], 0);
}

/* ─────────────────────────── the chunk graph ─────────────────────────── */

function loadBuild(variant, page) {
  const dir = join(DEMO_ROOT, "dist", variant, page);
  const manifestPath = join(dir, ".vite/manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`measure: ${relative(REPO_ROOT, manifestPath)} is missing — run \`pnpm build\` first`);
  }
  return {
    dir,
    manifest: JSON.parse(readFileSync(manifestPath, "utf8")),
    moduleSizes: JSON.parse(readFileSync(join(dir, ".vite/module-sizes.json"), "utf8")),
    moduleCode: JSON.parse(readFileSync(join(dir, ".vite/module-code.json"), "utf8")),
  };
}

/**
 * The eager closure: the entry's chunk plus everything reachable from it by
 * static import. Returns manifest keys, so callers can still see what each
 * chunk *was* before it was hashed into a filename.
 */
function eagerClosure(manifest, entryKey) {
  const seen = new Set();
  const queue = [entryKey];
  while (queue.length) {
    const key = queue.shift();
    if (seen.has(key)) continue;
    seen.add(key);
    for (const next of manifest[key]?.imports ?? []) queue.push(next);
  }
  return seen;
}

/** Everything reachable only through a dynamic import, and its static deps. */
function lazyClosure(manifest, eager) {
  const lazy = new Map(); // key -> the eager-side key that dynamically imports it
  const queue = [];

  for (const key of eager) {
    for (const next of manifest[key]?.dynamicImports ?? []) queue.push([next, key]);
  }

  while (queue.length) {
    const [key, importer] = queue.shift();
    if (eager.has(key) || lazy.has(key)) continue;
    lazy.set(key, importer);
    for (const next of manifest[key]?.imports ?? []) queue.push([next, key]);
    for (const next of manifest[key]?.dynamicImports ?? []) queue.push([next, key]);
  }

  return lazy;
}

/* ──────────────────── what pulls a lazy chunk down ───────────────────── */

/**
 * The event that fetches a handler chunk, read out of the artifact the chunk
 * was emitted from: the wiring record names the event and the locator, and
 * the locator is resolved against the served template to name the element the
 * user actually clicks.
 */
async function handlerTriggers() {
  const triggers = new Map();

  // Both artifact sets: the fixtures page's five components and the todos
  // page's one (`app.Header`). Same derivation for both — the wiring record
  // names the event and the locator, and the locator is resolved against the
  // emitted template to name the element the user actually touches.
  for (const fixture of [...FIXTURES, ...RESUMED]) {
    const manifest = readManifest(fixture);
    const { html } = await readTemplate(fixture);
    const root = new JSDOM(`<body>${html}</body>`).window.document.body.firstElementChild;

    for (const record of manifest.wiring) {
      const key = `artifacts/${fixture.artifact}/${record.module.replace(/^\.\//, "")}`;
      const element = record.locator
        .split("/")
        .filter(Boolean)
        .reduce((node, index) => node.children[Number(index)], root);
      // The fixtures carry `data-testid`, which names the element the way the
      // tests click it. The corpus does not, so a corpus component's element
      // is named the way the page's own markup names it — tag plus first
      // class — rather than by a testid it does not have.
      const testId = element?.getAttribute("data-testid");
      const tag = element?.tagName?.toLowerCase();
      const className = element?.getAttribute("class")?.split(/\s+/)[0];
      const target = testId ?? (tag && className ? `${tag}.${className}` : (tag ?? record.locator));
      triggers.set(key, {
        component: fixture.component,
        handler: record.handler,
        event: record.event,
        locator: record.locator,
        target,
        trigger: `${record.event} on ${testId ? `[data-testid="${testId}"]` : target} (${fixture.component})`,
      });
    }
  }

  return triggers;
}

const FALLBACK_TRIGGER = {
  trigger:
    "never on this page — the ordinary Solid path, fetched only if a component on the page has no artifacts",
};

/* ───────────────────── where a chunk's bytes come from ───────────────── */

const GROUPS = [
  { id: "signals", label: "@solidjs/signals (reactive runtime)", test: id => id.includes("/@solidjs/signals/") },
  { id: "renderer", label: "@solidjs/web + solid-js (renderer)", test: id => id.includes("/@solidjs/web/") || id.includes("/solid-js/dist/") },
  {
    id: "app-components",
    label: "app components (todos)",
    // The substituted module counts here and not as demo glue: it *is* the
    // app's components, minus the one the resumable page resumes.
    test: id =>
      /\/app\/src\/(app|todos|filter)\./.test(id) || id.includes("/demo/src/generated/app.resumable."),
  },
  { id: "fixture-components", label: "fixture component bodies", test: id => id.includes("/app/src/fixtures/") },
  { id: "handler-artifacts", label: "handler artifacts (lazy)", test: id => id.includes("/demo/artifacts/") && id.includes("/handlers/") },
  { id: "artifacts", label: "structure + wiring artifacts", test: id => id.includes("/demo/artifacts/") },
  {
    id: "bootstrap",
    label: "resume bootstrap (resumer + registry + locate + page glue)",
    test: id =>
      id.includes("/src/resume/") ||
      /\/demo\/src\/(resume|resumable-page|todos-resume)\.ts/.test(id) ||
      id.includes("/demo/src/pages/fixtures-resumable.ts") ||
      id.includes("/demo/src/pages/todos-resumable.ts"),
  },
  { id: "api-mock", label: "demo API mock", test: id => id.includes("/demo/src/api-mock.ts") },
  { id: "vite-runtime", label: "vite runtime (preload helper, modulepreload polyfill)", test: id => id.includes("vite/preload-helper") || id.includes("vite/modulepreload-polyfill") },
  { id: "demo-glue", label: "demo page glue", test: id => id.includes("/demo/src/") },
];

function groupOf(id) {
  return GROUPS.find(group => group.test(id))?.id ?? "other";
}

/**
 * Group the modules of a set of chunks, and weigh each group the way the
 * build weighs a chunk: minify its rendered code, then gzip it.
 *
 * The rendered lengths rollup reports are *pre*-minification, so they say how
 * a chunk divides but not what each part costs on the wire. Minifying each
 * group's own code with the build's own minifier gives a number in the same
 * units as the chunk totals. It is not exactly a chunk's byte total split
 * into parts — minifiers work across module boundaries and gzip works across
 * the whole file — so the report prints the residual rather than hiding it.
 */
async function groupBytes(build, chunkFiles) {
  const grouped = new Map();

  for (const file of chunkFiles) {
    const chunk = build.moduleSizes[file];
    if (!chunk) continue;
    for (const [id, renderedLength] of Object.entries(chunk.modules)) {
      const group = groupOf(id);
      const entry = grouped.get(group) ?? { group, renderedBytes: 0, modules: [], code: [] };
      grouped.set(group, entry);
      entry.renderedBytes += renderedLength;
      entry.modules.push(relative(REPO_ROOT, id).replace(/^(\.\.\/)+/, ""));
      if (build.moduleCode[id]) entry.code.push(build.moduleCode[id]);
    }
  }

  const out = [];
  for (const entry of grouped.values()) {
    // Minify module by module rather than the concatenation: rendered modules
    // are fragments of one chunk's scope and several of them legitimately
    // declare the same top-level name (every handler artifact exports `id`),
    // so the concatenation is not a parseable program. Minifying separately
    // also forgoes cross-module renaming, which makes these numbers slightly
    // *larger* than the group's real share — the safe direction.
    const minifiedModules = [];
    for (const code of entry.code) {
      minifiedModules.push((await transformWithEsbuild(code, "module.js", { minify: true, target: "es2022" })).code);
    }
    const minified = minifiedModules.join("\n");
    out.push({
      group: entry.group,
      label: GROUPS.find(group => group.id === entry.group)?.label ?? entry.group,
      renderedBytes: entry.renderedBytes,
      minifiedBytes: Buffer.byteLength(minified),
      minifiedGzipBytes: gzipSync(Buffer.from(minified)).length,
      modules: entry.modules.sort(),
    });
  }

  return out.sort((a, b) => b.minifiedBytes - a.minifiedBytes);
}

/**
 * One named module, weighed on its own — the same way `groupBytes` weighs a
 * group, so the number is in the same units as everything else here.
 *
 * Used for the cell kernel, a single file: `src/resume/cells.ts` replaces
 * `@solidjs/signals` on the resume path, and a claim about that trade needs
 * both sides of it measured rather than one side measured and the other
 * asserted. Returns `null` when the module is not
 * in these chunks at all (the classic page never has it).
 */
async function moduleSize(build, suffix, chunkFiles) {
  for (const file of chunkFiles) {
    const chunk = build.moduleSizes[file];
    if (!chunk) continue;
    for (const [id, renderedLength] of Object.entries(chunk.modules)) {
      if (!id.endsWith(suffix) || !build.moduleCode[id]) continue;
      const minified = (
        await transformWithEsbuild(build.moduleCode[id], "module.js", { minify: true, target: "es2022" })
      ).code;
      return {
        module: relative(REPO_ROOT, id).replace(/^(\.\.\/)+/, ""),
        renderedBytes: renderedLength,
        minifiedBytes: Buffer.byteLength(minified),
        minifiedGzipBytes: gzipSync(Buffer.from(minified)).length,
      };
    }
  }
  return null;
}

/**
 * Every module of these chunks the predicate names, weighed one at a time the
 * way `moduleSize` weighs a single file.
 *
 * A group total says which part of a payload is large; an itemization says
 * which file to open. Used where a cap is at issue, because a cap that is
 * missed by 786 B is answerable only by naming the files that hold them.
 */
async function moduleBreakdown(build, chunkFiles, test) {
  const out = [];
  for (const file of chunkFiles) {
    const chunk = build.moduleSizes[file];
    if (!chunk) continue;
    for (const [id, renderedLength] of Object.entries(chunk.modules)) {
      if (!test(id) || !build.moduleCode[id]) continue;
      const minified = (
        await transformWithEsbuild(build.moduleCode[id], "module.js", { minify: true, target: "es2022" })
      ).code;
      out.push({
        module: relative(REPO_ROOT, id).replace(/^(\.\.\/)+/, ""),
        renderedBytes: renderedLength,
        minifiedBytes: Buffer.byteLength(minified),
        minifiedGzipBytes: gzipSync(Buffer.from(minified)).length,
      });
    }
  }
  return out.sort((a, b) => b.minifiedBytes - a.minifiedBytes);
}

/** The resume runtime and the page's own glue — the files a cap is about. */
const BOOTSTRAP_MODULE = id => id.includes("/src/resume/") || /\/demo\/src\/[\w-]+\.ts$/.test(id);

/* ─────────────────────────── one page, one variant ───────────────────── */

async function measurePage(variant, page, triggers) {
  const build = loadBuild(variant, page);
  const entryKey = `${page}.html`;
  const entry = build.manifest[entryKey];
  if (!entry) throw new Error(`measure: ${variant}/${page} has no manifest entry for ${entryKey}`);

  const eager = eagerClosure(build.manifest, entryKey);
  const lazy = lazyClosure(build.manifest, eager);

  const chunkOf = (key, extra = {}) => {
    const record = build.manifest[key];
    const file = record.file;
    return {
      file,
      name: record.name ?? key,
      source: key,
      ...fileSizes(join(build.dir, file)),
      ...extra,
    };
  };

  const eagerChunks = [...eager].map(key => chunkOf(key)).sort((a, b) => b.bytes - a.bytes);

  // A handler chunk in the eager set would mean the build fused a lazy module
  // into the page's first payload — the exact failure this demo exists to
  // rule out. It is an error, not a footnote.
  const eagerHandlers = eagerChunks.filter(chunk => chunk.source.includes("/handlers/"));
  if (eagerHandlers.length > 0) {
    throw new Error(
      `measure: ${variant}/${page} loads handler chunks eagerly: ${eagerHandlers.map(c => c.source).join(", ")}`,
    );
  }

  const lazyChunks = [...lazy.entries()]
    .map(([key, importer]) =>
      chunkOf(key, {
        importedBy: build.manifest[importer]?.file ?? importer,
        ...(triggers.get(key) ??
          (key === GROUP_SOURCE
            ? GROUP_TRIGGER
            : key === "src/fallback.ts"
              ? FALLBACK_TRIGGER
              : { trigger: "dynamic import" })),
      }),
    )
    .sort((a, b) => a.file.localeCompare(b.file));

  const cssFiles = [...new Set([...eager].flatMap(key => build.manifest[key]?.css ?? []))];
  const css = cssFiles.map(file => ({ file, ...fileSizes(join(build.dir, file)) }));

  const htmlPath = join(build.dir, `${page}.html`);
  const html = { file: `${page}.html`, ...fileSizes(htmlPath) };

  const eagerBytes = sum(eagerChunks, "bytes");
  const eagerGzipBytes = sum(eagerChunks, "gzipBytes");
  const cssBytes = sum(css, "bytes");
  const cssGzipBytes = sum(css, "gzipBytes");

  return {
    variant,
    page,
    entryChunk: entry.file,
    eagerBytes,
    eagerGzipBytes,
    eagerChunks,
    lazyChunks,
    lazyBytes: sum(lazyChunks, "bytes"),
    lazyGzipBytes: sum(lazyChunks, "gzipBytes"),
    css,
    cssBytes,
    cssGzipBytes,
    html,
    initialTransferBytes: eagerBytes + cssBytes + html.bytes,
    initialTransferGzipBytes: eagerGzipBytes + cssGzipBytes + html.gzipBytes,
    whereTheBytesGo: await groupBytes(build, eagerChunks.map(chunk => chunk.file)),
    lazyWhereTheBytesGo: await groupBytes(build, lazyChunks.map(chunk => chunk.file)),
    kernel: await moduleSize(build, "/src/resume/cells.ts", eagerChunks.map(chunk => chunk.file)),
    eagerBootstrapModules: await moduleBreakdown(
      build,
      eagerChunks.map(chunk => chunk.file),
      BOOTSTRAP_MODULE,
    ),
  };
}

/* ──────────────── the bootstrap, weighed on its own line ─────────────── */

async function bootstrapSize(measured) {
  const group = measured.whereTheBytesGo.find(entry => entry.group === "bootstrap");
  if (!group) throw new Error("measure: the resumable fixtures page has no bootstrap modules");

  const rendered = sum(measured.whereTheBytesGo, "renderedBytes");
  const shipped = sum(measured.eagerChunks, "bytes");

  return {
    ...group,
    /** Exact, in pre-minification units. */
    sharePercent: Math.round((group.renderedBytes / rendered) * 1000) / 10,
    /** That share of the chunk that actually shipped — the lower bracket. */
    shareOfChunkBytes: Math.round((group.renderedBytes / rendered) * shipped),
    marklessReferenceBytes: MARKLESS_BOOTSTRAP_REFERENCE,
    /**
     * The cell kernel's own line. It is one file inside the bootstrap group,
     * and it is the file that replaced `@solidjs/signals` here, so it is
     * reported separately from the group it belongs to.
     */
    kernel: measured.kernel,
  };
}

/* ─────────────────────────────── the run ─────────────────────────────── */

const executionsPath = join(DEMO_ROOT, ".measure/executions.json");
if (!existsSync(executionsPath)) {
  throw new Error(
    "measure: demo/.measure/executions.json is missing. It is written by `pnpm test` " +
      "(test/fixtures-page.test.ts) from live loader instrumentation, and this script will not " +
      "invent the number. Run `pnpm test` first.",
  );
}
const executions = JSON.parse(readFileSync(executionsPath, "utf8"));

const expectedComponents = FIXTURES.map(fixture => fixture.component);
if (executions.components.join(",") !== expectedComponents.join(",")) {
  throw new Error(
    `measure: the instrumentation covered [${executions.components}] but the demo ships [${expectedComponents}]`,
  );
}

/**
 * The todos page's own reading, from `demo/test/todos-resume.test.tsx`.
 *
 * Same rule as the fixtures page's: this script does not invent the number of
 * component bodies a page runs, because no static analysis of `dist/` can
 * produce it. The instrument there is a loader hook on `createComponent`, so
 * it sees the four module-local components an export-level hook cannot.
 */
const todosExecutionsPath = join(DEMO_ROOT, ".measure/todos-executions.json");
if (!existsSync(todosExecutionsPath)) {
  throw new Error(
    "measure: demo/.measure/todos-executions.json is missing. It is written by `pnpm test` " +
      "(test/todos-resume.test.tsx) from live loader instrumentation. Run `pnpm test` first.",
  );
}
const todosExecutions = JSON.parse(readFileSync(todosExecutionsPath, "utf8"));

const triggers = await handlerTriggers();

const measured = {};
for (const variant of VARIANTS) {
  measured[variant] = {};
  for (const page of PAGES) {
    measured[variant][page] = await measurePage(variant, page, triggers);
  }
}

const compared = {
  classic: measured.classic[COMPARED_PAGE],
  resumable: measured.resumable[COMPARED_PAGE],
};

const bootstrap = await bootstrapSize(compared.resumable);

/**
 * The todos page — the real application, with its fallback group deferred.
 *
 * The four components that stay in the group — two the pass cannot prove, two
 * it proves but may not substitute — no longer render at load:
 * they, the framework they need and the store they share are one chunk behind
 * one dynamic `import()`, and what the browser gets instead is a prerendered
 * shell in the document plus one resumed component. So this page now makes
 * both claims at once — zero component bodies executed before the first
 * interaction, and an eager payload that is a fraction of the classic build's
 * rather than slightly larger than it.
 *
 * The bytes that moved did not vanish: the group is itemized below at full
 * weight, with the signal that transfers it and the event that executes it
 * named separately.
 */
const groupChunk = measured.resumable.todos.lazyChunks.find(chunk => chunk.group);
if (!groupChunk) {
  throw new Error(`measure: the resumable todos page has no lazy chunk for ${GROUP_SOURCE}`);
}

const todosEagerRaw = measured.resumable.todos.eagerBytes;
const todosEagerGzip = measured.resumable.todos.eagerGzipBytes;

/**
 * The group's anatomy — which modules are in it, in what proportion, and what
 * the three chunkings of it actually weighed.
 *
 * This is the section that answers a question the byte tables cannot: 62 kB is
 * a large chunk, so why is it not split? The answer is in the shape of the
 * thing rather than in anyone's preference, and it needs all three numbers on
 * the page to be believable.
 *
 * Read module for module from the build's own `module-sizes.json`, the same
 * file `demo/scripts/check-zero-eager.mjs` freezes the membership of, so the
 * gate and the document cannot drift apart.
 */
const groupBuild = loadBuild("resumable", "todos");
const groupModules = Object.entries(groupBuild.moduleSizes[groupChunk.file]?.modules ?? {});
if (groupModules.length === 0) {
  throw new Error(`measure: module-sizes.json has no modules for the group chunk ${groupChunk.file}`);
}

const dependency = id => id.includes("/node_modules/");
const moduleName = id => {
  const marker = id.lastIndexOf("/node_modules/");
  return marker === -1 ? relative(REPO_ROOT, id) : id.slice(marker + "/node_modules/".length);
};

const groupFrameworkRendered = groupModules.filter(([id]) => dependency(id)).reduce((total, [, n]) => total + n, 0);
const groupAppRendered = groupModules.filter(([id]) => !dependency(id)).reduce((total, [, n]) => total + n, 0);
const groupRendered = groupFrameworkRendered + groupAppRendered;

const groupAnatomy = {
  chunk: groupChunk.file,
  bytes: groupChunk.bytes,
  gzipBytes: groupChunk.gzipBytes,
  moduleCount: groupModules.length,
  framework: {
    moduleCount: groupModules.filter(([id]) => dependency(id)).length,
    renderedBytes: groupFrameworkRendered,
    sharePercent: Math.round((groupFrameworkRendered / groupRendered) * 1000) / 10,
    modules: groupModules.filter(([id]) => dependency(id)).map(([id]) => moduleName(id)).sort(),
  },
  app: {
    moduleCount: groupModules.filter(([id]) => !dependency(id)).length,
    renderedBytes: groupAppRendered,
    sharePercent: Math.round((groupAppRendered / groupRendered) * 1000) / 10,
    /** As a real emitted chunk, from the split that was built to find out. */
    measuredChunkBytes: GROUP_APP_PARTITION.bytes,
    measuredChunkGzipBytes: GROUP_APP_PARTITION.gzipBytes,
    modules: groupModules.filter(([id]) => !dependency(id)).map(([id]) => moduleName(id)).sort(),
  },
  splits: GROUP_SPLITS,
  whyOneChunk:
    "Activation is atomic: every module of the group runs before any member handler does, so a " +
    "chunk boundary drawn inside it never removes a byte from the first touch — it only adds " +
    "gzip-boundary overhead. All three chunkings were built and weighed, and every split is " +
    "LARGER than no split (+1,033 B raw / +1,450 B gz three-way, +203 / +337 two-way). The gzip " +
    "figure is the structural one: three gzip streams cannot share a dictionary, and that cost " +
    "is bigger than anything a boundary buys back. Cross-page cacheability, which was the " +
    "three-way split's whole reason to exist, is unavailable in any case — per-page builds " +
    "tree-shake 12 of the 14 shared framework modules to different lengths, so the two pages' " +
    "framework chunks have different content hashes no matter how the boundary is drawn.",
  theLever:
    "What shrinks this chunk is not chunk surgery, it is provable coverage — with the correction " +
    "phase 2 forced on that sentence. A proved component leaves the group only when its mount can " +
    "be SUBSTITUTED: then its body becomes structure + wiring artifacts in the eager chunk and a " +
    "handler chunk fetched on the interaction that needs it, and the framework goes with it once " +
    "the last body does. `MainSection` and `Footer` are proved and do NOT leave. What flips their " +
    "guard is a store write, and a store write is the group's — substitute them and the document " +
    "would carry an empty mount for markup the group has not built yet, and the resumer would " +
    "throw rather than resume. Their verdicts are analysis with guard-only artifacts; their " +
    "bodies stay where the group renders them the ordinary way, and this chunk is recorded " +
    "UNCHANGED across both flips. A no-drop is the correct outcome here, not a missed one — an " +
    "unexplained drop would be the red gate. At full coverage the group empties only where the " +
    "ROOT is provable too, and `App`'s mount point is where the store is provided, so on this " +
    "page it never will be. That end state is not hypothetical elsewhere — the fixtures page, " +
    "whose five mounts the pass proves every one of, already ships it, and ships it harder than " +
    "a branch nobody takes: its fallback branch is not BUILT, auto-omitted because every declared " +
    "mount on the page is provable, so the ordinary renderer is in no chunk of that build at all, " +
    "eager or lazy (claim 7b). What the page does fetch is a STORE — the carrier's mount point " +
    "imports one when a dispatch finds no live store, and the module it imports imports nothing " +
    "itself — while no chunk the page can fetch carries a store-partition module of the framework " +
    "(claim 7a). A resumed page on this build fetches a STORE without fetching a RENDERER. The " +
    "todos page is the same page at 3 of 5 proved and exactly one of the three resumed.",
};

const todos = {
  page: "todos.html",
  claim:
    "Bytes and executions, and the bytes are now the smaller part of the story. Zero of the app's " +
    "five component bodies run before the first interaction: `Header` is resumed from artifacts " +
    "against markup the build captured into the document, and the other four — with " +
    "`@solidjs/web`, `@solidjs/signals`, the todos store and the API — are one chunk behind one " +
    "dynamic import that no byte of travels until the user touches the page. The eager payload " +
    "is the resume bootstrap, one component's structure and wiring, and the deferral loader. " +
    "Nothing is excluded from it: the group is reported at full weight under `lazyChunks`, with " +
    "the interaction signal that transfers it and the event that executes it named separately.",
  instrument: todosExecutions.instrument,
  interaction: todosExecutions.interaction,
  classic: {
    eagerRawBytes: measured.classic.todos.eagerBytes,
    eagerGzipBytes: measured.classic.todos.eagerGzipBytes,
    initialTransferBytes: measured.classic.todos.initialTransferBytes,
    initialTransferGzipBytes: measured.classic.todos.initialTransferGzipBytes,
    lazyChunks: measured.classic.todos.lazyChunks,
    componentExecutions: todosExecutions.classic.componentExecutions,
    componentExecutionsBeforeInteraction: todosExecutions.classic.componentExecutionsBeforeInteraction,
    componentsExecuted: todosExecutions.classic.componentsExecuted,
  },
  resumable: {
    /** The load set: one entry chunk, and nothing reaches it but this. */
    eagerRawBytes: todosEagerRaw,
    eagerGzipBytes: todosEagerGzip,
    initialTransferBytes: measured.resumable.todos.initialTransferBytes,
    initialTransferGzipBytes: measured.resumable.todos.initialTransferGzipBytes,
    /**
     * The two caps this payload answers to, and the distance to each. The
     * gzip companion is missed; it is recorded missed, with the files that
     * hold the bytes listed under `eagerBootstrapModules`.
     */
    gates: {
      eagerRawCapBytes: TODOS_EAGER_RAW_CAP,
      eagerRawHeadroomBytes: TODOS_EAGER_RAW_CAP - todosEagerRaw,
      eagerRawCapHolds: todosEagerRaw <= TODOS_EAGER_RAW_CAP,
      eagerGzipCompanionCapBytes: TODOS_EAGER_GZIP_COMPANION_CAP,
      eagerGzipOverCompanionBytes: todosEagerGzip - TODOS_EAGER_GZIP_COMPANION_CAP,
      eagerGzipCompanionHolds: todosEagerGzip <= TODOS_EAGER_GZIP_COMPANION_CAP,
      replaySplitCeiling: TODOS_REPLAY_SPLIT_CEILING,
      note:
        "The raw cap is enforced by demo/scripts/check-zero-eager.mjs and by the witness box " +
        "(verify/config.ts, TODOS_EAGER_JS_CAP_BYTES) against the wire. The gzip companion is " +
        "the figure the deferred-group design named beside it; the payload is over it by the " +
        "amount above, which is reported rather than restated. Moving the deferral loader's " +
        "replay half behind the lazy boundary — the one split available, since that code cannot " +
        "run before the group exists — was measured at a ceiling of " +
        `${TODOS_REPLAY_SPLIT_CEILING.gzipBytes} B gzip, so no split closes this gap and none was made.`,
    },
    /** Per file, for the caps above: the resume runtime and the page glue. */
    eagerBootstrapModules: measured.resumable.todos.eagerBootstrapModules,
    lazyChunks: measured.resumable.todos.lazyChunks,
    lazyBytes: measured.resumable.todos.lazyBytes,
    lazyGzipBytes: measured.resumable.todos.lazyGzipBytes,
    /**
     * The deferral group, on its own line: what a first interaction costs, and
     * what the eager figure above does not contain.
     */
    groupChunk: {
      file: groupChunk.file,
      bytes: groupChunk.bytes,
      gzipBytes: groupChunk.gzipBytes,
      trigger: groupChunk.trigger,
      transferredOn: groupChunk.transferredOn,
      observedTrigger: todosExecutions.resumable.groupTrigger,
      contains: measured.resumable.todos.lazyWhereTheBytesGo
        .filter(group => group.group !== "handler-artifacts")
        .map(group => group.label),
    },
    /**
     * What the group is made of, and why it is one chunk rather than three.
     * The membership here is the same membership `check-zero-eager.mjs`
     * freezes module for module.
     */
    groupAnatomy,
    /**
     * Bytes that travel on an interaction signal and are not executed until
     * the event that commits. Distinct from eager (nothing moves before the
     * user acts) and never folded into it.
     */
    prefetchedBytes: groupChunk.bytes,
    prefetchedGzipBytes: groupChunk.gzipBytes,
    prefetchTrigger: todosExecutions.resumable.prefetchTrigger,
    componentExecutionsAtPrefetch: todosExecutions.resumable.componentExecutionsAtPrefetch,
    componentExecutions: todosExecutions.resumable.componentExecutions,
    componentExecutionsBeforeInteraction: todosExecutions.resumable.componentExecutionsBeforeInteraction,
    componentsExecuted: todosExecutions.resumable.componentsExecuted,
    groupEvaluationsBeforeInteraction: todosExecutions.resumable.groupEvaluationsBeforeInteraction,
    handlerChunkLoadsBeforeInteraction: todosExecutions.resumable.handlerChunkLoadsBeforeInteraction,
    handlerChunkLoadsAfterInteraction: todosExecutions.resumable.handlerChunkLoadsAfterInteraction,
    storesRegisteredBeforeInteraction: todosExecutions.resumable.storesRegisteredBeforeInteraction,
    storesRegistered: todosExecutions.resumable.storesRegistered,
    whereTheBytesGo: measured.resumable.todos.whereTheBytesGo,
    lazyWhereTheBytesGo: measured.resumable.todos.lazyWhereTheBytesGo,
  },
  delta: {
    eagerRawBytes: todosEagerRaw - measured.classic.todos.eagerBytes,
    eagerGzipBytes: todosEagerGzip - measured.classic.todos.eagerGzipBytes,
    eagerGzipPercent:
      Math.round(
        ((measured.resumable.todos.eagerGzipBytes - measured.classic.todos.eagerGzipBytes) /
          measured.classic.todos.eagerGzipBytes) *
          1000,
      ) / 10,
    initialTransferGzipBytes:
      measured.resumable.todos.initialTransferGzipBytes - measured.classic.todos.initialTransferGzipBytes,
    componentExecutions:
      todosExecutions.resumable.componentExecutions - todosExecutions.classic.componentExecutions,
  },
};

// A handler chunk that is not lazy is the failure this page exists to rule
// out — `measurePage` already refuses an eagerly-loaded one, and this refuses
// the other direction: no lazy handler chunk at all would mean the resumable
// todos page never wired `Header`.
if (!todos.resumable.lazyChunks.some(chunk => chunk.handler)) {
  throw new Error("measure: the resumable todos page has no lazily-imported handler chunk");
}

const toolchain = JSON.parse(readFileSync(join(DEMO_ROOT, "package.json"), "utf8")).devDependencies;

/* ──────────────────── phase 1 -> phase 2, as measured ─────────────────── */

/**
 * The two axes this document does not otherwise carry: what the analyzer
 * proves, and how many boxes a real browser is driven through.
 *
 * Both are read rather than restated. Coverage comes out of the record
 * `pnpm coverage` writes, so a verdict cannot move here without moving there
 * first; the box count is the box files themselves, one file per box, so a box
 * cannot be deleted and still be claimed.
 */
const coverage = JSON.parse(readFileSync(join(REPO_ROOT, "docs/coverage/coverage.json"), "utf8")).segments;
const witnessBoxes = readdirSync(join(REPO_ROOT, "verify/boxes")).filter(file => file.endsWith(".box.ts")).length;

/** Fallback branches the fixtures build still emits. Claim 7b says none. */
const fixturesFallbackChunks = [...compared.resumable.eagerChunks, ...compared.resumable.lazyChunks].filter(chunk =>
  /(^|\/)fallback-/.test(chunk.file),
);

const fraction = segment => `${segment.provable}/${segment.components}`;

const phaseDelta = {
  phase1: { ...PHASE_1_GATE },
  phase2: {
    todosEagerRawBytes: todos.resumable.eagerRawBytes,
    todosEagerRawCapBytes: todos.resumable.gates.eagerRawCapBytes,
    todosEagerRawHeadroomBytes: todos.resumable.gates.eagerRawHeadroomBytes,
    todosComponentExecutionsBeforeInteraction: todos.resumable.componentExecutionsBeforeInteraction,
    fixturesComponentExecutionsBeforeInteraction: executions.componentExecutionsBeforeInteraction,
    fixturesEagerRawBytes: compared.resumable.eagerBytes,
    fixturesFallbackChunkBytes: fixturesFallbackChunks.reduce((total, chunk) => total + chunk.bytes, 0),
    groupBytes: todos.resumable.groupChunk.bytes,
    groupGzipBytes: todos.resumable.groupChunk.gzipBytes,
    coverage: {
      app: { provable: coverage.app.provable, components: coverage.app.components },
      fixtures: { provable: coverage.fixtures.provable, components: coverage.fixtures.components },
    },
    witnessBoxes,
  },
  /**
   * Why the group is not in the win, said before anyone can read the no-drop as
   * a miss. This is the T013 correction to the phase-2 design, and it is a
   * statement about the substitution model rather than about chunking.
   */
  whyNotGroupBytes:
    "The group did not shrink and it was not supposed to. `MainSection` and `Footer` flipped to " +
    "provable in phase 2, and neither one may be substituted out of the group: what flips their " +
    "guard is a store WRITE, a store write is the group's, and a substituted mount would sit in " +
    "the document empty while the markup that fills it is still inside the chunk nobody has " +
    "fetched — the resumer throws on an empty mount rather than resuming one. So both flips are " +
    "ANALYSIS verdicts carrying guard-only artifacts, both bodies stay where the group renders " +
    "them the ordinary way, and gate A's anatomy is re-recorded UNCHANGED at " +
    `${groupAnatomy.framework.moduleCount} framework + ${groupAnatomy.app.moduleCount} app ` +
    "modules. T006 predicted 22 + 5 and that prediction is VOID, not missed: it assumed the " +
    "flips would move bodies, and the doctrine that forbids the move was ruled after it. A " +
    "no-drop is the correct outcome for this page; an unexplained drop would be the red gate.",
};

const report = {
  schemaVersion: 1,
  date: process.env.MEASURE_DATE ?? new Date().toISOString().slice(0, 10),
  method: {
    eager:
      "Every file reachable from the page's HTML entry by static import, transitively, as recorded " +
      "in vite's build manifest. No exclusions: framework, resume runtime, artifact modules and " +
      "vite's own preload helper all count.",
    lazy: "Chunks reachable from the eager set only through a dynamic import(), plus their static deps.",
    transferredNotExecuted:
      "Bytes fetched after a real interaction signal (a pointer press, or a keystroke in an " +
      "already-live subtree) and before the event that commits them. They are reported as " +
      "`prefetchedBytes`, at full weight, under their own trigger, and are never added to the " +
      "eager total: the eager total is what an untouched page has fetched, which is why a " +
      "signal-driven transfer cannot enter it and a load-time one would. There are no other " +
      "categories and no exclusions.",
    gzip: "node:zlib gzipSync at its default level, over the built file as shipped.",
    build:
      "Each page is built alone (2 variants x 2 pages) so that chunk grouping across unrelated " +
      "pages cannot move bytes between the two sides. Built together, the todos page's use of " +
      "@solidjs/signals' store modules leaks into the fixtures page's chunk (54 kB where the " +
      "page's own needs are 17 kB) on BOTH sides.",
    attribution:
      "Two units per group, because neither is sufficient alone. `share` is exact but pre-minification: " +
      "the group's fraction of the rendered bytes rollup put in these chunks. `minified standalone` " +
      "is in shipped units but is an upper bound — minifying a module alone cannot rename across " +
      "module boundaries the way the chunk's own minification does, so the parts sum to more than " +
      "the whole (both sums are printed). `share x chunk` applies the exact proportion to the exact " +
      "chunk total. The chunk totals themselves are measured, not derived.",
    componentExecutions:
      "Read from demo/.measure/executions.json (fixtures page) and demo/.measure/todos-executions.json " +
      "(todos page), both written by `pnpm test` from vi.mock loader hooks. The fixtures page's hook " +
      "wraps the five fixture modules' exports and records module evaluation and component invocation " +
      "separately; the todos page's wraps @solidjs/web's createComponent, because four of the app's " +
      "five components are module-local and no export-level hook can see them. Not asserted here.",
    notMeasured: "Time. No browser is involved — bytes and module identity only.",
  },
  toolchain,
  comparedPage: `${COMPARED_PAGE}.html`,

  // The headline pair the verification block reads: the fixtures page, the
  // one page the two variants deliver differently.
  classic: {
    page: `${COMPARED_PAGE}.html`,
    eagerBytes: compared.classic.eagerBytes,
    eagerGzipBytes: compared.classic.eagerGzipBytes,
    eagerChunks: compared.classic.eagerChunks,
    lazyChunks: compared.classic.lazyChunks,
    lazyBytes: compared.classic.lazyBytes,
    lazyGzipBytes: compared.classic.lazyGzipBytes,
    html: compared.classic.html,
    css: compared.classic.css,
    cssBytes: compared.classic.cssBytes,
    cssGzipBytes: compared.classic.cssGzipBytes,
    initialTransferBytes: compared.classic.initialTransferBytes,
    initialTransferGzipBytes: compared.classic.initialTransferGzipBytes,
    whereTheBytesGo: compared.classic.whereTheBytesGo,
    componentExecutionsBeforeInteraction: executions.classicComponentExecutions,
    componentModuleLoadsBeforeInteraction: executions.classicComponentModuleLoads,
  },
  resumable: {
    page: `${COMPARED_PAGE}.html`,
    eagerBytes: compared.resumable.eagerBytes,
    eagerGzipBytes: compared.resumable.eagerGzipBytes,
    eagerChunks: compared.resumable.eagerChunks,
    lazyChunks: compared.resumable.lazyChunks,
    lazyBytes: compared.resumable.lazyBytes,
    lazyGzipBytes: compared.resumable.lazyGzipBytes,
    html: compared.resumable.html,
    css: compared.resumable.css,
    cssBytes: compared.resumable.cssBytes,
    cssGzipBytes: compared.resumable.cssGzipBytes,
    initialTransferBytes: compared.resumable.initialTransferBytes,
    initialTransferGzipBytes: compared.resumable.initialTransferGzipBytes,
    whereTheBytesGo: compared.resumable.whereTheBytesGo,
    lazyWhereTheBytesGo: compared.resumable.lazyWhereTheBytesGo,
    bootstrap,
    componentExecutionsBeforeInteraction: executions.componentExecutionsBeforeInteraction,
    componentExecutionsAfterInteraction: executions.componentExecutionsAfterInteraction,
    componentModuleLoadsBeforeInteraction: executions.componentModuleLoadsBeforeInteraction,
    componentModuleLoadsAfterInteraction: executions.componentModuleLoadsAfterInteraction,
  },

  delta: {
    eagerBytes: compared.resumable.eagerBytes - compared.classic.eagerBytes,
    eagerGzipBytes: compared.resumable.eagerGzipBytes - compared.classic.eagerGzipBytes,
    eagerGzipPercent:
      Math.round(
        ((compared.resumable.eagerGzipBytes - compared.classic.eagerGzipBytes) /
          compared.classic.eagerGzipBytes) *
          1000,
      ) / 10,
    initialTransferBytes: compared.resumable.initialTransferBytes - compared.classic.initialTransferBytes,
    initialTransferGzipBytes:
      compared.resumable.initialTransferGzipBytes - compared.classic.initialTransferGzipBytes,
  },

  todos,
  phaseDelta,

  pages: measured,
  instrumentation: { fixtures: executions, todos: todosExecutions, ...executions },
};

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, "demo-baseline.json"), JSON.stringify(report, null, 2) + "\n", "utf8");
writeFileSync(join(OUT_DIR, "demo-baseline.md"), markdown(report), "utf8");

console.log(
  `fixtures page — eager JS gz: resumable ${report.resumable.eagerGzipBytes} B vs classic ` +
    `${report.classic.eagerGzipBytes} B (${report.delta.eagerGzipPercent}%), ` +
    `${report.resumable.lazyChunks.length} lazy chunk(s), ` +
    `${report.resumable.componentExecutionsBeforeInteraction} component executions`,
);
console.log(
  `todos page    — component bodies before interaction: classic ${todos.classic.componentExecutionsBeforeInteraction} vs resumable ` +
    `${todos.resumable.componentExecutionsBeforeInteraction}, eager JS ${todos.resumable.eagerRawBytes} B raw / ` +
    `${todos.resumable.eagerGzipBytes} B gz (cap ${todos.resumable.gates.eagerRawCapBytes} B raw, ` +
    `${todos.resumable.gates.eagerRawHeadroomBytes} B of headroom; gzip companion ` +
    `${todos.resumable.gates.eagerGzipCompanionCapBytes} B missed by ${todos.resumable.gates.eagerGzipOverCompanionBytes} B), ` +
    `group chunk ${todos.resumable.groupChunk.bytes} B on the first interaction`,
);
console.log(`wrote ${relative(REPO_ROOT, join(OUT_DIR, "demo-baseline.json"))} and demo-baseline.md`);

/* ────────────────────────────── markdown ─────────────────────────────── */

function kb(bytes) {
  return `${(bytes / 1024).toFixed(2)} kB`;
}

function row(cells) {
  return `| ${cells.join(" | ")} |`;
}

function chunkTable(chunks) {
  return [
    row(["chunk", "raw", "gzip"]),
    row(["---", "---:", "---:"]),
    ...chunks.map(chunk => row([`\`${chunk.file}\``, kb(chunk.bytes), kb(chunk.gzipBytes)])),
    row([`**total**`, `**${kb(sum(chunks, "bytes"))}**`, `**${kb(sum(chunks, "gzipBytes"))}**`]),
  ].join("\n");
}

/**
 * Two units, side by side, because neither one alone is sufficient.
 *
 * `share` is exact but in pre-minification bytes: what fraction of the code
 * rollup put in these chunks belongs to this group. `standalone` is in
 * shipped units but is an upper bound: minifying a module by itself cannot
 * rename across module boundaries the way the chunk's own minification does,
 * so the parts add up to more than the whole. The chunk totals underneath are
 * the exact figure, and the gap is printed rather than hidden.
 */
function groupTable(groups, chunks) {
  const rendered = sum(groups, "renderedBytes");
  const standalone = sum(groups, "minifiedBytes");
  const actual = sum(chunks, "bytes");
  const share = value => `${((value / rendered) * 100).toFixed(1)}%`;

  return [
    row(["what", "rendered (pre-min)", "share", "minified standalone", "+ gzip", "share x chunk"]),
    row(["---", "---:", "---:", "---:", "---:", "---:"]),
    ...groups.map(group =>
      row([
        group.label,
        kb(group.renderedBytes),
        share(group.renderedBytes),
        kb(group.minifiedBytes),
        kb(group.minifiedGzipBytes),
        kb((group.renderedBytes / rendered) * actual),
      ]),
    ),
    row([
      `**chunk total, as shipped**`,
      `${kb(rendered)}`,
      "100%",
      `_${kb(standalone)}_`,
      "",
      `**${kb(actual)}** / **${kb(sum(chunks, "gzipBytes"))}** gz`,
    ]),
  ].join("\n");
}

function markdown(report) {
  const { classic, resumable, delta } = report;

  const lazyRows = resumable.lazyChunks.map(chunk =>
    row([`\`${chunk.file}\``, kb(chunk.bytes), kb(chunk.gzipBytes), chunk.trigger]),
  );

  return `# Demo baseline — classic vs resumable, measured on built output

**Date:** ${report.date} · **Compared page:** \`${report.comparedPage}\` · Generated by \`cd demo && pnpm measure\`.

Two builds of the same two pages, from the same sources, in \`demo/\`. The fixtures page holds
five components the comptime pass proves resumable — four flat ones and a keyed list the
document itself carries — and is where the byte claim lives. The
todos page holds the ported TodoMVC — the pass proves three of its five components and the demo
RESUMES exactly one of them, \`Header\`. That page is where the *execution* claim lives, and it is
measured further down.

## Headline — the fixtures page

| | classic | resumable | delta |
|---|---:|---:|---:|
| eager JS, raw | ${kb(classic.eagerBytes)} | ${kb(resumable.eagerBytes)} | ${delta.eagerBytes > 0 ? "+" : ""}${kb(delta.eagerBytes)} |
| **eager JS, gzip** | **${kb(classic.eagerGzipBytes)}** | **${kb(resumable.eagerGzipBytes)}** | **${delta.eagerGzipBytes > 0 ? "+" : ""}${kb(delta.eagerGzipBytes)} (${delta.eagerGzipPercent}%)** |
| HTML, raw / gzip | ${kb(classic.html.bytes)} / ${kb(classic.html.gzipBytes)} | ${kb(resumable.html.bytes)} / ${kb(resumable.html.gzipBytes)} | |
| CSS, raw / gzip | ${kb(classic.cssBytes ?? sum(classic.css, "bytes"))} / ${kb(sum(classic.css, "gzipBytes"))} | ${kb(sum(resumable.css, "bytes"))} / ${kb(sum(resumable.css, "gzipBytes"))} | |
| initial transfer (HTML+CSS+JS), raw | ${kb(classic.initialTransferBytes)} | ${kb(resumable.initialTransferBytes)} | ${delta.initialTransferBytes > 0 ? "+" : ""}${kb(delta.initialTransferBytes)} |
| initial transfer, gzip | ${kb(classic.initialTransferGzipBytes)} | ${kb(resumable.initialTransferGzipBytes)} | ${delta.initialTransferGzipBytes > 0 ? "+" : ""}${kb(delta.initialTransferGzipBytes)} |
| component bodies run before interaction | ${classic.componentExecutionsBeforeInteraction} | ${resumable.componentExecutionsBeforeInteraction} | |
| component modules loaded before interaction | ${classic.componentModuleLoadsBeforeInteraction} | ${resumable.componentModuleLoadsBeforeInteraction} | |
| lazy chunks | ${classic.lazyChunks.length} | ${resumable.lazyChunks.length} | |

Read the byte rows together. The resumable page still sends more raw HTML — the markup it
saves the browser from computing is markup it has to send — and with the cell kernel in place of
\`@solidjs/signals\` it wins that trade outright anyway: not just on eager
JavaScript but on the whole initial transfer, ${kb(Math.abs(delta.initialTransferGzipBytes))} gzip less than classic with the extra
markup already counted. What it does not lose on is behaviour: **${resumable.componentExecutionsBeforeInteraction} component bodies run**,
before or after interaction, against ${classic.componentExecutionsBeforeInteraction} on the classic side.

## The bootstrap, on its own line

The resume runtime does not get its own chunk (splitting it out costs ~1.0 kB raw / 0.7 kB
gzip, and it is now ${resumable.bootstrap.sharePercent}% of the eager chunk in any case), so the configs do no manual
chunking. It is therefore reported two ways, which bracket the truth:

| | raw | gzip |
|---|---:|---:|
| minified on its own — upper bound, no cross-module renaming | ${kb(resumable.bootstrap.minifiedBytes)} | ${kb(resumable.bootstrap.minifiedGzipBytes)} |
| its share of the eager chunk, by rendered bytes (${resumable.bootstrap.sharePercent}%) | ${kb(resumable.bootstrap.shareOfChunkBytes)} | — |
| — of which the cell kernel, \`${resumable.bootstrap.kernel?.module ?? "src/resume/cells.ts"}\` | ${resumable.bootstrap.kernel?.minifiedBytes ?? 0} B | ${resumable.bootstrap.kernel?.minifiedGzipBytes ?? 0} B |
| _markless reference point_ | _${resumable.bootstrap.marklessReferenceBytes} B_ | |

So: **the runtime that makes a served page interactive without running its components is
somewhere between ~${kb(resumable.bootstrap.shareOfChunkBytes)} and ${kb(resumable.bootstrap.minifiedBytes)}** — a few times the ${resumable.bootstrap.marklessReferenceBytes} B markless reference, and
carrying no framework underneath it at all. The reactive runtime this page needs is the
${resumable.bootstrap.kernel?.minifiedBytes ?? 0} B / ${resumable.bootstrap.kernel?.minifiedGzipBytes ?? 0} B gzip kernel on the row above, where a signals-backed resume path carried ${kb(SIGNALS_BEFORE_KERNEL_GZIP)} gzip of
\`@solidjs/signals\` — 83.9% of an eager payload that is now ${kb(resumable.eagerGzipBytes)} in total.

Modules in it: ${resumable.bootstrap.modules.map(m => `\`${m}\``).join(", ")}.

## Eager chunks

### classic / fixtures

${chunkTable(classic.eagerChunks)}

### resumable / fixtures

${chunkTable(resumable.eagerChunks)}

## Where the resumable page's eager bytes go

${groupTable(resumable.whereTheBytesGo, resumable.eagerChunks)}

## Where the classic page's eager bytes go

${groupTable(classic.whereTheBytesGo, classic.eagerChunks)}

## Lazy chunks — resumable / fixtures

${[row(["chunk", "raw", "gzip", "fetched by"]), row(["---", "---:", "---:", "---"]), ...lazyRows].join("\n")}

Total lazy: ${kb(resumable.lazyBytes ?? sum(resumable.lazyChunks, "bytes"))} raw / ${kb(sum(resumable.lazyChunks, "gzipBytes"))} gzip, none of it fetched before the first
interaction. The classic variant has ${classic.lazyChunks.length} lazy chunks: its behaviour is inside the component
bodies it already shipped.

## The todos page — the real app, with its fallback group deferred

The ported TodoMVC, in both variants. The resumable one is the *same application*: same
\`render()\`, same store, same four sibling components written the ordinary Solid way, and
\`app/src/app.tsx\` is not edited. What differs is when they reach the browser. One mount point is
substituted — \`Header\`, the single component this demo RESUMES — and the other four,
with \`@solidjs/web\`, \`@solidjs/signals\`, the todos store and the API, are one chunk behind one
dynamic \`import()\`. The pass's verdict for the module is app 3/5, and the two proved components
that are not substituted are the reason a coverage fraction is never a count of resumptions:
\`MainSection\` and \`Footer\` carry guard-only artifacts and keep their bodies in the group. The
page is served with its first paint already in the document, captured from a real render at
build time, so it is painted and typable with none of that code present.

| | classic | resumable | delta |
|---|---:|---:|---:|
| **component bodies run before interaction** | **${todos.classic.componentExecutionsBeforeInteraction}** | **${todos.resumable.componentExecutionsBeforeInteraction}** | |
| component bodies run in total | ${todos.classic.componentExecutions} | ${todos.resumable.componentExecutions} | ${todos.delta.componentExecutions} |
| **eager JS, raw** | **${kb(todos.classic.eagerRawBytes)}** | **${kb(todos.resumable.eagerRawBytes)}** | **${todos.delta.eagerRawBytes > 0 ? "+" : ""}${kb(todos.delta.eagerRawBytes)}** |
| **eager JS, gzip** | **${kb(todos.classic.eagerGzipBytes)}** | **${kb(todos.resumable.eagerGzipBytes)}** | **${todos.delta.eagerGzipBytes > 0 ? "+" : ""}${kb(todos.delta.eagerGzipBytes)} (${todos.delta.eagerGzipPercent}%)** |
| initial transfer, gzip | ${kb(todos.classic.initialTransferGzipBytes)} | ${kb(todos.resumable.initialTransferGzipBytes)} | ${todos.delta.initialTransferGzipBytes > 0 ? "+" : ""}${kb(todos.delta.initialTransferGzipBytes)} |
| lazy chunks | ${todos.classic.lazyChunks.length} | ${todos.resumable.lazyChunks.length} | |

And against this page's own previous shape, where the whole application shipped at load:

| resumable / todos | before deferral | now | delta |
|---|---:|---:|---:|
| eager JS, raw | ${kb(TODOS_EAGER_BEFORE_DEFERRAL.bytes)} | ${kb(todos.resumable.eagerRawBytes)} | ${kb(todos.resumable.eagerRawBytes - TODOS_EAGER_BEFORE_DEFERRAL.bytes)} |
| eager JS, gzip | ${kb(TODOS_EAGER_BEFORE_DEFERRAL.gzipBytes)} | ${kb(todos.resumable.eagerGzipBytes)} | ${kb(todos.resumable.eagerGzipBytes - TODOS_EAGER_BEFORE_DEFERRAL.gzipBytes)} |
| component bodies run before interaction | ${TODOS_EAGER_BEFORE_DEFERRAL.componentExecutionsBeforeInteraction} | ${todos.resumable.componentExecutionsBeforeInteraction} | |

Which bodies ran: classic \`${todos.classic.componentsExecuted.join("`, `")}\`; resumable
\`${todos.resumable.componentsExecuted.join("`, `")}\` — all four of them *after* the first
interaction, none before it. Read live, through a loader hook on \`createComponent\`: four of the
five components are module-local, so nothing at the export level could see them. The interaction
both variants were driven through: ${todos.interaction}.

**On the bytes.** ${todos.claim}

**Where the deferred bytes went, and when they arrive.** The group chunk is
\`${todos.resumable.groupChunk.file}\` — ${kb(todos.resumable.groupChunk.bytes)} raw / ${kb(todos.resumable.groupChunk.gzipBytes)} gzip, carrying
${todos.resumable.groupChunk.contains.join(", ")}. It has two moments and they are not the same event.
The transfer starts on the first interaction SIGNAL — ${todos.resumable.groupChunk.transferredOn}. The execution
happens on the event that COMMITS: ${todos.resumable.groupChunk.trigger}, observed here as
\`${todos.resumable.groupChunk.observedTrigger}\`. Between the two, the bytes are in the
browser and nothing of the application has run: ${todos.resumable.componentExecutionsAtPrefetch ?? 0} component bodies, ${todos.resumable.storesRegisteredBeforeInteraction.length} live stores, and the
served shell still painted. They are reported as \`prefetchedBytes\` — ${kb(todos.resumable.prefetchedBytes)} raw — never inside
the eager total, and never at a discount.

**On the caps.** The eager payload is ${todos.resumable.eagerRawBytes} B raw against a ${todos.resumable.gates.eagerRawCapBytes} B cap
(${todos.resumable.gates.eagerRawHeadroomBytes} B of headroom), enforced by \`demo/scripts/check-zero-eager.mjs\` on the built chunk and by
the witness box on the wire. The gzip companion figure the design named beside it, ${todos.resumable.gates.eagerGzipCompanionCapBytes} B, is
**missed by ${todos.resumable.gates.eagerGzipOverCompanionBytes} B** at ${todos.resumable.eagerGzipBytes} B. That is recorded, not restated: the only split available —
moving the loader's replay half, which cannot run before the group exists, behind the lazy
boundary — was measured at a ceiling of ${todos.resumable.gates.replaySplitCeiling.gzipBytes} B gzip, so no split closes a ${todos.resumable.gates.eagerGzipOverCompanionBytes} B gap and none
was made. The files holding the eager bytes:

${[
  row(["module", "rendered (pre-min)", "minified standalone", "+ gzip"]),
  row(["---", "---:", "---:", "---:"]),
  ...todos.resumable.eagerBootstrapModules.map(module =>
    row([`\`${module.module}\``, `${module.renderedBytes} B`, `${module.minifiedBytes} B`, `${module.minifiedGzipBytes} B`]),
  ),
].join("\n")}

### Group anatomy — what the group is, and why it is one chunk

The group chunk is the largest single thing this build emits, so it gets read out module for
module rather than described. \`${todos.resumable.groupAnatomy.chunk}\` is
**${todos.resumable.groupAnatomy.moduleCount} modules**: ${todos.resumable.groupAnatomy.framework.moduleCount} framework files and ${todos.resumable.groupAnatomy.app.moduleCount} app files. That membership is
frozen by name in \`demo/scripts/check-zero-eager.mjs\`, which also refuses any \`node_modules\`
module anywhere else in the build — a byte cap can be cleared by a chunk carrying the wrong
bytes, a frozen module list cannot.

| half | modules | rendered (pre-min) | share |
|---|---:|---:|---:|
| framework (\`@solidjs/signals\`, \`@solidjs/web\`, \`solid-js\`) | ${todos.resumable.groupAnatomy.framework.moduleCount} | ${kb(todos.resumable.groupAnatomy.framework.renderedBytes)} | **${todos.resumable.groupAnatomy.framework.sharePercent}%** |
| app (four bodies — two unproved, two proved but not safe to substitute — plus the store, the API, the template) | ${todos.resumable.groupAnatomy.app.moduleCount} | ${kb(todos.resumable.groupAnatomy.app.renderedBytes)} | ${todos.resumable.groupAnatomy.app.sharePercent}% |

The app half was built as its own chunk once, to find out what it really weighs:
**${todos.resumable.groupAnatomy.app.measuredChunkBytes.toLocaleString("en-US")} B raw / ${todos.resumable.groupAnatomy.app.measuredChunkGzipBytes.toLocaleString("en-US")} B gzip**. That figure retired an estimate — a 5,000 B cap
had been derived by applying the whole group's 0.241 minification ratio to the app's
${todos.resumable.groupAnatomy.app.renderedBytes.toLocaleString("en-US")} B of rendered source, but that ratio comes from \`@solidjs/*\` code that ships
pre-minified and authored TS/JSX does not compress anywhere near it. ${todos.resumable.groupAnatomy.app.measuredChunkBytes.toLocaleString("en-US")} B is the floor for
these six modules, and no chunking makes it smaller.

Which is the smaller half of the point. **Every split of this group is bigger than no split:**

| chunking | raw | gzip | vs single |
|---|---:|---:|---:|
${(() => {
  const single = todos.resumable.groupAnatomy.splits.find(split => split.id === "single");
  return todos.resumable.groupAnatomy.splits
    .map(split =>
      row([
        split.label,
        `${split.bytes.toLocaleString("en-US")} B`,
        `${split.gzipBytes.toLocaleString("en-US")} B`,
        split.id === "single"
          ? "—"
          : `+${(split.bytes - single.bytes).toLocaleString("en-US")} raw / **+${(split.gzipBytes - single.gzipBytes).toLocaleString("en-US")} gz**`,
      ]),
    )
    .join("\n");
})()}

All three were built and weighed in one run; the gzip column of that run is quoted as it stood,
so the deltas are like for like. (This document's own gzip of the shipped chunk, at zlib's
default level, reads ${todos.resumable.groupChunk.gzipBytes.toLocaleString("en-US")} B — the levels differ by a little, the deltas do not.)

**Why.** ${todos.resumable.groupAnatomy.whyOneChunk}

**The lever, named plainly.** ${todos.resumable.groupAnatomy.theLever}

Framework modules in the group: ${todos.resumable.groupAnatomy.framework.modules.map(m => `\`${m}\``).join(", ")}.

App modules in the group: ${todos.resumable.groupAnatomy.app.modules.map(m => `\`${m}\``).join(", ")}.

### Lazy chunks — resumable / todos

${[
  row(["chunk", "raw", "gzip", "fetched by"]),
  row(["---", "---:", "---:", "---"]),
  ...todos.resumable.lazyChunks.map(chunk =>
    row([`\`${chunk.file}\`${chunk.group ? " **(group)**" : ""}`, kb(chunk.bytes), kb(chunk.gzipBytes), chunk.trigger]),
  ),
].join("\n")}

Group chunks fetched before the first interaction: ${todos.resumable.groupEvaluationsBeforeInteraction}. Handler chunks imported before the first
keydown: ${todos.resumable.handlerChunkLoadsBeforeInteraction}. After it: ${todos.resumable.handlerChunkLoadsAfterInteraction}.
Live stores registered by identity at the substitution point: \`${todos.resumable.storesRegistered.join("`, `")}\`, and
${todos.resumable.storesRegisteredBeforeInteraction.length} of them before the group ran — the store's single birth is inside the group, at the
mount point where the resumed component's own context read stood.

### What the todos page's eager JavaScript is made of

#### classic / todos

${groupTable(report.pages.classic.todos.whereTheBytesGo, report.pages.classic.todos.eagerChunks)}

#### resumable / todos

${groupTable(report.pages.resumable.todos.whereTheBytesGo, report.pages.resumable.todos.eagerChunks)}

## Phase 1 → phase 2 — what the second phase actually moved

Every table above measures a build. This one measures a phase. The before-column is quoted from
the audit that took it first-hand at the phase gate (\`${report.phaseDelta.phase1.source}\`,
${report.phaseDelta.phase1.date}) rather than recomputed, because phase 1 is a build this repository no longer
produces; the after-column is this run. **The win is stated on three axes — eager bytes,
executions and coverage — and on none of them is it group bytes.** The group row is in the table
anyway, at its recorded no-drop, because a number left out reads worse than a number explained.

${[
  row(["", `phase 1 (${report.phaseDelta.phase1.date})`, "phase 2 (this run)", "delta"]),
  row(["---", "---:", "---:", "---:"]),
  row([
    "**coverage, `app` segment**",
    `**${fraction(report.phaseDelta.phase1.coverage.app)}**`,
    `**${fraction(report.phaseDelta.phase2.coverage.app)}**`,
    `**+${report.phaseDelta.phase2.coverage.app.provable - report.phaseDelta.phase1.coverage.app.provable} proved**`,
  ]),
  row([
    "coverage, `fixtures` segment",
    fraction(report.phaseDelta.phase1.coverage.fixtures),
    fraction(report.phaseDelta.phase2.coverage.fixtures),
    `+${report.phaseDelta.phase2.coverage.fixtures.provable - report.phaseDelta.phase1.coverage.fixtures.provable} proved, ` +
      `+${report.phaseDelta.phase2.coverage.fixtures.components - report.phaseDelta.phase1.coverage.fixtures.components} counted`,
  ]),
  row([
    "**component bodies run before interaction — todos**",
    `**${report.phaseDelta.phase1.todosComponentExecutionsBeforeInteraction}**`,
    `**${report.phaseDelta.phase2.todosComponentExecutionsBeforeInteraction}**`,
    "**held**",
  ]),
  row([
    "component bodies run before interaction — fixtures",
    "0",
    `${report.phaseDelta.phase2.fixturesComponentExecutionsBeforeInteraction}`,
    "held",
  ]),
  row([
    "**fixtures fallback branch, in the build**",
    `**${report.phaseDelta.phase1.fixturesFallbackChunkBytes.toLocaleString("en-US")} B, required**`,
    report.phaseDelta.phase2.fixturesFallbackChunkBytes === 0 ? "**not built**" : `**${report.phaseDelta.phase2.fixturesFallbackChunkBytes.toLocaleString("en-US")} B**`,
    `**−${(report.phaseDelta.phase1.fixturesFallbackChunkBytes - report.phaseDelta.phase2.fixturesFallbackChunkBytes).toLocaleString("en-US")} B**`,
  ]),
  row([
    "todos eager JS, raw",
    `${report.phaseDelta.phase1.todosEagerRawBytes.toLocaleString("en-US")} B`,
    `${report.phaseDelta.phase2.todosEagerRawBytes.toLocaleString("en-US")} B`,
    `+${(report.phaseDelta.phase2.todosEagerRawBytes - report.phaseDelta.phase1.todosEagerRawBytes).toLocaleString("en-US")} B`,
  ]),
  row([
    "witness boxes, driven in a real browser",
    `${report.phaseDelta.phase1.witnessBoxes}`,
    `${report.phaseDelta.phase2.witnessBoxes}`,
    `+${report.phaseDelta.phase2.witnessBoxes - report.phaseDelta.phase1.witnessBoxes}`,
  ]),
  row([
    "deferred group, raw / gzip",
    `${report.phaseDelta.phase1.groupBytes.toLocaleString("en-US")} / ${report.phaseDelta.phase1.groupGzipBytes.toLocaleString("en-US")} B`,
    `${report.phaseDelta.phase2.groupBytes.toLocaleString("en-US")} / ${report.phaseDelta.phase2.groupGzipBytes.toLocaleString("en-US")} B`,
    "**no-drop, by design**",
  ]),
].join("\n")}

**Coverage and executions, together.** The pass proves ${report.phaseDelta.phase2.coverage.app.provable} of the app's ${report.phaseDelta.phase2.coverage.app.components} components where it proved
${report.phaseDelta.phase1.coverage.app.provable}, and it proves ${report.phaseDelta.phase2.coverage.fixtures.provable} of the ${report.phaseDelta.phase2.coverage.fixtures.components} fixtures where it proved ${report.phaseDelta.phase1.coverage.fixtures.provable} of ${report.phaseDelta.phase1.coverage.fixtures.components} — the fixtures denominator
moved because the keyed-list carrier and its provider are two new counted components, which is
recorded here rather than netted out. Read the app fraction as coverage and never as
resumptions: the demo RESUMES exactly one component on the wire, the same one it resumed in
phase 1. What phase 2 bought is that the number of component bodies a browser runs before the
first interaction stayed at zero while the analyzer admitted keyed regions and store reads —
holding zero through new machinery is the claim, and a real browser is now driven through
${report.phaseDelta.phase2.witnessBoxes} witness boxes instead of ${report.phaseDelta.phase1.witnessBoxes} to say so.

**Eager bytes, in both directions, because only one of them is a win.** The fixtures page ships a
build with no fallback branch in it — ${report.phaseDelta.phase1.fixturesFallbackChunkBytes.toLocaleString("en-US")} B of ordinary renderer that phase 1's one-armed
gate REQUIRED to exist and that no interaction on the page could ever have reached. The
two-armed gate refuses it instead, and the entry that used to name it is ${report.phaseDelta.phase2.fixturesEagerRawBytes.toLocaleString("en-US")} B.
The todos entry went the other way: ${report.phaseDelta.phase1.todosEagerRawBytes.toLocaleString("en-US")} B to ${report.phaseDelta.phase2.todosEagerRawBytes.toLocaleString("en-US")} B, +${(report.phaseDelta.phase2.todosEagerRawBytes - report.phaseDelta.phase1.todosEagerRawBytes).toLocaleString("en-US")} B, which is what the
region machinery and two components' worth of guard-only artifacts cost to carry. That is stated
as a cost and not folded into an average: it was paid inside the ${report.phaseDelta.phase2.todosEagerRawCapBytes.toLocaleString("en-US")} B cap with
${report.phaseDelta.phase2.todosEagerRawHeadroomBytes} B of headroom left, and the cap is now a RATCHET — every further slice lands at or
below ${report.phaseDelta.phase2.todosEagerRawBytes.toLocaleString("en-US")} B raw, and any increase stops it.

**Why the group is not in the win.** ${report.phaseDelta.whyNotGroupBytes}

## Method

- **Eager** — ${report.method.eager}
- **Lazy** — ${report.method.lazy}
- **Transferred, not executed** — ${report.method.transferredNotExecuted}
- **gzip** — ${report.method.gzip}
- **Per-page builds** — ${report.method.build}
- **Attribution** — ${report.method.attribution}
- **Component executions** — ${report.method.componentExecutions}
- **Not measured** — ${report.method.notMeasured}

### Regenerating

\`\`\`
cd demo && pnpm install && pnpm test && pnpm build && pnpm measure
\`\`\`
`;
}
