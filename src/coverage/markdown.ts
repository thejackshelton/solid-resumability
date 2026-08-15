/**
 * The human-readable half of the baseline.
 *
 * Same numbers as `coverage.json`, rendered so a reader can see the shape of
 * the problem without parsing JSON: the headline fraction, the two segments
 * side by side (never summed), the ranked refusal tables, and the only-blocker
 * table that says which single code, if lifted, would flip a component.
 *
 * Two per-segment subsections qualify the fraction rather than compute it: the
 * components that proved with a region recorded absent, and the caller's notes.
 * Each is omitted outright when its segment has nothing to say — an empty
 * heading reads like a finding, and there isn't one. Like `report.ts`, this
 * renderer is corpus-agnostic: the app-specific sentences arrive as `notes`.
 */

import type { ComponentRecord, CoverageReport, RankedCode, Segment } from "./report.ts";

export interface RenderOptions {
  /** The command that regenerates both files. */
  command: string;
  /** ISO date (YYYY-MM-DD) the committed baseline was generated on. */
  date: string;
}

function percent(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}

function table(header: string[], rows: string[][]): string {
  const lines = [`| ${header.join(" | ")} |`, `|${header.map(() => "---").join("|")}|`];
  for (const row of rows) lines.push(`| ${row.join(" | ")} |`);
  return lines.join("\n");
}

function rankingTable(codes: RankedCode[]): string {
  if (codes.length === 0) return "_No refusals in this segment._";
  return table(
    ["Rank", "Code", "Components", "Occurrences", "Only-blocker for"],
    codes.map((entry, index) => [
      String(index + 1),
      `\`${entry.code}\``,
      String(entry.components),
      String(entry.occurrences),
      String(entry.onlyBlockerFor),
    ]),
  );
}

/**
 * The absent-region qualification, or nothing.
 *
 * A component can prove *because* a region is absent — nothing inside an absent
 * region is walked, so nothing inside it can refuse. The fraction above is
 * correct as stated; this is the sentence that stops it from being read as more
 * than it says. Omitted entirely when the segment has no such component, so a
 * segment with nothing to qualify carries no empty heading.
 */
function absentRegionSection(records: ComponentRecord[]): string[] {
  const withRegions = records.filter((record) => record.absentRegions !== undefined);
  if (withRegions.length === 0) return [];

  return [
    "### Verdicts proved in an absent state",
    "",
    "These components hold at least one two-state region the build recorded **absent**. Nothing inside an absent region is walked, so nothing inside it can refuse: the verdict is a statement about the markup the served page actually carries, and the region's own contents are outside it.",
    "",
    table(
      ["Component", "File", "Verdict", "Absent regions", "Recorded from"],
      withRegions.map((record) => [
        `\`${record.name}\``,
        `\`${record.file}\``,
        record.verdict,
        String(record.absentRegions?.count ?? 0),
        (record.absentRegions?.presentFrom ?? []).map((from) => `\`${from}\``).join(", "),
      ]),
    ),
    "",
  ];
}

/**
 * Caller-supplied prose, one bullet per noted component, or nothing.
 *
 * The report is corpus-agnostic; the notes are where whoever ran it says what
 * the numbers mean for their own corpus. Nothing here is derived, and nothing
 * here is a total.
 */
function notesSection(records: ComponentRecord[]): string[] {
  const noted = records.filter((record) => record.note !== undefined);
  if (noted.length === 0) return [];

  return [
    "### Notes",
    "",
    ...noted.map((record) => `- **\`${record.name}\`** (\`${record.file}\`) — ${record.note}`),
    "",
  ];
}

function segmentSection(report: CoverageReport, segment: Segment, title: string, blurb: string): string {
  const totals = report.segments[segment];
  const blockers = report.onlyBlockers[segment];
  const records = report.components.filter((record) => record.segment === segment);

  const inventory = table(
    ["Component", "File", "Exported", "Verdict", "Inlined by", "Codes"],
    records
      .map((record) => [
        `\`${record.name}\``,
        `\`${record.file}\``,
        record.exported ? "yes" : "no",
        record.verdict,
        // A refused child whose markup, bindings and handlers are nonetheless
        // carried by a provable parent's artifacts. Still counted, still
        // refused — but not a component the toolchain drops on the floor.
        record.inlinedBy === undefined ? "—" : `\`${record.inlinedBy.split("#")[1]}\``,
        record.refusalCodes.length === 0
          ? "—"
          : record.refusalCodes.map((code) => `\`${code}\``).join("<br>"),
      ]),
  );

  const blockerTable =
    blockers.length === 0
      ? "_No component in this segment is blocked by exactly one code._"
      : table(
          ["Component", "File", "Only blocker"],
          blockers.map((blocker) => [`\`${blocker.name}\``, `\`${blocker.file}\``, `\`${blocker.code}\``]),
        );

  return [
    `## Segment \`${segment}\` — ${title}`,
    "",
    blurb,
    "",
    `**${totals.provable} / ${totals.components} provable (${percent(totals.provableFraction)})** across ${totals.files} file(s).`,
    "",
    // Both qualify the fraction, so both come before the tables that break it
    // down — a reader should meet the caveat with the number, not after it.
    ...absentRegionSection(records),
    ...notesSection(records),
    "### Ranked refusals",
    "",
    "Ranked by how many distinct components carry the code; occurrences break ties.",
    "",
    rankingTable(report.ranking[segment]),
    "",
    "### Only-blockers",
    "",
    "Components whose entire refusal set is a single code — lift that code and they flip.",
    "",
    blockerTable,
    "",
    "### Component inventory",
    "",
    inventory,
  ].join("\n");
}

export function renderBaseline(report: CoverageReport, options: RenderOptions): string {
  const app = report.segments.app;
  const fixtures = report.segments.fixtures;

  const pins = table(
    ["Package", "Pin"],
    Object.entries(report.toolchain).map(([name, version]) => [`\`${name}\``, `\`${version}\``]),
  );

  const filesWithoutComponents = report.files.filter((file) => file.components === 0);
  const diagnostics = report.files.filter((file) => file.diagnostics.length > 0);

  return `${[
    "# Coverage baseline — provable fraction of the Solid 2.0 corpus",
    "",
    `Generated by \`${options.command}\` on ${options.date}. Do not hand-edit: regenerate.`,
    "",
    "## Headline",
    "",
    `**${app.provable} / ${app.components} components provable (${percent(app.provableFraction)})** in the \`app\` segment — the ported first-party TodoMVC sources.`,
    "",
    `The \`fixtures\` segment (${fixtures.provable} / ${fixtures.components}, ${percent(fixtures.provableFraction)}) is a hand-written near-miss slice built to exercise specific refusal codes. It is reported below on its own and is **never** folded into the headline: blending a synthetic slice that contains purpose-built provable controls into a real-code denominator is exactly the flattered number this baseline exists to prevent.`,
    "",
    "## Metric",
    "",
    `- **Component** — ${report.metric.component}. Anonymous module-scope callbacks (\`render(() => <App />, root)\`) are call-site arguments, not components, and are excluded.`,
    `- **Unit** — ${report.metric.unit}. Every component counts once, regardless of size.`,
    "- **Provable fraction** — `provable / components`, computed inside a segment.",
    "- **Refusal set** — exhaustive: the classifier collects every applicable code per component, not just the first.",
    "- **Ranking** — distinct-component count per code, occurrences as the secondary key.",
    "",
    "## Per-segment totals",
    "",
    table(
      ["Segment", "Files", "Components", "Provable", "Fallback", "Provable fraction"],
      [app, fixtures].map((totals) => [
        `\`${totals.segment}\``,
        String(totals.files),
        String(totals.components),
        String(totals.provable),
        String(totals.fallback),
        percent(totals.provableFraction),
      ]),
    ),
    "",
    "There is no combined row. The segments answer different questions and their sum answers neither.",
    "",
    segmentSection(
      report,
      "app",
      "ported first-party sources",
      "`app/src/**` excluding the fixture directory: the TodoMVC example ported byte-identically from the pinned Solid commit. This is the number that matters.",
    ),
    "",
    segmentSection(
      report,
      "fixtures",
      "hand-written near-miss slice",
      "`app/src/fixtures/**`: components written to land on one side or the other of a specific refusal code, plus three provable positive controls. Useful for reading the taxonomy; useless as a coverage estimate.",
    ),
    "",
    "## Corpus files with no component",
    "",
    filesWithoutComponents.length === 0
      ? "_Every corpus file holds at least one component._"
      : table(
          ["File", "Segment", "File-level refusal"],
          filesWithoutComponents.map((file) => [
            `\`${file.path}\``,
            `\`${file.segment}\``,
            file.refusals.length === 0
              ? "—"
              : file.refusals.map((refusal) => `\`${refusal.code}\``).join("<br>"),
          ]),
        ),
    "",
    "These are in the corpus and were analyzed; they contribute no components to the denominator. The refusal column is what `classify()` says about the *file* — `no-exported-component` fires here and nowhere else, and it is counted in the taxonomy below but in no component total.",
    "",
    "## Taxonomy exercise",
    "",
    `The classifier defines ${report.taxonomy.codes} refusal codes; this corpus fires ${report.taxonomy.observed} of them (\`app\` fires ${report.taxonomy.observedBySegment.app}, \`fixtures\` fires ${report.taxonomy.observedBySegment.fixtures}), counting file-level refusals as well as component ones.`,
    "",
    report.taxonomy.unobserved.length === 0
      ? "Every code in the taxonomy is exercised by at least one component or file."
      : `Never observed: ${report.taxonomy.unobserved.map((code) => `\`${code}\``).join(", ")}.`,
    "",
    report.taxonomy.fileLevelOnly.length === 0
      ? "Every observed code is carried by at least one component."
      : `Observed only at file level, never on a component: ${report.taxonomy.fileLevelOnly
          .map((code) => `\`${code}\``)
          .join(", ")} — see the table above.`,
    "",
    "This counts *codes*, not components — it is not a coverage fraction and does not blend the segments.",
    "",
    "## Analyzer diagnostics",
    "",
    diagnostics.length === 0
      ? "_yuku-analyzer parsed and linked every corpus file with no diagnostics._"
      : table(
          ["File", "Diagnostics"],
          diagnostics.map((file) => [`\`${file.path}\``, file.diagnostics.join("<br>")]),
        ),
    "",
    "## Pins",
    "",
    pins,
    "",
    "## Regenerating",
    "",
    "```sh",
    `${options.command}`,
    "```",
    "",
    "Writes `docs/coverage/coverage.json` and `docs/coverage/baseline.md`. Two consecutive runs over an unchanged corpus are byte-identical; set `COVERAGE_DATE=YYYY-MM-DD` to pin the generation date in this file.",
  ].join("\n")}\n`;
}
