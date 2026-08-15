import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterAll, describe, expect, it } from "vitest";
import { render } from "@solidjs/web";
import { Analyzer, type Module } from "yuku-analyzer";

import { classify, emit, runComptime } from "../src/comptime/index.ts";
import type { Analysis, ProvableAnalysis, ReasonCode } from "../src/comptime/types.ts";
import { createRegistry } from "../src/resume/registry.ts";
import { resumeBundle } from "../src/resume/resumer.ts";
import { createStoreRegistry } from "../src/resume/stores.ts";
import { Roster } from "./fixtures/KeyedList.tsx";
import { createRoster, seedRoster, type Member } from "./fixtures/roster.ts";

/**
 * Keyed `<For>` regions: the shape `<Show>` is the degenerate case of.
 *
 * The claim is not "the pass admits `<For>`". It is that the resume path never
 * BUILDS a list — it READS one — and that every address into it is an IDENTITY:
 *
 *   I1 — nothing is inserted, removed or reordered before activation, so there
 *        is no reconciliation to get wrong. The build emits an EMPTY container
 *        and no item markup into the component's own template, which is that
 *        invariant stated as bytes rather than promised as behaviour.
 *   I2 — every binding and every listener resolves through the key an item's
 *        element carries. The load-bearing test below REORDERS the served items
 *        between emit and resume and still dispatches `b`'s click to `b`; a key
 *        the page never read refuses loudly rather than reaching a neighbour.
 *   I3 — the region introduces no shared reactive source, so atomicity is
 *        inherited rather than re-argued.
 *   I4 — the store's only writer is the group, so the region's DOM is read-only
 *        in the resumed window: item bindings are RECORDED and never applied.
 *
 * And the five refusals, each with its own case at the bottom of the file.
 *
 * On `data-key` and `test/parity.test.tsx`: the key never enters the component's
 * own template. A region's list is a store projection with no build-time value,
 * so the region contributes NOTHING to `analysis.html` — the container is served
 * empty and `data-key` lives only in `itemTemplate`, an artifact used to address
 * items the page's own first paint carried. The first test in this file is the
 * evidence: unmodified Solid's render of the fixture is byte-identical to
 * `analysis.html`, and `analysis.html` contains no `data-key` at all.
 */

const scratchDirs: string[] = [];

/** Inside the repo: these artifacts are `import()`ed, and Vite resolves what is
 * under the project root. Removed in `afterAll`. */
function scratch(): string {
  const dir = mkdtempSync(join(process.cwd(), "test", ".artifacts-keyed-regions-"));
  scratchDirs.push(dir);
  return dir;
}

const disposers: Array<() => void> = [];

afterAll(() => {
  while (disposers.length) disposers.pop()!();
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
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

// ----------------------------------------------------------- the real fixture

const ROSTER: Member[] = [
  { id: "a", name: "Ada" },
  { id: "b", name: "Bob" },
  { id: "c", name: "Cy" },
];

const { analysis: classified } = runComptime("test/fixtures/KeyedList.tsx", {
  write: false,
  component: "RosterList",
});
if (classified.status !== "provable") {
  throw new Error(`RosterList should be provable: ${classified.reasons.map((r) => r.code).join(", ")}`);
}
const roster: ProvableAnalysis = classified;
const [region] = roster.keyedRegions;

describe("the template — an empty container, and no key in the served bytes", () => {
  it("matches what unmodified Solid renders, byte for byte", () => {
    // THE named risk of this slice, taken first. The region's list is a store
    // projection, so it has no build-time value and the build templates the
    // container EMPTY — which is exactly what Solid renders for an empty list,
    // with no marker comment and no item markup. `data-key` is nowhere in these
    // bytes, so the assumption `test/parity.test.tsx` states about every locator
    // is untouched by this slice rather than argued around.
    seedRoster([]);
    const host = mount(Roster);

    expect(host.innerHTML).toBe(roster.html);
    expect(roster.html).toBe('<ul class="roster"></ul>');
    expect(roster.html).not.toContain("data-key");
  });

  it("puts the key only on the item template, where the page's own items are addressed", () => {
    // The item template is not served markup and is not compared to any. It is
    // how an item the PAGE painted is addressed: `keyAttribute` says where the
    // key sits, and the locators inside it are rooted at the item element.
    expect(region.keyAttribute).toBe("data-key");
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

describe("the record — a container, a key path, and one item's address space", () => {
  it("addresses the CONTAINER, not the `<For>`", () => {
    // A `<For>` renders nothing the build can address. What survives into the
    // served markup is its parent, whose children ARE the items — which is also
    // why the pass only admits a `<For>` that is its container's only child.
    expect(roster.keyedRegions).toHaveLength(1);
    expect(region).toMatchObject({ id: "k0", container: "/", item: "member", keyPath: ["id"] });
    expect(region.each).toBe("roster.members");
  });

  it("expresses the list over store IDENTITY, never over store data", () => {
    expect(region.captures).toEqual([{ name: "roster", kind: "store-read", store: "s0", path: [0] }]);
  });

  it("roots an item's bindings and listeners at the ITEM, in a numbering of their own", () => {
    expect(region.itemBindings).toHaveLength(1);
    expect(region.itemBindings[0]).toMatchObject({
      id: "k0b0",
      kind: "text",
      locator: "/0",
      expression: "member.name",
      // No build-time answer: at build time there is no list. The text is a hole
      // the page's own first paint already filled.
      initialTextFrom: "capture",
    });
    expect(region.itemBindings[0].captures).toEqual([
      { name: "member", kind: "region-item", region: "k0" },
    ]);

    expect(region.itemWiring).toHaveLength(1);
    expect(region.itemWiring[0]).toMatchObject({ locator: "/1", event: "click", handler: "s0" });
    expect(region.itemWiring[0].captures).toEqual([
      { name: "drop", kind: "action", store: "s0", path: [1, "drop"] },
      { name: "member", kind: "region-item", region: "k0" },
    ]);

    // And the component's own flat wiring stays EMPTY: an item's locator is
    // rooted at an item element, so from the component's root it would address
    // something else entirely.
    expect(roster.wiring).toEqual([]);
    expect(roster.bindings).toEqual([]);
  });

  it("emits the region into `structure.js`, and nothing into a component without one", () => {
    const dir = join(scratch(), "RosterList");
    emit(roster, dir);
    const structure = readFileSync(join(dir, "structure.js"), "utf8");

    expect(structure).toContain("export const keyedRegions = [");
    expect(structure).toContain("return roster.members;");
    expect(structure).toContain('kind: "region-item"');

    // The same discipline `stores` and `regions` follow: a component with no
    // list says nothing about keyed regions, so every artifact emitted before
    // this slice comes out byte for byte what it was.
    expect(readFileSync("artifacts/CounterA/structure.js", "utf8")).not.toContain("keyedRegions");
  });
});

// ------------------------------------------------- classify -> emit -> resume

interface Resumed {
  container: Element;
  app: ReturnType<typeof resumeBundle>;
  dropped: string[];
}

/**
 * The whole path, once: emit the artifacts, build the served DOM the way a page
 * carrying a populated region would, register the live store, resume.
 *
 * `served` is the order the DOM is in when the resumer reads it — deliberately
 * an argument, because the point of the load-bearing test is that it may differ
 * from the order the build ever saw and nothing downstream cares.
 */
async function resumeRoster(served: Member[], live: Member[] = served): Promise<Resumed> {
  const dir = join(scratch(), "RosterList");
  emit(roster, dir);

  const load = async (file: string) =>
    (await import(pathToFileURL(join(dir, file)).href)) as Record<string, unknown>;

  const registry = createRegistry(
    {
      "/artifacts/RosterList/template.js": await load("template.js"),
      "/artifacts/RosterList/structure.js": await load("structure.js"),
      "/artifacts/RosterList/wiring.js": await load("wiring.js"),
    },
    { "/artifacts/RosterList/handlers/s0.js": () => load("handlers/s0.js") as never },
  );

  const bundle = registry.get("RosterList")!;
  const container = document.createElement("div");
  container.innerHTML = servedMarkup(served);
  document.body.appendChild(container);
  disposers.push(() => container.remove());

  seedRoster(live);
  const stores = createStoreRegistry();
  const value = createRoster();
  stores.provide("s0", value);

  // A resumed page's markup carries the items its own first paint painted, so it
  // is NOT the empty-container template. That check belongs to the build that
  // wrote the populated markup; here it would only assert the fixture.
  const app = resumeBundle(container, bundle, { stores, verifyTemplate: false });
  return { container, app, dropped: value[1].dropped() };
}

/** The markup a page carrying a populated region serves: the item template, once
 * per item, with the key filled in and the measured text painted. */
function servedMarkup(members: Member[]): string {
  const items = members
    .map((member) =>
      region.itemTemplate
        .replace('data-key=""', `data-key="${member.id}"`)
        .replace('<span class="name"></span>', `<span class="name">${member.name}</span>`),
    )
    .join("");
  return `<ul class="roster">${items}</ul>`;
}

describe("resume — the list is read, and every address is an identity", () => {
  it("dispatches to the item the KEY names, not to the one in that position", async () => {
    // The load-bearing case. The build never saw an order; the page serves one;
    // and this test serves the REVERSE of the store's own, so the element at
    // index 0 is the item at index 2. A resolution that counted children would
    // drop `Cy` here. The key is what makes it drop `Bob`.
    const served = [...ROSTER].reverse();
    const { container, app, dropped } = await resumeRoster(served, ROSTER);

    const items = [...container.querySelectorAll<HTMLElement>("li.member")];
    expect(items.map((item) => item.getAttribute("data-key"))).toEqual(["c", "b", "a"]);

    items[1].querySelector<HTMLButtonElement>("button.drop")!.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    await app.settled();

    expect(dropped).toEqual(["b"]);
    expect(app.stats).toMatchObject({ handlerLoads: 1, dispatches: 1 });

    // First and last, to rule out the reading that only the middle survives a
    // reversal: the first served element is the store's LAST item.
    items[0].querySelector<HTMLButtonElement>("button.drop")!.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    await app.settled();
    expect(dropped).toEqual(["b", "c"]);
  });

  it("attaches ONE listener at the container, however many items there are", async () => {
    const { container, app } = await resumeRoster(ROSTER);
    const list = container.firstElementChild!;

    // The container is the resume container, not the `<ul>` — and no item and no
    // button carries a listener of its own, so an item costs nothing to add and
    // leaks nothing when it goes.
    let attached = 0;
    const original = Element.prototype.addEventListener;
    for (const element of [list, ...list.querySelectorAll("*")]) {
      element.addEventListener = function (this: Element, ...args: Parameters<typeof original>) {
        attached++;
        return original.apply(this, args);
      } as typeof original;
    }
    expect(attached).toBe(0);

    // Every item dispatches through that one listener — and all three land
    // before the resolver has arrived, since nothing has been awaited yet. They
    // are heard anyway, because the listener set is eager artifact data and the
    // module's arrival is a wait inside the queue.
    for (const item of container.querySelectorAll<HTMLElement>("button.drop")) {
      item.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }
    await app.settled();
    expect(app.stats.dispatches).toBe(3);
    // One import for the whole region, not one per item: the handler module is
    // the region's, and the item is a slot it is called with.
    expect(app.stats.handlerLoads).toBe(3);
  });

  it("leaves the region's DOM exactly as the page painted it", async () => {
    // I1 and I4 together, as an assertion rather than as a paragraph. Resuming
    // inserts nothing, removes nothing, reorders nothing, and applies no item
    // binding — the store's only writer is the group, so until the group runs
    // this markup is somebody else's.
    const served = [...ROSTER].reverse();
    const before = servedMarkup(served);
    const { container, app } = await resumeRoster(served, ROSTER);

    expect(container.innerHTML).toBe(before);

    container.querySelector<HTMLButtonElement>("button.drop")!.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    await app.settled();
    expect(container.innerHTML).toBe(before);
  });

  it("carries the item template and the key path through to the page", async () => {
    const { app } = await resumeRoster(ROSTER);
    void app;
    // Read off the bundle rather than off the analysis: this is what a page gets.
    const dir = join(scratch(), "RosterList");
    emit(roster, dir);
    const structure = (await import(pathToFileURL(join(dir, "structure.js")).href)) as Record<string, unknown>;
    const [spec] = structure.keyedRegions as Array<Record<string, unknown>>;
    expect(spec).toMatchObject({ id: "k0", container: "/", keyAttribute: "data-key", keyPath: ["id"] });
  });
});

describe("what a page with no list pays for one", () => {
  // The eager chunk is the product, so this is asserted on the source that
  // becomes it rather than inferred from behaviour. `resumer.ts` names
  // `regions.ts` twice: once as a type, which compiles to nothing, and once as
  // the `import()` the decision point takes. A third mention would be a static
  // edge, and a static edge would put the whole resolver — the key map, the
  // record cache, both refusals — in front of every page that resumes anything.
  const source = readFileSync("src/resume/resumer.ts", "utf8");

  it("names the resolver statically only as a type", () => {
    const statics = [...source.matchAll(/^import (type )?[^\n]*"\.\/regions\.ts";$/gm)];
    expect(statics).toHaveLength(1);
    expect(statics[0][1]).toBe("type ");
  });

  it("reaches it by exactly one dynamic import", () => {
    expect([...source.matchAll(/import\("\.\/regions\.ts"\)/g)]).toHaveLength(1);
  });

  it("takes that import inside the queue, never in front of a listener", () => {
    // Where the import sits is the no-gap argument: `append` is the FIFO, and
    // the await is inside the task it appends. `addEventListener` runs at
    // resume, from the event types the artifacts name, and nothing between here
    // and there is awaited.
    const inQueue = /append\(async \(\) => \{\n\s+const resolver = await regionsArrive\(\);/;
    expect(source).toMatch(inQueue);
    expect(source).toMatch(/for \(const type of eventTypes\) container\.addEventListener\(type, onEvent\);/);
  });
});

describe("a missing key refuses loudly, and never binds to a neighbour", () => {
  it("refuses at the first dispatch when a served item carries no key at all", async () => {
    const dir = join(scratch(), "RosterList");
    emit(roster, dir);
    const load = async (file: string) =>
      (await import(pathToFileURL(join(dir, file)).href)) as Record<string, unknown>;

    const registry = createRegistry(
      {
        "/artifacts/RosterList/template.js": await load("template.js"),
        "/artifacts/RosterList/structure.js": await load("structure.js"),
        "/artifacts/RosterList/wiring.js": await load("wiring.js"),
      },
      {},
    );
    const bundle = registry.get("RosterList")!;

    const container = document.createElement("div");
    // The middle item lost its key. Position would happily call it the second
    // one; identity refuses, before a single dispatch resolves to anything.
    container.innerHTML = servedMarkup(ROSTER).replace(' data-key="b"', "");
    document.body.appendChild(container);
    disposers.push(() => container.remove());

    // Resuming reads no item: the walk that does travels with `regions.ts`, and
    // that module is fetched by the first event to come through the container.
    // So the refusal is a rejected dispatch rather than a throw at resume — the
    // same words, at the first moment position could have been used instead of
    // identity. Nothing was resumed on trust in between: a page that PAINTS a
    // keyed region owes the keys, and `plugin/src/stages/prerender.ts` asserts
    // that on the captured paint before the document is written.
    const app = resumeBundle(container, bundle, { verifyTemplate: false });

    container
      .querySelector<HTMLButtonElement>("button.drop")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await expect(app.settled()).rejects.toThrow(/no data-key/);
  });

  it("refuses at dispatch when the key names an item the live list does not have", async () => {
    // The page painted three; the store has two. The click lands on an item that
    // is gone, and the answer is an error — not the neighbour that happens to
    // sit where it used to.
    const { container, app } = await resumeRoster(ROSTER, [ROSTER[0], ROSTER[2]]);

    container
      .querySelectorAll<HTMLButtonElement>("button.drop")[1]
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await expect(app.settled()).rejects.toThrow(/no item keyed b/);
  });
});

// --------------------------------------------------------------- the refusals

const STORE = `export function createRoster() {
    const data = { members: [] as { id: string }[] };
    const actions = { drop(id: string) { return id; } };
    return [data, actions] as const;
  }`;

/** One consumer with two holes, over a fixed context, provider and store —
 * everything a case does not name is identical across cases, so a differing
 * verdict is evidence about the hole. */
function panel(markup: string, declares = "const [roster, { drop }] = useContext(RosterContext);"): Analysis {
  const files: Record<string, string> = {
    "store.ts": STORE,
    "app.tsx": `import { createContext, For, useContext } from "solid-js";
      import { createRoster } from "./store";

      const RosterContext = createContext<ReturnType<typeof createRoster>>();

      function Panel() {
        ${declares}
        return (${markup});
      }

      export function Shell() {
        return (
          <RosterContext value={createRoster()}>
            <Panel />
          </RosterContext>
        );
      }`,
  };

  const analyzer = new Analyzer();
  const modules = new Map<string, Module>();
  for (const [path, source] of Object.entries(files)) modules.set(path, analyzer.addFile(path, source));
  analyzer.link();
  return classify(modules.get("app.tsx")!, "Panel");
}

function codesOf(analysis: Analysis): ReasonCode[] {
  return [...new Set(analysis.reasons.map((reason) => reason.code))].sort();
}

describe("the five refusals, each by its own name", () => {
  it("refuses a list this page could compute for itself", () => {
    // A list with no store behind it is a list this page would have to RENDER,
    // and rendering is the one thing a resumed window does not do.
    const analysis = panel(
      `<ul class="roster"><For each={[1, 2, 3]}>{n => <li>{String(n)}</li>}</For></ul>`,
    );
    expect(analysis.status).toBe("fallback");
    expect(codesOf(analysis)).toContain("region-each-not-store-projection");
  });

  it("refuses a body that is not an inline arrow", () => {
    const analysis = panel(
      `<ul class="roster"><For each={roster.members}><li class="member">x</li></For></ul>`,
    );
    expect(analysis.status).toBe("fallback");
    expect(codesOf(analysis)).toContain("region-body-not-inline-arrow");
  });

  it("refuses index-as-key, because an index is position", () => {
    // Solid's second body parameter is the item's index. A key exists precisely
    // to escape position, so a body that asks for one is refused rather than
    // keyed by it.
    const analysis = panel(
      `<ul class="roster"><For each={roster.members}>{(m, i) => <li>{String(i)}</li>}</For></ul>`,
    );
    expect(analysis.status).toBe("fallback");
    expect(codesOf(analysis)).toContain("region-key-not-derivable");
    expect(
      analysis.reasons.find((reason) => reason.code === "region-key-not-derivable")!.message,
    ).toContain("INDEX");
  });

  it("refuses a key that is a function rather than a fixed path", () => {
    const analysis = panel(
      `<ul class="roster"><For each={roster.members} key={m => m.id}>{m => <li>x</li>}</For></ul>`,
    );
    expect(analysis.status).toBe("fallback");
    expect(codesOf(analysis)).toContain("region-key-not-derivable");
  });

  it("takes a fixed path a `key` names, and defaults to `id` when it names none", () => {
    const named = panel(
      `<ul class="roster"><For each={roster.members} key="meta.id">{m => <li class="m">{m.name}</li>}</For></ul>`,
    );
    expect(named.status).toBe("provable");
    expect((named as ProvableAnalysis).keyedRegions[0].keyPath).toEqual(["meta", "id"]);
  });

  it("refuses an item that is not a single element", () => {
    const analysis = panel(
      `<ul class="roster"><For each={roster.members}>{m => m.name}</For></ul>`,
    );
    expect(analysis.status).toBe("fallback");
    expect(codesOf(analysis)).toContain("region-item-not-single-element");
  });

  it("refuses a region inside a region", () => {
    // Two address spaces stacked: an item's locators would depend on which list
    // they were reached through, and nothing on the resume path reads two.
    const analysis = panel(
      `<ul class="roster"><For each={roster.members}>{m => (
         <li class="member"><ul class="inner"><For each={roster.members}>{n => <li>{n.name}</li>}</For></ul></li>
       )}</For></ul>`,
    );
    expect(analysis.status).toBe("fallback");
    expect(codesOf(analysis)).toContain("region-nested");
  });

  it("leaves a `<For>` beside a sibling to the refusal it always had", () => {
    // A region owns its container's children WHOLESALE — the runtime calls every
    // one of them an item — so a `<For>` with a sibling is not offered the
    // region at all, and keeps `jsx-component-element`.
    const analysis = panel(
      `<ul class="roster"><li class="head">head</li><For each={roster.members}>{m => <li>{m.name}</li>}</For></ul>`,
    );
    expect(analysis.status).toBe("fallback");
    expect(codesOf(analysis)).toContain("jsx-component-element");
    expect(codesOf(analysis)).not.toContain("region-each-not-store-projection");
  });

  it("is Solid's `For` by resolution, not by spelling", () => {
    // A local component named `For` is not control flow, whatever it is handed.
    const analysis = panel(
      `<ul class="roster"><For each={roster.members}>{m => <li>{m.name}</li>}</For></ul>`,
      "const roster = { members: [] };\n        const For = (p: { each: unknown[]; children: unknown }) => null;\n        void For; void roster;",
    );
    expect(codesOf(analysis)).not.toContain("region-each-not-store-projection");
  });
});
