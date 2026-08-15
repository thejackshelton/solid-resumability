import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

import { runComptime } from "../src/comptime/index.ts";
import { createIdentityRegistry } from "../src/resume/identities.ts";
import { createRegistry, type Bundle, type HandlerModule, type IdentityCaptureSlotSpec } from "../src/resume/registry.ts";
import { resumeBundle } from "../src/resume/resumer.ts";

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

/**
 * Mount-time measured-attribute restore. The page is the caller: it owns the
 * live rest object and provides it at the fill site. The artifact's compute
 * reads that identity; nothing here reconstructs a component body.
 */
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

function measuredBundle(
  overrides: Partial<Bundle> = {},
  compute: (slots: Record<string, unknown>) => unknown = (slots) => (slots.rest as { role: string }).role,
): Bundle {
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
        compute,
      },
    ],
    wiring: [],
    loadHandler: async () => {
      throw new Error("no handler on this bundle");
    },
    ...overrides,
  };
}

describe("mount-time restore of a measured attribute from a rest-props identity", () => {
  it("writes the attribute from the page-provided rest object", () => {
    const rest: { role: string; toJSON?: () => unknown } = { role: "separator" };
    Object.defineProperty(rest, "toJSON", {
      value: () => {
        throw new Error("identity cargo was serialized");
      },
    });
    const identities = createIdentityRegistry();
    const host = measuredHost();
    identities.provide(host, REST_SOURCE, rest);

    const app = resumeBundle(host, measuredBundle(), { identities });
    expect(host.querySelector("hr")!.getAttribute("role")).toBe("separator");
    expect(Object.is(identities.resolve(host, REST_SOURCE), rest)).toBe(true);
    app.dispose();
  });

  it("throws at mount when no identity registry is given — and does not paint the attribute", () => {
    const host = measuredHost();
    expect(() => resumeBundle(host, measuredBundle(), {})).toThrow(/needs an identity registry for slot rest/);
    expect(host.querySelector("hr")!.getAttribute("role")).toBeNull();
  });

  it("throws at mount when the rest source was never provided — and does not paint the attribute", () => {
    const identities = createIdentityRegistry();
    const host = measuredHost();
    expect(() => resumeBundle(host, measuredBundle(), { identities })).toThrow(
      /no live identity is registered as "rest"/,
    );
    expect(host.querySelector("hr")!.getAttribute("role")).toBeNull();
  });

  it("apply after restore leaves the attribute unchanged", async () => {
    let computes = 0;
    const rest = { role: "separator" };
    const identities = createIdentityRegistry();
    const host = measuredHost();
    identities.provide(host, REST_SOURCE, rest);

    const increment: HandlerModule = {
      id: "s0",
      event: "click",
      locator: "/",
      captures: [{ name: "n", cell: "c0", access: "read" }, { name: "setN", cell: "c0", access: "write" }],
      create({ n, setN }: Record<string, unknown>) {
        return () => (setN as (value: number) => void)((n as () => number)() + 1);
      },
    };

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
    expect([...node.attributes].map((attr) => attr.name).sort()).toEqual(["role"]);

    node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await app.settled();

    expect(computes).toBe(2);
    expect(app.stats.patches).toBe(0);
    expect(node.getAttribute("role")).toBe("separator");
    expect([...node.attributes].map((attr) => attr.name).sort()).toEqual(["role"]);
    app.dispose();
  });
});

/**
 * WP2 rehearsal: emit the four-shape conjunction and resume that bundle.
 * The page owns the live orientation object and the rest projection; it
 * does not re-run component-body merge/omit beyond those two provides.
 */
const CONJUNCTION = "test/fixtures/shapes/FoldedMeasuredHost.tsx";
const conjunctionDirs: string[] = [];

function conjunctionScratch(): string {
  const dir = mkdtempSync(join(process.cwd(), ".artifacts-conjunction-"));
  conjunctionDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of conjunctionDirs) rmSync(dir, { recursive: true, force: true });
});

describe("emitted four-shape conjunction resumes measured attrs at mount", () => {
  it("emits a full bundle and paints identity cargo the build did not bake", async () => {
    const outRoot = conjunctionScratch();
    const result = runComptime(CONJUNCTION, { component: "FoldedMeasuredHost", outRoot });
    expect(result.analysis.status).toBe("provable");
    if (result.analysis.status !== "provable" || result.emitted === null) {
      throw new Error("expected the conjunction host to emit");
    }
    expect(result.analysis.html).toBe("<hr>");
    expect(result.emitted.files).toEqual(expect.arrayContaining(["manifest.json", "structure.js", "template.js", "wiring.js"]));

    const dir = result.emitted.dir;
    const load = async (file: string) =>
      (await import(pathToFileURL(join(dir, file)).href)) as Record<string, unknown>;
    const template = await load("template.js");
    const structure = await load("structure.js");
    const wiring = await load("wiring.js");
    const registry = createRegistry(
      {
        "/artifacts/FoldedMeasuredHost/template.js": template,
        "/artifacts/FoldedMeasuredHost/structure.js": structure,
        "/artifacts/FoldedMeasuredHost/wiring.js": wiring,
      },
      {},
    );
    const bundle = registry.get("FoldedMeasuredHost");
    if (!bundle) throw new Error("no bundle for FoldedMeasuredHost");

    const live = { orientation: "vertical", id: "from-page" };
    const others = { id: "from-page" };
    const handle = (node: Element) => {
      void node;
    };
    const identities = createIdentityRegistry();
    const host = document.createElement("div");
    host.innerHTML = bundle.template!.html;
    document.body.appendChild(host);
    identities.provide(host, { name: "orientation", path: ["orientation"] }, live);
    identities.provide(host, { name: "orientation", path: ["handle"] }, handle);
    identities.provide(host, { name: "others", path: [] }, others);

    const app = resumeBundle(host, bundle, { identities });
    const node = host.querySelector("hr")!;
    expect(node.getAttribute("role")).toBe("separator");
    expect(node.getAttribute("aria-orientation")).toBe("vertical");
    expect(node.getAttribute("data-orientation")).toBe("vertical");
    expect(node.getAttribute("id")).toBe("from-page");
    expect(Object.is(identities.resolve(host, { name: "others", path: [] }), others)).toBe(true);
    app.dispose();
    host.remove();
  });
});
