import { describe, expect, it } from "vitest";

import { analyzeFixture } from "../src/comptime/index.ts";
import type { Analysis, FallbackAnalysis, Reason } from "../src/comptime/types.ts";

/**
 * The unmask instrument: a default-off diagnostic that runs the classifier's
 * own attribute audit on a refused component element and records the codes
 * that walk would emit, without moving the verdict or the published reasons.
 *
 * PropTaggedHost is the existing S1 shape: one nested component element whose
 * opening carries a literal, a call-valued spread, and another literal. Flag
 * OFF the corpus already asserts those attributes are not audited into the
 * verdict. Flag ON must emit them as diagnostics only.
 */

const HOST = "test/fixtures/shapes/PropTaggedHost.tsx";
const SPREAD = "test/fixtures/shapes/SpreadAfterAttribute.tsx";

function classify(file: string, component: string, unmaskAttributeAudit?: boolean): Analysis {
  return analyzeFixture(file, {
    write: false,
    component,
    ...(unmaskAttributeAudit === undefined ? {} : { unmaskAttributeAudit }),
  });
}

function fallback(analysis: Analysis): FallbackAnalysis {
  if (analysis.status !== "fallback") throw new Error(`expected fallback, got ${analysis.status}`);
  return analysis;
}

function codes(reasons: Reason[]): string[] {
  return reasons.map((reason) => reason.code);
}

describe("unmask instrument — flag OFF is the default and is inert", () => {
  const omitted = fallback(classify(HOST, "PropTaggedHost"));
  const explicit = fallback(classify(HOST, "PropTaggedHost", false));

  it("omitting the flag and passing false are the same verdict and reasons", () => {
    expect(omitted.status).toBe("fallback");
    expect(explicit.status).toBe("fallback");
    expect(omitted.reasons).toEqual(explicit.reasons);
    expect(codes(omitted.reasons)).toEqual(["jsx-component-element"]);
  });

  it("does not attach diagnostics when the flag is off", () => {
    expect(omitted.attributeDiagnostics).toBeUndefined();
    expect(explicit.attributeDiagnostics).toBeUndefined();
    expect("attributeDiagnostics" in omitted).toBe(false);
  });

  it("still does not publish attribute-shape codes on the refused element", () => {
    expect(codes(omitted.reasons)).not.toContain("jsx-spread");
    expect(codes(omitted.reasons)).not.toContain("jsx-dynamic-attribute");
  });
});

describe("unmask instrument — flag ON records the audit and changes no verdict", () => {
  const off = fallback(classify(HOST, "PropTaggedHost", false));
  const on = fallback(classify(HOST, "PropTaggedHost", true));

  it("keeps status and published reasons byte-identical to flag OFF", () => {
    expect(on.status).toBe(off.status);
    expect(on.reasons).toEqual(off.reasons);
    expect(codes(on.reasons)).toEqual(["jsx-component-element"]);
  });

  it("emits diagnostics for the refused component element", () => {
    expect(on.attributeDiagnostics).toBeDefined();
    expect(on.attributeDiagnostics).toHaveLength(1);
    const record = on.attributeDiagnostics![0];
    expect(record.loc).toEqual(off.reasons[0].loc);
    expect(codes(record.codes)).toContain("jsx-spread");
  });

  it("inventories the opening by AST kind and splits call-spread from identifier-spread", () => {
    const record = on.attributeDiagnostics![0];
    expect(record.attributes).toHaveLength(3);
    expect(record.attributes.map((attribute) => attribute.class)).toEqual([
      "jsx-attribute",
      "spread-of-call",
      "jsx-attribute",
    ]);
    expect(record.attributes.some((attribute) => attribute.class === "spread-of-identifier")).toBe(false);
  });
});

describe("unmask instrument — an intrinsic spread is not a diagnostic path", () => {
  const off = fallback(classify(SPREAD, "SpreadAfterAttribute", false));
  const on = fallback(classify(SPREAD, "SpreadAfterAttribute", true));

  it("still publishes jsx-spread from the real intrinsic audit", () => {
    expect(codes(off.reasons)).toContain("jsx-spread");
    expect(on.reasons).toEqual(off.reasons);
  });

  it("attaches an empty diagnostic list: there is no refused component element", () => {
    expect(on.attributeDiagnostics).toEqual([]);
  });
});

const TWO_HOP = "test/fixtures/shapes/TwoHopLiteral.tsx";
const PROVIDER = "test/fixtures/shapes/ProviderElementRoot.tsx";

describe("unmask instrument — flag OFF still omits binding-class cargo", () => {
  const omitted = fallback(classify(HOST, "PropTaggedHost"));
  const explicit = fallback(classify(HOST, "PropTaggedHost", false));

  it("does not attach cargo when the flag is off", () => {
    expect(omitted.attributeDiagnostics).toBeUndefined();
    expect(explicit.attributeDiagnostics).toBeUndefined();
  });
});

describe("unmask instrument — flag ON records binding classes and changes no verdict", () => {
  it("keeps status and published reasons byte-identical on a call-spread opening", () => {
    const off = fallback(classify(HOST, "PropTaggedHost", false));
    const on = fallback(classify(HOST, "PropTaggedHost", true));
    expect(on.status).toBe(off.status);
    expect(on.reasons).toEqual(off.reasons);
  });

  it("classes a call-valued spread as unresolvable and fails entire-cargo", () => {
    const on = fallback(classify(HOST, "PropTaggedHost", true));
    const record = on.attributeDiagnostics![0];
    expect(record.cargo).toEqual([{ role: "spread-of-call", class: "unresolvable" }]);
    expect(record.entireCargoCandidateRecordable).toBe(false);
  });

  it("resolves a dynamic attribute through the own-props parameter", () => {
    const off = fallback(classify(TWO_HOP, "Middle", false));
    const on = fallback(classify(TWO_HOP, "Middle", true));
    expect(on.status).toBe(off.status);
    expect(on.reasons).toEqual(off.reasons);
    expect(on.attributeDiagnostics).toHaveLength(1);
    const record = on.attributeDiagnostics![0];
    expect(record.cargo).toEqual([{ role: "dynamic-attribute", class: "own-props-parameter" }]);
    expect(record.entireCargoCandidateRecordable).toBe(true);
  });

  it("resolves a dynamic attribute through a signal getter", () => {
    const off = fallback(classify(PROVIDER, "ProviderElementRoot", false));
    const on = fallback(classify(PROVIDER, "ProviderElementRoot", true));
    expect(on.status).toBe(off.status);
    expect(on.reasons).toEqual(off.reasons);
    expect(on.attributeDiagnostics).toHaveLength(1);
    const record = on.attributeDiagnostics![0];
    expect(record.cargo).toEqual([{ role: "dynamic-attribute", class: "signal-getter" }]);
    expect(record.entireCargoCandidateRecordable).toBe(true);
  });
});

const COMPUTED = "app/src/fixtures/ComputedInitializerCounter.tsx";
const OPTIONS = "app/src/fixtures/OptionsArgCounter.tsx";
const IMPURE = "app/src/fixtures/ImpureEscapeCounter.tsx";
const DEEP = "app/src/fixtures/PropsDeepPair.tsx";

describe("unmask instrument — flag OFF still omits signal-family shapes", () => {
  const omitted = fallback(classify(HOST, "PropTaggedHost"));
  const explicit = fallback(classify(HOST, "PropTaggedHost", false));

  it("does not attach signalDiagnostics when the flag is off", () => {
    expect(omitted.signalDiagnostics).toBeUndefined();
    expect(explicit.signalDiagnostics).toBeUndefined();
    expect("signalDiagnostics" in omitted).toBe(false);
  });
});

describe("unmask instrument — flag ON records signal-family shapes and changes no verdict", () => {
  it("keeps status and published reasons byte-identical on a literal cell", () => {
    const off = fallback(classify(HOST, "PropTaggedHost", false));
    const on = fallback(classify(HOST, "PropTaggedHost", true));
    expect(on.status).toBe(off.status);
    expect(on.reasons).toEqual(off.reasons);
    expect(on.signalDiagnostics?.initializers.map((item) => item.shape)).toEqual(["literal"]);
    expect(on.signalDiagnostics?.escapes).toEqual([]);
  });

  it("prices a call-valued initializer as call", () => {
    const off = fallback(classify(COMPUTED, "ComputedInitializerCounter", false));
    const on = fallback(classify(COMPUTED, "ComputedInitializerCounter", true));
    expect(on.status).toBe(off.status);
    expect(on.reasons).toEqual(off.reasons);
    expect(on.signalDiagnostics?.initializers.map((item) => item.shape)).toEqual(["call"]);
    expect(on.signalDiagnostics?.initializers[0]?.astType).toBe("CallExpression");
  });

  it("prices an options-argument factory as extra-arguments", () => {
    // T027 C2 / T033: a second-arg static object of literal values now folds,
    // so `OptionsArgCounter` is provable under both flag states — gained, not
    // lost. The unmask shape is still `extra-arguments` (arity > 1); the
    // verdict moved, the priced initializer class did not.
    const off = classify(OPTIONS, "OptionsArgCounter", false);
    const on = classify(OPTIONS, "OptionsArgCounter", true);
    expect(off.status).toBe("provable");
    expect(on.status).toBe("provable");
    expect(on.status).toBe(off.status);
    expect(on.reasons).toEqual(off.reasons);
    expect(on.signalDiagnostics?.initializers.map((item) => item.shape)).toEqual(["extra-arguments"]);
  });

  it("prices an opaque-callee escape via this pass's own callee resolution", () => {
    const off = fallback(classify(IMPURE, "ImpureEscapeCounter", false));
    const on = fallback(classify(IMPURE, "ImpureEscapeCounter", true));
    expect(on.status).toBe(off.status);
    expect(on.reasons).toEqual(off.reasons);
    const escape = on.signalDiagnostics?.escapes.find((item) => item.code === "signal-escapes-to-opaque-callee");
    expect(escape).toBeDefined();
    expect(escape?.site).toBe("opaque-call");
    expect(escape?.callee?.callee).toBe("logCount");
    expect(escape?.callee?.opaque).toBe(true);
    expect(escape?.callee?.definedIn).toMatch(/impure-helpers/);
  });

  it("prices a prop-handed accessor as jsx-attribute", () => {
    const off = fallback(classify(DEEP, "PropsDeepParent", false));
    const on = fallback(classify(DEEP, "PropsDeepParent", true));
    expect(on.status).toBe(off.status);
    expect(on.reasons).toEqual(off.reasons);
    expect(on.signalDiagnostics?.escapes.some((item) => item.site === "jsx-attribute")).toBe(true);
  });
});
