/**
 * The coverage report: one record per component, aggregated per segment.
 *
 * The metric, stated once so the code can be checked against it:
 *
 *   - **Component** — a module-scope JSX-returning function in the corpus,
 *     exported or not, several per file allowed (see `comptime/discover.ts`).
 *   - **Unit** — unweighted component count. A five-line component and a
 *     hundred-line one count the same.
 *   - **Provable fraction** — `provable / total`, computed *within a segment*.
 *     There is deliberately no corpus-wide total in this report: the headline
 *     is the `app` segment alone, and a blended number is the exact misfire
 *     this baseline exists to avoid. Omitting the field is the enforcement.
 *   - **Refusal set** — exhaustive per component: the classifier collects
 *     every applicable code, not just the first. Codes are ranked by
 *     *distinct component count* (how many components the code blocks), with
 *     occurrence count as the tiebreak, because a code that fires six times
 *     inside one component is a smaller problem than one that fires once in
 *     six components.
 *   - **Only-blocker** — a component whose entire refusal set is a single
 *     code: fixing that one code would flip it to provable.
 *
 * One thing in this report is deliberately *not* a component observation.
 * `no-exported-component` fires in exactly one place (see `classify.ts`):
 * `classify()` asked to judge a module that holds no component at all. That is
 * a refusal about a **file**. It is recorded per file, in
 * `FileRecord.refusals`, and folded into the taxonomy exercise. It contributes
 * to no denominator, no ranking, and no only-blocker list: those are all
 * derived from `components`, which a file-level refusal never enters.
 *
 * Two fields here exist to keep the number honest rather than to change it, and
 * both obey the same rule: **the report describes a verdict, it never computes
 * one.**
 *
 *   - `absentRegions` reads the analysis the classifier already produced and
 *     says out loud when a component's provable verdict was reached with part
 *     of its markup recorded absent. A reader who wants to know whether the
 *     fraction is flattered by an empty region should not have to open the
 *     analyzer to find out.
 *   - `note` is caller-supplied prose attached to one component id. It is
 *     inert: nothing reads it back, no total moves, and a note keyed to an id
 *     the corpus does not contain is a hard error rather than a silent no-op,
 *     because a note that quietly stops applying is worse than no note at all.
 *
 * This module and `markdown.ts` stay corpus-agnostic — every app-specific
 * sentence lives in `cli.ts`, which is this repo's own front end.
 */

import { relative, resolve } from "pathe";

import { makeLocator } from "../comptime/ast.ts";
import { classify, classifySite } from "../comptime/classify.ts";
import { findComponents } from "../comptime/discover.ts";
import { loadProjectFrom } from "../comptime/project.ts";
import {
  REASON_CODES,
  type InitialFrom,
  type Reason,
  type ReasonCode,
  type ShowRegionInfo,
} from "../comptime/types.ts";
import { SEGMENTS, collectCorpus, type CorpusFile, type Segment } from "./corpus.ts";

export type { Segment } from "./corpus.ts";

export interface RefusalRecord {
  code: ReasonCode;
  message: string;
  line: number;
  column: number;
  detail?: Record<string, unknown>;
}

/**
 * The two-state regions a component holds that the build recorded ABSENT.
 *
 * Recorded only when there is at least one, and derived purely from the
 * analysis: a region is in this summary exactly when `present === false`, which
 * is why `present` is a literal here rather than a value that could vary. A
 * present region contributes nothing, so a component whose regions are all
 * present carries no summary at all — the same discipline `inlinedBy` follows.
 *
 * What it is for: a component can prove *because* a region is absent. Nothing
 * inside an absent region is walked, so nothing inside it can refuse. That is a
 * true statement about the served page, not a loophole — but it is a statement
 * a reader of the fraction is owed, and this is where the report makes it.
 */
export interface AbsentRegionSummary {
  /** How many of the component's regions were recorded absent. Always >= 1. */
  count: number;
  /** Always `false`: absence is the entry condition for this summary. */
  present: false;
  /**
   * Where that state came from, distinct and sorted. `"capture"` means the
   * guard reaches a store and has no build-time answer, so the served page's
   * captured first paint is what makes the absence a fact.
   */
  presentFrom: InitialFrom[];
}

export interface ComponentRecord {
  /** `<file>#<name>`: stable across runs, unique within the corpus. */
  id: string;
  file: string;
  name: string;
  exported: boolean;
  /** Mandatory on every record — there is no unsegmented component. */
  segment: Segment;
  verdict: "provable" | "fallback";
  line: number;
  column: number;
  /**
   * The id of a **provable** component whose template absorbed this one via
   * the depth-1 splice, when there is one.
   *
   * A see-through child (`PropsCountLabel`, `PropsStepButton`) is refused when
   * judged standalone — it declares no cells of its own — but it is not a
   * component the toolchain fails to handle: its markup, bindings and handlers
   * are all carried, at parent-frame locators, in the parent's artifacts.
   * Recording that here is what stops the segment fraction from reading those
   * children as plain misses. It changes no denominator and no verdict: the
   * child is still counted, and still `fallback`.
   */
  inlinedBy?: string;
  /**
   * Present when the component holds at least one region the build recorded
   * absent. Derived, never a verdict, and it moves no count in this report.
   *
   * Only a provable analysis carries regions at all — a refusal stops at its
   * reasons — so this appears only on `provable` records. That is the case it
   * is for: it is a provable verdict, not a refused one, that a reader might
   * want to weigh against how much markup the build recorded absent.
   */
  absentRegions?: AbsentRegionSummary;
  /**
   * Caller-supplied prose about this component, from `BuildOptions.notes`.
   * Rendered under the segment's `Notes` list and read by nothing else.
   */
  note?: string;
  /** Distinct codes, sorted: the component's refusal *set*. */
  refusalCodes: ReasonCode[];
  /** Every refusal in analysis order, with its location. */
  refusals: RefusalRecord[];
}

export interface FileRecord {
  path: string;
  segment: Segment;
  components: number;
  /** Analyzer diagnostics for this file; a non-empty list is evidence, not noise. */
  diagnostics: string[];
  /**
   * File-level refusals: what `classify()` says about a module holding no
   * component. Empty for every file that holds one. These are taxonomy
   * observations only — nothing here is a component, so nothing here can reach
   * a denominator, a ranking, or an only-blocker.
   */
  refusals: RefusalRecord[];
}

export interface SegmentTotals {
  segment: Segment;
  files: number;
  components: number;
  provable: number;
  fallback: number;
  /** provable / components, 0 when the segment holds no components. */
  provableFraction: number;
}

export interface RankedCode {
  code: ReasonCode;
  /** Distinct components carrying this code — the ranking key. */
  components: number;
  /** Total emissions of this code across the segment. */
  occurrences: number;
  /** Components whose whole refusal set is just this code. */
  onlyBlockerFor: number;
}

export interface OnlyBlocker {
  component: string;
  file: string;
  name: string;
  code: ReasonCode;
  occurrences: number;
}

export interface CoverageReport {
  schemaVersion: number;
  metric: {
    unit: string;
    component: string;
    headlineSegment: Segment;
    note: string;
  };
  corpus: {
    root: string;
    fixtureDirectory: string;
    segments: readonly Segment[];
  };
  toolchain: Record<string, string>;
  headline: { segment: Segment; provable: number; components: number; provableFraction: number };
  segments: Record<Segment, SegmentTotals>;
  ranking: Record<Segment, RankedCode[]>;
  onlyBlockers: Record<Segment, OnlyBlocker[]>;
  /**
   * How much of the 18-code taxonomy the corpus actually exercises. This is a
   * statement about *codes*, not about components, so it is corpus-wide on
   * purpose and can never be mistaken for a blended coverage fraction.
   *
   * The union is over component refusal sets **and** file-level refusals — a
   * code the corpus fires on a file is exercised whether or not any component
   * carries it.
   */
  taxonomy: {
    codes: number;
    observed: number;
    unobserved: ReasonCode[];
    observedBySegment: Record<Segment, number>;
    /** Codes observed only at file level, never on a component. */
    fileLevelOnly: ReasonCode[];
  };
  files: FileRecord[];
  components: ComponentRecord[];
}

export interface BuildOptions {
  /** Directory walked for corpus sources. */
  corpusDir: string;
  /** Path root that every reported path is relative to. */
  root: string;
  /** Corpus-relative directory holding the synthetic near-miss slice. */
  fixtureDirectory?: string;
  /** Recorded verbatim in the report; the caller owns pin discovery. */
  toolchain: Record<string, string>;
  /**
   * Prose keyed by component id (`<file>#<name>`), attached verbatim to that
   * component's record. Every key must name a component the corpus contains:
   * an unknown key throws `UnknownNoteComponentError` rather than being
   * dropped, so a note about a component that was renamed or deleted fails the
   * regeneration instead of silently going missing from the baseline.
   */
  notes?: Record<string, string>;
}

/**
 * Thrown when `BuildOptions.notes` names a component id the corpus does not
 * contain. Named so a caller can catch this specific staleness rather than
 * pattern-matching an error message.
 */
export class UnknownNoteComponentError extends Error {
  /** The unknown ids, sorted — all of them, not just the first found. */
  readonly componentIds: string[];

  constructor(componentIds: string[]) {
    super(
      `coverage notes name ${componentIds.length} component id(s) the corpus does not contain: ` +
        `${componentIds.join(", ")}`,
    );
    this.name = "UnknownNoteComponentError";
    this.componentIds = componentIds;
  }
}

/**
 * The absent half of a component's regions, or `undefined` when it has none.
 * Purely a fold over what the analysis already decided.
 */
function absentRegionsOf(regions: readonly ShowRegionInfo[]): AbsentRegionSummary | undefined {
  const absent = regions.filter((region) => !region.present);
  if (absent.length === 0) return undefined;
  return {
    count: absent.length,
    present: false,
    presentFrom: [...new Set(absent.map((region) => region.presentFrom))].sort(),
  };
}

function ratio(part: number, whole: number): number {
  if (whole === 0) return 0;
  // Fixed to four places so the value is a short, stable decimal rather than a
  // binary-float tail that could print differently under another engine.
  return Number((part / whole).toFixed(4));
}

/** Sorted distinct codes: the refusal *set*, as opposed to the emission list. */
function distinctCodes(reasons: Reason[]): ReasonCode[] {
  return [...new Set(reasons.map((reason) => reason.code))].sort();
}

function rank(records: ComponentRecord[]): RankedCode[] {
  const components = new Map<ReasonCode, number>();
  const occurrences = new Map<ReasonCode, number>();
  const onlyBlockerFor = new Map<ReasonCode, number>();

  for (const record of records) {
    for (const code of record.refusalCodes) {
      components.set(code, (components.get(code) ?? 0) + 1);
      if (record.refusalCodes.length === 1) {
        onlyBlockerFor.set(code, (onlyBlockerFor.get(code) ?? 0) + 1);
      }
    }
    for (const refusal of record.refusals) {
      occurrences.set(refusal.code, (occurrences.get(refusal.code) ?? 0) + 1);
    }
  }

  return [...components.keys()]
    .map((code) => ({
      code,
      components: components.get(code) ?? 0,
      occurrences: occurrences.get(code) ?? 0,
      onlyBlockerFor: onlyBlockerFor.get(code) ?? 0,
    }))
    .sort(
      (a, b) =>
        b.components - a.components ||
        b.occurrences - a.occurrences ||
        (a.code < b.code ? -1 : a.code > b.code ? 1 : 0),
    );
}

function onlyBlockersOf(records: ComponentRecord[]): OnlyBlocker[] {
  return records
    .filter((record) => record.refusalCodes.length === 1)
    .map((record) => ({
      component: record.id,
      file: record.file,
      name: record.name,
      code: record.refusalCodes[0],
      occurrences: record.refusals.length,
    }));
}

function totalsOf(segment: Segment, records: ComponentRecord[], files: FileRecord[]): SegmentTotals {
  const provable = records.filter((record) => record.verdict === "provable").length;
  return {
    segment,
    files: files.filter((file) => file.segment === segment).length,
    components: records.length,
    provable,
    fallback: records.length - provable,
    provableFraction: ratio(provable, records.length),
  };
}

function diagnosticText(diagnostic: unknown): string {
  if (diagnostic == null) return "unknown diagnostic";
  const record = diagnostic as { message?: unknown; severity?: unknown; start?: unknown };
  const message = typeof record.message === "string" ? record.message : JSON.stringify(diagnostic);
  const severity = record.severity === undefined ? "" : `[${String(record.severity)}] `;
  const at = typeof record.start === "number" ? ` @${record.start}` : "";
  return `${severity}${message}${at}`;
}

/**
 * Walks the corpus, classifies every component, and folds the results into a
 * report. Nothing here reads the clock, the environment, or the filesystem
 * beyond the corpus sources, so two runs over the same tree produce the same
 * object.
 */
export function buildReport(options: BuildOptions): CoverageReport {
  const fixtureDirectory = options.fixtureDirectory ?? "fixtures";
  const corpus: CorpusFile[] = collectCorpus(options.corpusDir, options.root, fixtureDirectory);

  // One linked project over the whole corpus: cross-module `definition()` is
  // what lets an escape refusal name the module it escaped into.
  const project = loadProjectFrom(
    corpus.map((file) => file.absolute),
    options.root,
  );

  const files: FileRecord[] = [];
  const components: ComponentRecord[] = [];
  /** child component id -> the provable parent that spliced it in. */
  const absorbedBy = new Map<string, string>();

  for (const file of corpus) {
    const module = project.modules.get(file.path);
    if (module === undefined) {
      throw new Error(`corpus file was not analyzed: ${file.path}`);
    }

    const locOf = makeLocator(module.source);
    const sites = findComponents(module);

    for (const site of sites) {
      const analysis = classifySite(module, site);
      const loc = locOf(site.fn);
      const id = `${file.path}#${site.name}`;

      // A fold over the analysis, not a second opinion about it: the classifier
      // decided both the verdict and each region's state, and all this does is
      // carry the absent half of that decision into the record.
      const absentRegions =
        analysis.status === "provable" ? absentRegionsOf(analysis.regions) : undefined;

      // Only a *provable* parent absorbs anything: a splice inside a component
      // that was refused for some other reason ships nowhere, so claiming it
      // carried the child would be false comfort. First parent wins, and the
      // corpus walk is deterministic, so the choice is stable.
      if (analysis.status === "provable") {
        for (const child of analysis.inlined) {
          const childId = `${child.module}#${child.component}`;
          if (!absorbedBy.has(childId)) absorbedBy.set(childId, id);
        }
      }

      components.push({
        id,
        file: file.path,
        name: site.name,
        exported: site.exported,
        segment: file.segment,
        verdict: analysis.status === "provable" ? "provable" : "fallback",
        line: loc.line,
        column: loc.column,
        ...(absentRegions === undefined ? {} : { absentRegions }),
        refusalCodes: distinctCodes(analysis.reasons as Reason[]),
        refusals: (analysis.reasons as Reason[]).map((reason) => ({
          code: reason.code,
          message: reason.message,
          line: reason.loc.line,
          column: reason.loc.column,
          ...(reason.detail === undefined ? {} : { detail: reason.detail }),
        })),
      });
    }

    // A file with no component still gets a verdict — `classify()` refuses it
    // with `no-exported-component`, the one case that code literally
    // describes. Recording it is what keeps the taxonomy honest without
    // inventing a component to carry it.
    const fileRefusals =
      sites.length > 0
        ? []
        : (classify(module).reasons as Reason[]).map((reason) => ({
            code: reason.code,
            message: reason.message,
            line: reason.loc.line,
            column: reason.loc.column,
            ...(reason.detail === undefined ? {} : { detail: reason.detail }),
          }));

    files.push({
      path: file.path,
      segment: file.segment,
      components: sites.length,
      diagnostics: (module.diagnostics ?? []).map(diagnosticText),
      refusals: fileRefusals,
    });
  }

  // Applied after the walk because a child is classified before the parent
  // that absorbs it whenever it is declared first in the file, which is the
  // usual arrangement. Rebuilding the record rather than assigning onto it
  // keeps `inlinedBy` in its declared position in the serialized report.
  for (let index = 0; index < components.length; index++) {
    const parent = absorbedBy.get(components[index].id);
    if (parent === undefined) continue;
    const { refusalCodes, refusals, ...head } = components[index];
    components[index] = { ...head, inlinedBy: parent, refusalCodes, refusals };
  }

  // Notes are attached last, against the finished component set, which is what
  // makes the staleness check total: every key is checked against every id the
  // corpus produced, and an unknown one stops the build. A note is prose about
  // a component — if the component is gone, the prose is a claim about nothing.
  const notes = options.notes ?? {};
  const known = new Set(components.map((record) => record.id));
  const unknown = Object.keys(notes)
    .filter((id) => !known.has(id))
    .sort();
  if (unknown.length > 0) throw new UnknownNoteComponentError(unknown);

  for (let index = 0; index < components.length; index++) {
    const note = notes[components[index].id];
    if (note === undefined) continue;
    const { refusalCodes, refusals, ...head } = components[index];
    components[index] = { ...head, note, refusalCodes, refusals };
  }

  const bySegment = (segment: Segment): ComponentRecord[] =>
    components.filter((record) => record.segment === segment);

  const segments = Object.fromEntries(
    SEGMENTS.map((segment) => [segment, totalsOf(segment, bySegment(segment), files)]),
  ) as Record<Segment, SegmentTotals>;

  const ranking = Object.fromEntries(
    SEGMENTS.map((segment) => [segment, rank(bySegment(segment))]),
  ) as Record<Segment, RankedCode[]>;

  const onlyBlockers = Object.fromEntries(
    SEGMENTS.map((segment) => [segment, onlyBlockersOf(bySegment(segment))]),
  ) as Record<Segment, OnlyBlocker[]>;

  const headlineSegment: Segment = "app";
  const headline = segments[headlineSegment];

  const onComponents = new Set(components.flatMap((record) => record.refusalCodes));
  const onFiles = new Set(files.flatMap((file) => file.refusals.map((refusal) => refusal.code)));
  const observed = new Set([...onComponents, ...onFiles]);

  /** Distinct codes a segment fires, counting its files as well as its components. */
  const observedIn = (segment: Segment): number => {
    const codes = new Set<ReasonCode>(ranking[segment].map((entry) => entry.code));
    for (const file of files) {
      if (file.segment !== segment) continue;
      for (const refusal of file.refusals) codes.add(refusal.code);
    }
    return codes.size;
  };

  const taxonomy = {
    codes: REASON_CODES.length,
    observed: REASON_CODES.filter((code) => observed.has(code)).length,
    unobserved: REASON_CODES.filter((code) => !observed.has(code)),
    observedBySegment: Object.fromEntries(
      SEGMENTS.map((segment) => [segment, observedIn(segment)]),
    ) as Record<Segment, number>,
    fileLevelOnly: REASON_CODES.filter((code) => onFiles.has(code) && !onComponents.has(code)),
  };

  return {
    // 2 — `ComponentRecord` gained `absentRegions` and `note`. Both are
    // optional and additive; every field a version-1 consumer read is
    // unchanged, and no total in this report moved.
    schemaVersion: 2,
    metric: {
      unit: "unweighted component count",
      component: "module-scope JSX-returning function, exported or not, many per file",
      headlineSegment,
      note:
        "Fractions are per segment. There is no corpus-wide total by design: " +
        "the `fixtures` segment is synthetic and blending it into the headline would flatter the number.",
    },
    corpus: {
      // Root-relative and posix-shaped, so the committed report says nothing
      // about the machine that generated it.
      root: relative(resolve(options.root), resolve(options.corpusDir)),
      fixtureDirectory,
      segments: SEGMENTS,
    },
    toolchain: options.toolchain,
    headline: {
      segment: headlineSegment,
      provable: headline.provable,
      components: headline.components,
      provableFraction: headline.provableFraction,
    },
    segments,
    ranking,
    onlyBlockers,
    taxonomy,
    files,
    components,
  };
}
