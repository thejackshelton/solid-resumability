/**
 * The zero-eager gate for the resumable todos page.
 *
 *   pnpm build && node scripts/check-zero-eager.mjs
 *
 * Eight mechanical claims about `dist/resumable/`, each one a thing that would
 * be easy to lose by accident and impossible to notice by reading:
 *
 *   1. THE SHELL IS IN THE DOCUMENT. `#root` is not empty, and what is in it
 *      is the first paint — the resumed component's input and the app's
 *      loading paragraph. A page that shipped an empty root would render
 *      nothing until the first interaction.
 *
 *   2. THE EAGER PAYLOAD IS ONE CHUNK, UNDER THE CAP. The document loads
 *      exactly one script, that script statically imports no other chunk, and
 *      it is at most 15,500 raw bytes. The cap is raw rather than gzipped
 *      because it is a budget for what the build may emit, not a claim about
 *      a particular transport.
 *
 *   3. THE EAGER CHUNK CARRIES THE MOUNTS AND NOTHING ELSE. Size alone is not
 *      the claim: a chunk can be small and still be the wrong bytes. Two
 *      readings of the entry chunk's module list, taken from the build's own
 *      `.vite/module-sizes.json`.
 *
 *      It must NOT name the framework, the app's state modules, the substituted
 *      app module or the API. This is the assertion manual chunking would have
 *      to lie to, which is why the cap alone is not the gate.
 *
 *      And the artifact directories it DOES name must be exactly the ones the
 *      served document carries a resume mount for — today `app.Header`, and
 *      that is the whole list. The pass proves components this page never
 *      mounts: a component whose guard the group flips ships an empty mount, so
 *      it is the group that renders it, the ordinary way. Their structure and
 *      wiring on the wire would be bytes for a resume that cannot happen, and
 *      an artifact glob is exactly the kind of thing that widens by accident.
 *      Read from the document rather than from a list written here, so adding a
 *      mount and adding its artifacts stay one change.
 *
 *   4. THE GROUP IS ONE ATOMIC CHUNK. Exactly one dynamic-entry chunk carries
 *      ALL of those modules. Two chunks would mean the deferral boundary
 *      crosses the group, and a group whose members can arrive separately is
 *      a group whose shared reactive source can be observed half-initialized.
 *
 *   5. THE GROUP IS EXACTLY THESE 28 MODULES (G4', anatomy). Claim 4 says the
 *      group is one chunk; this says WHICH modules are in it, module for
 *      module: 22 framework files and 6 app files, frozen below by name. It is
 *      the leak detector. A byte cap can be cleared by a build that quietly
 *      swapped what it carries; a frozen module set cannot. Three directions
 *      are checked, because a leak can go any of them: nothing missing from
 *      the group, nothing extra in it, and — the one that matters most —
 *      **no `node_modules` module anywhere in this build outside the frozen
 *      framework list**. The whole point of the page is that the framework is
 *      in exactly one place, so a framework module appearing in the entry, in
 *      a handler chunk, or in a chunk nobody expected is the failure, wherever
 *      it lands.
 *
 *   6. THE GROUP IS UNDER ITS SIZE CAPS (G3'). 63,000 raw / 23,500 gzip
 *      against a shipped 62,368 / 23,172. A pure regression tripwire, not a
 *      target: the group's size is not a chunking problem (see the group
 *      anatomy section of `docs/measurements/demo-baseline.md`), so these caps
 *      exist to catch a dependency walking in, not to be optimized against.
 *
 *   7. THE FIXTURES PAGE AND THE ORDINARY RENDERER (G5'), in two arms.
 *
 *      OLD #1 (retired 2026-08-12, when the keyed-region carrier landed): "the
 *      fixtures fallback graph reaches no store-partition module". That was an
 *      absolute, and it was true only while no component on the page owned a
 *      store. The carrier's provider (`Roster`) owns one, it is registered in
 *      `demo/src/components.ts` the ordinary way, and the fallback graph
 *      therefore reached the store partition. The honest options were to move
 *      the carrier out of the fallback map — keeping the old claim green by
 *      emptying it — or to re-derive the claim against what is actually being
 *      asserted. That re-derivation split the claim into 7a and 7b.
 *
 *      7a (UNCHANGED). NO CHUNK THE RESUMABLE FIXTURES PAGE CAN FETCH WITHOUT
 *      FALLING BACK CARRIES A STORE-PARTITION MODULE. The entry, and every
 *      chunk reachable from it by a static or dynamic import that is not the
 *      fallback branch: the handler chunks, the region resolver, and the store
 *      partition the carrier's mount point fetches when a dispatch finds no
 *      live store. This is the page's headline as a mechanical claim — a
 *      resumed page can fetch a STORE without fetching a FRAMEWORK, and the
 *      store's own module (`app/src/fixtures/roster.ts`) imports nothing at
 *      all. The arm reads the same as it did; what changed under it is that
 *      there is no longer a branch to exclude, so the walk excludes nothing and
 *      "what the page can fetch without falling back" and "what the page can
 *      fetch" are the same set. That makes the arm STRONGER, not vacuous, and
 *      its evidence line says which of the two it proved.
 *
 *      OLD #2 (retired 2026-08-13, when fallback auto-omit landed): "the
 *      fixtures fallback graph reaches exactly the frozen 3 store-partition
 *      modules" — `@solidjs/signals`' `core/context.js`, `map.js` and
 *      `store/store.js`, each one reached because `Roster` creates a context,
 *      wraps a store and paints a keyed list. That was a measurement of a
 *      chunk this build no longer emits. The plugin's `policies.fallback:
 *      'auto-omit'` drops the branch of any page whose every declared mount is
 *      provable, all five of this page's are, and so the `import()` behind
 *      which the ordinary renderer sat is rewritten out before the bundler
 *      resolves it. An itemized list of what a nonexistent chunk reaches is not
 *      a weaker claim than it was, it is no claim at all — which is exactly the
 *      gate-emptying the ruling that wrote 7a/7b refused. So the arm is
 *      re-derived upward rather than deleted.
 *
 *      NEW 7b. THE FIXTURES BUILD SHIPS NO FALLBACK BRANCH AT ALL. Two
 *      readings, both over every chunk in the build rather than over one named
 *      one: no chunk carries `demo/src/fallback.ts`, and NO CHUNK CARRIES A
 *      DEPENDENCY MODULE — not the renderer, not the signals core, not the
 *      store partition, nowhere, eager or lazy. The old arm said "the framework
 *      is behind one import nobody takes"; this one says the framework is not
 *      in the build. It subsumes the three frozen modules (a build with zero
 *      dependency modules trivially has none of them) and it catches what an
 *      itemized list could not: a fourth module arriving in a chunk the list
 *      was never written for. Auto-omit landing is what makes the stronger
 *      claim available, and the two land together — an omission the gate does
 *      not measure would read green while measuring nothing.
 *
 *   8. THE CORPUS IS FROZEN. `app/src/**` is the thing under measurement, not
 *      a thing this demo may adjust. The five files the page depends on are
 *      pinned by content hash.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "pathe";
import { gzipSync } from "node:zlib";

import { CLICK, DEMO_ROOT, DIALOG, REPO_ROOT, RULE } from "../build/fixtures.mjs";

const DIST = join(DEMO_ROOT, "dist/resumable/todos");
const FIXTURES_DIST = join(DEMO_ROOT, "dist/resumable/fixtures");
const RULE_DIST = join(DEMO_ROOT, "dist/resumable/rule");
const CLICK_DIST = join(DEMO_ROOT, "dist/resumable/click");
const DIALOG_DIST = join(DEMO_ROOT, "dist/resumable/dialog");

/**
 * The eager cap for the one todos entry chunk. This gate measures the
 * on-disk file; `verify/config.ts` (`TODOS_EAGER_JS_CAP_BYTES`) measures
 * the same payload on the CDP wire. Both homes are the same number.
 *
 * Post-T071 measurement: file 16,099 B (`todos-Cu6ovhai.js`), CDP wire
 * 16,307 B. The 208 B gap is CDP response-header accounting, unchanged
 * from the previous derivation. Cap = measured wire + ≥200 B, rounded
 * up to the next 100 → 16,600. Headroom is for jitter only, not a
 * budget. The smallest framework leak (`solid-js/dist` alone, ~9,500 B
 * minified) is ≥ 29× that headroom, so a quietly fused group still
 * fails loudly.
 */
export const EAGER_JS_CAP_BYTES = 16600;

/**
 * The rule page's own eager cap. Ceiling is parity with fixtures (20,000 B);
 * the first measured build's byte figure is the ratchet baseline, recorded
 * in the WP3 receipt rather than written back here.
 */
export const RULE_EAGER_JS_CAP_BYTES = 20000;

/**
 * The click page's own eager cap. Ceiling is parity with fixtures (20,000 B);
 * the first measured build's byte figure is the ratchet baseline, recorded
 * in the WP-C receipt rather than written back here.
 */
export const CLICK_EAGER_JS_CAP_BYTES = 20000;

/**
 * The dialog page's own eager cap. T085 revised the tranche-4 bar: the
 * live DialogRoot sits behind a dynamic `import()` of `dialog-provider.ts`,
 * so the renderer and the library's dialog chunk are no longer on the
 * eager entry (the T061-Ruling-5 eager-by-design figure is superseded).
 * T086 measurement: file 20,671 B (`dialog-0shcvsV4.js`). Cap = measured
 * file + CDP-header gap + ≥200 B jitter, rounded up to the next 100
 * → 21,100. Headroom is for jitter only, not a budget. Other pages'
 * caps do not move to fit.
 */
export const DIALOG_EAGER_JS_CAP_BYTES = 21100;

/**
 * The group's own caps, raw and gzipped (G3'). Kept in step with
 * `verify/config.ts` (`TODOS_GROUP_RAW_CAP`, `TODOS_GROUP_GZ_CAP`), which is
 * where the witness box reads them; the two files are separate because one is
 * plain Node against the dist and the other is TypeScript loaded through Vite.
 *
 * Set just above the shipped figures — 62,368 B raw / 23,172 B gzip — so they
 * trip on a new dependency rather than on ordinary drift. They are NOT a
 * budget anyone is meant to chase: the T004 measurements say plainly that no
 * split of this payload is smaller than the payload, so the only way this
 * number comes down is components leaving the group.
 */
export const GROUP_RAW_CAP_BYTES = 63000;
export const GROUP_GZIP_CAP_BYTES = 23500;

/**
 * The modules that must be in the group and nowhere else — the framework, the
 * two app modules that own the page's state, the API the store projects from,
 * and the substituted app module that runs all four fallback components.
 */
const GROUP_MODULES = [
  /@solidjs\/signals/,
  /@solidjs\/web/,
  /solid-js\/dist/,
  /app\/src\/todos/,
  /app\/src\/filter/,
  /generated\/app\.resumable/,
  /api-mock/,
];

/**
 * The group's framework half, frozen module for module: 20 files of
 * `@solidjs/signals` plus the two renderer entries. Written package-relative
 * rather than as absolute paths, because the pnpm store path carries a content
 * hash that says nothing about identity — `@solidjs/signals/dist/prod/map.js`
 * is the claim, and the version it resolves from is pinned in
 * `demo/package.json`, which is where a version claim belongs.
 *
 * If a signals release adds or removes a module, this list goes red and a
 * human decides whether the group grew. That is the intended failure: the
 * framework is 94.9% of the group's rendered bytes, so its membership drifting
 * unnoticed is the single largest thing this build could get wrong.
 */
const FRAMEWORK_MODULES = [
  "@solidjs/signals/dist/prod/boundaries.js",
  "@solidjs/signals/dist/prod/core/action.js",
  "@solidjs/signals/dist/prod/core/async.js",
  "@solidjs/signals/dist/prod/core/constants.js",
  "@solidjs/signals/dist/prod/core/context.js",
  "@solidjs/signals/dist/prod/core/core.js",
  "@solidjs/signals/dist/prod/core/effect.js",
  "@solidjs/signals/dist/prod/core/error.js",
  "@solidjs/signals/dist/prod/core/graph.js",
  "@solidjs/signals/dist/prod/core/heap.js",
  "@solidjs/signals/dist/prod/core/lanes.js",
  "@solidjs/signals/dist/prod/core/optimistic.js",
  "@solidjs/signals/dist/prod/core/owner.js",
  "@solidjs/signals/dist/prod/core/scheduler.js",
  "@solidjs/signals/dist/prod/map.js",
  "@solidjs/signals/dist/prod/signals.js",
  "@solidjs/signals/dist/prod/store/optimistic.js",
  "@solidjs/signals/dist/prod/store/projection.js",
  "@solidjs/signals/dist/prod/store/reconcile.js",
  "@solidjs/signals/dist/prod/store/store.js",
  "@solidjs/web/dist/web.js",
  "solid-js/dist/solid.js",
];

/**
 * The group's app half — the residue, and the reason it is asserted here
 * instead of assigned in `demo/build/config.mjs`.
 *
 * Routing these six into a NAMED manual chunk destroys the deferral outright:
 * rollup hangs the shared bootstrap off that name and the entry then imports
 * the lot statically (measured at T004 — entry 870 B, the group's 63 kB
 * eager). So the app partition is never assigned, only asserted, and this is
 * the assertion.
 */
const APP_MODULES = [
  "app/src/filter.ts",
  "app/src/todos.ts",
  "demo/artifacts/app.Header/template.js",
  "demo/src/api-mock.ts",
  "demo/src/generated/app.resumable.tsx",
  "demo/src/todos-group.ts",
];

/**
 * The store partition, by module id — the modules a page reaches only if
 * something on it needs a store. Used against the fixtures page (claim 7),
 * from both ends: none of them may be in a chunk that page can fetch without
 * falling back, and the ones its fallback DOES reach are frozen below.
 */
const STORE_MODULE =
  /(store\/(store|reconcile|optimistic|projection)|core\/(action|optimistic|context)|map)\.js$/;

/**
 * The module the fixtures page's fallback branch used to reach, by path.
 *
 * Not a list of what may be there — a single name, checked for ABSENCE. The
 * branch behind which this module sat is omitted at build time now (claim 7b's
 * old/new record above), so the honest form of the old itemized list is one
 * question asked of every chunk: is the ordinary renderer in this build at all?
 * The frozen store-partition list it replaces is quoted in that record rather
 * than kept here, because a frozen list of a chunk that does not exist is a
 * list nothing can go red against.
 */
const FALLBACK_MODULE = "/demo/src/fallback.ts";

/** The frozen corpus, by content. Regenerating these hashes is not a fix. */
const CORPUS = {
  "app/src/app.tsx": "3471986f4c638ffb4fa36247257034354e804be53360e72899718d4397f57bee",
  "app/src/todos.ts": "0f87def0a48f80c4bf5bd317a071091202511b6d087baee371d8bbc35b94b979",
  "app/src/filter.ts": "98d847edf4c5148639b7ca50596ba0300bc7765b8961abd518562503de254f02",
  "app/src/api.ts": "f2bc438b7a449a422088de3ed31b92a4ac3ead593c8f79a05e30a14cb7c580f1",
  "app/src/app.css": "0b909768284d9e7cb7896a6364285b5655ed6e5ae4ff128f0d67779c8fd3e573",
};

const failures = [];

function check(claim, ok, detail) {
  process.stdout.write(`${ok ? "ok  " : "FAIL"}  ${claim}${detail ? ` — ${detail}` : ""}\n`);
  if (!ok) failures.push(claim);
}

/**
 * A module id as this file names modules: package-relative under the last
 * `/node_modules/` for dependencies, repo-relative for everything else.
 * Rollup's ids are absolute and pnpm's are twice-nested, and neither fact is
 * part of what the module IS.
 */
function moduleName(id) {
  const marker = id.lastIndexOf("/node_modules/");
  return marker === -1 ? relative(REPO_ROOT, id) : id.slice(marker + "/node_modules/".length);
}

function isDependency(id) {
  return id.includes("/node_modules/");
}

/** Sorted set difference, for the module-for-module reports below. */
function missing(expected, actual) {
  const have = new Set(actual);
  return expected.filter(name => !have.has(name)).sort();
}

if (!existsSync(DIST)) {
  process.stderr.write(`check-zero-eager: ${relative(REPO_ROOT, DIST)} does not exist. Run \`pnpm build\` first.\n`);
  process.exit(1);
}

const html = readFileSync(join(DIST, "todos.html"), "utf8");
const manifest = JSON.parse(readFileSync(join(DIST, ".vite/manifest.json"), "utf8"));
const chunks = JSON.parse(readFileSync(join(DIST, ".vite/module-sizes.json"), "utf8"));

/* ── 1. the shell ──────────────────────────────────────────────────────── */

const root = /<div id="root">([\s\S]*?)<\/div>\s*\n/.exec(html);
const shell = root ? root[1] : "";

check("the document carries a prerendered shell in #root", shell.trim().length > 0, `${Buffer.byteLength(shell)} B`);
check('the shell is the first paint (class="loading")', shell.includes('class="loading"'));
check('the shell carries the resumed input (class="new-todo")', shell.includes('class="new-todo"'));

/* ── 2. one eager chunk, under the cap ─────────────────────────────────── */

const entry = manifest["todos.html"];
if (!entry) {
  process.stderr.write("check-zero-eager: the build manifest has no entry for todos.html\n");
  process.exit(1);
}

const entryBytes = statSync(join(DIST, entry.file)).size;
check(
  `the eager chunk is at most ${EAGER_JS_CAP_BYTES} raw bytes`,
  entryBytes <= EAGER_JS_CAP_BYTES,
  `${entry.file} is ${entryBytes} B (${EAGER_JS_CAP_BYTES - entryBytes} B of headroom)`,
);
check(
  "the eager payload is that one chunk",
  (entry.imports ?? []).length === 0,
  `statically imports ${(entry.imports ?? []).length} other chunks`,
);

const scripts = [...html.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)].map(match => match[1]);
check("the document loads exactly one script", scripts.length === 1, scripts.join(", ") || "none");

/**
 * The artifact directory a module id belongs to, or null. One directory is one
 * component's artifacts, which is the unit both halves of claim 3 are counted
 * in: the glob names directories and the document mounts them.
 */
function artifactDirOf(id) {
  return /^demo\/artifacts\/([^/]+)\//.exec(moduleName(id))?.[1] ?? null;
}

/** Sorted, deduplicated, and comparable as one string. */
function nameSet(names) {
  return [...new Set(names)].sort();
}

/* ── 3. the eager chunk's modules ──────────────────────────────────────── */

const entryChunk = chunks[entry.file];
if (!entryChunk) {
  process.stderr.write(`check-zero-eager: module-sizes.json has no record of ${entry.file}\n`);
  process.exit(1);
}

const entryModules = Object.keys(entryChunk.modules);
const leaked = entryModules.filter(id => GROUP_MODULES.some(pattern => pattern.test(id)));
check(
  "the eager chunk contains no group module",
  leaked.length === 0,
  leaked.length ? leaked.map(id => relative(REPO_ROOT, id)).join(", ") : `${entryModules.length} modules, none of them the group's`,
);

// The other reading of the same list: which components' artifacts are eager,
// against which components the served document can actually resume. `template.js`
// is not on either side of this — the markup is in the document, and the one
// template module the build keeps is the group's, not the entry's.
const eagerArtifacts = nameSet(entryModules.map(artifactDirOf).filter(Boolean));
const documentMounts = nameSet([...html.matchAll(/data-resume="([^"]+)"/g)].map(match => match[1]));

check(
  "the eager chunk's artifacts are exactly the document's resume mounts",
  eagerArtifacts.join(",") === documentMounts.join(","),
  eagerArtifacts.join(",") === documentMounts.join(",")
    ? `${documentMounts.join(", ") || "none"}`
    : `eager ${eagerArtifacts.join(", ") || "none"}; mounted ${documentMounts.join(", ") || "none"}`,
);

/* ── 4. one atomic group chunk ─────────────────────────────────────────── */

const dynamicEntries = Object.entries(chunks).filter(([, chunk]) => chunk.isDynamicEntry);
const complete = dynamicEntries.filter(([, chunk]) => {
  const ids = Object.keys(chunk.modules);
  return GROUP_MODULES.every(pattern => ids.some(id => pattern.test(id)));
});

check(
  "exactly one dynamic chunk carries the whole group",
  complete.length === 1,
  complete.length === 1
    ? `${complete[0][0]} is ${statSync(join(DIST, complete[0][0])).size} B raw, ${Object.keys(complete[0][1].modules).length} modules`
    : `${complete.length} of ${dynamicEntries.length} dynamic chunks carry all of them`,
);

if (complete.length === 1) {
  const [groupFile] = complete[0];
  const split = dynamicEntries
    .filter(([file]) => file !== groupFile)
    .filter(([, chunk]) => Object.keys(chunk.modules).some(id => GROUP_MODULES.some(pattern => pattern.test(id))));
  check(
    "no other chunk carries a piece of the group",
    split.length === 0,
    split.map(([file]) => file).join(", ") || `${dynamicEntries.length - 1} other dynamic chunks, none of them the group's`,
  );
}

/* ── 5. the group's anatomy, module for module (G4') ───────────────────── */

if (complete.length === 1) {
  const [groupFile, groupChunk] = complete[0];
  const groupIds = Object.keys(groupChunk.modules);
  const groupNames = groupIds.map(moduleName);
  const frozen = [...FRAMEWORK_MODULES, ...APP_MODULES];

  const absent = missing(frozen, groupNames);
  const unexpected = missing(groupNames, frozen);
  check(
    `the group is exactly the frozen ${FRAMEWORK_MODULES.length} framework + ${APP_MODULES.length} app modules`,
    absent.length === 0 && unexpected.length === 0,
    absent.length === 0 && unexpected.length === 0
      ? `${groupFile}, ${groupNames.length} modules, all of them named here`
      : [
          absent.length ? `missing from the group: ${absent.join(", ")}` : "",
          unexpected.length ? `not in the frozen list: ${unexpected.join(", ")}` : "",
        ]
          .filter(Boolean)
          .join("; "),
  );

  // The same set, read from the other end: none of these 28 may be in the
  // eager chunk. Claim 3 catches a leak by pattern; this catches one by name,
  // including a module a pattern was never written for.
  const frozenInEntry = entryModules.map(moduleName).filter(name => frozen.includes(name));
  check(
    "no module of the group is in the eager chunk",
    frozenInEntry.length === 0,
    frozenInEntry.length ? frozenInEntry.sort().join(", ") : `${entryModules.length} eager modules, none of them the group's`,
  );

  // And the widest of the three: the whole build, not just these two chunks.
  // A framework module in a handler chunk would clear both claims above and
  // still mean the framework ships before the group does.
  const strays = [];
  for (const [file, chunk] of Object.entries(chunks)) {
    for (const id of Object.keys(chunk.modules)) {
      if (isDependency(id) && !FRAMEWORK_MODULES.includes(moduleName(id))) strays.push(`${moduleName(id)} in ${file}`);
    }
  }
  check(
    "no node_modules module in the build outside the frozen framework list",
    strays.length === 0,
    strays.length ? strays.sort().join(", ") : `${Object.keys(chunks).length} chunks scanned`,
  );

  /* ── 6. the group's size caps (G3') ──────────────────────────────────── */

  // gzip at zlib's default level, the same setting `scripts/measure.mjs` and
  // vite's own build report use, so the number here and the number in
  // docs/measurements are the same number.
  const groupBuffer = readFileSync(join(DIST, groupFile));
  const groupRaw = groupBuffer.length;
  const groupGzip = gzipSync(groupBuffer).length;
  check(
    `the group chunk is at most ${GROUP_RAW_CAP_BYTES} raw bytes`,
    groupRaw <= GROUP_RAW_CAP_BYTES,
    `${groupFile} is ${groupRaw} B (${GROUP_RAW_CAP_BYTES - groupRaw} B of headroom)`,
  );
  check(
    `the group chunk is at most ${GROUP_GZIP_CAP_BYTES} gzipped bytes`,
    groupGzip <= GROUP_GZIP_CAP_BYTES,
    `${groupGzip} B gzip (${GROUP_GZIP_CAP_BYTES - groupGzip} B of headroom)`,
  );
}

/* ── 7. the fixtures page and the ordinary renderer, both arms (G5') ───── */

if (!existsSync(FIXTURES_DIST)) {
  process.stderr.write(`check-zero-eager: ${relative(REPO_ROOT, FIXTURES_DIST)} does not exist. Run \`pnpm build\` first.\n`);
  process.exit(1);
}

const fixturesChunks = JSON.parse(readFileSync(join(FIXTURES_DIST, ".vite/module-sizes.json"), "utf8"));
const fixturesManifest = JSON.parse(readFileSync(join(FIXTURES_DIST, ".vite/manifest.json"), "utf8"));
/**
 * The fallback chunk, if this build still emits one.
 *
 * It does not, and that is claim 7b — but the absence is CHECKED below rather
 * than assumed here, because a hard exit at this line is what the gate used to
 * do and it is the wrong shape for the question. A build that grew the branch
 * back should fail on a claim that names what it measured, not on a missing
 * file three claims early.
 *
 * So the value is read as an ordinary "there is one or there is not" everywhere
 * below: `null` when the branch is omitted, and that is the case both arms are
 * written for rather than the case they special-case around.
 */
const fallbackChunk =
  Object.entries(fixturesChunks).find(
    ([, chunk]) => chunk.isDynamicEntry && Object.keys(chunk.modules).some(id => id.endsWith(FALLBACK_MODULE)),
  )?.[0] ?? null;

const fixturesEntryFile = fixturesManifest["fixtures.html"]?.file;
if (!fixturesEntryFile) {
  process.stderr.write("check-zero-eager: the fixtures build manifest has no entry for fixtures.html\n");
  process.exit(1);
}

/** The store-partition modules one chunk carries, by name. */
function storeModulesIn(file) {
  return Object.keys(fixturesChunks[file]?.modules ?? {})
    .filter(id => isDependency(id) && STORE_MODULE.test(id))
    .map(moduleName);
}

/* 7a. what the page can fetch without falling back. */

// Every chunk reachable from the entry by a static OR dynamic import, with the
// fallback branch — and only it — not entered. Dynamic imports count because
// the question is what the page can FETCH, not what it loads at once: a
// handler chunk, the region resolver and the store partition are all one event
// away, and "one event away" is on the wire. The fallback chunk is the single
// excluded node rather than a subtracted set: what it drags in is reachable
// only through it, and what something else also reaches (the store's own
// module, which the fallback imports too) stays in, because the store import
// fetches it whether or not anyone falls back.
//
// On a build that omits the branch there is no node to exclude, and the walk
// runs with the exclusion empty. That is the ordinary case, not a special one:
// the same loop, one fewer name to skip. What it does to the CLAIM is make it
// stronger — "no chunk the page can fetch WITHOUT falling back" and "no chunk
// the page can fetch" become the same sentence — and the evidence string says
// so, because a reader who sees the arm pass on a smaller graph should be told
// which of the two it just proved.
const withoutFallback = new Set([fixturesEntryFile]);
for (const file of withoutFallback) {
  const chunk = fixturesChunks[file];
  for (const next of [...(chunk?.imports ?? []), ...(chunk?.dynamicImports ?? [])]) {
    if (next !== fallbackChunk) withoutFallback.add(next);
  }
}

const fetchableStoreModules = [...withoutFallback].flatMap(file =>
  storeModulesIn(file).map(name => `${name} in ${file}`),
);

// Named for the evidence line rather than asserted: the store's own module is
// what makes the arm interesting — the walk reaches a STORE and still reaches
// no framework — so the chunk carrying it is worth printing by name.
const storePartitionChunks = [...withoutFallback].filter(file =>
  Object.keys(fixturesChunks[file]?.modules ?? {}).some(id => moduleName(id) === "app/src/fixtures/roster.ts"),
);

const excluded = fallbackChunk
  ? `excluding the fallback branch ${fallbackChunk}`
  : "excluding nothing, because this build emits no fallback branch — the walk is every chunk the page can fetch at all, which makes the arm stronger than the form that subtracts one";
const included = storePartitionChunks.length ? `, including the store partition ${storePartitionChunks.join(", ")}` : "";

check(
  "7a. no chunk the fixtures page can fetch without falling back carries a store-partition module",
  fetchableStoreModules.length === 0,
  fetchableStoreModules.length
    ? fetchableStoreModules.sort().join(", ")
    : `${withoutFallback.size} chunk(s) from ${fixturesEntryFile}, ${excluded}${included}, none of them framework`,
);

/* 7b. what the fallback graph reaches — nothing, because there is no graph. */

// The old arm walked one named chunk and itemized the store-partition modules
// it reached: `core/context.js`, `map.js`, `store/store.js`, three of them,
// frozen. This build emits no such chunk, so the itemized set is empty — and
// the whole point of this arm is that the emptiness is ASSERTED rather than
// inherited from a walk that started nowhere. An empty list produced by looking
// at nothing is not a measurement.
//
// So both readings are taken over EVERY chunk in the build:
//
//   (i)  no chunk carries `demo/src/fallback.ts` — the branch is not in the
//        build under any name, hashed or not, entry or shared;
//   (ii) no chunk carries a `node_modules` module at all — not the renderer,
//        not the signals core, not the three store-partition modules the old
//        arm itemized. This subsumes (i)'s consequence and catches the case an
//        itemized list never could: a fourth framework module arriving in a
//        chunk nobody wrote a name for.
//
// A build that grows the branch back fails here, naming the chunk it found and
// the modules in it — which is what the hard exit this replaced could not do.
const fallbackCarriers = Object.entries(fixturesChunks)
  .filter(([, chunk]) => Object.keys(chunk.modules).some(id => id.endsWith(FALLBACK_MODULE)))
  .map(([file]) => file)
  .sort();

const dependencyModules = nameSet(
  Object.entries(fixturesChunks).flatMap(([file, chunk]) =>
    Object.keys(chunk.modules)
      .filter(isDependency)
      .map(id => `${moduleName(id)} in ${file}`),
  ),
);

const reachedStoreModules = nameSet(Object.keys(fixturesChunks).flatMap(storeModulesIn));
const scanned = Object.keys(fixturesChunks).length;
const scannedModules = Object.values(fixturesChunks).reduce((total, chunk) => total + Object.keys(chunk.modules).length, 0);

check(
  "7b. the fixtures build ships no fallback branch: no chunk carries the ordinary renderer, and the store-partition set it used to reach is empty",
  fallbackCarriers.length === 0 && dependencyModules.length === 0,
  fallbackCarriers.length === 0 && dependencyModules.length === 0
    ? `${scanned} chunks, ${scannedModules} modules: none is ${FALLBACK_MODULE.slice(1)}, none is from node_modules, ${reachedStoreModules.length} store-partition modules reached where the retired arm froze 3`
    : [
        fallbackCarriers.length ? `${FALLBACK_MODULE.slice(1)} is in ${fallbackCarriers.join(", ")}` : "",
        dependencyModules.length ? `dependency modules in the build: ${dependencyModules.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("; "),
);

/* ── 7c. the rule page's own eager cap ─────────────────────────────────── */

if (!existsSync(RULE_DIST)) {
  process.stderr.write(`check-zero-eager: ${relative(REPO_ROOT, RULE_DIST)} does not exist. Run \`pnpm build\` first.\n`);
  process.exit(1);
}

const ruleHtml = readFileSync(join(RULE_DIST, "rule.html"), "utf8");
const ruleManifest = JSON.parse(readFileSync(join(RULE_DIST, ".vite/manifest.json"), "utf8"));
const ruleEntry = ruleManifest["rule.html"];
if (!ruleEntry) {
  process.stderr.write("check-zero-eager: the rule build manifest has no entry for rule.html\n");
  process.exit(1);
}

const ruleBytes = statSync(join(RULE_DIST, ruleEntry.file)).size;
check(
  `the rule eager chunk is at most ${RULE_EAGER_JS_CAP_BYTES} raw bytes`,
  ruleBytes <= RULE_EAGER_JS_CAP_BYTES,
  `${ruleEntry.file} is ${ruleBytes} B (${RULE_EAGER_JS_CAP_BYTES - ruleBytes} B of headroom)`,
);
check(
  "the rule document carries the resume mount",
  ruleHtml.includes(`data-resume="${RULE[0].artifact}"`),
  RULE[0].artifact,
);
check("the rule document carries the folded intrinsic", /<hr\b/.test(ruleHtml));

/* ── 7d. the click page's own eager cap ────────────────────────────────── */

if (!existsSync(CLICK_DIST)) {
  process.stderr.write(`check-zero-eager: ${relative(REPO_ROOT, CLICK_DIST)} does not exist. Run \`pnpm build\` first.\n`);
  process.exit(1);
}

const clickHtml = readFileSync(join(CLICK_DIST, "click.html"), "utf8");
const clickManifest = JSON.parse(readFileSync(join(CLICK_DIST, ".vite/manifest.json"), "utf8"));
const clickEntry = clickManifest["click.html"];
if (!clickEntry) {
  process.stderr.write("check-zero-eager: the click build manifest has no entry for click.html\n");
  process.exit(1);
}

const clickBytes = statSync(join(CLICK_DIST, clickEntry.file)).size;
check(
  `the click eager chunk is at most ${CLICK_EAGER_JS_CAP_BYTES} raw bytes`,
  clickBytes <= CLICK_EAGER_JS_CAP_BYTES,
  `${clickEntry.file} is ${clickBytes} B (${CLICK_EAGER_JS_CAP_BYTES - clickBytes} B of headroom)`,
);
check(
  "the click document carries the resume mount",
  clickHtml.includes(`data-resume="${CLICK[0].artifact}"`),
  CLICK[0].artifact,
);
check("the click document carries the folded intrinsic", /<button\b/.test(clickHtml));
check(
  "the click document carries the page-owned sentinel outside the mount",
  /data-click-sentinel/.test(clickHtml),
);

/* ── 7e. the dialog page's own eager cap ───────────────────────────────── */

if (!existsSync(DIALOG_DIST)) {
  process.stderr.write(`check-zero-eager: ${relative(REPO_ROOT, DIALOG_DIST)} does not exist. Run \`pnpm build\` first.\n`);
  process.exit(1);
}

const dialogHtml = readFileSync(join(DIALOG_DIST, "dialog.html"), "utf8");
const dialogManifest = JSON.parse(readFileSync(join(DIALOG_DIST, ".vite/manifest.json"), "utf8"));
const dialogEntry = dialogManifest["dialog.html"];
if (!dialogEntry) {
  process.stderr.write("check-zero-eager: the dialog build manifest has no entry for dialog.html\n");
  process.exit(1);
}

const dialogBytes = statSync(join(DIALOG_DIST, dialogEntry.file)).size;
check(
  `the dialog eager chunk is at most ${DIALOG_EAGER_JS_CAP_BYTES} raw bytes`,
  dialogBytes <= DIALOG_EAGER_JS_CAP_BYTES,
  `${dialogEntry.file} is ${dialogBytes} B (${DIALOG_EAGER_JS_CAP_BYTES - dialogBytes} B of headroom)`,
);
check(
  "the dialog document carries the resume mount",
  dialogHtml.includes(`data-resume="${DIALOG[0].artifact}"`),
  DIALOG[0].artifact,
);
check("the dialog document carries the claimed child button", /<button\b/.test(dialogHtml));
check("the dialog document carries the page-owned live region", /data-dialog-live/.test(dialogHtml));

const dialogChunks = JSON.parse(readFileSync(join(DIALOG_DIST, ".vite/module-sizes.json"), "utf8"));

/** Static import closure of the dialog entry — what executes on load. */
const dialogEager = new Set([dialogEntry.file]);
for (const file of dialogEager) {
  for (const next of dialogChunks[file]?.imports ?? []) dialogEager.add(next);
}

const dialogProviderEntries = Object.entries(dialogManifest).filter(([id]) =>
  /(?:^|\/)dialog-provider\.ts$/.test(id),
);
const dialogProviderFiles = nameSet(dialogProviderEntries.map(([, info]) => info.file));
check(
  "the dialog build emits a dialog-provider dynamic entry",
  dialogProviderFiles.length === 1,
  dialogProviderFiles.length === 1
    ? dialogProviderFiles[0]
    : dialogProviderFiles.join(", ") || "none",
);

const providerInEager = [...dialogEager].filter(file => dialogProviderFiles.includes(file));
check(
  "the dialog entry's eager import closure excludes the provider chunk",
  providerInEager.length === 0 && dialogProviderFiles.length === 1,
  providerInEager.length
    ? `eager closure reached ${providerInEager.join(", ")}`
    : `${dialogEager.size} eager chunk(s) from ${dialogEntry.file}, provider ${dialogProviderFiles[0] ?? "(missing)"} is not among them`,
);

const entryDynamic = dialogChunks[dialogEntry.file]?.dynamicImports ?? [];
const providerNamedByEntry = dialogProviderFiles.filter(file => entryDynamic.includes(file));
check(
  "the dialog entry dynamically imports the provider chunk",
  providerNamedByEntry.length === 1,
  providerNamedByEntry.length === 1
    ? providerNamedByEntry[0]
    : `dynamicImports ${entryDynamic.join(", ") || "none"}; provider ${dialogProviderFiles.join(", ") || "none"}`,
);

const eagerLibrary = [...dialogEager].flatMap(file =>
  Object.keys(dialogChunks[file]?.modules ?? {})
    .filter(id => /@kobalte\/core\/dialog|dialog-provider\.ts$/.test(id))
    .map(id => `${moduleName(id)} in ${file}`),
);
check(
  "no eager dialog chunk carries the provider module or @kobalte/core/dialog",
  eagerLibrary.length === 0,
  eagerLibrary.length ? eagerLibrary.sort().join(", ") : `${dialogEager.size} eager chunk(s), none names the library`,
);

/* ── 8. the frozen corpus ──────────────────────────────────────────────── */

for (const [path, expected] of Object.entries(CORPUS)) {
  const actual = createHash("sha256").update(readFileSync(join(REPO_ROOT, path))).digest("hex");
  check(`${path} is the corpus byte for byte`, actual === expected, actual === expected ? undefined : `sha256 ${actual}`);
}

/* ── the verdict ───────────────────────────────────────────────────────── */

if (failures.length > 0) {
  process.stderr.write(`\ncheck-zero-eager: ${failures.length} claim(s) failed:\n`);
  for (const claim of failures) process.stderr.write(`  - ${claim}\n`);
  process.exit(1);
}

process.stdout.write(`\ncheck-zero-eager: ${relative(REPO_ROOT, DIST)} is zero-eager.\n`);
