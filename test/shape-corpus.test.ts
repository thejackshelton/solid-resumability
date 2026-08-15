import { describe, expect, it } from "vitest";

import { Analyzer } from "yuku-analyzer";

import { analyzeFixture, classify, loadProject } from "../src/comptime/index.ts";
import type { Analysis, ReasonCode } from "../src/comptime/types.ts";

/**
 * THE SHAPE CORPUS — the re-runnable half of `docs/kobalte/impossibility.md`.
 *
 * The account it belongs to answers one question: why can a real third-party
 * component library not be proved by this pass? An answer assembled out of that
 * library's files would be a report about someone else's code, and it would age
 * the moment they refactored. So every claim in the account is made about a
 * shape reproduced HERE, in this repo's own source, under `test/fixtures/shapes`
 * — six blocking shapes and two controls, each one first-party, each one naming
 * nothing.
 *
 * What this file adds is the part a document cannot have: a reader can run it.
 * Every refusal below is `analyzeFixture(path, { write: false })` classifying a
 * file on disk with zero filesystem writes, so the codes asserted here are the
 * pass's own verdicts rather than the account's paraphrase of them.
 *
 * THE CONTROLS ARE THE POINT OF THE EXERCISE. A corpus in which everything
 * refuses proves nothing at all — it is consistent with a pass that refuses
 * everything. Three assertions here are about a DIFFERENT outcome from an
 * almost-identical input: a one-hop literal that folds where the two-hop one
 * refuses, a context read the pass sees where the wrapped one is invisible, and
 * a guard whose module IS in the analyzed set and is refused anyway. Each of
 * them fixes the size of a claim, and the third one is what keeps a terminal
 * verdict from resting on an accident of the file walk.
 */

const SHAPES = "test/fixtures/shapes";

/** The pass's verdict on one component of one fixture, written nowhere. */
function shape(file: string, component: string): Analysis {
  return analyzeFixture(`${SHAPES}/${file}`, { write: false, component });
}

/** The refusal codes a component earned, deduplicated and sorted. */
function codes(analysis: Analysis): ReasonCode[] {
  return [...new Set(analysis.reasons.map((reason) => reason.code))].sort();
}

describe("S1 — a host tag that arrives as a prop", () => {
  const analysis = shape("PropTaggedHost.tsx", "PropTaggedHost");

  it("refuses the call site as a nested component, and nothing else", () => {
    // `classify.ts:875-879`. The ladder ran out: `tryShowRegion` declines a
    // component that is not `<Show>`, `tryInlineComponent` declines because the
    // child's root is itself a component element (`inlinableChild`,
    // `classify.ts:2929-2931` — the root must be lowercase), and
    // `tryAddressChild` declines at the BARE clause, `classify.ts:2060`, because
    // the element carries attributes. One code, because the parent has a real
    // cell and a real derivable readout beside the refused element.
    expect(analysis.status).toBe("fallback");
    expect(codes(analysis)).toEqual(["jsx-component-element"]);
  });

  it("never audits the attributes that would decide the host tag", () => {
    // The `tag="p"` literal and the spread after it are PROPS, not rendered
    // attributes, so the walk does not look at them (`classify.ts:880-882`).
    // That is the whole shape in one fact: the tag the element will actually
    // carry is settled by a merge the pass does not model, and the literal in
    // the AST is a default rather than an answer.
    expect(codes(analysis)).not.toContain("jsx-spread");
    expect(analysis.reasons).toHaveLength(1);
  });

  it("refuses the indirection in its own right, for reasons of its own", () => {
    // Classified alone, the tagged box is refused three times over: it declares
    // no source, its root is a framework component outside the analyzed set, and
    // its text child is a prop no frame of its own can resolve. None of these is
    // the caller's problem, and none of them is fixable from the call site.
    expect(codes(shape("PropTaggedHost.tsx", "TaggedBox"))).toEqual([
      "jsx-component-element",
      "jsx-dynamic-child-not-derivable",
      "no-signal-source",
    ]);
  });
});

describe("S2 — a spread that follows an attribute", () => {
  const analysis = shape("SpreadAfterAttribute.tsx", "SpreadAfterAttribute");

  it("refuses the attribute list whole, at the spread", () => {
    // `classify.ts:890-891`, on an ORDINARY INTRINSIC ELEMENT. There is no
    // indirection here and no framework component: the pass has no machinery for
    // a spread at all, and the refusal is unconditional rather than the result of
    // an analysis that came back inconclusive.
    expect(analysis.status).toBe("fallback");
    expect(codes(analysis)).toEqual(["jsx-spread"]);
  });

  it("locates the refusal at the spread and not at the literal before it", () => {
    const [reason] = analysis.reasons;
    expect(reason.code).toBe("jsx-spread");
    // The `id="a"` on the same element is never contested; what the pass will
    // not do is claim the element's props ARE the ones it can see.
    expect(analysis.reasons).toHaveLength(1);
  });
});

describe("S3 — a literal two props hops away, and the one-hop control", () => {
  const analysis = shape("TwoHopLiteral.tsx", "TwoHopLiteral");

  it("refuses the middle element as a nested component", () => {
    expect(analysis.status).toBe("fallback");
    expect(codes(analysis)).toEqual(["jsx-component-element"]);
  });

  it("fails at the capture clause, one gate EARLIER than the one-hop rule", () => {
    // The reason worth recording precisely. `tryInlineComponent`'s own one-hop
    // guard is `classify.ts:1954` — it returns null inside a child's frame — but
    // that is not what fires here. `inlinableChild` rejects the middle component
    // before any frame is opened, at `classify.ts:2904`, because NAMING A
    // COMPONENT CAPTURES ITS BINDING. Measured rather than inferred: the middle
    // component captures exactly one symbol, the leaf, and the leaf captures
    // none.
    const project = loadProject(
      `${process.cwd()}/${SHAPES}/TwoHopLiteral.tsx`,
      process.cwd(),
    );
    const module = project.entry;
    const captures = Object.fromEntries(
      module
        .findAll("FunctionDeclaration")
        .map((fn) => [String(fn.id?.name), module.capturesOf(fn).length]),
    );
    expect(captures).toEqual({ Leaf: 0, Middle: 1, TwoHopLiteral: 2 });
  });

  it("FOLDS THE SAME LITERAL AT ONE HOP — the control that makes this contingent", () => {
    // The same leaf, the same literal, the same call site, with the middle hop
    // removed and nothing else changed. It is provable, and the literal is in the
    // served bytes. So the evidence a second hop would need is not missing from
    // the AST: what is missing is machinery, and this assertion is the difference
    // between "the pass cannot know" and "the pass does not carry".
    const analyzer = new Analyzer();
    const module = analyzer.addFile(
      "one-hop.tsx",
      `import { createSignal } from "solid-js";
function Leaf(props: { text: string }) {
  return <span class="leaf">{props.text}</span>;
}
export function OneHop() {
  const [count, setCount] = createSignal(0);
  return (
    <section class="two-hop">
      <Leaf text="settled" />
      <button class="bump" onClick={() => setCount(count() + 1)}>{count()}</button>
    </section>
  );
}`,
    );
    analyzer.link();

    const folded = classify(module, "OneHop");
    expect(folded.status).toBe("provable");
    if (folded.status !== "provable") return;
    expect(folded.html).toBe(
      '<section class="two-hop"><span class="leaf">settled</span><button class="bump">0</button></section>',
    );
  });
});

describe("S4 — caller-supplied markup in a lone text position", () => {
  const analysis = shape("OpaqueChildrenSlot.tsx", "OpaqueChildrenSlot");

  it("refuses the text child as not derivable", () => {
    // `collectTextBinding`, `classify.ts:1600-1604`. The component's own frame
    // has `props === null` by construction, so `propBindingOf` returns null at
    // `classify.ts:1931` and the derivation walk has nothing to fold.
    expect(analysis.status).toBe("fallback");
    expect(codes(analysis)).toEqual(["jsx-dynamic-child-not-derivable"]);
  });

  it("keeps a component that HAD something to prove, so the refusal is the slot", () => {
    // The button beside the slot is an ordinary cell readout the pass folds
    // everywhere else in the corpus. Only one reason is recorded, and it is the
    // slot's — a fixture whose markup refused twice would not isolate anything.
    expect(analysis.reasons).toHaveLength(1);
    expect(analysis.reasons[0].code).toBe("jsx-dynamic-child-not-derivable");
  });
});

describe("S5 — a leaf whose state arrives from a provider, and the direct control", () => {
  const analysis = shape("ContextOnlyLeaf.tsx", "ContextOnlyLeaf");

  it("refuses it for declaring no source at all", () => {
    // `classify.ts:596-597`, gated on `signalCalls.length === 0 &&
    // contextCalls.length === 0`. `useContextCalls` (`stores.ts:136-142`) looks
    // for a call to a `useContext` IMPORTED FROM SOLID IN THIS MODULE; the leaf
    // imports a local wrapper instead, so the search is empty and the component
    // reads as stateless.
    expect(analysis.status).toBe("fallback");
    expect(codes(analysis)).toEqual(["no-signal-source"]);
  });

  it("changes code entirely once the wrapper is removed — the wrapper is load-bearing", () => {
    // The control. Same context, same handle, same static markup, `useContext`
    // called directly. `no-signal-source` does NOT fire, because the pass can now
    // see a declared source; the refusal moves to the SHAPE of the binding.
    // Which fixes the size of the S5 claim: the wrapper hides a source that
    // exists, and it is not what makes the shape unprovable.
    const control = shape("DirectContextLeaf.tsx", "DirectContextLeaf");
    expect(control.status).toBe("fallback");
    expect(codes(control)).toEqual(["store-binding-not-provable"]);
    expect(codes(control)).not.toContain("no-signal-source");
  });
});

describe("S6 — a region guard that is someone else's accessor", () => {
  const analysis = shape("ForeignGuard.tsx", "ForeignGuard");

  it("refuses the region because the guard neither folds nor measures", () => {
    // `tryShowRegion`'s `refuseGuard`, `classify.ts:1233`. `deriveCondition`
    // returned null: the call is not a cell read, and `deriveThroughFormatter`
    // (`classify.ts:1890-1892`) got nothing from `summarize`.
    expect(analysis.status).toBe("fallback");
    expect(codes(analysis)).toEqual(["show-branch-not-static-at-capture"]);
  });

  it("walks the re-export barrel so the module behind it is in the analyzed set", () => {
    // FLIP (C0 / T029). The walk used to queue a module's IMPORTS only, and a
    // bare `export * from` is an export record, so this assertion encoded the
    // gap: the barrel was analyzed and the module behind it was not. That is
    // the same edge erratum E1 recorded for the measured source arm. The rule
    // is now: a relative specifier on an export record is a module edge, the
    // same as a relative import. The analyzed set therefore contains the
    // module behind the barrel. The verdict in the test above does not move —
    // the LinkedGuard control already proved the refusal is the accessor body,
    // not the file-set edge.
    const project = loadProject(`${process.cwd()}/${SHAPES}/ForeignGuard.tsx`, process.cwd());
    expect([...project.modules.keys()].sort()).toEqual([
      `${SHAPES}/ForeignGuard.tsx`,
      `${SHAPES}/gate/ambient.ts`,
      `${SHAPES}/gate/index.ts`,
    ]);
  });

  it("REFUSES THE SAME GUARD WITH THE MODULE IN THE ANALYZED SET — the control", () => {
    // The assertion that keeps the terminal claim honest. This control imports
    // the accessor's module directly, so the walk queues it and the definition
    // resolves; the verdict does not move. `summarize` still declines, now at
    // clause (3), `summaries.ts:171`: the accessor reads module-scope mutable
    // state, so it captures. The re-export walk above closed the file-set edge
    // and, as this control required, changed nothing here.
    const control = shape("LinkedGuard.tsx", "LinkedGuard");
    expect(control.status).toBe("fallback");
    expect(codes(control)).toEqual(["show-branch-not-static-at-capture"]);

    const project = loadProject(`${process.cwd()}/${SHAPES}/LinkedGuard.tsx`, process.cwd());
    expect([...project.modules.keys()].sort()).toEqual([
      `${SHAPES}/LinkedGuard.tsx`,
      `${SHAPES}/gate/ambient.ts`,
    ]);
  });
});

describe("S7 — a component whose root is a provider element", () => {
  const analysis = shape("ProviderElementRoot.tsx", "ProviderElementRoot");

  it("refuses the provider element as a nested component", () => {
    // `classify.ts:875-879` again, and this time nothing about the shape is
    // undecidable: the element renders no host of its own and hands its children
    // through, which is the property `<Show>` already trades on. The pass has no
    // general rule for it, so the static markup underneath never reaches a
    // template.
    expect(analysis.status).toBe("fallback");
    expect(codes(analysis)).toEqual(["jsx-component-element"]);
  });

  it("does not refuse the state the provider carries", () => {
    // Worth stating on its own. The provided value is a live cell read, and it
    // escapes nowhere: `count()` in the `value` position is a nullary call on the
    // accessor, which the escape audit admits. So exactly one thing stands
    // between this component and a verdict, and it is the element.
    expect(analysis.reasons).toHaveLength(1);
    expect(codes(analysis)).not.toContain("signal-escapes-unanalyzable-use");
    expect(codes(analysis)).not.toContain("signal-escapes-to-opaque-callee");
  });
});

describe("the four-shape conjunction — folded measured intrinsic", () => {
  const host = shape("FoldedMeasuredHost.tsx", "FoldedMeasuredHost");
  const unseen = shape("FoldedMeasuredHost.tsx", "FoldedMeasuredUnseen");
  const counter = shape("FoldedMeasuredCounter.tsx", "FoldedMeasuredCounter");

  it("classifies the standalone host as provable, folding to a bare intrinsic", () => {
    expect(host.status).toBe("provable");
    if (host.status !== "provable") return;
    expect(host.html).toBe("<hr>");
    expect(host.reasons).toEqual([]);
  });

  it("carries all four sub-shapes on that one component", () => {
    expect(host.status).toBe("provable");
    if (host.status !== "provable") return;
    expect(host.bindings.some((binding) => binding.kind === "attribute" && binding.attribute === "ref")).toBe(
      true,
    );
    expect(
      host.bindings.some(
        (binding) =>
          binding.kind === "attribute" &&
          binding.attribute === "role" &&
          binding.initialValue === null &&
          binding.initialValueFrom === "capture",
      ),
    ).toBe(true);
    expect(
      host.bindings.some(
        (binding) =>
          binding.kind === "attribute" &&
          binding.attribute === "aria-orientation" &&
          binding.initialValue === null,
      ),
    ).toBe(true);
    expect(host.bindings.some((binding) => binding.kind === "spread")).toBe(true);
  });

  it("classifies the unseen pairing the same way — both analyzeFixture arms", () => {
    expect(unseen.status).toBe("provable");
    if (unseen.status !== "provable") return;
    expect(unseen.html).toBe("<hr>");
    expect(unseen.bindings.some((binding) => binding.kind === "spread")).toBe(true);
    expect(unseen.bindings.some((binding) => binding.kind === "attribute" && binding.attribute === "ref")).toBe(
      true,
    );
  });

  it("refuses the call-valued spread counter, and only that", () => {
    expect(counter.status).toBe("fallback");
    expect(codes(counter)).toEqual(["jsx-spread"]);
  });
});

describe("the corpus as a whole", () => {
  it("refuses every shape, and refuses each for a different reason", () => {
    // The account's own claim, asserted as one fact. Six shapes, six codes, no
    // two the same — which is what makes this a discrimination rather than a
    // pass that says no to everything. `jsx-component-element` appears twice on
    // purpose: it is the code on all twelve pre-registered functions, and the two
    // fixtures that earn it here are the two ends of the account, one terminal
    // and one contingent.
    const rows = [
      ["PropTaggedHost.tsx", "PropTaggedHost", "jsx-component-element"],
      ["SpreadAfterAttribute.tsx", "SpreadAfterAttribute", "jsx-spread"],
      ["TwoHopLiteral.tsx", "TwoHopLiteral", "jsx-component-element"],
      ["OpaqueChildrenSlot.tsx", "OpaqueChildrenSlot", "jsx-dynamic-child-not-derivable"],
      ["ContextOnlyLeaf.tsx", "ContextOnlyLeaf", "no-signal-source"],
      ["ForeignGuard.tsx", "ForeignGuard", "show-branch-not-static-at-capture"],
      ["ProviderElementRoot.tsx", "ProviderElementRoot", "jsx-component-element"],
    ] as const;

    for (const [file, component, expected] of rows) {
      const analysis = shape(file, component);
      expect(analysis.status, `${component} must refuse`).toBe("fallback");
      expect(codes(analysis), `${component} earns exactly its own code`).toEqual([expected]);
    }

    expect(new Set(rows.map((row) => row[2])).size).toBe(5);
  });

  it("writes nothing while proving it", () => {
    // `analyzeFixture` reads sources and classifies; `runComptime` is what emits,
    // and it is never called here. The account therefore costs zero bytes on
    // every page in this repo, which is why it could be produced at all under a
    // budget with 1,834 B of headroom.
    const analysis = shape("SpreadAfterAttribute.tsx", "SpreadAfterAttribute");
    expect(analysis.status).toBe("fallback");
    expect("emitted" in analysis).toBe(false);
  });
});
