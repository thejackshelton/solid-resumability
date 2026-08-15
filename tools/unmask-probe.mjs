#!/usr/bin/env node
/**
 * Live DIST unmask of the twelve pre-registered functions.
 *
 * Re-acquires the pinned DIST arm exactly as `tools/kobalte-probe.mjs` does
 * (same tarball, same integrity, same extract), classifies each function with
 * `unmaskAttributeAudit: true`, and records — without moving any verdict —
 * the binding class of each refused opening's attribute cargo.
 *
 * Writes `docs/goals/ecosystem-ready/notes/T011-recordable-classes.md` with
 * the numbers as recorded values. Names no library in any diagnostic class.
 *
 *   node tools/unmask-probe.mjs
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { classifySite, findComponent, loadProjectFrom } from "../src/comptime/index.ts";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const WORK_ROOT = join(tmpdir(), "kobalte-probe");
const NOTE_PATH = join(REPO_ROOT, "docs/goals/ecosystem-ready/notes/T011-recordable-classes.md");
const SIGNAL_NOTE_PATH = join(REPO_ROOT, "docs/goals/ecosystem-ready/notes/T015-signal-family.md");

const SIGNAL_FAMILY_CODES = [
  "signal-escapes-unanalyzable-use",
  "signal-initializer-not-literal",
  "signal-escapes-to-opaque-callee",
];

const ATTRIBUTE_FAMILY_CODES = new Set([
  "jsx-component-element",
  "jsx-dynamic-attribute",
  "jsx-spread",
  "handler-not-inline",
]);

const SIGNAL_PAIR = new Set(["signal-escapes-unanalyzable-use", "signal-initializer-not-literal"]);

/** The five zero-blocked-code components from the T010 feasible cut. */
const ZERO_BLOCKED = ["DialogRoot", "TabsRoot", "SeparatorRoot", "ButtonRoot", "TabsTrigger"];

const CLASS_LABEL = {
  "own-props-parameter": "own-props parameter",
  "derived-rest-props-result": "derived/rest-props result",
  "local-literal-const": "local literal const",
  "signal-getter": "signal getter",
  "context-value": "context value",
  "module-import": "module import",
  "other-function-value": "other-function value",
  unresolvable: "unresolvable",
};

const RECORDABLE_CLASSES = Object.keys(CLASS_LABEL);

/** Copied from tools/kobalte-probe.mjs — same integrity pin, same byte count. */
const DIST_ARM = {
  spec: "@kobalte/core@2.0.0-alpha.0",
  tarball: "https://registry.npmjs.org/@kobalte/core/-/core-2.0.0-alpha.0.tgz",
  integrity: "sha512-6l5wJRkk/CRXWzbzwYeNfv38XHWKoL3Bj9ykJQexGcmyM2TQV4IpR1E/wDbhygT9TsI3LYP5qgdLj/l2xx+qiw==",
  bytes: 379195,
};

/** THE PRE-REGISTERED TWELVE. Same list, same order, as kobalte-probe.mjs. */
const REGISTERED = [
  { entrypoint: "separator", fn: "SeparatorRoot" },
  { entrypoint: "button", fn: "ButtonRoot" },
  { entrypoint: "checkbox", fn: "CheckboxRoot" },
  { entrypoint: "checkbox", fn: "CheckboxControl" },
  { entrypoint: "checkbox", fn: "CheckboxIndicator" },
  { entrypoint: "dialog", fn: "DialogRoot" },
  { entrypoint: "dialog", fn: "DialogTrigger" },
  { entrypoint: "dialog", fn: "DialogContent" },
  { entrypoint: "dialog", fn: "DialogPortal" },
  { entrypoint: "tabs", fn: "TabsRoot" },
  { entrypoint: "tabs", fn: "TabsTrigger" },
  { entrypoint: "popover", fn: "PopoverContent" },
];

const ENTRY = {
  dist: (entrypoint) => `dist/${entrypoint}/index.jsx`,
};

function fail(message) {
  throw new Error(message);
}

/**
 * Materializes the dist arm by tarball integrity. Copied from
 * tools/kobalte-probe.mjs:acquireDist — hash asserted BEFORE extract.
 */
async function acquireDist() {
  const response = await fetch(DIST_ARM.tarball);
  if (!response.ok) fail(`dist arm download failed: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());

  const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
  if (integrity !== DIST_ARM.integrity) {
    fail(`dist arm integrity is ${integrity}, pinned at ${DIST_ARM.integrity}`);
  }
  if (bytes.length !== DIST_ARM.bytes) {
    fail(`dist arm is ${bytes.length} bytes, pinned at ${DIST_ARM.bytes}`);
  }

  const dir = join(WORK_ROOT, "dist-2.0.0-alpha.0");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const tgz = join(dir, "core.tgz");
  writeFileSync(tgz, bytes);
  execFileSync("tar", ["-xzf", tgz, "-C", dir]);

  return { root: join(dir, "package"), integrity, bytes: bytes.length };
}

function analyzeRegistered(root, unmaskAttributeAudit) {
  const projects = new Map();
  const records = [];

  for (const { entrypoint, fn } of REGISTERED) {
    if (!projects.has(entrypoint)) {
      projects.set(entrypoint, loadProjectFrom([join(root, ENTRY.dist(entrypoint))], root));
    }
    const project = projects.get(entrypoint);

    const hits = [];
    for (const [path, module] of project.modules) {
      const site = findComponent(module, fn);
      if (site !== null) hits.push({ path, module, site });
    }
    if (hits.length === 0) {
      fail(`${entrypoint}/${fn} does not resolve in the dist arm (${project.modules.size} modules linked)`);
    }
    if (hits.length > 1) {
      fail(`${entrypoint}/${fn} defines in ${hits.length} modules in the dist arm: ${hits.map((h) => h.path).join(", ")}`);
    }

    const { path, module, site } = hits[0];
    const analysis = classifySite(module, site, unmaskAttributeAudit ? { unmaskAttributeAudit: true } : {});
    records.push({
      id: `${entrypoint}/${fn}`,
      entrypoint,
      fn,
      module: path,
      analysis,
    });
  }

  return records;
}

function locKey(loc) {
  return `${loc.start}:${loc.end}:${loc.line}:${loc.column}`;
}

function tally(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function formatTally(entries) {
  if (entries.length === 0) return "(none)";
  return entries.map(([name, count]) => (count === 1 ? name : `${name}×${count}`)).join(", ");
}

function formatCargo(cargo) {
  if (cargo.length === 0) return "(none)";
  return cargo.map((item) => `${item.role} → ${CLASS_LABEL[item.class] ?? item.class}`).join(", ");
}

function renderNote(dist, offRecords, onRecords, incomplete) {
  const rows = onRecords.map((on, index) => {
    const off = offRecords[index];
    const diagnostics = on.analysis.attributeDiagnostics ?? [];
    const openings = off.analysis.reasons.filter((reason) => reason.code === "jsx-component-element");
    return {
      id: on.id,
      fn: on.fn,
      openings,
      diagnostics,
      offStatus: off.analysis.status,
      onStatus: on.analysis.status,
      reasonsEqual: JSON.stringify(off.analysis.reasons) === JSON.stringify(on.analysis.reasons),
    };
  });

  const openingRecords = [];
  for (const row of rows) {
    const byLoc = new Map(row.diagnostics.map((record) => [locKey(record.loc), record]));
    for (const opening of row.openings) {
      const record = byLoc.get(locKey(opening.loc));
      openingRecords.push({
        fn: row.fn,
        opening,
        record,
      });
    }
  }

  const allCargo = openingRecords.flatMap((item) => item.record?.cargo ?? []);
  const classTally = tally(allCargo.map((item) => item.class));
  const classCounts = new Map(RECORDABLE_CLASSES.map((name) => [name, 0]));
  for (const [name, count] of classTally) classCounts.set(name, count);
  const openingCount = openingRecords.length;
  const entireYes = openingRecords.filter((item) => item.record?.entireCargoCandidateRecordable === true).length;

  const lines = [];
  lines.push("# T011 — Recordable binding classes behind refused openings");
  lines.push("");
  lines.push("Recorded values from `node tools/unmask-probe.mjs` on the live DIST arm.");
  lines.push("Measurement, not admission. Flag OFF moved no verdict, reason, or template.");
  lines.push("");
  lines.push("## Provenance");
  lines.push("");
  lines.push(`- DIST spec: \`${DIST_ARM.spec}\``);
  lines.push(`- integrity: \`${dist.integrity}\``);
  lines.push(`- bytes: \`${dist.bytes}\``);
  lines.push(`- unmask flag: ON for diagnostics; OFF re-run asserted identical \`(status, reasons)\` on all twelve`);
  lines.push(`- refused component-element openings classified: **${openingCount}**`);
  lines.push("");
  lines.push("## Flag-OFF invariance");
  lines.push("");
  const drifted = rows.filter((row) => row.offStatus !== row.onStatus || !row.reasonsEqual);
  if (drifted.length === 0) {
    lines.push("All twelve: flag ON left `status` and `reasons` identical to flag OFF.");
  } else {
    lines.push(`DRIFT on: ${drifted.map((row) => row.id).join(", ")}`);
  }
  lines.push("");
  lines.push("## Recorded classes");
  lines.push("");
  lines.push("Each spread-of-identifier, each dynamic jsx-attribute value expression, and each handler-valued attribute is resolved through the classifier's own `referenceOf` / `definition` / accessor / import / context maps to one class:");
  lines.push("");
  lines.push("- own-props parameter");
  lines.push("- derived/rest-props result");
  lines.push("- local literal const");
  lines.push("- signal getter");
  lines.push("- context value");
  lines.push("- module import");
  lines.push("- other-function value");
  lines.push("- unresolvable");
  lines.push("");
  lines.push("Candidate-recordable means every class except `unresolvable`. A call-valued or other non-identifier spread has no identifier binding and is recorded as `unresolvable`. Static literal attributes are not cargo. Children are out of scope.");
  lines.push("");
  lines.push("## Per-class totals (all 18 openings)");
  lines.push("");
  for (const name of RECORDABLE_CLASSES) {
    lines.push(`- \`${CLASS_LABEL[name]}\`: **${classCounts.get(name) ?? 0}**`);
  }
  lines.push("");
  lines.push(`Cargo items priced: **${allCargo.length}**. Openings whose entire cargo is candidate-recordable: **${entireYes}/${openingCount}**.`);
  lines.push("");
  lines.push("## Per refused component element");
  lines.push("");
  lines.push("One row per `jsx-component-element` opening. Cargo is the binding-class inventory; children are out of scope.");
  lines.push("");
  lines.push("| Function | locator | line | Cargo (role → class) | Entire cargo candidate-recordable |");
  lines.push("| --- | --- | ---: | --- | --- |");
  for (const item of openingRecords) {
    if (item.record === undefined) {
      lines.push(`| \`${item.fn}\` | — | ${item.opening.loc.line} | INCOMPLETE | — |`);
      continue;
    }
    lines.push(
      `| \`${item.fn}\` | \`${item.record.locator}\` | ${item.record.loc.line} | ${formatCargo(item.record.cargo)} | ${item.record.entireCargoCandidateRecordable ? "yes" : "no"} |`,
    );
  }
  lines.push("");
  lines.push("## Per-component rollups (zero-blocked-code five)");
  lines.push("");
  lines.push("DialogRoot, TabsRoot, SeparatorRoot, ButtonRoot, TabsTrigger — the T010 feasible-cut set with no blocked published code.");
  lines.push("");
  lines.push("| Function | Openings | Entire-cargo yes | Class totals |");
  lines.push("| --- | ---: | ---: | --- |");
  for (const fn of ZERO_BLOCKED) {
    const items = openingRecords.filter((item) => item.fn === fn);
    const yes = items.filter((item) => item.record?.entireCargoCandidateRecordable === true).length;
    const cargo = items.flatMap((item) => item.record?.cargo ?? []);
    const totals = formatTally(tally(cargo.map((item) => CLASS_LABEL[item.class] ?? item.class)));
    lines.push(`| \`${fn}\` | ${items.length} | **${yes}** | ${totals} |`);
  }
  lines.push("");
  if (incomplete.length > 0) {
    lines.push("## Incomplete classification");
    lines.push("");
    for (const item of incomplete) lines.push(`- ${item}`);
    lines.push("");
  }
  lines.push("## Method");
  lines.push("");
  lines.push("1. Re-acquire DIST by tarball integrity (same pin as `tools/kobalte-probe.mjs`).");
  lines.push("2. `classifySite(module, site)` with the flag OFF, then ON.");
  lines.push("3. On the refuse path, classify runs its own `auditOpeningAttributes` and rolls every sink back, so the published `reasons` cannot grow.");
  lines.push("4. Binding class is assigned by the same `referenceOf` / `definition()` / accessor map / import table / `useContextCalls` already used by the verdict path. No second resolver.");
  lines.push("");

  return { markdown: `${lines.join("\n")}\n`, rows, openingCount, entireYes, incomplete };
}

function uniqueCodes(reasons) {
  return [...new Set(reasons.map((reason) => reason.code))].sort();
}

function residualAfterAttributeFamily(reasons) {
  return new Set(uniqueCodes(reasons).filter((code) => !ATTRIBUTE_FAMILY_CODES.has(code)));
}

function sameSet(left, right) {
  if (left.size !== right.size) return false;
  for (const value of left) if (!right.has(value)) return false;
  return true;
}

function formatInitializer(item) {
  return item.astType == null ? item.shape : `${item.shape} (${item.astType})`;
}

function formatEscape(item) {
  const callee = item.callee == null ? "—" : `${item.callee.callee}${item.callee.opaque ? " [opaque]" : ""}`;
  return `${item.site} → ${item.code} via ${item.parent ?? "null"} / ${callee}`;
}

function renderSignalNote(dist, offRecords, onRecords, incomplete) {
  const rows = onRecords.map((on, index) => {
    const off = offRecords[index];
    return {
      id: on.id,
      fn: on.fn,
      offStatus: off.analysis.status,
      onStatus: on.analysis.status,
      reasonsEqual: JSON.stringify(off.analysis.reasons) === JSON.stringify(on.analysis.reasons),
      published: uniqueCodes(off.analysis.reasons),
      publishedAll: off.analysis.reasons.map((reason) => reason.code),
      residual: residualAfterAttributeFamily(off.analysis.reasons),
      diagnostics: on.analysis.signalDiagnostics ?? { initializers: [], escapes: [] },
      attached: on.analysis.signalDiagnostics !== undefined,
    };
  });

  const occupancy = Object.fromEntries(
    SIGNAL_FAMILY_CODES.map((code) => [code, rows.filter((row) => row.published.includes(code)).length]),
  );

  const frontier = rows.filter((row) => sameSet(row.residual, SIGNAL_PAIR));

  const lines = [];
  lines.push("# T015 — Signal-family shapes on the frontier target");
  lines.push("");
  lines.push("Recorded values from `node tools/unmask-probe.mjs` on the live DIST arm.");
  lines.push("Measurement, not admission. Flag OFF moved no verdict, reason, or template.");
  lines.push("");
  lines.push("## Provenance");
  lines.push("");
  lines.push(`- DIST spec: \`${DIST_ARM.spec}\``);
  lines.push(`- integrity: \`${dist.integrity}\``);
  lines.push(`- bytes: \`${dist.bytes}\``);
  lines.push(`- unmask flag: ON for diagnostics; OFF re-run asserted identical \`(status, reasons)\` on all twelve`);
  lines.push("");
  lines.push("## Flag-OFF invariance");
  lines.push("");
  const drifted = rows.filter((row) => row.offStatus !== row.onStatus || !row.reasonsEqual);
  if (drifted.length === 0) {
    lines.push("All twelve: flag ON left `status` and `reasons` identical to flag OFF.");
  } else {
    lines.push(`DRIFT on: ${drifted.map((row) => row.id).join(", ")}`);
  }
  lines.push("");
  lines.push("## Occupancy (published reasons, all twelve)");
  lines.push("");
  for (const code of SIGNAL_FAMILY_CODES) {
    lines.push(`- \`${code}\`: **${occupancy[code]}/12**`);
  }
  lines.push("");
  lines.push("## Frontier target");
  lines.push("");
  lines.push("The registered function whose published residue after attribute-family codes");
  lines.push("(`jsx-component-element`, `jsx-dynamic-attribute`, `jsx-spread`, `handler-not-inline`)");
  lines.push("is exactly the signal pair (`signal-escapes-unanalyzable-use`, `signal-initializer-not-literal`).");
  lines.push("");
  if (frontier.length === 0) {
    lines.push("No registered function matched that residue.");
  } else if (frontier.length > 1) {
    lines.push(`More than one match: ${frontier.map((row) => row.id).join(", ")}.`);
  } else {
    const target = frontier[0];
    lines.push(`Registered id: \`${target.id}\`. Function: \`${target.fn}\`.`);
    lines.push("");
    lines.push("### Initializer shapes");
    lines.push("");
    if (target.diagnostics.initializers.length === 0) {
      lines.push("(none)");
    } else {
      lines.push("| line | shape | astType |");
      lines.push("| ---: | --- | --- |");
      for (const item of target.diagnostics.initializers) {
        lines.push(`| ${item.loc.line} | \`${item.shape}\` | \`${item.astType ?? "null"}\` |`);
      }
    }
    lines.push("");
    lines.push("### Escape sites");
    lines.push("");
    if (target.diagnostics.escapes.length === 0) {
      lines.push("(none)");
    } else {
      lines.push("| line | binding | code | site | parent | callee | definedIn | opaque |");
      lines.push("| ---: | --- | --- | --- | --- | --- | --- | --- |");
      for (const item of target.diagnostics.escapes) {
        const callee = item.callee?.callee ?? "—";
        const definedIn = item.callee?.definedIn ?? "—";
        const opaque = item.callee == null ? "—" : item.callee.opaque ? "yes" : "no";
        lines.push(
          `| ${item.loc.line} | \`${item.binding}\` | \`${item.code}\` | \`${item.site}\` | \`${item.parent ?? "null"}\` | \`${callee}\` | \`${definedIn}\` | ${opaque} |`,
        );
      }
    }
  }
  lines.push("");
  lines.push("## Per-function occupancy");
  lines.push("");
  lines.push("| Function | unanalyzable-use | initializer-not-literal | opaque-callee | initializer shapes | escape sites |");
  lines.push("| --- | ---: | ---: | ---: | --- | --- |");
  for (const row of rows) {
    const init = formatTally(tally(row.diagnostics.initializers.map((item) => formatInitializer(item))));
    const escapes = formatTally(tally(row.diagnostics.escapes.map((item) => formatEscape(item))));
    lines.push(
      `| \`${row.fn}\` | ${row.publishedAll.filter((code) => code === "signal-escapes-unanalyzable-use").length} | ${row.publishedAll.filter((code) => code === "signal-initializer-not-literal").length} | ${row.publishedAll.filter((code) => code === "signal-escapes-to-opaque-callee").length} | ${init} | ${escapes} |`,
    );
  }
  lines.push("");
  if (incomplete.length > 0) {
    lines.push("## Incomplete classification");
    lines.push("");
    for (const item of incomplete) lines.push(`- ${item}`);
    lines.push("");
  }
  lines.push("## Method");
  lines.push("");
  lines.push("1. Re-acquire DIST by tarball integrity (same pin as `tools/kobalte-probe.mjs`).");
  lines.push("2. `classifySite(module, site)` with the flag OFF, then ON.");
  lines.push("3. Signal shapes are recorded only when the existing unmask flag is ON, at the same factory-call and `auditUses` sites the verdict path already walks. No second resolver.");
  lines.push("4. An enclosing callee on `signal-escapes-unanalyzable-use` is diagnostic-only: the verdict path's sink walk does not climb through `Property` / `ObjectExpression`; the instrument does, via the same callee resolution.");
  lines.push("");

  return { markdown: `${lines.join("\n")}\n`, rows, frontier, occupancy };
}

async function main() {
  if (!existsSync(join(REPO_ROOT, "src/comptime/classify.ts"))) {
    fail("unmask-probe must run from the solid-resumability workspace");
  }

  const dist = await acquireDist();
  const offRecords = analyzeRegistered(dist.root, false);
  const onRecords = analyzeRegistered(dist.root, true);

  const incomplete = [];
  const drifted = [];

  for (let index = 0; index < REGISTERED.length; index++) {
    const off = offRecords[index];
    const on = onRecords[index];
    if (off.analysis.status !== on.analysis.status) {
      drifted.push(`${on.id}: status ${off.analysis.status} -> ${on.analysis.status}`);
    }
    if (JSON.stringify(off.analysis.reasons) !== JSON.stringify(on.analysis.reasons)) {
      drifted.push(`${on.id}: published reasons moved with the flag ON`);
    }

    const openings = off.analysis.reasons.filter((reason) => reason.code === "jsx-component-element");
    const diagnostics = on.analysis.attributeDiagnostics ?? [];
    const byLoc = new Map(diagnostics.map((record) => [locKey(record.loc), record]));
    for (const opening of openings) {
      const record = byLoc.get(locKey(opening.loc));
      if (record === undefined) {
        incomplete.push(`${on.id}: refused element at ${opening.loc.line}:${opening.loc.column} has no diagnostic`);
        continue;
      }
      if (!Array.isArray(record.attributes)) {
        incomplete.push(`${on.id}: diagnostic at ${record.locator} has no attribute inventory`);
      }
      if (!Array.isArray(record.cargo)) {
        incomplete.push(`${on.id}: diagnostic at ${record.locator} has no cargo classification`);
        continue;
      }
      for (const item of record.cargo) {
        if (!RECORDABLE_CLASSES.includes(item.class)) {
          incomplete.push(`${on.id}: cargo at ${record.locator} has class outside the enumerated set`);
        }
      }
    }
    if (on.analysis.attributeDiagnostics === undefined) {
      incomplete.push(`${on.id}: flag ON did not attach attributeDiagnostics`);
    }
    if (on.analysis.signalDiagnostics === undefined) {
      incomplete.push(`${on.id}: flag ON did not attach signalDiagnostics`);
    } else {
      if (!Array.isArray(on.analysis.signalDiagnostics.initializers)) {
        incomplete.push(`${on.id}: signalDiagnostics has no initializer inventory`);
      }
      if (!Array.isArray(on.analysis.signalDiagnostics.escapes)) {
        incomplete.push(`${on.id}: signalDiagnostics has no escape inventory`);
      }
    }
  }

  if (drifted.length > 0) {
    console.error("unmask-probe FAILED — flag ON moved a verdict or published reasons:");
    for (const item of drifted) console.error(`  - ${item}`);
    process.exitCode = 1;
    return;
  }

  const rendered = renderNote(dist, offRecords, onRecords, incomplete);
  writeFileSync(NOTE_PATH, rendered.markdown);
  const signalRendered = renderSignalNote(dist, offRecords, onRecords, incomplete);
  writeFileSync(SIGNAL_NOTE_PATH, signalRendered.markdown);

  if (incomplete.length > 0) {
    console.error("unmask-probe PARTIAL — incomplete inventory:");
    for (const item of incomplete) console.error(`  - ${item}`);
    process.exitCode = 1;
    return;
  }

  const frontierId = signalRendered.frontier.length === 1 ? signalRendered.frontier[0].id : "none";
  console.log(
    `unmask-probe ok — DIST ${DIST_ARM.integrity.slice(0, 18)}…, ` +
      `${REGISTERED.length}/12 classified, ${rendered.openingCount} openings priced, ` +
      `${rendered.entireYes}/${rendered.openingCount} entire-cargo candidate-recordable, ` +
      `frontier ${frontierId}, wrote ${NOTE_PATH} and ${SIGNAL_NOTE_PATH}`,
  );
}

await main();
