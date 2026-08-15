import { afterEach, describe, expect, it } from "vitest";

import { PropsPairParent } from "../src/fixtures/PropsPair";

import { clickTestId, mount, testId, unmountAll } from "./harness";

/**
 * The props slice of the near-miss corpus.
 *
 * Same contract as `fixtures.test.tsx`: every one of these is ordinary Solid
 * and has to render and update under unmodified `solid-js`, whichever
 * side of the refusal taxonomy the classifier puts it on. The classifier is not
 * imported here and never will be — these are *corpus source*, and a test that
 * asserted a verdict from inside `app/` would make the corpus depend on the
 * tool measuring it. The verdicts are asserted in the analysis package's own
 * suite instead.
 *
 * Each file is mounted through its exported parent; the module-local children
 * are exercised by being rendered, which is the only way anything ever renders
 * them in real code.
 *
 * `PropsDeepParent`, `PropsSpreadParent`, `PropsOpaqueParent` and
 * `ImpureEscapeCounter` are *refused* fixtures, and their refusal codes — the
 * thing the report actually claims about them — are asserted per component in
 * `test/coverage.test.ts`, including `ImpureEscapeCounter`'s role as the
 * corpus carrier for `signal-escapes-to-opaque-callee`. They need no mount
 * here.
 *
 * `PropsPairParent` has two tests, and they are not the same test. The first
 * is the demo's behaviour claim: a click on the *child's* button runs the
 * *parent's* handler, which is the wiring the depth-1 splice proves. The
 * second is the splice claim: the rendered shape is the parent's `<div>`
 * holding the children's own elements, which is what makes the spliced
 * locators "/0" and "/1" address real nodes. `children` skips the `<!---->`
 * comment nodes the emitter reproduces, which is why the locators need no
 * arithmetic adjustment.
 */

afterEach(() => {
  unmountAll();
});

function label(host: HTMLElement, id: string): string {
  return testId(host, id).textContent ?? "";
}

describe("props fixtures", () => {
  it("PropsPairParent drives a child label through a prop-passed accessor", () => {
    const host = mount(PropsPairParent);
    expect(label(host, "props-pair-label")).toBe("0");

    // The click lands on the child's button, and the handler it runs is the
    // parent's — which is exactly the wiring the classifier claims to prove.
    clickTestId(host, "props-pair-inc");
    clickTestId(host, "props-pair-inc");
    expect(label(host, "props-pair-label")).toBe("2");
  });

  it("PropsPairParent renders the children as plain elements, with no wrapper", () => {
    // The template the pass emits for this component is the parent's `<div>`
    // holding the children's own elements. Solid renders the same shape, which
    // is what makes the spliced locators ("/0", "/1") address real nodes.
    const host = mount(PropsPairParent);
    const root = host.firstElementChild!;

    expect(root.tagName).toBe("DIV");
    expect(root.children).toHaveLength(2);
    expect(root.children[0].tagName).toBe("SPAN");
    expect(root.children[0].getAttribute("data-testid")).toBe("props-pair-label");
    expect(root.children[1].tagName).toBe("BUTTON");
    expect(root.children[1].getAttribute("data-testid")).toBe("props-pair-inc");
  });
});
