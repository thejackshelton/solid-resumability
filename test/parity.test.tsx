import { afterEach, describe, expect, it } from "vitest";
import { render } from "@solidjs/web";
import { flush } from "solid-js";

import { CounterA } from "../src/fixtures/CounterA";
import { PropsPairParent } from "../app/src/fixtures/PropsPair.tsx";
import { runComptime } from "../src/comptime/index.ts";
import { textBinding } from "./bindings.ts";

/**
 * Byte-neutrality: the comptime pass's template artifact must be *exactly*
 * what unmodified Solid produces.
 *
 * This is the load-bearing claim of the whole spike. If the static template
 * and the framework's own output differ by so much as a marker comment or a
 * stray text node, then resuming from the template is not resuming the same
 * page, and every downstream locator (which addresses nodes by child index)
 * is addressing something else.
 *
 * Note what this test does *not* do: there is no normalization step. Not
 * whitespace collapsing, not attribute reordering, not comment stripping.
 * `render()` of Fixture A produces markup that is already byte-identical to
 * the emitted template, so the assertion is a raw string comparison. If a
 * future fixture forces a normalization, it belongs here, spelled out, and
 * the weakening should be argued rather than absorbed.
 *
 * The second describe block covers the shape where the claim is hardest: a
 * see-through parent, whose template has to carry the `<!---->` placeholders
 * `render()` writes after a dynamic insert. Nothing here normalizes that away
 * — the emitter reproduces the placeholders, and the comparison below is the
 * same raw string comparison as Fixture A's. The see-through fixture gets a
 * live-render test and not only an `analysis.html` string assertion.
 */

const disposers: Array<() => void> = [];

function mount(component: () => unknown) {
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

describe("template parity with classic render()", () => {
  // Classify only — the artifact bytes are asserted separately below.
  const { analysis } = runComptime("src/fixtures/CounterA.tsx", { write: false });
  if (analysis.status !== "provable") throw new Error("Fixture A should be provable");

  it("matches the classic DOM byte for byte, with no normalization", () => {
    const host = mount(CounterA);

    expect(host.innerHTML).toBe(analysis.html);
  });

  it("matches the emitted template module too", async () => {
    // Read the committed artifact rather than re-emitting it: emission is
    // `comptime-pass.test.ts`'s job, and test files run in parallel workers.
    // @ts-expect-error Generated plain-JS artifact; its shape is the emitter's contract, asserted below.
    const template = await import("../artifacts/CounterA/template.js");
    const host = mount(CounterA);

    expect(template.html).toBe(analysis.html);
    expect(host.innerHTML).toBe(template.html);
  });

  it("addresses the same nodes the locators claim", () => {
    const host = mount(CounterA);
    const root = host.firstElementChild!;

    // Locators are child indices from the component root. The template has no
    // whitespace-only text nodes, so childNodes and children agree — which is
    // exactly what makes an index-based locator safe here.
    expect(host.childNodes).toHaveLength(1);
    expect(root.childNodes).toHaveLength(root.children.length);

    const at = (locator: string) =>
      locator
        .split("/")
        .filter(Boolean)
        .reduce<Element>((node, index) => node.children[Number(index)], root);

    expect(at(analysis.bindings[0].locator).getAttribute("data-testid")).toBe("a-label");
    expect(at(analysis.bindings[0].locator).textContent).toBe(textBinding(analysis.bindings[0]).initialText);
    expect(at(analysis.wiring[0].locator).getAttribute("data-testid")).toBe("a-inc");
    expect(at(analysis.wiring[1].locator).getAttribute("data-testid")).toBe("a-dec");
  });

  it("still matches after the classic component mutates its own state", () => {
    const host = mount(CounterA);

    // The template describes initial state only. Drive the real component
    // forward and back through its own handlers; the DOM must land back on
    // the template exactly, proving the template is a real fixed point of
    // Solid's rendering rather than a lucky first paint.
    const inc = host.querySelector<HTMLButtonElement>('[data-testid="a-inc"]')!;
    const dec = host.querySelector<HTMLButtonElement>('[data-testid="a-dec"]')!;

    inc.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    flush();
    expect(host.innerHTML).not.toBe(analysis.html);

    dec.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    flush();
    expect(host.innerHTML).toBe(analysis.html);
  });
});

describe("template parity for a see-through parent", () => {
  // `PropsPairParent` is the depth-1 inlining case and the demo's fourth
  // fixture: two component children, both spliced into the parent's template.
  // It is the only shape where the pass emits markup it did not read directly
  // out of the component's own JSX, so it is the shape where "the template is
  // what render() produces" is a real claim rather than a restatement.
  const { analysis } = runComptime("app/src/fixtures/PropsPair.tsx", {
    write: false,
    component: "PropsPairParent",
  });
  if (analysis.status !== "provable") throw new Error("PropsPairParent should be provable");

  it("matches the classic DOM byte for byte, placeholders included", () => {
    const host = mount(PropsPairParent);

    expect(host.innerHTML).toBe(analysis.html);
    // Named explicitly so the test fails loudly if a future emitter stops
    // writing them and the comparison passes for the wrong reason — i.e. if
    // Solid also stopped, which would be a framework change worth noticing.
    expect(analysis.html.split("<!---->").length - 1).toBe(2);
  });

  it("keeps element-indexed locators addressing the same nodes", () => {
    const host = mount(PropsPairParent);
    const root = host.firstElementChild!;

    // The point of the placeholders: they are comment nodes, so `childNodes`
    // is now wider than `children` — and locators have always indexed
    // `children`, which is why nothing about resolution had to change.
    expect(root.childNodes.length).toBe(root.children.length + 2);

    const at = (locator: string) =>
      locator
        .split("/")
        .filter(Boolean)
        .reduce<Element>((node, index) => node.children[Number(index)], root);

    expect(at(analysis.bindings[0].locator).getAttribute("data-testid")).toBe("props-pair-label");
    expect(at(analysis.bindings[0].locator).textContent).toBe(textBinding(analysis.bindings[0]).initialText);
    expect(at(analysis.wiring[0].locator).getAttribute("data-testid")).toBe("props-pair-inc");
  });

  it("still matches after the classic component mutates its own state", () => {
    const host = mount(PropsPairParent);

    const inc = host.querySelector<HTMLButtonElement>('[data-testid="props-pair-inc"]')!;
    inc.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    flush();
    expect(host.innerHTML).not.toBe(analysis.html);

    // No decrement on this fixture, so the return trip is driven by the DOM
    // going back to its initial text rather than by a second handler.
    host.querySelector('[data-testid="props-pair-label"]')!.textContent = "0";
    expect(host.innerHTML).toBe(analysis.html);
  });
});
