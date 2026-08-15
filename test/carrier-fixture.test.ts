import { readFileSync } from "node:fs";

import { afterAll, describe, expect, it } from "vitest";
import { render } from "@solidjs/web";

import { runComptime } from "../src/comptime/index.ts";
import type { ProvableAnalysis, ReasonCode } from "../src/comptime/types.ts";
import { Roster } from "../app/src/fixtures/KeyedRoster.tsx";
import { createRoster } from "../app/src/fixtures/roster.ts";

/**
 * The carrier fixture (T015) — the keyed region promoted into the CORPUS.
 *
 * `test/keyed-regions.test.tsx` proved the region against a test-only fixture:
 * classify, emit, resume, and five refusals, all over a file the coverage metric
 * never sees. This file is about the production sibling, and it asks three
 * questions that one could not:
 *
 *   1. THE PROBE. The ruling shipped with exactly one unprobed assumption — a
 *      region-item handler that also captures a CELL SETTER. The third shape
 *      needs it: the item handler feeds `drop`'s return into a cell whose
 *      readout sits OUTSIDE the region, so a click proves key identity and DOM
 *      invariance at once without mutating a single item. If `classify` had
 *      refused that handler, the shape would have been dead and the phase would
 *      have stopped here. It does not: the handler carries all three capture
 *      kinds — action, region-item, cell — in one listener.
 *
 *   2. THE READOUT'S ADDRESS SPACE. The cell's own binding is the COMPONENT's,
 *      with a flat locator from the component root; everything under the `<For>`
 *      lives in the region's separate numbering. Both are asserted below,
 *      because the whole reason an item's locators are safe is that they are
 *      rooted at an item element and never mixed with the component's.
 *
 *   3. PARITY, WITH THE READOUT IN THE MARKUP. The region contributes nothing to
 *      `analysis.html` — the container is served empty — but the readout does.
 *      So the template is no longer "an empty container": it is a readout at its
 *      cell's initial value NEXT TO an empty container, and unmodified Solid has
 *      to produce that byte for byte or the fixture is not the page.
 *
 * `docs/coverage/baseline.md` is the arithmetic the rest of the phase inherits:
 * two counted components land here, one provable and one refused, and the
 * provider's refusal is recorded rather than fought.
 */

const disposers: Array<() => void> = [];

afterAll(() => {
  while (disposers.length) disposers.pop()!();
});

function mount(component: () => unknown): HTMLDivElement {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const dispose = render(component as never, host);
  disposers.push(() => {
    dispose();
    host.remove();
  });
  return host;
}

const CARRIER = "app/src/fixtures/KeyedRoster.tsx";

function classified(component: string) {
  return runComptime(CARRIER, { write: false, component }).analysis;
}

const list = classified("RosterList");
if (list.status !== "provable") {
  throw new Error(`RosterList should be provable: ${list.reasons.map((reason) => reason.code).join(", ")}`);
}
const carrier: ProvableAnalysis = list;
const [region] = carrier.keyedRegions;

describe("the probe — a region-item handler that also writes a cell", () => {
  it("admits the item handler at all", () => {
    // Stated first and on its own, because this is the assumption the ruling
    // shipped without evidence for. Everything below is what the admission
    // CONTAINS; this is that it happened.
    expect(carrier.status).toBe("provable");
    expect(region.itemWiring).toHaveLength(1);
  });

  it("carries all three capture kinds in one listener, in resolution order", () => {
    // `() => setLast(drop(member.id))`, read exactly as `classify` reads it: the
    // store action by its fixed slot path, the region item by its region, and
    // the component's own cell by id and access. Sorted by the author's own
    // names, which is the only ordering the emitter promises.
    expect(region.itemWiring[0]).toMatchObject({ locator: "/1", event: "click", handler: "s0" });
    expect(region.itemWiring[0].captures).toEqual([
      { name: "drop", kind: "action", store: "s0", path: [1, "drop"] },
      { name: "member", kind: "region-item", region: "k0" },
      { name: "setLast", cell: "c0", access: "write" },
    ]);
  });

  it("keeps the cell the COMPONENT's, and the item bindings the REGION's", () => {
    // The write target is an ordinary component-scope cell with a literal
    // initializer — nothing about sitting downstream of a region handler makes
    // it a different kind of cell.
    expect(carrier.cells).toMatchObject([
      { id: "c0", getter: "last", setter: "setLast", initial: "none" },
    ]);

    // The readout is the component's own binding, at a flat locator from the
    // component root. The item's text binding is the region's, in the region's
    // own numbering, rooted at the item element. `/0` in both cases and they
    // address different documents — which is why they are never in one list.
    expect(carrier.bindings).toHaveLength(1);
    expect(carrier.bindings[0]).toMatchObject({
      id: "b0",
      kind: "text",
      locator: "/0",
      expression: "last()",
      initialText: "none",
      initialTextFrom: "derivation",
    });
    expect(carrier.bindings[0].captures).toEqual([{ name: "last", cell: "c0", access: "read" }]);

    expect(region.itemBindings).toHaveLength(1);
    expect(region.itemBindings[0]).toMatchObject({
      id: "k0b0",
      kind: "text",
      locator: "/0",
      expression: "member.name",
      // No build-time answer: at build time there is no list.
      initialTextFrom: "capture",
    });
    expect(region.itemBindings[0].captures).toEqual([
      { name: "member", kind: "region-item", region: "k0" },
    ]);

    // And the component's own flat WIRING stays empty: an item's handler is
    // wired by key inside its region, so from the component's root its locator
    // would address something else entirely.
    expect(carrier.wiring).toEqual([]);
  });
});

describe("the record — one container, one key path, one item address space", () => {
  it("addresses the CONTAINER, and the container is no longer the root", () => {
    // The list fixture's `<ul>` WAS the component root. Here the readout is its
    // sibling, so the container sits at `/1` — evidence that the region's
    // container is found by walking the component's markup rather than assumed
    // to be the root element.
    expect(carrier.keyedRegions).toHaveLength(1);
    expect(region).toMatchObject({
      id: "k0",
      container: "/1",
      item: "member",
      keyPath: ["id"],
      keyAttribute: "data-key",
    });
    expect(region.each).toBe("roster.members");
  });

  it("expresses the list over store IDENTITY, never over store data", () => {
    expect(region.captures).toEqual([{ name: "roster", kind: "store-read", store: "s0", path: [0] }]);
    expect(carrier.stores).toMatchObject([
      {
        id: "s0",
        context: "RosterContext",
        readSlot: 0,
        actionsSlot: 1,
        value: { module: "app/src/fixtures/roster.ts", factory: "createRoster" },
      },
    ]);
  });

  it("puts the key only on the item template", () => {
    expect(region.itemTemplate).toBe(
      '<li class="member" data-key=""><span class="name"></span><button class="drop">x</button></li>',
    );
    // Last, not first: the only other writer of this attribute is a capture
    // stage calling `setAttribute` on parsed markup, and every serializer writes
    // a newly set attribute after the ones the bytes already carried.
    expect(region.itemTemplate.indexOf("data-key")).toBeGreaterThan(
      region.itemTemplate.indexOf('class="member"'),
    );
  });
});

describe("the template — a readout, an empty container, and no key in the bytes", () => {
  it("templates the readout at its initial value and the container empty", () => {
    expect(carrier.html).toBe(
      '<div class="roster-panel"><p class="last">none</p><ul class="roster"></ul></div>',
    );
    expect(carrier.html).not.toContain("data-key");
    expect(carrier.html).not.toContain("<li");
  });

  it("matches what unmodified Solid renders, byte for byte, at the default seed", () => {
    // The named risk, taken with no arrangement: nothing here seeds the store.
    // The module-level default IS empty, which is what makes the served bytes
    // and the templated bytes agree by construction rather than by setup — and
    // it is why a seeded default would quietly void this assertion.
    expect(createRoster()[0].members).toEqual([]);

    const host = mount(Roster);

    expect(host.innerHTML).toBe(carrier.html);
  });
});

describe("the provider — an expected refusal, recorded rather than fought", () => {
  it("refuses `Roster`, with the two codes the mount point earns", () => {
    // `App`'s architectural residue in miniature. The provider call IS the frame
    // that creates the store, so a resumed `Roster` would have no frame to
    // create it in — and it declares no cell of its own to resume either. Both
    // codes are the shape of that boundary, not defects to close, and this is
    // the second counted component behind the fixtures denominator moving by two.
    const provider = classified("Roster");
    expect(provider.status).toBe("fallback");

    const codes: ReasonCode[] = [...new Set(provider.reasons.map((reason) => reason.code))].sort();
    expect(codes).toEqual(["jsx-component-element", "no-signal-source"]);
    // Two nested components, one refusal each: the `<RosterContext>` provider
    // element and the `<RosterList />` under it.
    expect(provider.reasons.filter((reason) => reason.code === "jsx-component-element")).toHaveLength(2);
  });
});

describe("the store partition — framework-free, asserted on the source", () => {
  const source = readFileSync("app/src/fixtures/roster.ts", "utf8");

  it("imports nothing at all, so it imports no framework", () => {
    // Claim 7a, checked where it can be broken. This module is the partition a
    // resumed page fetches at a mount point with no provided store, so every
    // byte of it lands on the resumable page's wire. The strongest available
    // check is also the simplest: the import list is EMPTY. A weaker check —
    // "no `solid-js` specifier" — would pass a module that reached the framework
    // through a re-export.
    expect([...source.matchAll(/^\s*(?:import|export)\b[^\n]*\bfrom\b[^\n]*$/gm)]).toEqual([]);
    expect([...source.matchAll(/\bimport\s*\(/g)]).toEqual([]);
    expect([...source.matchAll(/\brequire\s*\(/g)]).toEqual([]);
  });

  it("names no framework specifier anywhere in its text", () => {
    expect(source).not.toMatch(/solid-js|@solidjs/);
  });
});
