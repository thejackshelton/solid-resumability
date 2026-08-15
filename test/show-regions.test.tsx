import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterAll, afterEach, describe, expect, it } from "vitest";
import { render } from "@solidjs/web";
import { Analyzer, type Module } from "yuku-analyzer";

import { classify, emit, runComptime } from "../src/comptime/index.ts";
import type { Analysis, ProvableAnalysis, ReasonCode } from "../src/comptime/types.ts";
import { createRegistry } from "../src/resume/registry.ts";
import { resumeBundle } from "../src/resume/resumer.ts";
import { GuardedRow } from "./fixtures/GuardedRow.tsx";

/**
 * Two-state `<Show>` regions: the degenerate keyed region, and the one piece of
 * control flow this pass admits.
 *
 * The claim is not "the pass admits `<Show>`". It is that a region is a GUARD
 * rather than a toggle, and that the guard is decided at BUILD time so the
 * resume path never has to create DOM:
 *
 *   - a region the build folded PRESENT is ordinary markup, spliced where it
 *     sits, and everything under it is proved like any other element;
 *   - a region recorded ABSENT has no DOM, contributes no binding and no wiring,
 *     and is not even walked — nothing inside it exists to be proved;
 *   - a guard reaching a SOURCE CELL is refused by name, because a cell is
 *     written by a resumed handler on this very page, and a guard this page can
 *     flip for itself is a region this page would have to build.
 *
 * A guard reaching a STORE is the admitted asymmetry: the store's writer is the
 * group, and a group event renders the component the ordinary way, so the build
 * records the region absent and the page's captured first paint is what proves
 * it. `plugin/test/prerender.test.ts` is where that proof is actually taken.
 *
 * The refusal half is the rest of the file. `jsx-component-element` was
 * NARROWED, not lifted: a `fallback`, a render-prop child, two children, and a
 * component that merely spells its name `Show` all still refuse under the code
 * they always did.
 */

const scratchDirs: string[] = [];

/** Inside the repo: these artifacts are `import()`ed, and Vite resolves what is
 * under the project root. Removed in `afterAll`. */
function scratch(): string {
  const dir = mkdtempSync(join(process.cwd(), "test", ".artifacts-show-regions-"));
  scratchDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
});

// ----------------------------------------------------------- in-memory corpus

function project(files: Record<string, string>): Map<string, Module> {
  const analyzer = new Analyzer();
  const modules = new Map<string, Module>();
  for (const [path, source] of Object.entries(files)) modules.set(path, analyzer.addFile(path, source));
  analyzer.link();
  return modules;
}

function classifyProject(files: Record<string, string>, entry: string, component?: string): Analysis {
  const module = project(files).get(entry);
  if (module === undefined) throw new Error(`no entry module ${entry}`);
  return classify(module, component);
}

function codesOf(analysis: Analysis): ReasonCode[] {
  return [...new Set(analysis.reasons.map((reason) => reason.code))].sort();
}

function proved(analysis: Analysis): ProvableAnalysis {
  if (analysis.status !== "provable") {
    throw new Error(`expected provable, got refusals: ${codesOf(analysis).join(", ") || "(none)"}`);
  }
  return analysis;
}

/** A store whose data slot is what a guard reaches into. */
const STORE = `export function createTodos() {
    const data = { items: [] as string[] };
    const actions = { clear() { return data.items.length; } };
    return [data, actions] as const;
  }`;

/**
 * One consumer with two holes — what the component returns, and what it declares
 * above it — over a fixed context, provider and store. Everything a case does
 * not name is identical across cases, so a differing verdict is evidence about
 * the hole rather than about the scaffolding.
 */
function app(markup: string, declares = "const [todos, { clear }] = useContext(TodosContext);"): Record<string, string> {
  return {
    "store.ts": STORE,
    "app.tsx": `import { createContext, createSignal, Show, useContext } from "solid-js";
      import { createTodos } from "./store";

      const TodosContext = createContext<ReturnType<typeof createTodos>>();

      function Panel() {
        ${declares}
        return (${markup});
      }

      export function Shell() {
        return (
          <TodosContext value={createTodos()}>
            <Panel />
          </TodosContext>
        );
      }`,
  };
}

function panel(markup: string, declares?: string): Analysis {
  return classifyProject(app(markup, declares), "app.tsx", "Panel");
}

/** The shape every store case below varies one thing away from: a guard over the
 * store's data, one element child, and a sibling outside the region. */
const GUARDED = `
  <footer class="panel">
    <Show when={todos.items.length > 0}>
      <button class="clear" onClick={clear}>Clear</button>
    </Show>
    <span class="hint">nothing yet</span>
  </footer>`;

// ------------------------------------------------------------------ the shapes

describe("a guard reaching a store — the region is recorded absent", () => {
  const analysis = proved(panel(GUARDED));
  const [region] = analysis.regions;

  it("records the position, the guard and the state, and says the capture decided it", () => {
    expect(analysis.regions).toHaveLength(1);
    expect(region).toMatchObject({
      id: "r0",
      locator: "/0",
      when: "todos.items.length > 0",
      present: false,
      presentFrom: "capture",
    });
    // The guard travels expressed in the same capture slots every other
    // artifact uses — identity, never the store's data.
    expect(region.captures).toEqual([{ name: "todos", kind: "store-read", store: "s0", path: [0] }]);
  });

  it("puts no DOM where the region sits, and nothing inside it is proved", () => {
    // The button is inside the region. It is not in the markup, it owns no
    // wiring, and it was never even walked — an absent region has nothing in it
    // for this pass to have an opinion about.
    expect(analysis.html).toBe('<footer class="panel"><span class="hint">nothing yet</span></footer>');
    expect(analysis.wiring).toEqual([]);
    expect(analysis.handlers).toEqual([]);
    expect(analysis.bindings).toEqual([]);
  });

  it("indexes the sibling by where it actually is, not by which JSX child it is", () => {
    // The span is the footer's SECOND JSX child and its FIRST element, and the
    // region sits where no element is. A locator is an element index in the
    // served markup, so both read `/0` and neither is wrong.
    expect(analysis.html).toContain('<span class="hint">');
    expect(region.locator).toBe("/0");
  });

  it("emits the region into `structure.js`, and nothing into a component without one", () => {
    const dir = join(scratch(), "Panel");
    emit(analysis, dir);
    const structure = readFileSync(join(dir, "structure.js"), "utf8");

    expect(structure).toContain("export const regions = [");
    expect(structure).toContain('presentFrom: "capture"');
    expect(structure).toContain("return todos.items.length > 0;");

    // The same discipline `stores` follows: a component with no control flow
    // says nothing about regions, so every artifact from before they existed
    // comes out byte for byte what it was.
    const plain = readFileSync("artifacts/CounterA/structure.js", "utf8");
    expect(plain).not.toContain("regions");
  });
});

describe("a guard the build folds — the region is ordinary markup, either way", () => {
  // Byte parity is the load-bearing claim here, so this case is a real fixture
  // rendered by unmodified Solid rather than an in-memory string.
  const { analysis: folded } = runComptime("test/fixtures/GuardedRow.tsx", { write: false });
  const analysis = proved(folded);

  const disposers: Array<() => void> = [];
  afterEach(() => {
    while (disposers.length) disposers.pop()!();
  });

  it("splices a present region where it sits and records it as derived", () => {
    expect(analysis.regions.map((region) => [region.id, region.present, region.presentFrom])).toEqual([
      ["r0", true, "derivation"],
      ["r1", false, "derivation"],
    ]);
    expect(analysis.html).toContain('<p class="always">always</p>');
    expect(analysis.html).not.toContain("never");
  });

  it("matches what unmodified Solid renders, byte for byte", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    disposers.push(render(GuardedRow as never, host));
    disposers.push(() => host.remove());

    // Everything about regions rests on this line. The marker comment after the
    // present region, the absence of one after the region that is not there, and
    // the element indices the locators below claim are all Solid's, not ours.
    expect(host.innerHTML).toBe(analysis.html);
  });

  it("addresses the nodes an absent region shifted", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    disposers.push(render(GuardedRow as never, host));
    disposers.push(() => host.remove());
    const root = host.firstElementChild!;

    // Third and fourth JSX children; second and third elements.
    expect(analysis.wiring[0].locator).toBe("/1");
    expect(analysis.bindings[0].locator).toBe("/2");
    expect(root.children[1].className).toBe("bump");
    expect(root.children[2].className).toBe("count");
  });
});

describe("resume — an absent region installs nothing", () => {
  async function resumed() {
    const dir = join(scratch(), "Panel");
    const analysis = proved(panel(GUARDED));
    emit(analysis, dir);

    const load = async (file: string) =>
      (await import(pathToFileURL(join(dir, file)).href)) as Record<string, unknown>;

    const registry = createRegistry(
      {
        "/artifacts/Panel/template.js": await load("template.js"),
        "/artifacts/Panel/structure.js": await load("structure.js"),
        "/artifacts/Panel/wiring.js": await load("wiring.js"),
      },
      {},
    );

    const bundle = registry.get("Panel")!;
    const container = document.createElement("div");
    container.innerHTML = bundle.template!.html;
    document.body.appendChild(container);
    return { bundle, container, app: resumeBundle(container, bundle) };
  }

  it("carries the region record through to the page, unread", () => {
    // There is no resumer branch for a region, and that is the design: the build
    // already emitted no DOM, no binding and no wiring for it, so "installs
    // nothing" is true before this code runs. The record travels so the claim is
    // READABLE — what state this build recorded, and what guard decided it.
    return resumed().then(({ bundle, container, app: resumedApp }) => {
      expect(bundle.regions).toHaveLength(1);
      expect(bundle.regions[0]).toMatchObject({ id: "r0", locator: "/0", present: false, presentFrom: "capture" });
      expect(bundle.wiring).toEqual([]);
      expect(bundle.bindings).toEqual([]);

      // Nothing to load, nothing to dispatch: a click where the region would be
      // reaches no listener, because the build installed none.
      container.firstElementChild!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(resumedApp.stats).toMatchObject({ handlerLoads: 0, dispatches: 0, patches: 0 });

      resumedApp.dispose();
      container.remove();
    });
  });
});

// -------------------------------------------------- reachability from output

/**
 * The narrowing that closes `store-read-escapes` for a guard-absent component,
 * and the control that keeps it honest.
 *
 * The claim: a local derivation that NO EMITTED ARTIFACT REACHES is not a
 * blocker. It is the same sentence as "a measured guard's child is never
 * walked", said one level up — a component whose outer region is absent emits a
 * template with nothing in it, no binding, no wiring and no keyed region, so
 * the closure its markup would have called is, to everything this pass emits,
 * code that is not there.
 *
 * What makes that a narrowing rather than a hole is that it is REACHABILITY,
 * not a reference count, and reachability is the walk's own record. So the same
 * component, with the same closure, refuses the moment the region is recorded
 * PRESENT — nothing is remembered to make that happen, it falls out of the walk
 * entering the branch. Both directions are asserted here, over one body.
 */
describe("a derivation no emitted artifact reaches", () => {
  const DECLARES = `const [todos, { clear }] = useContext(TodosContext);
        const remaining = () => todos.items.filter(x => x !== "").length;`;

  /** One body, one hole: the guard. Everything the region contains, and the
   * closure it calls, is identical across the two cases. */
  const guarded = (guard: string) => `
  <footer class="panel">
    <Show when={${guard}}>
      <span class="count">{remaining()}</span>
    </Show>
    <span class="hint">nothing yet</span>
  </footer>`;

  it("is exempt where the region is absent, and the component proves", () => {
    const analysis = proved(panel(guarded("todos.items.length > 0"), DECLARES));

    // `remaining` reads the store by a route this pass never performed —
    // `todos.items.filter(…)` is a method call on the store's data. It is not
    // an escape here because nothing emitted reaches it: the region is absent,
    // so the span that would have called it was never walked.
    expect(analysis.regions[0]).toMatchObject({ present: false, presentFrom: "capture" });
    expect(analysis.html).toBe('<footer class="panel"><span class="hint">nothing yet</span></footer>');
    expect(analysis.bindings).toEqual([]);
    expect(analysis.wiring).toEqual([]);
    expect(analysis.keyedRegions).toEqual([]);

    // The store is still named, in full: the narrowing exempts a USE, never the
    // binding, and the artifact carries the read slot exactly as it always did.
    expect(analysis.reads).toEqual([
      { id: "s0r", store: "s0", name: "todos", path: [0], loc: expect.anything() },
    ]);
  });

  it("refuses again the moment the same region is recorded present", () => {
    // The control, and the whole reason the narrowing is reachability-based. A
    // folded guard makes the region ordinary markup, the walk enters it, the
    // text child reaches `remaining`, and the escape the case above exempted is
    // an escape again — same closure, same store, same sentence.
    const analysis = panel(guarded("true"), DECLARES);
    expect(analysis.status).toBe("fallback");
    expect(codesOf(analysis)).toContain("store-read-escapes");
  });

  it("analyses a derivation reached through the guard itself", () => {
    // A guard is an attribute of an element the walk entered, so it is emitted
    // output like any other: what the guard names is reached, and stays fully
    // analysed. Nothing here is exempt — the guard cannot be decided AND the
    // read it goes through is an escape.
    const analysis = panel(
      `<footer class="panel"><Show when={anyLeft()}><b>hi</b></Show></footer>`,
      `const [todos, { clear }] = useContext(TodosContext);
        const anyLeft = () => todos.items.filter(x => x).length > 0;`,
    );
    expect(analysis.status).toBe("fallback");
    expect(codesOf(analysis)).toContain("show-branch-not-static-at-capture");
    expect(codesOf(analysis)).toContain("store-read-escapes");
  });

  it("exempts no write, reached or not", () => {
    // Reachability says nobody READS this. It says nothing about a component
    // that WRITES to a store, and the narrowing is not the place to start.
    const analysis = panel(
      `<footer class="panel"><Show when={todos.items.length > 0}><b>hi</b></Show></footer>`,
      `const [todos, { clear }] = useContext(TodosContext);
        const wipe = () => { todos.items = []; };
        void wipe;`,
    );
    expect(analysis.status).toBe("fallback");
    expect(codesOf(analysis)).toContain("store-read-escapes");
  });
});

// --------------------------------------------------------------- the refusals

describe("the narrowing still refuses what it always refused", () => {
  it("refuses a guard a resumed handler could flip", () => {
    // The whole asymmetry, in one case. A store is written by the group, which
    // renders the component the ordinary way; a cell is written by a handler on
    // this page, with no group in the picture. Pinning the region to whatever
    // the cell said at build time would be a page that quietly stops working.
    const analysis = panel(
      `<footer class="panel"><Show when={open()}><b>hi</b></Show></footer>`,
      "const [todos, { clear }] = useContext(TodosContext);\n        const [open, setOpen] = createSignal(false);\n        void setOpen;",
    );
    expect(analysis.status).toBe("fallback");
    expect(codesOf(analysis)).toContain("show-branch-not-static-at-capture");
    expect(
      analysis.reasons.find((reason) => reason.code === "show-branch-not-static-at-capture")!.message,
    ).toContain("`open`");
  });

  it("refuses a guard it can neither fold nor measure", () => {
    const analysis = panel(
      `<footer class="panel"><Show when={todos.items.filter(Boolean).length}><b>hi</b></Show></footer>`,
    );
    expect(analysis.status).toBe("fallback");
    expect(codesOf(analysis)).toContain("show-branch-not-static-at-capture");
  });

  it("keeps walking the markup under a guard it refused", () => {
    // A refused guard did not decide a branch, but the markup under it is real
    // code with its own defects, and exhaustive collection still applies.
    const analysis = panel(
      `<footer class="panel"><Show when={mystery()}><b>{whatever}</b></Show></footer>`,
    );
    expect(codesOf(analysis)).toContain("show-branch-not-static-at-capture");
    expect(codesOf(analysis)).toContain("jsx-dynamic-child-not-derivable");
  });

  it("leaves every other `<Show>` shape to the refusal it always had", () => {
    const cases: Record<string, string> = {
      "a fallback branch": `<Show when={todos.items.length > 0} fallback={<i>none</i>}><b>hi</b></Show>`,
      "a render-prop child": `<Show when={todos.items.length > 0}>{x => <b>{String(x)}</b>}</Show>`,
      "two children": `<Show when={todos.items.length > 0}><b>hi</b><i>there</i></Show>`,
    };
    for (const [name, markup] of Object.entries(cases)) {
      const analysis = panel(`<footer class="panel">${markup}</footer>`);
      expect(analysis.status, name).toBe("fallback");
      expect(codesOf(analysis), name).toContain("jsx-component-element");
      expect(codesOf(analysis), name).not.toContain("show-branch-not-static-at-capture");
    }
  });

  it("is Solid's `Show` by resolution, not by spelling", () => {
    // A local component named `Show`, taking a prop named `when`, is not control
    // flow — and Solid's `Show` imported under another name still is.
    const files = {
      "store.ts": STORE,
      "app.tsx": `import { createContext, useContext } from "solid-js";
        import { createTodos } from "./store";

        const TodosContext = createContext<ReturnType<typeof createTodos>>();
        function Show(props: { when: boolean }) { return <b>{String(props.when)}</b>; }

        function Panel() {
          const [todos, { clear }] = useContext(TodosContext);
          return (
            <footer class="panel">
              <Show when={todos.items.length > 0} />
            </footer>
          );
        }

        export function Shell() {
          return (
            <TodosContext value={createTodos()}>
              <Panel />
            </TodosContext>
          );
        }`,
    };
    const analysis = classifyProject(files, "app.tsx", "Panel");
    expect(analysis.status).toBe("fallback");
    expect(codesOf(analysis)).not.toContain("show-branch-not-static-at-capture");
  });
});

// --------------------------------------------- the corpus, analysis only

describe("the app's own outer regions — analysis only, no component flips", () => {
  const outer = (component: string) => {
    const { analysis } = runComptime("app/src/app.tsx", { write: false, component });
    return analysis;
  };

  it("records MainSection's and Footer's outer `<Show>` absent, and proves both", () => {
    for (const name of ["MainSection", "Footer"]) {
      const analysis = proved(outer(name));

      // Guard-only, and that is the whole component: one region, recorded
      // absent by the capture, and nothing else. Each reads the store through a
      // closure this pass never derived — `todos.filter(…)`, `todos.length` —
      // and no emitted artifact reaches one of them, because the branch that
      // would have called it is not in the served markup.
      expect(analysis.html, name).toBe("");
      expect(analysis.regions, name).toHaveLength(1);
      expect(analysis.regions[0], name).toMatchObject({
        locator: "/",
        when: "todos.length > 0",
        present: false,
        presentFrom: "capture",
      });
      expect(analysis.cells, name).toEqual([]);
      expect(analysis.bindings, name).toEqual([]);
      expect(analysis.wiring, name).toEqual([]);
      expect(analysis.keyedRegions, name).toEqual([]);

      // The store is named in full all the same: one store, one read slot, and
      // the action each of them destructures.
      expect(analysis.stores, name).toHaveLength(1);
      expect(analysis.reads.map((read) => read.path), name).toEqual([[0]]);
    }

    // The flip is theirs alone. `TodoItem` lives INSIDE MainSection's absent
    // region and is refused on its own markup, which nothing here narrows.
    expect(outer("TodoItem").status).toBe("fallback");
  });

  it("would record `todos.length > 0` as absent, measured from the capture", () => {
    // A fallback analysis carries no regions — the verdict is the reasons — so
    // the recorded shape is asserted where it exists: over the same guard, in a
    // component whose only defect is the guard's surroundings. The corpus claim
    // above is that the guard stopped refusing; this is what it would say.
    const analysis = proved(panel(GUARDED));
    expect(analysis.regions[0]).toMatchObject({ present: false, presentFrom: "capture" });
  });

  it("commits guard-only artifacts, byte for byte what the pass emits today", () => {
    // `artifacts/**` is a checked reference tree, the way `demo/artifacts/**`
    // is: the committed bytes are the claim, and re-emitting is how it is
    // checked. What a guard-only component ships is worth reading — a store, a
    // read slot, one region recorded absent, and NOTHING addressable. No cell,
    // no binding, no wiring record, no keyed region, no item template, and an
    // empty template: a resume path that installs nothing, because the served
    // page carries nothing of this component to install against.
    for (const name of ["MainSection", "Footer"]) {
      const dir = join(scratch(), `app.${name}`);
      const emitted = emit(proved(outer(name)), dir);
      expect(emitted.files, name).toEqual(["manifest.json", "structure.js", "template.js", "wiring.js"]);

      for (const file of emitted.files) {
        expect(readFileSync(join(dir, file), "utf8"), `app.${name}/${file}`).toBe(
          readFileSync(join("artifacts", `app.${name}`, file), "utf8"),
        );
      }

      const structure = readFileSync(join("artifacts", `app.${name}`, "structure.js"), "utf8");
      expect(structure, name).toContain('presentFrom: "capture"');
      expect(structure, name).toContain("return todos.length > 0;");
      expect(structure, name).not.toContain("keyedRegions");
      expect(readFileSync(join("artifacts", `app.${name}`, "template.js"), "utf8"), name).toContain(
        'export const html = "";',
      );
      expect(readFileSync(join("artifacts", `app.${name}`, "wiring.js"), "utf8"), name).toContain(
        "export const wiring = [\n\n];",
      );
    }
  });
});
