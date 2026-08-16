import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { Analyzer, type Module } from "yuku-analyzer";

import { classify, classifyAll, findComponents } from "../src/comptime/index.ts";
import { renderBaseline } from "../src/coverage/markdown.ts";
import {
  UnknownNoteComponentError,
  buildReport,
  type ComponentRecord,
  type CoverageReport,
} from "../src/coverage/report.ts";
import type { ReasonCode } from "../src/comptime/types.ts";

/**
 * The coverage tooling: does discovery see what the metric says a component is,
 * does the classifier collect a component's *whole* refusal set, and is the
 * committed baseline reproducible from the corpus on disk?
 *
 * Vitest runs with cwd at the repo root. The corpus is read as text through
 * the analyzer — nothing here imports a module from `app/`.
 */

const ROOT = resolve(process.cwd());
const CORPUS = join(ROOT, "app/src");
const COVERAGE_JSON = join(ROOT, "docs/coverage/coverage.json");
const BASELINE_MD = join(ROOT, "docs/coverage/baseline.md");

/** Analyzes an in-memory module, so nothing depends on paths or file names. */
function moduleOf(path: string, source: string): Module {
  const analyzer = new Analyzer();
  const module = analyzer.addFile(path, source);
  analyzer.link();
  return module;
}

const report: CoverageReport = buildReport({
  corpusDir: CORPUS,
  root: ROOT,
  fixtureDirectory: "fixtures",
  toolchain: { "yuku-analyzer": "test" },
});

function componentRecord(id: string): ComponentRecord {
  const found = report.components.find((component) => component.id === id);
  if (found === undefined) throw new Error(`no component record for ${id}`);
  return found;
}

describe("discovery — module-scope components, exported or not", () => {
  it("finds a component that is never exported", () => {
    const module = moduleOf(
      "src/Local.tsx",
      `import { createSignal } from "solid-js";
       function Hidden() {
         const [count, setCount] = createSignal(0);
         return <div><span>{"count: " + count()}</span><button onClick={() => setCount(count() + 1)}>+</button></div>;
       }
       export function useHidden() { return Hidden; }`,
    );

    const components = findComponents(module);
    expect(components.map((site) => site.name)).toEqual(["Hidden"]);
    expect(components[0].exported).toBe(false);
  });

  it("counts the four module-local components in the real app shell", () => {
    const locals = report.components.filter(
      (component) => component.file === "app/src/app.tsx" && !component.exported,
    );

    expect(locals.map((component) => component.name)).toEqual([
      "Header",
      "TodoItem",
      "MainSection",
      "Footer",
    ]);
    // An export-only walk sees exactly one component in this file.
    expect(report.files.find((file) => file.path === "app/src/app.tsx")?.components).toBe(5);
  });

  it("proves a module-local component", () => {
    // Export is packaging, not provability: artifacts key by `(module path,
    // local name)`, so `LocalOnlyCounter` is judged on its body alone.
    const local = componentRecord("app/src/fixtures/LocalOnlyCounter.tsx#LocalOnlyCounter");
    expect(local.exported).toBe(false);
    expect(local.verdict).toBe("provable");
    expect(local.refusalCodes).toEqual([]);
  });

  it("never fires `no-exported-component` on a component it discovered", () => {
    // The code survives for exactly one case, and it is not this one.
    for (const component of report.components) {
      expect(component.refusalCodes).not.toContain("no-exported-component");
    }
  });

  it("does not count an anonymous module-scope callback as a component", () => {
    // `render(() => <App />, root)` returns JSX from a module-scope arrow, but
    // it is a call-site argument, not a component.
    const module = moduleOf(
      "src/main.tsx",
      `import { render } from "@solidjs/web";
       import { App } from "./app";
       render(() => <App />, document.getElementById("root"));`,
    );

    expect(findComponents(module)).toEqual([]);
    expect(report.files.find((file) => file.path === "app/src/main.tsx")?.components).toBe(0);
  });

  it("discovers a component that returns an array of elements", () => {
    // The classifier refuses this shape — but it has to see it to refuse it.
    const arrayRoot = componentRecord("app/src/fixtures/ArrayRootCounter.tsx#ArrayRootCounter");
    expect(arrayRoot.verdict).toBe("fallback");
    expect(arrayRoot.refusalCodes).toEqual(["jsx-root-not-element"]);
  });

  it("classifies every component in a file holding two of them", () => {
    const module = moduleOf(
      "src/Pair.tsx",
      `import { createSignal } from "solid-js";
       export function First() {
         const [count, setCount] = createSignal(0);
         return <div><span>{"count: " + count()}</span><button onClick={() => setCount(count() + 1)}>+</button></div>;
       }
       const Second = () => {
         const [name, setName] = createSignal("a");
         return <p><span>{name()}</span><button onClick={() => setName("b")}>b</button></p>;
       };`,
    );

    const analyses = classifyAll(module);
    expect(analyses.map((analysis) => analysis.component)).toEqual(["First", "Second"]);
    // Two verdicts out of one file: the module-local `Second` is judged on
    // its body alone, so both prove.
    expect(analyses.map((analysis) => analysis.status)).toEqual(["provable", "provable"]);
    expect(analyses[1].reasons).toEqual([]);

    // The single-component entry point reaches either of them by name.
    expect(classify(module, "Second").component).toBe("Second");
    expect(classify(module, "First").status).toBe("provable");
  });

  it("keeps `no-exported-component` for a module holding no component at all", () => {
    // The one case the code literally describes: `classify()` found nothing to
    // classify. It is a discovery failure, not a packaging judgement.
    const module = moduleOf("src/todos.ts", `export const todos = [];`);

    const analysis = classify(module);
    expect(analysis.status).toBe("fallback");
    expect(analysis.reasons.map((reason) => reason.code)).toEqual(["no-exported-component"]);
    expect(classify(module, "Missing").reasons[0].code).toBe("no-exported-component");
  });
});

describe("exhaustive refusal collection", () => {
  it("reports every code a multi-defect fixture triggers, not just the first", () => {
    const tuple = componentRecord("app/src/fixtures/TupleSignalCounter.tsx#TupleSignalCounter");

    // Non-destructured *and* escaping *and* unprovable handlers *and* an
    // underivable text child: one component, six distinct codes.
    expect(tuple.refusalCodes).toEqual([
      "handler-calls-non-accessor",
      "handler-captures-unprovable-binding",
      "handler-unsupported-syntax",
      "jsx-dynamic-child-not-derivable",
      "signal-binding-not-destructured",
      "signal-escapes-unanalyzable-use",
    ]);
    expect(tuple.refusals.length).toBeGreaterThan(tuple.refusalCodes.length);
    for (const refusal of tuple.refusals) expect(refusal.line).toBeGreaterThan(0);
  });

  it("keeps walking past a refused component element", () => {
    // `TodoItem`'s error `<Show>` takes a render-prop child, which is not the
    // shape a two-state region admits, so the element is still refused — and
    // stopping there would hide the dynamic attribute and the unprovable
    // handler around it.
    const item = componentRecord("app/src/app.tsx#TodoItem");
    expect(item.refusalCodes).toContain("jsx-component-element");
    expect(item.refusalCodes).toContain("jsx-dynamic-attribute");
    expect(item.refusalCodes).toContain("handler-captures-unprovable-binding");
  });

  it("stops walking INSIDE a region the build recorded absent", () => {
    // The other half of the same discipline. Exhaustive collection is about
    // markup the served page CARRIES. `MainSection` and `Footer` are each one
    // outer `<Show>` over a store read, recorded absent — no DOM, no bindings,
    // no wiring — so there is nothing inside them to prove and nothing to
    // report. What used to survive was what is outside the region: their
    // derivations reaching into the store by a route this pass did not perform.
    //
    // Those derivations are now exempt, for the reason the walk already had:
    // no emitted artifact reaches one of them. Both components are guard-only
    // and both prove. `test/show-regions.test.tsx` holds the control that
    // re-fires the escape the moment the same region is recorded present.
    for (const id of ["app/src/app.tsx#MainSection", "app/src/app.tsx#Footer"]) {
      const record = componentRecord(id);
      expect(record.verdict, id).toBe("provable");
      expect(record.refusalCodes, id).toEqual([]);
    }
  });

  it("does not mask a missing source behind an earlier refusal", () => {
    // Every app-shell component is refused for several reasons; whether it has
    // a resumable source is still reported for each of them. S3 split that
    // report in two, and the split is exhaustive by construction: a component
    // reaches for a store or it does not.
    //
    //   - no `useContext` at all -> `no-signal-source`, unchanged.
    //   - a store this pass could not name -> `store-binding-not-provable`,
    //     which is the more specific statement of the same fact. Reporting
    //     both would say twice that the source is unaccounted for.
    // Nowhere in the corpus do both fire on one component: they are two
    // statements of the same missing fact, and saying it twice would be
    // double-counting it in the ranking.
    for (const component of report.components) {
      expect(
        component.refusalCodes.includes("no-signal-source") &&
          component.refusalCodes.includes("store-binding-not-provable"),
        component.id,
      ).toBe(false);
    }

    // `App` renders the provider but consumes nothing, so it is still the
    // plain sourceless case, reported behind four `jsx-component-element`s.
    expect(componentRecord("app/src/app.tsx#App").refusalCodes).toContain("no-signal-source");
    // `MainSection` and `Footer` both bind the store's read slot, and both have
    // it ADMITTED — the slot is fixed and the provider is visible. `Footer` used
    // to stop short of that, because `onClick={clearCompleted}` looked like the
    // action leaving its own call site; an event prop hands the framework the
    // identity itself, so it is no longer an escape and the store is named.
    //
    // What used to refuse them both was the same sentence: `todos.filter(…)` and
    // `todos.length` inside a local closure are not text derivations this pass
    // performed. Nothing emitted reaches either closure — the branch that would
    // have called it is the absent region's — so neither is a blocker, and both
    // components prove on their store and their guard alone.
    for (const name of ["MainSection", "Footer"]) {
      expect(componentRecord(`app/src/app.tsx#${name}`).refusalCodes).toEqual([]);
      expect(componentRecord(`app/src/app.tsx#${name}`).verdict).toBe("provable");
    }
    // `TodoItem`'s store *is* proven — it takes three actions and reads
    // nothing — so it reports neither, and is refused only on its markup and
    // on the props its handlers close over.
    expect(componentRecord("app/src/app.tsx#TodoItem").refusalCodes).not.toContain("no-signal-source");
    expect(componentRecord("app/src/app.tsx#TodoItem").refusalCodes).not.toContain(
      "store-binding-not-provable",
    );
  });

  it("treats a computed initializer as a single-code refusal and a literal-options factory as provable", () => {
    // A computed initializer used to abandon the cell, cascading into handler
    // and binding refusals; the options-argument arm never did. The computed
    // arm is still a single-code refusal. T027 C2 / T033: a second-arg static
    // object of literal values now folds, so `OptionsArgCounter` is provable —
    // gained, not lost.
    expect(componentRecord("app/src/fixtures/ComputedInitializerCounter.tsx#ComputedInitializerCounter").refusalCodes)
      .toEqual(["signal-initializer-not-literal"]);
    expect(componentRecord("app/src/fixtures/OptionsArgCounter.tsx#OptionsArgCounter").refusalCodes)
      .toEqual([]);
    expect(componentRecord("app/src/fixtures/OptionsArgCounter.tsx#OptionsArgCounter").verdict)
      .toBe("provable");
  });
});

describe("the metric — segments, never blended", () => {
  it("puts every component in exactly one segment", () => {
    expect(report.components.length).toBeGreaterThan(0);
    for (const component of report.components) {
      expect(["app", "fixtures"]).toContain(component.segment);
    }
    const counted = report.segments.app.components + report.segments.fixtures.components;
    expect(counted).toBe(report.components.length);
  });

  it("takes the headline from the app segment alone", () => {
    expect(report.headline.segment).toBe("app");
    expect(report.headline.components).toBe(report.segments.app.components);
    expect(report.headline.provable).toBe(report.segments.app.provable);
    expect(report.headline.provableFraction).toBe(report.segments.app.provableFraction);
  });

  it("emits no corpus-wide component total that could be read as the headline", () => {
    const blendable = JSON.stringify(report).match(/"provableFraction"/g) ?? [];
    // One per segment, plus the headline echo of the app segment. Nothing else.
    expect(blendable).toHaveLength(3);
  });

  it("ranks codes by distinct component count, occurrences as the tiebreak", () => {
    for (const segment of ["app", "fixtures"] as const) {
      const ranked = report.ranking[segment];
      for (let i = 1; i < ranked.length; i++) {
        const previous = ranked[i - 1];
        const current = ranked[i];
        expect(previous.components).toBeGreaterThanOrEqual(current.components);
        if (previous.components === current.components) {
          expect(previous.occurrences).toBeGreaterThanOrEqual(current.occurrences);
        }
      }
    }
  });

  it("lists only components whose whole refusal set is one code as only-blockers", () => {
    for (const segment of ["app", "fixtures"] as const) {
      for (const blocker of report.onlyBlockers[segment]) {
        expect(componentRecord(blocker.component).refusalCodes).toEqual([blocker.code]);
      }
      const expected = report.components.filter(
        (component) => component.segment === segment && component.refusalCodes.length === 1,
      );
      expect(report.onlyBlockers[segment]).toHaveLength(expected.length);
    }
  });
});

describe("file-level refusals — taxonomy only, never a denominator", () => {
  const withoutComponents = () => report.files.filter((file) => file.components === 0);

  it("classifies a corpus file that holds no component", () => {
    // `no-exported-component` fires in exactly one place: a module with
    // nothing to classify. This asks it.
    const files = withoutComponents();
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(file.refusals.map((refusal) => refusal.code)).toEqual(["no-exported-component"]);
    }
  });

  it("records nothing at file level for a file that does hold a component", () => {
    for (const file of report.files) {
      if (file.components > 0) expect(file.refusals).toEqual([]);
    }
  });

  it("keeps the file-level code out of every component-derived total", () => {
    // The exact hazard: a file observation quietly inflating the thing the
    // headline is computed from.
    for (const component of report.components) {
      expect(component.refusalCodes).not.toContain("no-exported-component");
    }
    for (const segment of ["app", "fixtures"] as const) {
      expect(report.ranking[segment].map((entry) => entry.code)).not.toContain(
        "no-exported-component",
      );
      expect(report.onlyBlockers[segment].map((blocker) => blocker.code)).not.toContain(
        "no-exported-component",
      );
    }
    expect(report.segments.app.components).toBe(5);
    expect(report.segments.fixtures.components).toBe(28);
  });

  it("counts it in the taxonomy, and says it is file-level only", () => {
    expect(report.taxonomy.observed).toBe(16);
    expect(report.taxonomy.fileLevelOnly).toEqual(["no-exported-component"]);
  });

  it("names every code the corpus has no carrier for", () => {
    // The honest cost of admission 2, stated rather than hidden. `Header` was
    // the corpus's only carrier of `handler-references-free-name` — it fired
    // on `Date` and `Math` — and admitting those two as enumerated event-time
    // receivers is exactly what flipped it provable. The code itself is
    // unchanged and still fires (see `test/store-model.test.ts`, where a
    // handler reaching for `document` and one calling `Date.parse` are both
    // refused by it); what it no longer has is a *corpus* carrier.
    //
    // Restoring one needs a fixture under `app/src/fixtures/**` — a handler
    // naming a non-enumerated global — which is corpus, and therefore not that
    // slice's to write, nor this one's.
    //
    // The store read slice adds the second: `store-read-not-provable` fires on a
    // read slot bound by a pattern rather than a plain name, and no component in
    // the corpus writes one. It is exercised in `test/store-model.test.ts`
    // instead, which is where the shape can be varied one thing at a time.
    //
    // Two-state regions add three more, and every one is the SAME fact stated
    // three ways: `MainSection` and `Footer` are each one outer `<Show>` over a
    // store read, and recording that region absent takes their whole bodies out
    // of the walk. `jsx-unsupported-children` lived on `Footer`'s todo-count
    // span, inside the region. `store-binding-not-provable` lived on `Footer`'s
    // `onClick={clearCompleted}`, which an event prop now preserves the identity
    // through. And `show-branch-not-static-at-capture` — the code this slice
    // added — has no corpus carrier at all, because the corpus's other guards
    // are inside those same regions; it is exercised over `test/fixtures` in
    // `test/show-regions.test.tsx`.
    //
    // The five region codes joined them for the same reason one level up: the
    // corpus's only list is `MainSection`'s, which sits inside the absent
    // `<Show>` — so nothing in `app/src` reaches a `<For>` at all, and every one
    // of them is exercised over `test/fixtures` in `test/keyed-regions.test.tsx`.
    // A code with no corpus carrier is a fact worth stating, not a gap to paper
    // over: this counts CODES, not components, and no coverage fraction moves.
    //
    // W4's narrowing adds the eleventh, and it is the same fact a third time:
    // `store-read-escapes` had exactly two corpus carriers — `MainSection` and
    // `Footer` — and closing it for a derivation no emitted artifact reaches is
    // precisely what flipped them. The code is unchanged and still fires on
    // every use it always refused; `test/show-regions.test.tsx` re-fires it over
    // the same body with the region recorded PRESENT, and
    // `test/store-model.test.ts` varies the escape shape one thing at a time.
    // Restoring a corpus carrier needs a fixture under `app/src/fixtures/**`,
    // which is corpus, and therefore not this slice's to write.
    //
    // The taxonomy therefore reads 16 of 30, and this test is what stops any of
    // the fourteen absences from being discovered by accident later. T051 added
    // the two derived-cell codes to the closed set; T053 added
    // callee-body-not-guarded-return; T054 added the two element-projection
    // codes. None has an `app/src` carrier (they fire on `test/fixtures/shapes`),
    // so they join unobserved.
    expect(report.taxonomy.codes).toBe(32);
    expect(report.taxonomy.unobserved).toEqual([
      "store-binding-not-provable",
      "store-read-not-provable",
      "store-read-escapes",
      "handler-references-free-name",
      "show-branch-not-static-at-capture",
      "region-each-not-store-projection",
      "region-body-not-inline-arrow",
      "region-item-not-single-element",
      "region-key-not-derivable",
      "region-nested",
      "jsx-unsupported-children",
      "derived-cell-initial-not-foldable",
      "derived-cell-input-not-mount-stable",
      "element-projection-not-own-host",
      "element-projection-not-pure",
      "callee-body-not-guarded-return",
    ]);
  });
});

describe("the props slice", () => {
  it("flips the parent and nothing else in its file", () => {
    expect(componentRecord("app/src/fixtures/PropsPair.tsx#PropsPairParent").verdict).toBe("provable");
    for (const name of ["PropsCountLabel", "PropsStepButton"]) {
      const child = componentRecord(`app/src/fixtures/PropsPair.tsx#${name}`);
      expect(child.verdict).toBe("fallback");
      // The children have no cells of their own; the parent's provability is
      // a statement about the parent, not about them.
      expect(child.refusalCodes).toContain("no-signal-source");
    }
  });

  it("refuses every other new fixture, and says why", () => {
    const expected: Record<string, ReasonCode[]> = {
      "app/src/fixtures/PropsDeepPair.tsx#PropsDeepParent": [
        "jsx-component-element",
        "signal-escapes-unanalyzable-use",
      ],
      "app/src/fixtures/PropsDeepPair.tsx#PropsMiddle": ["jsx-component-element", "no-signal-source"],
      "app/src/fixtures/PropsDeepPair.tsx#PropsLeaf": [
        "jsx-dynamic-child-not-derivable",
        "no-signal-source",
      ],
      "app/src/fixtures/PropsSpreadPair.tsx#PropsSpreadParent": [
        "jsx-component-element",
        "jsx-spread",
        "signal-escapes-unanalyzable-use",
      ],
      "app/src/fixtures/PropsOpaquePair.tsx#PropsOpaqueParent": [
        "jsx-component-element",
        "signal-escapes-to-opaque-callee",
      ],
      "app/src/fixtures/ImpureEscapeCounter.tsx#ImpureEscapeCounter": [
        "signal-escapes-to-opaque-callee",
      ],
    };

    for (const [id, codes] of Object.entries(expected)) {
      expect(componentRecord(id).refusalCodes, id).toEqual(codes);
    }
  });

  it("restores the corpus carrier for `signal-escapes-to-opaque-callee`", () => {
    // `OpaqueCalleeCounter` proves against summarizable helpers, so the code
    // needs another carrier: it must be fired by real corpus source, not just
    // by in-memory test fixtures.
    const carriers = report.components.filter((component) =>
      component.refusalCodes.includes("signal-escapes-to-opaque-callee"),
    );
    expect(carriers.map((component) => component.name)).toContain("ImpureEscapeCounter");
  });

  it("records the parent that absorbed each see-through child (S3)", () => {
    // Without this, a child that only ever renders through a provable parent
    // reads as a plain miss against the fixtures denominator, with nothing in
    // the report saying otherwise.
    for (const name of ["PropsCountLabel", "PropsStepButton"]) {
      const child = componentRecord(`app/src/fixtures/PropsPair.tsx#${name}`);
      expect(child.inlinedBy).toBe("app/src/fixtures/PropsPair.tsx#PropsPairParent");
      // It is a fact recorded *about* the child, not a verdict changed for it:
      // it is still counted, still refused, and still in the denominator.
      expect(child.verdict).toBe("fallback");
    }

    // Nothing else claims a parent — in particular not a child whose parent
    // was refused. `PropsMiddle` and `PropsLeaf` are rendered by a parent that
    // never proved, so no artifact carries them.
    const absorbed = report.components.filter((component) => component.inlinedBy !== undefined);
    expect(absorbed.map((component) => component.name).sort()).toEqual([
      "PropsCountLabel",
      "PropsStepButton",
    ]);
    // Nothing above changes under ADDRESSING, and that is the point: an
    // addressed child is not absorbed, so it claims no parent here. The two
    // components `ComposedCounter.tsx` adds compose by address, and neither
    // appears in this list.
    //
    // 6/24 -> 7/26 (T015): the carrier fixture landed two counted components in
    // `app/src/fixtures/KeyedRoster.tsx` — `RosterList` provable, the provider
    // `Roster` refused. 7/26 -> 9/28 (T003): `app/src/fixtures/ComposedCounter.tsx`
    // lands two more, and BOTH prove — `ComposedInner` on its own, and
    // `ComposedOuter` because the addressing arm lets it hold a hole for a child
    // inlining could never absorb. 9/28 -> 8/28 (T016): the recorded prop
    // `kind="seed"` makes `ComposedInner` provable only when addressed with its
    // record — addressed, not lost. Wire receipt
    // `verify/.witness/receipts/2026-08-15T19-42-52.629Z`. 8/28 -> 9/28
    // (T027/T033): C2 literal-options admission made `OptionsArgCounter`
    // provable — gained, not lost. Declared moves, not drift, which is the
    // only kind this pin was ever meant to let through.
    expect(report.segments.fixtures.components).toBe(28);
    expect(report.segments.fixtures.provable).toBe(9);
  });
});

describe("the store slice (S3)", () => {
  it("carries the app segment to three, on the store's own components", () => {
    // `Header` dispatches an action; `MainSection` and `Footer` are guard-only,
    // each one region the build recorded absent. All three are proved through
    // the store, and all three are the ported TodoMVC's own code.
    expect(report.segments.app.provable).toBe(3);
    expect(report.segments.app.components).toBe(5);
    for (const name of ["Header", "MainSection", "Footer"]) {
      expect(componentRecord(`app/src/app.tsx#${name}`).verdict, name).toBe("provable");
      expect(componentRecord(`app/src/app.tsx#${name}`).refusalCodes, name).toEqual([]);
    }
  });

  it("grows no other app component's refusal set", () => {
    // The recorded baseline, verbatim. Shrinkage is what an admission is for;
    // growth in the same breath would mean the slice cost something it did not
    // account for.
    const baseline: Record<string, number> = { TodoItem: 7, MainSection: 6, Footer: 6, App: 2 };
    for (const [name, before] of Object.entries(baseline)) {
      expect(componentRecord(`app/src/app.tsx#${name}`).refusalCodes.length, name).toBeLessThanOrEqual(before);
    }
  });

  it("keeps the fixtures segment where the last declared move left it", () => {
    // The claim of THIS slice is about the app: the store slice moved the app
    // segment and was not allowed to move the fixtures one, in either direction.
    // The numbers below are 6/24 as that slice left them, plus T015's carrier
    // fixture, which declared its own move to 7/26 — `RosterList` provable and
    // the provider `Roster` refused — plus T003's addressing fixture, which
    // declared 7/26 -> 9/28 with both of its components provable — plus T016's
    // ruling that the recorded prop makes `ComposedInner` provable only when
    // addressed with its record (9/28 -> 8/28; addressed, not lost; wire
    // receipt `verify/.witness/receipts/2026-08-15T19-42-52.629Z`) — plus
    // T027/T033's C2 literal-options admission that made `OptionsArgCounter`
    // provable (8/28 -> 9/28; gained, not lost). Undeclared movement still
    // fails here, which is the whole job of the pin.
    expect(report.segments.fixtures.provable).toBe(9);
    expect(report.segments.fixtures.components).toBe(28);
  });
});

describe("the record's qualifications — described, never computed", () => {
  const options = {
    corpusDir: CORPUS,
    root: ROOT,
    fixtureDirectory: "fixtures",
    toolchain: { "yuku-analyzer": "test" },
  };

  it("says which provable verdicts were reached with a region recorded absent", () => {
    // The fraction is correct as stated, and this is what stops it from being
    // read as more than it says: `MainSection` and `Footer` are each one outer
    // `<Show>` over a store read, recorded ABSENT, and nothing inside an absent
    // region is walked. The report now carries that fact next to the verdict
    // instead of leaving it in the analyzer for a reader to go and find.
    for (const id of ["app/src/app.tsx#MainSection", "app/src/app.tsx#Footer"]) {
      const record = componentRecord(id);
      expect(record.verdict, id).toBe("provable");

      const absent = record.absentRegions;
      if (absent === undefined) throw new Error(`expected an absent-region summary on ${id}`);
      expect(absent.count, id).toBeGreaterThanOrEqual(1);
      // Absence is the entry condition, not a value that varies: a present
      // region contributes nothing to this summary.
      expect(absent.present, id).toBe(false);
      // `capture` — the guard reaches a store, so the build has no answer of
      // its own and the served page's captured first paint is what makes the
      // absence a fact.
      expect(absent.presentFrom, id).toEqual(["capture"]);
    }
  });

  it("records nothing for a component with no absent region", () => {
    // `Header` proves on its own markup, with every element present. A summary
    // here would say "no regions were absent", which is not a finding.
    expect(componentRecord("app/src/app.tsx#Header").verdict).toBe("provable");
    expect(componentRecord("app/src/app.tsx#Header").absentRegions).toBeUndefined();
  });

  it("keeps `TodoItem` a props-boundary fallback, on its own five codes", () => {
    // Its verdict is its own: the keyed region's item slot binds a body
    // parameter, never a child component's props, so nothing about
    // `MainSection` proving reaches down into this. Pinned exactly, because a
    // silent drift here is how a fallback quietly becomes a different claim.
    const item = componentRecord("app/src/app.tsx#TodoItem");
    expect(item.verdict).toBe("fallback");
    expect(item.refusalCodes).toEqual([
      "handler-captures-unprovable-binding",
      "handler-unsupported-syntax",
      "jsx-component-element",
      "jsx-dynamic-attribute",
      "jsx-dynamic-child-not-derivable",
    ]);
    // A refusal stops at its reasons, so there is no region record to carry —
    // and no provable parent absorbed it either.
    expect(item.absentRegions).toBeUndefined();
    expect(item.inlinedBy).toBeUndefined();
  });

  it("throws a named error on a note keyed to a component the corpus lacks", () => {
    // The whole point of the notes mechanism. A note is prose ABOUT a
    // component; if the component was renamed or deleted, the prose is a claim
    // about nothing, and the honest failure is a loud one at regeneration time
    // rather than a sentence quietly missing from the committed baseline.
    let thrown: unknown;
    try {
      buildReport({ ...options, notes: { "app/src/app.tsx#Ghost": "a component that is not there" } });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(UnknownNoteComponentError);
    expect((thrown as UnknownNoteComponentError).componentIds).toEqual(["app/src/app.tsx#Ghost"]);
    // Every unknown id, not just the first one found: a run that fails should
    // fail once, with the whole list.
    expect(() =>
      buildReport({ ...options, notes: { "x#B": "b", "x#A": "a", "app/src/app.tsx#App": "real" } }),
    ).toThrowError(/x#A, x#B/);
  });

  it("attaches a known note without moving anything", () => {
    const noted = buildReport({ ...options, notes: { "app/src/app.tsx#App": "architectural residue" } });

    expect(noted.components.find((record) => record.id === "app/src/app.tsx#App")?.note).toBe(
      "architectural residue",
    );
    // Inert by construction: prose attached to a record is not evidence, and
    // nothing in this report is allowed to read it back.
    expect(noted.headline).toEqual(report.headline);
    expect(noted.segments).toEqual(report.segments);
    expect(noted.ranking).toEqual(report.ranking);
    expect(noted.onlyBlockers).toEqual(report.onlyBlockers);
    expect(noted.components.map((record) => record.verdict)).toEqual(
      report.components.map((record) => record.verdict),
    );
  });

  it("renders the qualification and the notes only where a segment has them", () => {
    const noted = buildReport({ ...options, notes: { "app/src/app.tsx#App": "architectural residue" } });
    const rendered = renderBaseline(noted, { command: "pnpm coverage", date: "2026-01-01" });

    expect(rendered).toContain("### Verdicts proved in an absent state");
    expect(rendered).toContain("architectural residue");
    // One of each: `app` has both, `fixtures` has neither, and an empty heading
    // in the fixtures segment would read like a finding that isn't there.
    expect(rendered.match(/### Verdicts proved in an absent state/g)).toHaveLength(1);
    expect(rendered.match(/### Notes/g)).toHaveLength(1);
    // The inventory table is untouched by either subsection.
    expect(rendered).toContain("| Component | File | Exported | Verdict | Inlined by | Codes |");

    const withoutNotes = renderBaseline(report, { command: "pnpm coverage", date: "2026-01-01" });
    expect(withoutNotes).not.toContain("### Notes");
  });

  it("carries the schema version the two new fields arrived in", () => {
    expect(report.schemaVersion).toBe(2);
  });
});

describe("the baseline is reproducible", () => {
  it("produces an identical report on two independent runs", () => {
    const options = {
      corpusDir: CORPUS,
      root: ROOT,
      fixtureDirectory: "fixtures",
      toolchain: { "yuku-analyzer": "test" },
    };
    const first = buildReport(options);
    const second = buildReport(options);

    expect(JSON.stringify(second, null, 2)).toBe(JSON.stringify(first, null, 2));

    const render = { command: "pnpm coverage", date: "2026-01-01" };
    expect(renderBaseline(second, render)).toBe(renderBaseline(first, render));
  });

  it("matches the committed docs/coverage/coverage.json", () => {
    const committed = JSON.parse(readFileSync(COVERAGE_JSON, "utf8"));
    // Two things in the committed file are CLI *input* rather than corpus
    // observations, and neither is derivable here: the pins, read from the
    // package manifests, and the notes, written in `cli.ts`. Everything else
    // must reproduce from the corpus on disk, so both are lifted out and the
    // rest is compared whole. The notes get their own assertion below.
    const withoutNote = (record: Record<string, unknown>): Record<string, unknown> => {
      const { note, ...rest } = record;
      return rest;
    };
    const fresh = { ...report, toolchain: committed.toolchain };
    const expected = {
      ...committed,
      components: (committed.components as Record<string, unknown>[]).map(withoutNote),
    };

    expect(
      JSON.parse(JSON.stringify(fresh)),
      "committed coverage baseline is stale — run `pnpm coverage`",
    ).toEqual(expected);
  });

  it("commits this repo's own notes on the components the ruling named", () => {
    const committed = JSON.parse(readFileSync(COVERAGE_JSON, "utf8"));
    const noted = (committed.components as { id: string; note?: string }[]).filter(
      (record) => record.note !== undefined,
    );

    // Exactly the four the W5 ruling names, and no drive-by fifth: `App`'s
    // architectural residue, the two guard-only components, and `TodoItem`'s
    // props boundary. `MainSection` and `Footer` share one sentence because
    // they are one case.
    expect(noted.map((record) => record.id)).toEqual([
      "app/src/app.tsx#TodoItem",
      "app/src/app.tsx#MainSection",
      "app/src/app.tsx#Footer",
      "app/src/app.tsx#App",
    ]);
    for (const record of noted) expect(record.note?.length ?? 0).toBeGreaterThan(80);
    const guardOnly = noted.filter((record) => record.id.endsWith("MainSection") || record.id.endsWith("Footer"));
    expect(guardOnly[0].note).toBe(guardOnly[1].note);
  });

  it("commits a human summary that agrees with the machine one", () => {
    const baseline = readFileSync(BASELINE_MD, "utf8");
    const app = report.segments.app;
    const fixtures = report.segments.fixtures;

    expect(baseline).toContain(`**${app.provable} / ${app.components} components provable`);
    expect(baseline).toContain(`(${fixtures.provable} / ${fixtures.components},`);
    expect(baseline).toContain("There is no combined row.");
  });
});
