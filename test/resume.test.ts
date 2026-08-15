import { describe, expect, it, vi } from "vitest";

import { cellKernel } from "../src/resume/cells.ts";
import { createIdentityRegistry } from "../src/resume/identities.ts";
import type { Bundle, HandlerModule, IdentityCaptureSlotSpec } from "../src/resume/registry.ts";
import { resumeBundle } from "../src/resume/resumer.ts";
import { resumeSuite } from "./resume-suite.ts";

/**
 * The resume path over the cell kernel — the backend that ships.
 *
 * The suite itself is `resume-suite.ts`, which documents what it asserts and
 * why it is a module rather than a `describe.each`. What cannot be shared
 * lives here: `vi.mock` is hoisted to the top of the *file* that calls it and
 * its factories run once per module registry, and vitest gives one registry
 * per test file. So the probe and the loader hooks live here,
 * `resume-signals.test.ts` has an identical pair for the oracle, and the two
 * runs are genuinely independent readings rather than one reading and one
 * echo of it.
 *
 * Nothing is relaxed on either side. If the kernel and `@solidjs/signals`
 * disagreed about batching, updaters, sharing or flush ordering, one of these
 * two files would fail on the assertion the disagreement reached — and the
 * clause-level comparison of the two backends, on inputs the artifacts do not
 * happen to produce, is `cells.test.ts`.
 */

const probe = vi.hoisted(() => ({
  /** Module ids, in evaluation order. */
  loads: [] as string[],
  /** The capture slots each handler module was created with. */
  slots: new Map<string, Record<string, unknown>>(),
}));

vi.mock("../src/fixtures/CounterA.tsx", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  probe.loads.push("src/fixtures/CounterA.tsx");
  return original;
});

vi.mock("../src/fixtures/CounterB.tsx", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  probe.loads.push("src/fixtures/CounterB.tsx");
  return original;
});

/** Wraps a handler module: records its load, and the slots it was bound to. */
function handlerHook(id: string) {
  return async (importOriginal: () => Promise<Record<string, unknown>>) => {
    const original = await importOriginal();
    probe.loads.push(`artifacts/CounterA/handlers/${id}.js`);
    const create = original.create as (slots: Record<string, unknown>) => (event: Event) => void;
    return {
      ...original,
      create(slots: Record<string, unknown>) {
        probe.slots.set(id, slots);
        return create(slots);
      },
    };
  };
}

vi.mock("../artifacts/CounterA/handlers/s0.js", handlerHook("s0"));
vi.mock("../artifacts/CounterA/handlers/s1.js", handlerHook("s1"));

await resumeSuite({ backend: cellKernel, backendName: "cells.ts kernel", probe });

const MEASURED_TEMPLATE = "<hr>";

const REST_SOURCE = { name: "rest", path: [] as const };

const REST_SLOT: IdentityCaptureSlotSpec = {
  name: "rest",
  kind: "identity",
  bindingClass: "derived-rest-props-result",
  source: { name: "rest", path: [] },
};

function measuredHost(): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = MEASURED_TEMPLATE;
  document.body.appendChild(host);
  return host;
}

function incrementHandler(): HandlerModule {
  return {
    id: "s0",
    event: "click",
    locator: "/",
    captures: [
      { name: "n", cell: "c0", access: "read" },
      { name: "setN", cell: "c0", access: "write" },
    ],
    create({ n, setN }: Record<string, unknown>) {
      return () => (setN as (value: number) => void)((n as () => number)() + 1);
    },
  };
}

function measuredBundle(overrides: Partial<Bundle> = {}): Bundle {
  return {
    component: "Host",
    template: { html: MEASURED_TEMPLATE, root: "/" },
    cells: [],
    regions: [],
    keyedRegions: [],
    stores: [],
    actions: [],
    reads: [],
    bindings: [
      {
        id: "b0",
        kind: "attribute",
        locator: "/",
        attribute: "role",
        initialValue: null,
        captures: [REST_SLOT],
        compute(slots: Record<string, unknown>) {
          return (slots.rest as { role: string }).role;
        },
      },
    ],
    wiring: [],
    loadHandler: async () => {
      throw new Error("no handler on this bundle");
    },
    ...overrides,
  };
}

describe("mount-time measured-attribute restore", () => {
  it("paints a measured attribute from a page-provided rest-props identity", () => {
    const rest = { role: "separator" };
    const identities = createIdentityRegistry();
    const host = measuredHost();
    identities.provide(host, REST_SOURCE, rest);

    const app = resumeBundle(host, measuredBundle(), { identities });
    expect(host.querySelector("hr")!.getAttribute("role")).toBe("separator");
    app.dispose();
  });

  it("throws at mount without an identity registry and leaves the node unpainted", () => {
    const host = measuredHost();
    expect(() => resumeBundle(host, measuredBundle(), {})).toThrow(/needs an identity registry for slot rest/);
    expect(host.querySelector("hr")!.getAttribute("role")).toBeNull();
  });

  it("throws at mount when the rest source is missing and leaves the node unpainted", () => {
    const identities = createIdentityRegistry();
    const host = measuredHost();
    expect(() => resumeBundle(host, measuredBundle(), { identities })).toThrow(
      /no live identity is registered as "rest"/,
    );
    expect(host.querySelector("hr")!.getAttribute("role")).toBeNull();
  });

  it("a later apply of the same compute is a no-op on the DOM", async () => {
    let computes = 0;
    const rest = { role: "separator" };
    const identities = createIdentityRegistry();
    const host = measuredHost();
    identities.provide(host, REST_SOURCE, rest);
    const increment = incrementHandler();

    const app = resumeBundle(
      host,
      measuredBundle({
        cells: [{ id: "c0", initial: 0, getter: "n", setter: "setN" }],
        bindings: [
          {
            id: "b0",
            kind: "attribute",
            locator: "/",
            attribute: "role",
            initialValue: null,
            captures: [REST_SLOT, { name: "n", cell: "c0", access: "read" }],
            compute(slots: Record<string, unknown>) {
              computes++;
              (slots.n as () => number)();
              return (slots.rest as { role: string }).role;
            },
          },
        ],
        wiring: [
          {
            locator: "/",
            event: "click",
            module: "./handlers/s0.js",
            handler: "s0",
            captures: increment.captures,
          },
        ],
        loadHandler: async () => increment,
      }),
      { identities },
    );

    const node = host.querySelector("hr")!;
    expect(node.getAttribute("role")).toBe("separator");
    expect(computes).toBe(1);

    node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await app.settled();

    expect(computes).toBe(2);
    expect(app.stats.patches).toBe(0);
    expect(node.getAttribute("role")).toBe("separator");
    expect(node.getAttributeNames()).toEqual(["role"]);
    app.dispose();
  });
});
