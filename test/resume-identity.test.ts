import { describe, expect, it } from "vitest";

import { createIdentityRegistry } from "../src/resume/identities.ts";
import { resumeBundle } from "../src/resume/resumer.ts";
import type { Bundle, HandlerModule, IdentityCaptureSlotSpec } from "../src/resume/registry.ts";

/**
 * v2 resume join — a live prop value, by identity, never serialized.
 *
 * Slice C named `{ kind: "identity", bindingClass, source }` on the child's
 * own captures and froze no value. The resume side's whole job is to turn
 * that identity into the live value provided at the fill site — and its
 * whole obligation is to do that without reading claimedChildren, without
 * stringifying the cargo, and without StoreRegistry's one-value-per-id
 * contract (two mounts of the same source are two provides).
 *
 * Hand-built bundle on purpose: the first-party wire is slice E. What is
 * left for here is the join's edges.
 */

const TEMPLATE = '<button class="act" type="button"></button>';

const SOURCE = { name: "props", path: ["onClick"] } as const;

const SLOT: IdentityCaptureSlotSpec = {
  name: "onClick",
  kind: "identity",
  bindingClass: "own-props-parameter",
  source: { name: "props", path: ["onClick"] },
};

function liveHandler() {
  const seen: unknown[] = [];
  const onClick = (event: Event) => {
    seen.push((event.currentTarget as HTMLElement | null)?.tagName ?? null);
  };
  return { onClick, seen };
}

function handlerModule(): HandlerModule {
  return {
    id: "s0",
    event: "click",
    locator: "/",
    captures: [SLOT],
    // The extracted body, factored over its slot manifest — exactly the
    // shape the emitter writes for an identity event prop. It returns the
    // slot; it never inspects it.
    create({ onClick }: Record<string, unknown>) {
      return onClick as (event: Event) => void;
    },
  };
}

function bundle(overrides: Partial<Bundle> = {}): Bundle {
  return {
    component: "Child",
    template: { html: TEMPLATE, root: "/" },
    cells: [],
    regions: [],
    keyedRegions: [],
    stores: [],
    actions: [],
    reads: [],
    bindings: [],
    wiring: [
      {
        locator: "/",
        event: "click",
        module: "./handlers/s0.js",
        handler: "s0",
        captures: [SLOT],
      },
    ],
    loadHandler: async () => handlerModule(),
    ...overrides,
  };
}

function mount(): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = TEMPLATE;
  document.body.appendChild(host);
  return host;
}

function click(host: HTMLElement): void {
  host.querySelector("button.act")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

describe("the identity registry resolves by live reference, and only that", () => {
  it("hands back the provided value — not a copy, not a wrapper", () => {
    const live = { cargo: 1 };
    const site = {};
    const registry = createIdentityRegistry();
    registry.provide(site, SOURCE, live);

    const resolved = registry.resolve(site, SOURCE);
    // The soundness line, as an assertion: what the slot gets IS what the
    // page provided. A wrapper here would mean the resume path had formed
    // an opinion about a value it was never allowed to freeze.
    expect(Object.is(resolved, live)).toBe(true);
  });

  it("keeps two provides of the same source at two mounts distinct", () => {
    const first = { cargo: "a" };
    const second = { cargo: "a" };
    const mountA = {};
    const mountB = {};
    const registry = createIdentityRegistry();

    registry.provide(mountA, SOURCE, first);
    registry.provide(mountB, SOURCE, second);

    expect(Object.is(first, second)).toBe(false);
    expect(Object.is(registry.resolve(mountA, SOURCE), first)).toBe(true);
    expect(Object.is(registry.resolve(mountB, SOURCE), second)).toBe(true);
    expect(Object.is(registry.resolve(mountA, SOURCE), registry.resolve(mountB, SOURCE))).toBe(false);
    expect(registry.has(mountA, SOURCE)).toBe(true);
    expect(registry.has(mountB, SOURCE)).toBe(true);
  });

  it("never serializes the provided value", () => {
    const live: { n: number; toJSON?: () => unknown } = { n: 1 };
    Object.defineProperty(live, "toJSON", {
      value: () => {
        throw new Error("identity cargo was serialized");
      },
    });
    const site = {};
    const registry = createIdentityRegistry();
    registry.provide(site, SOURCE, live);
    expect(Object.is(registry.resolve(site, SOURCE), live)).toBe(true);
  });

  it("re-provide of the same value at the same site is a no-op; a different value is not", () => {
    const live = { cargo: 1 };
    const site = {};
    const registry = createIdentityRegistry();
    registry.provide(site, SOURCE, live);
    registry.provide(site, SOURCE, live);
    expect(Object.is(registry.resolve(site, SOURCE), live)).toBe(true);
    expect(() => registry.provide(site, SOURCE, { cargo: 1 })).toThrow(/already registered/);
  });

  it("errors on an unregistered source — explicitly, not silently", () => {
    const registry = createIdentityRegistry();
    expect(() => registry.resolve({}, SOURCE)).toThrow(/no live identity is registered as "props"/);
  });
});

describe("a resumed handler dispatches through the identity join", () => {
  it("calls the live function, Object.is with what was provided", async () => {
    const live = liveHandler();
    const identities = createIdentityRegistry();
    const host = mount();
    identities.provide(host, SOURCE, live.onClick);

    expect(Object.is(identities.resolve(host, SOURCE), live.onClick)).toBe(true);

    const app = resumeBundle(host, bundle(), { identities });
    expect(app.stats.handlerLoads).toBe(0);

    click(host);
    await app.settled();

    expect(live.seen).toEqual(["BUTTON"]);
    expect(app.stats.handlerLoads).toBe(1);
    app.dispose();
  });

  it("two mounts with two live values stay distinct through resume", async () => {
    const first = liveHandler();
    const second = liveHandler();
    const identities = createIdentityRegistry();
    const hostA = mount();
    const hostB = mount();

    identities.provide(hostA, SOURCE, first.onClick);
    identities.provide(hostB, SOURCE, second.onClick);

    const appA = resumeBundle(hostA, bundle(), { identities });
    const appB = resumeBundle(hostB, bundle(), { identities });

    click(hostA);
    await appA.settled();
    click(hostB);
    await appB.settled();

    expect(first.seen).toEqual(["BUTTON"]);
    expect(second.seen).toEqual(["BUTTON"]);
    expect(Object.is(identities.resolve(hostA, SOURCE), first.onClick)).toBe(true);
    expect(Object.is(identities.resolve(hostB, SOURCE), second.onClick)).toBe(true);
    expect(Object.is(identities.resolve(hostA, SOURCE), identities.resolve(hostB, SOURCE))).toBe(false);

    appA.dispose();
    appB.dispose();
  });

  it("throws at dispatch when the identity was never registered", async () => {
    const identities = createIdentityRegistry();
    const host = mount();
    const app = resumeBundle(host, bundle(), { identities });

    click(host);
    await expect(app.settled()).rejects.toThrow(/no live identity is registered as "props"/);
    app.dispose();
  });

  it("throws at dispatch when the page gave no identity registry at all", async () => {
    const host = mount();
    const app = resumeBundle(host, bundle(), {});

    click(host);
    await expect(app.settled()).rejects.toThrow(/needs an identity registry for slot onClick/);
    app.dispose();
  });

  it("claimedChildren is never read", async () => {
    const live = liveHandler();
    const identities = createIdentityRegistry();
    const host = mount();
    identities.provide(host, SOURCE, live.onClick);

    const wired = bundle();
    Object.defineProperty(wired, "claimedChildren", {
      get() {
        throw new Error("claimedChildren read at resume");
      },
    });

    const app = resumeBundle(host, wired, { identities });
    click(host);
    await app.settled();
    expect(live.seen).toEqual(["BUTTON"]);
    app.dispose();
  });
});
