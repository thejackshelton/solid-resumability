import { afterEach, describe, expect, it } from "vitest";

import { ProvableCounter } from "../src/fixtures/ProvableCounter";
import { ProvableStepper } from "../src/fixtures/ProvableStepper";
import { ProvableGreeting } from "../src/fixtures/ProvableGreeting";
import { OpaqueCalleeCounter } from "../src/fixtures/OpaqueCalleeCounter";
import { getLocalOnlyCounter } from "../src/fixtures/LocalOnlyCounter";

import { clickTestId, mount, testId, unmountAll } from "./harness";

/**
 * The near-miss slice: every fixture is ordinary Solid and must render and
 * update under unmodified solid-js, whichever side of the refusal taxonomy it
 * lands on. These are corpus files — the todos app never imports them.
 *
 * Refusals themselves are asserted from the analysis side in
 * `test/coverage.test.ts` (per-fixture `refusalCodes`, plus the whole
 * committed `docs/coverage/coverage.json` re-derived from the corpus), so a
 * refused fixture needs no mount here. What is mounted is deliberate:
 *
 * - the three provable fixtures, because they are the positive controls the
 *   emitter, the demo and the parity tests all resolve back to; if one of
 *   them stopped working under plain Solid, "the artifact is what render()
 *   produces" would be a claim about a broken component;
 * - `OpaqueCalleeCounter`, the corpus's live example of the summarized-helper
 *   path actually running;
 * - `LocalOnlyCounter`, whose whole point is that it is never exported, so
 *   mounting it through its factory is the only evidence that a module-local
 *   emittable component is a real component and not a discovery artifact.
 *
 * The refused fixtures have no runtime exercise anywhere, so hydration work
 * that needs one is restoring a known-good test rather than rediscovering the
 * need for it.
 */

afterEach(() => {
  unmountAll();
});

function label(host: HTMLElement, id: string): string {
  return testId(host, id).textContent ?? "";
}

describe("provable fixtures (positive controls)", () => {
  it("ProvableCounter increments and decrements", () => {
    const host = mount(ProvableCounter);
    expect(label(host, "provable-counter-label")).toBe("count: 0");

    clickTestId(host, "provable-counter-inc");
    clickTestId(host, "provable-counter-inc");
    expect(label(host, "provable-counter-label")).toBe("count: 2");

    clickTestId(host, "provable-counter-dec");
    expect(label(host, "provable-counter-label")).toBe("count: 1");
  });

  it("ProvableStepper derives its total from two cells", () => {
    const host = mount(ProvableStepper);
    expect(label(host, "provable-stepper-total")).toBe("15");
    expect(label(host, "provable-stepper-step")).toBe("5");

    clickTestId(host, "provable-stepper-up");
    expect(label(host, "provable-stepper-total")).toBe("20");

    clickTestId(host, "provable-stepper-widen");
    expect(label(host, "provable-stepper-step")).toBe("6");
    expect(label(host, "provable-stepper-total")).toBe("21");
  });

  it("ProvableGreeting swaps a string cell through a template literal", () => {
    const host = mount(ProvableGreeting);
    expect(label(host, "provable-greeting-text")).toBe("hello, world");

    clickTestId(host, "provable-greeting-solid");
    expect(label(host, "provable-greeting-text")).toBe("hello, solid");

    clickTestId(host, "provable-greeting-reset");
    expect(label(host, "provable-greeting-text")).toBe("hello, world");
  });
});

describe("near-miss fixtures", () => {
  it("OpaqueCalleeCounter updates through imported helpers", () => {
    const host = mount(OpaqueCalleeCounter);
    expect(label(host, "opaque-callee-label")).toBe("count: 0");

    clickTestId(host, "opaque-callee-inc");
    clickTestId(host, "opaque-callee-inc");
    expect(label(host, "opaque-callee-label")).toBe("count: 2");
  });

  it("LocalOnlyCounter mounts through its exported factory", () => {
    const host = mount(getLocalOnlyCounter());
    expect(label(host, "local-only-label")).toBe("count: 0");

    clickTestId(host, "local-only-inc");
    expect(label(host, "local-only-label")).toBe("count: 1");
  });
});
