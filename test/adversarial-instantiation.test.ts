import { afterEach, describe, expect, it } from "vitest";
import { render } from "@solidjs/web";

import { analyzeFixture } from "../src/comptime/index.ts";
import type { Analysis } from "../src/comptime/types.ts";
import { UnseenHost } from "./fixtures/shapes/LiteralHost.tsx";
import { RecordedLiteralHost } from "./fixtures/shapes/RecordedPropHost.tsx";
import { IdentitySeenLive, IdentityUnseenLive } from "./fixtures/shapes/IdentityPropHost.tsx";
import { AccessorSummaryUnseen } from "./fixtures/shapes/AccessorSummaryHost.tsx";
import { OptionsInitializerUnseen } from "./fixtures/shapes/OptionsInitializerHost.tsx";
import { ElementIndirectionUnseen } from "./fixtures/shapes/ElementIndirectionHost.tsx";
import { RefFanoutUnseen } from "./fixtures/shapes/RefFanoutHost.tsx";

/**
 * THE ADVERSARIAL INSTANTIATION GATE.
 *
 * Spec (kobalte-support T002 RULING 3; ecosystem-ready T002 affirmed
 * gate-before-admission): every admitted shape rule registers two things
 * beside it, and this file is the hard stop that checks them.
 *
 *   1. COUNTER-INSTANTIATION — a first-party fixture that satisfies every
 *      clause EXCEPT ONE. The gate asserts the rule REFUSES it, so the
 *      clauses are load-bearing rather than decorative.
 *
 *   2. SECOND INSTANTIATION — the same admitted shape under props or an
 *      instance count THE BUILD DID NOT SEE. The gate asserts the published
 *      artifact and what `render()` actually produces still agree.
 *
 * Nothing is admitted yet. The demonstration below is by injection: a
 * deliberately unsound stub is registered only inside this file, both
 * clauses fire red on it by named assertion, and removing the stub leaves
 * the gate green. Corpus byte-parity cannot do this work — it is silent on
 * what is new — which is why the gate exists at all.
 *
 * `analyzeFixture(path, { write: false })` is the instrument. The pass is
 * not widened here; no real shape rule is admitted.
 */

const SHAPES = "test/fixtures/shapes";
const HOSTS = `${SHAPES}/LiteralHost.tsx`;

function classify(file: string, component: string): Analysis {
  return analyzeFixture(file, { write: false, component });
}

function codes(analysis: Analysis): Set<string> {
  return analysis.status === "fallback"
    ? new Set(analysis.reasons.map((reason) => reason.code))
    : new Set();
}

/** A clause the rule claims is load-bearing, judged from a real analysis. */
export interface ShapeClause {
  id: string;
  holds: (analysis: Analysis) => boolean;
}

export interface Instantiation {
  path: string;
  component: string;
}

/**
 * One registered shape rule. Future admission slices add an entry; they do
 * not edit the evaluator. A stub may lie in `admits` / `publishedHtml`.
 */
export interface ShapeRuleRegistration {
  id: string;
  clauses: ShapeClause[];
  admits: (analysis: Analysis) => boolean;
  publishedHtml: (analysis: Analysis) => string | null;
  counterInstantiation: Instantiation;
  secondInstantiation: Instantiation & { render: () => unknown };
}

export type GateAssertion =
  | "counter-instantiation"
  | "second-instantiation"
  | "unproven-rule";

export interface GateFailure {
  assertion: GateAssertion;
  rule: string;
  message: string;
}

export interface GateVerdict {
  status: "green" | "red";
  failures: GateFailure[];
}

const disposers: Array<() => void> = [];

function mount(component: () => unknown): HTMLElement {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const dispose = render(component as never, host);
  disposers.push(() => {
    dispose();
    host.remove();
  });
  return host;
}

afterEach(() => {
  while (disposers.length) disposers.pop()!();
});

/**
 * Standing evaluator. An empty registry is green — there is nothing admitted
 * to catch. A rule that cannot name a well-formed counter-instantiation is
 * unproven and fails the same way an unsound admission does.
 */
export function evaluateAdversarialGate(rules: ShapeRuleRegistration[]): GateVerdict {
  const failures: GateFailure[] = [];

  for (const rule of rules) {
    if (rule.clauses.length === 0 || !rule.counterInstantiation) {
      failures.push({
        assertion: "unproven-rule",
        rule: rule.id,
        message: `${rule.id} registered no load-bearing clauses or counter-instantiation`,
      });
      continue;
    }

    const counter = classify(rule.counterInstantiation.path, rule.counterInstantiation.component);
    const failedClauses = rule.clauses.filter((clause) => !clause.holds(counter));

    if (failedClauses.length !== 1) {
      failures.push({
        assertion: "unproven-rule",
        rule: rule.id,
        message:
          `${rule.id} counter-instantiation must fail exactly one clause ` +
          `(failed: ${failedClauses.map((clause) => clause.id).join(",") || "none"})`,
      });
    }

    if (rule.admits(counter)) {
      failures.push({
        assertion: "counter-instantiation",
        rule: rule.id,
        message:
          `${rule.id} admitted ${rule.counterInstantiation.component}, which fails ` +
          `${failedClauses.map((clause) => clause.id).join(",") || "no clause"} — ` +
          `the rule must refuse a fixture that drops one clause`,
      });
    }

    const second = classify(rule.secondInstantiation.path, rule.secondInstantiation.component);
    const published = rule.publishedHtml(second);
    const rendered = mount(rule.secondInstantiation.render).innerHTML;

    if (published !== rendered) {
      failures.push({
        assertion: "second-instantiation",
        rule: rule.id,
        message:
          `${rule.id} published artifact disagrees with render() on a ` +
          `second instantiation the build did not see`,
      });
    }
  }

  return { status: failures.length === 0 ? "green" : "red", failures };
}

function named(verdict: GateVerdict, assertion: GateAssertion): GateFailure | undefined {
  return verdict.failures.find((failure) => failure.assertion === assertion);
}

/** Clauses of the stub's claimed shape — first-party, no library name. */
const STUB_CLAUSES: ShapeClause[] = [
  {
    id: "lowercase-host",
    holds: (analysis) => analysis.status === "provable" || !codes(analysis).has("jsx-component-element"),
  },
  {
    id: "no-spread",
    holds: (analysis) => analysis.status === "provable" || !codes(analysis).has("jsx-spread"),
  },
  {
    id: "static-text-child",
    holds: (analysis) =>
      analysis.status === "provable" || !codes(analysis).has("jsx-dynamic-child-not-derivable"),
  },
];

const seen = classify(HOSTS, "SeenHost");
const SEEN_HTML = seen.status === "provable" ? seen.html : '<p class="seen"><button class="bump">0</button></p>';

/**
 * Deliberately unsound stub, registered only inside this file.
 *
 * It claims every first-party host is admitted, and it republishes the
 * artifact from the instantiation the build saw (`SeenHost`) onto every
 * other instantiation. Clause 1 must catch the admit; clause 2 must catch
 * the republish.
 */
function unsoundStub(): ShapeRuleRegistration {
  return {
    id: "unsound-literal-host-stub",
    clauses: STUB_CLAUSES,
    admits: () => true,
    publishedHtml: () => SEEN_HTML,
    counterInstantiation: { path: HOSTS, component: "SpreadHost" },
    secondInstantiation: { path: HOSTS, component: "UnseenHost", render: UnseenHost },
  };
}

describe("adversarial instantiation gate — injection", () => {
  const verdict = evaluateAdversarialGate([unsoundStub()]);

  it("counter-instantiation: the named assertion fires red on the unsound stub", () => {
    const failure = named(verdict, "counter-instantiation");
    expect(verdict.status, "counter-instantiation").toBe("red");
    expect(
      failure,
      "counter-instantiation: a fixture that fails one clause must be refused",
    ).toBeDefined();
    expect(failure?.rule).toBe("unsound-literal-host-stub");
  });

  it("second-instantiation: the named assertion fires red on the unsound stub", () => {
    const failure = named(verdict, "second-instantiation");
    expect(verdict.status, "second-instantiation").toBe("red");
    expect(
      failure,
      "second-instantiation: published artifact must agree with render()",
    ).toBeDefined();
    expect(failure?.rule).toBe("unsound-literal-host-stub");
  });

  it("the counter-instantiation is well-formed: exactly one clause fails", () => {
    // The demonstration is worthless if the counter is junk. SpreadHost is a
    // lowercase host with a static text child and a spread — only `no-spread`
    // fails, which is the load-bearing clause the stub refuses to honour.
    const counter = classify(HOSTS, "SpreadHost");
    expect(counter.status).toBe("fallback");
    expect([...codes(counter)]).toEqual(["jsx-spread"]);
    expect(STUB_CLAUSES.filter((clause) => !clause.holds(counter)).map((clause) => clause.id)).toEqual([
      "no-spread",
    ]);
  });

  it("the disagreement clause 2 catches is real: render() of the unseen host is not the seen artifact", () => {
    const unseen = classify(HOSTS, "UnseenHost");
    const rendered = mount(UnseenHost).innerHTML;
    expect(unseen.status).toBe("provable");
    if (unseen.status !== "provable") return;
    expect(rendered).toBe(unseen.html);
    expect(rendered).not.toBe(SEEN_HTML);
    expect(SEEN_HTML).toBe('<p class="seen"><button class="bump">0</button></p>');
    expect(rendered).toBe('<p class="unseen"><button class="bump">0</button></p>');
  });
});

describe("adversarial instantiation gate — stub removed", () => {
  it("is green when no unsound stub is registered", () => {
    const verdict = evaluateAdversarialGate([]);
    expect(verdict.status).toBe("green");
    expect(verdict.failures).toEqual([]);
  });

  it("writes nothing while deciding", () => {
    const analysis = classify(HOSTS, "SpreadHost");
    expect(analysis.status).toBe("fallback");
    expect("emitted" in analysis).toBe(false);
  });
});

const RECORDED_HOSTS = `${SHAPES}/RecordedPropHost.tsx`;

/** Clauses of the recorded-const-prop shape — first-party, no library name. */
const RECORDED_PROP_CLAUSES: ShapeClause[] = [
  {
    id: "build-constant",
    holds: (analysis) => analysis.status === "provable" || !codes(analysis).has("jsx-component-element"),
  },
  {
    id: "no-spread",
    holds: (analysis) => analysis.status === "provable" || !codes(analysis).has("jsx-spread"),
  },
];

function recordedConstPropRule(): ShapeRuleRegistration {
  return {
    id: "addressed-child-recorded-const-prop",
    clauses: RECORDED_PROP_CLAUSES,
    admits: (analysis) =>
      analysis.status === "provable" &&
      analysis.claimedChildren.some((child) => (child.recordedProps?.length ?? 0) > 0),
    publishedHtml: (analysis) => {
      if (analysis.status !== "provable") return null;
      const claimed = analysis.claimedChildren[0];
      if (claimed == null) return null;
      const child = analyzeFixture(claimed.module, {
        write: false,
        component: claimed.component,
        recordedProps: claimed.recordedProps,
      });
      return child.status === "provable" ? child.html : null;
    },
    counterInstantiation: { path: RECORDED_HOSTS, component: "RecordedPropHost" },
    secondInstantiation: {
      path: RECORDED_HOSTS,
      component: "RecordedLiteralHost",
      render: RecordedLiteralHost,
    },
  };
}

describe("adversarial instantiation gate — addressed-child-recorded-const-prop", () => {
  it("is green when the rule is registered honestly", () => {
    const verdict = evaluateAdversarialGate([recordedConstPropRule()]);
    expect(verdict.status).toBe("green");
    expect(verdict.failures).toEqual([]);
  });

  it("counter-instantiation fires red if the rule admits the signal-getter host", () => {
    const lying: ShapeRuleRegistration = { ...recordedConstPropRule(), admits: () => true };
    const verdict = evaluateAdversarialGate([lying]);
    expect(verdict.status).toBe("red");
    expect(named(verdict, "counter-instantiation")?.rule).toBe("addressed-child-recorded-const-prop");
  });

  it("second-instantiation fires red if the rule republishes the hole", () => {
    const lying: ShapeRuleRegistration = {
      ...recordedConstPropRule(),
      publishedHtml: (analysis) => (analysis.status === "provable" ? analysis.html : null),
    };
    const verdict = evaluateAdversarialGate([lying]);
    expect(verdict.status).toBe("red");
    expect(named(verdict, "second-instantiation")?.rule).toBe("addressed-child-recorded-const-prop");
  });

  it("the counter-instantiation fails exactly the build-constant clause", () => {
    const counter = classify(RECORDED_HOSTS, "RecordedPropHost");
    expect(counter.status).toBe("fallback");
    expect(codes(counter).has("jsx-component-element")).toBe(true);
    expect(RECORDED_PROP_CLAUSES.filter((clause) => !clause.holds(counter)).map((clause) => clause.id)).toEqual([
      "build-constant",
    ]);
  });
});

const IDENTITY_HOSTS = `${SHAPES}/IdentityPropHost.tsx`;

/** Clauses of the identity-prop shape — first-party, no library name. */
const IDENTITY_PROP_CLAUSES: ShapeClause[] = [
  {
    id: "identity-class",
    holds: (analysis) => analysis.status === "provable" || !codes(analysis).has("jsx-component-element"),
  },
  {
    id: "no-spread",
    holds: (analysis) => analysis.status === "provable" || !codes(analysis).has("jsx-spread"),
  },
];

function measureIdentityPairing(render: () => unknown): string {
  const host = mount(render);
  const child = host.querySelector(".identity");
  return child?.outerHTML ?? host.innerHTML;
}

function identityPropRule(): ShapeRuleRegistration {
  return {
    id: "addressed-child-identity-prop",
    clauses: IDENTITY_PROP_CLAUSES,
    admits: (analysis) =>
      analysis.status === "provable" &&
      analysis.claimedChildren.some((child) => (child.identityProps?.length ?? 0) > 0),
    publishedHtml: (analysis) => {
      if (analysis.status !== "provable") return null;
      return measureIdentityPairing(IdentityUnseenLive);
    },
    counterInstantiation: { path: IDENTITY_HOSTS, component: "IdentityPropHost" },
    secondInstantiation: {
      path: IDENTITY_HOSTS,
      component: "IdentityForwardHost",
      render: IdentityUnseenLive,
    },
  };
}

describe("adversarial instantiation gate — addressed-child-identity-prop", () => {
  it("is green when the rule is registered honestly", () => {
    const verdict = evaluateAdversarialGate([identityPropRule()]);
    expect(verdict.status).toBe("green");
    expect(verdict.failures).toEqual([]);
  });

  it("counter-instantiation fires red if the rule admits the signal-getter host", () => {
    const lying: ShapeRuleRegistration = { ...identityPropRule(), admits: () => true };
    const verdict = evaluateAdversarialGate([lying]);
    expect(verdict.status).toBe("red");
    expect(named(verdict, "counter-instantiation")?.rule).toBe("addressed-child-identity-prop");
  });

  it("second-instantiation fires red if the rule republishes the first instantiation's measured bytes", () => {
    const first = measureIdentityPairing(IdentitySeenLive);
    const lying: ShapeRuleRegistration = {
      ...identityPropRule(),
      publishedHtml: () => first,
    };
    const verdict = evaluateAdversarialGate([lying]);
    expect(verdict.status).toBe("red");
    expect(named(verdict, "second-instantiation")?.rule).toBe("addressed-child-identity-prop");
  });

  it("the counter-instantiation fails exactly the identity-class clause", () => {
    const counter = classify(IDENTITY_HOSTS, "IdentityPropHost");
    expect(counter.status).toBe("fallback");
    expect(codes(counter).has("jsx-component-element")).toBe(true);
    expect(IDENTITY_PROP_CLAUSES.filter((clause) => !clause.holds(counter)).map((clause) => clause.id)).toEqual([
      "identity-class",
    ]);
  });

  it("value-recording of the same identity-class cargo stays refused", () => {
    const honest = identityPropRule();
    const parent = classify(IDENTITY_HOSTS, "IdentityForwardHost");
    expect(parent.status).toBe("provable");
    if (parent.status !== "provable") return;
    expect(parent.claimedChildren[0].recordedProps).toBeUndefined();
    expect((parent.claimedChildren[0].identityProps?.length ?? 0) > 0).toBe(true);
    expect(recordedConstPropRule().admits(parent)).toBe(false);
    expect(honest.admits(parent)).toBe(true);
    expect(JSON.stringify(parent.claimedChildren[0].identityProps)).not.toContain("unseen-runtime-cargo");
    expect(JSON.stringify(parent.claimedChildren[0].identityProps)).not.toContain("seen-runtime-cargo");
  });
});

const ACCESSOR_HOSTS = `${SHAPES}/AccessorSummaryHost.tsx`;

/** Clauses of the derived-accessor callee shape — first-party, no library name. */
const DERIVED_ACCESSOR_CLAUSES: ShapeClause[] = [
  {
    id: "derived-accessor-callee",
    holds: (analysis) =>
      analysis.status === "provable" ||
      (!codes(analysis).has("signal-escapes-unanalyzable-use") &&
        !codes(analysis).has("signal-escapes-to-opaque-callee")),
  },
  {
    id: "no-spread",
    holds: (analysis) => analysis.status === "provable" || !codes(analysis).has("jsx-spread"),
  },
];

function derivedAccessorRule(): ShapeRuleRegistration {
  return {
    id: "derived-accessor-callee",
    clauses: DERIVED_ACCESSOR_CLAUSES,
    admits: (analysis) => analysis.status === "provable",
    publishedHtml: (analysis) => (analysis.status === "provable" ? analysis.html : null),
    counterInstantiation: { path: ACCESSOR_HOSTS, component: "AccessorSummaryHost" },
    secondInstantiation: {
      path: ACCESSOR_HOSTS,
      component: "AccessorSummaryUnseen",
      render: AccessorSummaryUnseen,
    },
  };
}

describe("adversarial instantiation gate — derived-accessor-callee", () => {
  it("is green when the rule is registered honestly", () => {
    const verdict = evaluateAdversarialGate([derivedAccessorRule()]);
    expect(verdict.status).toBe("green");
    expect(verdict.failures).toEqual([]);
  });

  it("counter-instantiation fires red if the rule admits the write-through host", () => {
    const lying: ShapeRuleRegistration = { ...derivedAccessorRule(), admits: () => true };
    const verdict = evaluateAdversarialGate([lying]);
    expect(verdict.status).toBe("red");
    expect(named(verdict, "counter-instantiation")?.rule).toBe("derived-accessor-callee");
  });

  it("second-instantiation fires red if the rule republishes the first instantiation's bytes", () => {
    const first = classify(ACCESSOR_HOSTS, "AccessorSummarySeen");
    const lying: ShapeRuleRegistration = {
      ...derivedAccessorRule(),
      publishedHtml: () => (first.status === "provable" ? first.html : "<p class=\"seen\"></p>"),
    };
    const verdict = evaluateAdversarialGate([lying]);
    expect(verdict.status).toBe("red");
    expect(named(verdict, "second-instantiation")?.rule).toBe("derived-accessor-callee");
  });

  it("the counter-instantiation fails exactly the derived-accessor-callee clause", () => {
    const counter = classify(ACCESSOR_HOSTS, "AccessorSummaryHost");
    expect(counter.status).toBe("fallback");
    expect(
      codes(counter).has("signal-escapes-unanalyzable-use") || codes(counter).has("signal-escapes-to-opaque-callee"),
    ).toBe(true);
    expect(DERIVED_ACCESSOR_CLAUSES.filter((clause) => !clause.holds(counter)).map((clause) => clause.id)).toEqual([
      "derived-accessor-callee",
    ]);
  });
});

const OPTIONS_HOSTS = `${SHAPES}/OptionsInitializerHost.tsx`;

/** Clauses of the literal-options initializer shape — first-party, no library name. */
const LITERAL_OPTIONS_CLAUSES: ShapeClause[] = [
  {
    id: "literal-options",
    holds: (analysis) => analysis.status === "provable" || !codes(analysis).has("signal-initializer-not-literal"),
  },
  {
    id: "no-spread",
    holds: (analysis) => analysis.status === "provable" || !codes(analysis).has("jsx-spread"),
  },
];

function literalOptionsRule(): ShapeRuleRegistration {
  return {
    id: "literal-options-initializer",
    clauses: LITERAL_OPTIONS_CLAUSES,
    admits: (analysis) => analysis.status === "provable",
    publishedHtml: (analysis) => (analysis.status === "provable" ? analysis.html : null),
    counterInstantiation: { path: OPTIONS_HOSTS, component: "OptionsInitializerHost" },
    secondInstantiation: {
      path: OPTIONS_HOSTS,
      component: "OptionsInitializerUnseen",
      render: OptionsInitializerUnseen,
    },
  };
}

describe("adversarial instantiation gate — literal-options-initializer", () => {
  it("is green when the rule is registered honestly", () => {
    const verdict = evaluateAdversarialGate([literalOptionsRule()]);
    expect(verdict.status).toBe("green");
    expect(verdict.failures).toEqual([]);
  });

  it("counter-instantiation fires red if the rule admits the computed-options host", () => {
    const lying: ShapeRuleRegistration = { ...literalOptionsRule(), admits: () => true };
    const verdict = evaluateAdversarialGate([lying]);
    expect(verdict.status).toBe("red");
    expect(named(verdict, "counter-instantiation")?.rule).toBe("literal-options-initializer");
  });

  it("second-instantiation fires red if the rule republishes the first instantiation's bytes", () => {
    const first = classify(OPTIONS_HOSTS, "OptionsInitializerSeen");
    const lying: ShapeRuleRegistration = {
      ...literalOptionsRule(),
      publishedHtml: () => (first.status === "provable" ? first.html : "<p class=\"seen\"></p>"),
    };
    const verdict = evaluateAdversarialGate([lying]);
    expect(verdict.status).toBe("red");
    expect(named(verdict, "second-instantiation")?.rule).toBe("literal-options-initializer");
  });

  it("the counter-instantiation fails exactly the literal-options clause", () => {
    const counter = classify(OPTIONS_HOSTS, "OptionsInitializerHost");
    expect(counter.status).toBe("fallback");
    expect(codes(counter).has("signal-initializer-not-literal")).toBe(true);
    expect(LITERAL_OPTIONS_CLAUSES.filter((clause) => !clause.holds(counter)).map((clause) => clause.id)).toEqual([
      "literal-options",
    ]);
  });
});

const INDIRECTION_HOSTS = `${SHAPES}/ElementIndirectionHost.tsx`;
const INDIRECTION_COUNTER = `${SHAPES}/ElementIndirectionCounter.tsx`;

/** Clauses of the element-indirection fold — first-party, no library name. */
const ELEMENT_INDIRECTION_CLAUSES: ShapeClause[] = [
  {
    id: "literal-intrinsic-tag",
    holds: (analysis) => analysis.status === "provable" || !codes(analysis).has("jsx-component-element"),
  },
  {
    id: "no-spread",
    holds: (analysis) => analysis.status === "provable" || !codes(analysis).has("jsx-spread"),
  },
];

function elementIndirectionRule(): ShapeRuleRegistration {
  return {
    id: "element-indirection-fold",
    clauses: ELEMENT_INDIRECTION_CLAUSES,
    admits: (analysis) => analysis.status === "provable",
    publishedHtml: (analysis) => (analysis.status === "provable" ? analysis.html : null),
    counterInstantiation: { path: INDIRECTION_COUNTER, component: "ElementIndirectionCounter" },
    secondInstantiation: {
      path: INDIRECTION_HOSTS,
      component: "ElementIndirectionUnseen",
      render: ElementIndirectionUnseen,
    },
  };
}

describe("adversarial instantiation gate — element-indirection-fold", () => {
  it("is green when the rule is registered honestly", () => {
    const verdict = evaluateAdversarialGate([elementIndirectionRule()]);
    expect(verdict.status).toBe("green");
    expect(verdict.failures).toEqual([]);
  });

  it("counter-instantiation fires red if the rule admits the caller-variable tag", () => {
    const lying: ShapeRuleRegistration = { ...elementIndirectionRule(), admits: () => true };
    const verdict = evaluateAdversarialGate([lying]);
    expect(verdict.status).toBe("red");
    expect(named(verdict, "counter-instantiation")?.rule).toBe("element-indirection-fold");
  });

  it("second-instantiation fires red if the rule republishes the first instantiation's bytes", () => {
    const first = classify(INDIRECTION_HOSTS, "ElementIndirectionHost");
    const lying: ShapeRuleRegistration = {
      ...elementIndirectionRule(),
      publishedHtml: () => (first.status === "provable" ? first.html : '<p class="host"><hr class="folded"></p>'),
    };
    const verdict = evaluateAdversarialGate([lying]);
    expect(verdict.status).toBe("red");
    expect(named(verdict, "second-instantiation")?.rule).toBe("element-indirection-fold");
  });

  it("the counter-instantiation fails exactly the literal-intrinsic-tag clause", () => {
    const counter = classify(INDIRECTION_COUNTER, "ElementIndirectionCounter");
    expect(counter.status).toBe("fallback");
    expect(codes(counter).has("jsx-component-element")).toBe(true);
    expect(
      ELEMENT_INDIRECTION_CLAUSES.filter((clause) => !clause.holds(counter)).map((clause) => clause.id),
    ).toEqual(["literal-intrinsic-tag"]);
  });
});

const REF_FANOUT_HOSTS = `${SHAPES}/RefFanoutHost.tsx`;
const REF_FANOUT_COUNTER = `${SHAPES}/RefFanoutCounter.tsx`;

/** Clauses of the array-ref wiring admission — first-party, no library name. */
const ARRAY_REF_CLAUSES: ShapeClause[] = [
  {
    id: "admitted-array-elements",
    holds: (analysis) => analysis.status === "provable" || !codes(analysis).has("jsx-dynamic-attribute"),
  },
  {
    id: "no-spread",
    holds: (analysis) => analysis.status === "provable" || !codes(analysis).has("jsx-spread"),
  },
];

function arrayRefWiringRule(): ShapeRuleRegistration {
  return {
    id: "array-ref-wiring",
    clauses: ARRAY_REF_CLAUSES,
    admits: (analysis) =>
      analysis.status === "provable" &&
      analysis.bindings.some((binding) => binding.kind === "attribute" && binding.attribute === "ref"),
    publishedHtml: (analysis) => (analysis.status === "provable" ? analysis.html : null),
    counterInstantiation: { path: REF_FANOUT_COUNTER, component: "RefFanoutCounter" },
    secondInstantiation: {
      path: REF_FANOUT_HOSTS,
      component: "RefFanoutUnseen",
      render: RefFanoutUnseen,
    },
  };
}

describe("adversarial instantiation gate — array-ref-wiring", () => {
  it("is green when the rule is registered honestly", () => {
    const verdict = evaluateAdversarialGate([arrayRefWiringRule()]);
    expect(verdict.status).toBe("green");
    expect(verdict.failures).toEqual([]);
  });

  it("counter-instantiation fires red if the rule admits the local-function array", () => {
    const lying: ShapeRuleRegistration = { ...arrayRefWiringRule(), admits: () => true };
    const verdict = evaluateAdversarialGate([lying]);
    expect(verdict.status).toBe("red");
    expect(named(verdict, "counter-instantiation")?.rule).toBe("array-ref-wiring");
  });

  it("second-instantiation fires red if the rule republishes the first instantiation's bytes", () => {
    const first = classify(REF_FANOUT_HOSTS, "RefFanoutHost");
    const lying: ShapeRuleRegistration = {
      ...arrayRefWiringRule(),
      publishedHtml: () => (first.status === "provable" ? first.html : '<p class="fanout">seen</p>'),
    };
    const verdict = evaluateAdversarialGate([lying]);
    expect(verdict.status).toBe("red");
    expect(named(verdict, "second-instantiation")?.rule).toBe("array-ref-wiring");
  });

  it("the counter-instantiation fails exactly the admitted-array-elements clause", () => {
    const counter = classify(REF_FANOUT_COUNTER, "RefFanoutCounter");
    expect(counter.status).toBe("fallback");
    expect(codes(counter).has("jsx-dynamic-attribute")).toBe(true);
    expect(
      ARRAY_REF_CLAUSES.filter((clause) => !clause.holds(counter)).map((clause) => clause.id),
    ).toEqual(["admitted-array-elements"]);
  });
});
