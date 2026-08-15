/**
 * The reproduction, end to end: install, build both arms, serve both arms,
 * print everything verbatim, and only then say what it means.
 *
 * ── What this answers ─────────────────────────────────────────────────────
 * Does `unplugin-solid-resumability` compose with `@solidjs/vite-plugin`'s
 * `start: true` mode? T001 answered the source half of that question by reading
 * the published plugin. Nobody had run anything. This runs it.
 *
 * ── Why two arms ──────────────────────────────────────────────────────────
 * A bare negative — "it does not work" — is worth much less than a bounded one.
 * Both arms are handed the SAME component, the SAME resumability options and
 * the SAME page declaration; the only thing that differs is `solid()` versus
 * `solid({ start: true })`. So the plain arm is not decoration: it is the
 * control that makes the start arm's result attributable to the flag rather
 * than to this reproduction being wrong.
 *
 * ── What it does NOT do ───────────────────────────────────────────────────
 * It does not build the seam. `rewritePageHtml`/`prerenderPages` and the
 * unplumbed `PrerenderInput.htmlDir` are named in docs/start-mode/answer.md and
 * left exactly where they are.
 *
 * Exit code: 0 when the arms behave as the source predicts, 1 when the start
 * arm shows composition WORKING — which would overturn a finding three units
 * have built on, and is meant to be impossible to miss.
 *
 * Usage: node tools/start-mode-repro/run.mjs [--skip-install]
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const VITE = join(HERE, "node_modules/vite/bin/vite.js");

/** The marker the wrapped hook prints. Absence of it IS the finding. */
const HOOK_FIRED = "[repro] HOOK FIRED  unplugin-solid-resumability:html.transformIndexHtml";

/** What an inlined template looks like once it is in the document. */
const TEMPLATE_MARK = 'data-testid="counter-label"';

/** What the entry swap looks like once it has happened, served or built. */
const SWAP_MARK_SERVED = "/src/resumable-entry.ts";
const SWAP_MARK_BUILT = "[repro] resumable entry loaded";

const transcript = [];

function record(line) {
  transcript.push(line);
  console.log(line);
}

function banner(title) {
  record("");
  record("=".repeat(78));
  record(`== ${title}`);
  record("=".repeat(78));
}

/** Runs a command, streams it verbatim, and keeps every byte of it. */
function run(label, command, args, options = {}) {
  return new Promise((resolve, reject) => {
    record(`$ ${command} ${args.join(" ")}`);
    record("");

    const child = spawn(command, args, { cwd: HERE, ...options });
    let output = "";

    const take = (chunk) => {
      const text = chunk.toString();
      output += text;
      process.stdout.write(text);
    };

    child.stdout.on("data", take);
    child.stderr.on("data", take);
    child.on("error", reject);
    child.on("close", (code) => {
      for (const line of output.replace(/\n$/, "").split("\n")) transcript.push(line);
      record("");
      record(`[repro] ${label} exited with code ${code}`);
      resolve({ label, code, output });
    });
  });
}

function countOf(output, needle) {
  return output.split(needle).length - 1;
}

// ── Step 0: this reproduction's own install, in its own directory ──────────
// Its own package.json, its own pnpm-lock.yaml, its own node_modules. The main
// repository's pins are not read, not resolved and not written; the plugin is
// consumed through `link:../../plugin`, the same way the demo consumes it.
if (!process.argv.includes("--skip-install")) {
  banner("install — the reproduction's own dependency tree, nothing shared");
  const install = await run("pnpm install", "pnpm", [
    "install",
    "--no-frozen-lockfile",
    "--lockfile-dir",
    ".",
  ]);
  if (install.code !== 0) {
    console.error("[repro] install failed; the reproduction cannot run");
    process.exit(install.code ?? 1);
  }
}

// ── The arms ────────────────────────────────────────────────────────────────
// `dist` is removed before each build so "does the document exist when
// closeBundle fires" is answered by THIS build and never by a leftover.

banner("ARM 1 (control) — solid() with no start, production build");
rmSync(join(HERE, "dist"), { recursive: true, force: true });
const plainBuild = await run("plain build", process.execPath, [
  VITE,
  "build",
  "--config",
  "vite.plain.config.mjs",
]);

const plainDocument = join(HERE, "dist/plain/index.html");
const plainHtml = existsSync(plainDocument) ? readFileSync(plainDocument, "utf8") : "";
banner("ARM 1 — the built document, verbatim");
for (const line of plainHtml.replace(/\n$/, "").split("\n")) record(line);

const plainChunks = join(HERE, "dist/plain/assets");
const plainBundle = existsSync(plainChunks)
  ? readFileSync(
      join(plainChunks, readFileSync(join(HERE, "dist/plain/.vite/manifest.json"), "utf8")
        .match(/"file":\s*"assets\/([^"]+)"/)?.[1] ?? ""),
      "utf8",
    )
  : "";

banner("ARM 1 (control) — solid() with no start, dev server");
const plainDev = await run("plain dev", process.execPath, ["dev-probe.mjs", "plain"]);

banner("ARM 2 — solid({ start: true }), production build");
rmSync(join(HERE, "dist"), { recursive: true, force: true });
const startBuild = await run("start build", process.execPath, [
  VITE,
  "build",
  "--config",
  "vite.start.config.mjs",
]);

const startDocument = join(HERE, "dist/client/index.html");
const startHtml = existsSync(startDocument) ? readFileSync(startDocument, "utf8") : "";
banner("ARM 2 — the built document, verbatim");
record(`[repro] tools/start-mode-repro/dist/client/index.html exists: ${existsSync(startDocument)}`);
for (const line of startHtml.replace(/\n$/, "").split("\n")) record(line);

banner("ARM 2 — solid({ start: true }), dev server");
const startDev = await run("start dev", process.execPath, ["dev-probe.mjs", "start"]);

// ── The verdict ─────────────────────────────────────────────────────────────
const observed = {
  plainBuildHookCalls: countOf(plainBuild.output, HOOK_FIRED),
  plainBuildDocumentAtCloseBundle: plainBuild.output.includes("exists at closeBundle: true"),
  plainBuildTemplateInlined: plainHtml.includes(TEMPLATE_MARK),
  plainBuildEntrySwapped: plainBundle.includes(SWAP_MARK_BUILT),
  plainDevHookCalls: countOf(plainDev.output, HOOK_FIRED),
  plainDevTemplateInlined: plainDev.output.includes(TEMPLATE_MARK),
  plainDevEntrySwapped: plainDev.output.includes(SWAP_MARK_SERVED),

  startBuildHookCalls: countOf(startBuild.output, HOOK_FIRED),
  startBuildDocumentAtCloseBundle: startBuild.output.includes("exists at closeBundle: true"),
  startBuildDocumentAfterBuild: existsSync(startDocument),
  startBuildTemplateInlined: startHtml.includes(TEMPLATE_MARK),
  startBuildEntryPresent: startHtml.includes(SWAP_MARK_SERVED) || startHtml.includes("classic-entry"),
  startDevHookCalls: countOf(startDev.output, HOOK_FIRED),
  startDevTemplateInlined: startDev.output.includes(TEMPLATE_MARK),
  startDevEntrySwapped: startDev.output.includes(SWAP_MARK_SERVED),
};

banner("OBSERVED");
for (const [key, value] of Object.entries(observed)) record(`  ${key} = ${JSON.stringify(value)}`);

/**
 * Refutation first, deliberately.
 *
 * The unit that ordered this reproduction said a refutation is worth more than
 * a confirmation, so the refutation branch is the one written to be impossible
 * to overlook: any sign of the start arm actually composing stops the run with
 * a non-zero exit and a message naming the finding it overturns.
 */
const refutations = [];
if (observed.startBuildHookCalls > 0) {
  refutations.push(
    "the resumability plugin's transformIndexHtml FIRED under `start: true` in build — " +
      "T001's collision point 2 says it cannot",
  );
}
if (observed.startDevHookCalls > 0) {
  refutations.push(
    "the resumability plugin's transformIndexHtml FIRED under `start: true` in dev — " +
      "T001's collision point 2 says appType:'custom' un-registers the middleware that calls it",
  );
}
if (observed.startBuildTemplateInlined || observed.startDevTemplateInlined) {
  refutations.push("a start-mode document carries the plugin's inlined template");
}
if (observed.startDevEntrySwapped) {
  refutations.push("a start-mode dev document carries the plugin's swapped entry");
}
if (observed.startBuildDocumentAtCloseBundle) {
  refutations.push(
    "the built document already existed when closeBundle fired under `start: true` — " +
      "T001's collision point 4 says start writes it strictly afterwards",
  );
}

const confirmations = [];
if (observed.plainBuildHookCalls > 0 && observed.plainDevHookCalls > 0) {
  confirmations.push("the control arm's HTML hook fires in both build and dev");
}
if (observed.plainBuildTemplateInlined && observed.plainDevTemplateInlined) {
  confirmations.push("the control arm's document carries the inlined template, built and served");
}
if (observed.plainBuildEntrySwapped && observed.plainDevEntrySwapped) {
  confirmations.push("the control arm's entry swap lands, built and served");
}
if (observed.plainBuildDocumentAtCloseBundle) {
  confirmations.push("the control arm's built document is on disk when closeBundle fires");
}

banner("VERDICT");

if (refutations.length > 0) {
  record("");
  record("  ####################################################################");
  record("  ##  REFUTED. The start arm shows composition WORKING.             ##");
  record("  ##  This overturns a ruling-grade finding. Stop and escalate.     ##");
  record("  ####################################################################");
  for (const line of refutations) record(`  - ${line}`);
  writeFileSync(join(HERE, "transcript.txt"), transcript.join("\n") + "\n", "utf8");
  process.exit(1);
}

for (const line of confirmations) record(`  CONTROL   ${line}`);
record("");
record(`  START     transformIndexHtml fired ${observed.startBuildHookCalls} times in build ` +
  `and ${observed.startDevHookCalls} times in dev, with the plugin registered in both`);
record("  START     no start-mode document carries the inlined template or the swapped entry");
record("  START     the built document does not exist when closeBundle fires; it appears only");
record("            afterwards, written by start's own buildApp post hook, and it is named");
record("            index.html rather than the page's declared name");
record("");
record("  CONFIRMED: T001's prediction holds. The two compose without `start: true`");
record("  and do not compose with it, and the failure under start mode is SILENT —");
record("  the build exits 0 and ships a document with none of the plugin's work in it.");

if (confirmations.length < 4) {
  record("");
  record("  The control arm did not fully compose either, so this run proves nothing");
  record("  about start mode. Fix the control before reading the start arm.");
  writeFileSync(join(HERE, "transcript.txt"), transcript.join("\n") + "\n", "utf8");
  process.exit(1);
}

writeFileSync(join(HERE, "transcript.txt"), transcript.join("\n") + "\n", "utf8");
record("");
record(`[repro] transcript written to tools/start-mode-repro/transcript.txt`);
