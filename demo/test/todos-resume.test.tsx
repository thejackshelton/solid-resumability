import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

import { flush } from "solid-js";
import { render } from "@solidjs/web";

import { DEMO_ROOT, RESUMED, readManifest, readTemplate } from "../build/fixtures.mjs";
import { substituteHeader, APP_SOURCE, GENERATED_APP } from "../build/substitute.mjs";
import { api, resetTodos } from "../src/api-mock.ts";

/**
 * The todos page with its whole fallback group deferred: nothing but the
 * served shell and one resumed component until the user touches something.
 *
 * The classic page runs five component bodies at load. The resumable page
 * runs ZERO — not because its components are cheaper but because they are not
 * in the browser. `Header` is resumed from artifacts against markup the build
 * captured and inlined; `App`, `MainSection`, `Footer` and `TodoItem` are one
 * chunk behind one `import()` that the first interaction makes.
 *
 * ── The instruments ───────────────────────────────────────────────────────
 * Three, and each of them counts something rather than asserting a mood:
 *
 *   createComponent   The corpus's components are module-local (only `App` is
 *                     exported), so a `vi.mock` factory over named exports
 *                     cannot see four of the five. What can see all of them
 *                     is the thing that *invokes* them: Solid's
 *                     `createComponent`, which every compiled JSX component
 *                     element goes through. Names arrive with
 *                     @solidjs/vite-plugin's HMR prefix in test mode; it is
 *                     stripped, and it is the function's own name either way.
 *   todos-group.ts    A mock factory that records and then hands back the
 *                     original module. It runs on the module's FIRST
 *                     evaluation, so the length of what it recorded is the
 *                     number of times the group was evaluated at all.
 *   handlers/s0.js    The same, for `Header`'s handler chunk.
 *
 * ── The transcript ────────────────────────────────────────────────────────
 * Both variants are mounted once, at module scope, in a fixed order, because
 * "nothing has loaded yet" is a claim about a moment in time. The resumable
 * variant goes first, so its claims are made against a registry that has
 * evaluated nothing. It is mounted exactly once per process on purpose: the
 * store registry refuses to name two live stores with one identity, which is
 * the invariant that makes the swap sound, and a second mount in the same
 * module registry would be asking for an exemption from it.
 */

const probe = vi.hoisted(() => ({
  /** Component functions invoked, in call order, tagged by variant. */
  calls: [] as string[],
  /** Handler artifact modules imported, in load order. */
  handlerLoads: [] as string[],
  /** Evaluations of the deferred group module. */
  groupEvaluations: [] as string[],
}));

vi.mock("@solidjs/web", async importOriginal => {
  const original = (await importOriginal()) as Record<string, unknown>;
  const createComponent = original.createComponent as (fn: unknown, props: unknown) => unknown;
  return {
    ...original,
    createComponent(fn: { name?: string }, props: unknown) {
      probe.calls.push((fn?.name ?? "<anonymous>").replace("[solid-refresh]", ""));
      return createComponent(fn, props);
    },
  };
});

// `render(App, root)` invokes the root component directly rather than as a
// compiled JSX element, so `createComponent` never sees it. `App` is the one
// component of the five that is an export, which is exactly the case a wrapper
// over named exports can cover.
vi.mock("../src/generated/app.resumable.tsx", async importOriginal => {
  const original = (await importOriginal()) as { App: (props: unknown) => unknown };
  return {
    ...original,
    App: function App(props: unknown) {
      probe.calls.push("App");
      return original.App(props);
    },
  };
});

vi.mock("../artifacts/app.Header/handlers/s0.js", async importOriginal => {
  const original = (await importOriginal()) as Record<string, unknown>;
  probe.handlerLoads.push("app.Header/s0");
  return original;
});

vi.mock("../src/todos-group.ts", async importOriginal => {
  const original = (await importOriginal()) as Record<string, unknown>;
  probe.groupEvaluations.push("todos-group");
  return original;
});

/** The five components `app/src/app.tsx` declares — the page's own bodies. */
const APP_COMPONENTS = ["App", "Header", "TodoItem", "MainSection", "Footer"];

const isAppComponent = (name: string) => APP_COMPONENTS.includes(name);

async function settle(turns = 12): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await Promise.resolve();
    flush();
  }
  await new Promise(resolve => setTimeout(resolve, 0));
  flush();
  for (let i = 0; i < turns; i++) {
    await Promise.resolve();
    flush();
  }
}

function host(): HTMLElement {
  const element = document.createElement("div");
  element.id = "root";
  document.body.appendChild(element);
  return element;
}

/** Types a title into the new-todo input and presses Enter. The real thing. */
function typeAndEnter(root: ParentNode, title: string): void {
  const input = root.querySelector<HTMLInputElement>("input.new-todo");
  expect(input, "the page has no new-todo input").toBeTruthy();
  input!.value = title;
  input!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  flush();
}

const rows = (root: ParentNode) =>
  [...root.querySelectorAll(".todo-list li label")].map(node => node.textContent);

/** Drains every resumed component's dispatch queue. */
async function settledAll(apps: { settled(): Promise<void> }[]): Promise<void> {
  for (const app of apps) await app.settled();
}

const LOADING = '<p class="loading">Loading…</p>';

/* ─────────────────────────── the resumable run ───────────────────────────── */

const resumable = await (async () => {
  resetTodos();
  const before = {
    calls: [...probe.calls],
    handlerLoads: [...probe.handlerLoads],
    groupEvaluations: [...probe.groupEvaluations],
  };

  const { bootstrap, createMount, resumed, stores } = await import("../src/todos-resume.ts");
  const { html: template } = await readTemplate(RESUMED[0]);

  // The served page, in the shape `plugin/src/stages/prerender.ts` inlines it: the
  // resumed component's mount carrying the emitted template, and the app's
  // loading paragraph. The build owns the claim that these are the bytes a
  // real render produces — it captures them from one, twice, and refuses to
  // write the page if the two captures differ or if the template artifact is
  // not in them verbatim.
  const root = host();
  const section = document.createElement("section");
  section.className = "todoapp";
  section.appendChild(createMount(template));
  section.insertAdjacentHTML("beforeend", LOADING);
  root.appendChild(section);

  const page = bootstrap(root)!;

  const afterLoad = {
    calls: [...probe.calls],
    groupEvaluations: [...probe.groupEvaluations],
    handlerLoads: [...probe.handlerLoads],
    imports: page.group.stats.imports,
    storeIds: stores.ids(),
    header: root.querySelector("header.header")?.outerHTML ?? "",
    rows: rows(root),
  };

  // A click inside the resumed mount belongs to the resumed path: it is not
  // the group's event and must not fetch the group.
  const input = root.querySelector<HTMLInputElement>("input.new-todo")!;
  input.dispatchEvent(new MouseEvent("click", { bubbles: true }));

  const afterExcluded = {
    imports: page.group.stats.imports,
    observed: page.group.stats.observed,
    queued: page.group.queue.length,
    groupEvaluations: [...probe.groupEvaluations],
  };

  // Typing before the group exists: plain keystrokes are native behaviour and
  // involve no store at all, so the value, the focus and the caret are the
  // browser's and the page has nothing to do.
  input.focus();
  input.value = "half typed";
  input.setSelectionRange(4, 4);

  // Focusing the input is an interaction signal in the resumed subtree: it
  // starts the group's transfer without committing it. What it must not do is
  // run anything.
  const atSignal = {
    prefetches: page.group.stats.prefetches,
    prefetchTrigger: page.group.prefetchTrigger,
    imports: page.group.stats.imports,
    calls: [...probe.calls],
    storeIds: stores.ids(),
  };

  // The first touch: a click on the shell, which nothing is listening to
  // because nothing of the group is in the browser. The deferral listeners
  // record it and start the one import.
  root.querySelector("p.loading")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

  const atTouch = {
    imports: page.group.stats.imports,
    trigger: page.group.trigger,
    queue: page.group.queue.map(entry => ({ ...entry })),
    groupEvaluations: [...probe.groupEvaluations],
  };

  await page.group.loading;
  await settledAll(resumed);

  // Read before anything is flushed: Solid batches, so this is the DOM as the
  // group's synchronous render left it — the post-swap first paint.
  const afterSwap = {
    calls: [...probe.calls],
    groupEvaluations: [...probe.groupEvaluations],
    handlerLoads: [...probe.handlerLoads],
    imports: page.group.stats.imports,
    storeIds: stores.ids(),
    paint: root.innerHTML,
    sameInput: root.querySelector("input.new-todo") === input,
    inputValue: input.value,
    focused: document.activeElement === input,
    selection: [input.selectionStart, input.selectionEnd],
    rows: rows(root),
  };

  await settle();

  typeAndEnter(root, "dispatched by identity");
  await settledAll(resumed);
  await settle();

  const afterAdd = {
    calls: [...probe.calls],
    handlerLoads: [...probe.handlerLoads],
    handlerLoadsCounted: resumed.reduce((total, app) => total + app.stats.handlerLoads, 0),
    dispatches: resumed.reduce((total, app) => total + app.stats.dispatches, 0),
    rows: rows(root),
    count: root.querySelector(".todo-count")?.textContent ?? "",
    inputValue: root.querySelector<HTMLInputElement>("input.new-todo")!.value,
    persisted: (await api.getTodos()).map(todo => todo.title),
  };

  // A sibling's own handler, on DOM that did not exist until the group ran.
  const toggle = root.querySelector<HTMLInputElement>("input.toggle")!;
  toggle.checked = true;
  toggle.dispatchEvent(new Event("input", { bubbles: true }));
  await settle();

  const afterToggle = {
    completed: [...root.querySelectorAll(".todo-list li")].map(node => node.className),
    count: root.querySelector(".todo-count")?.textContent ?? "",
    persisted: (await api.getTodos()).map(todo => todo.completed),
  };

  // A second touch, after the group is live: the listeners are gone and the
  // import is a settled promise, so nothing is fetched or evaluated again.
  root.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await settle();

  const afterSecondTouch = {
    imports: page.group.stats.imports,
    groupEvaluations: [...probe.groupEvaluations],
    handlerLoads: [...probe.handlerLoads],
    rows: rows(root),
  };

  return {
    root,
    page,
    resumed,
    before,
    afterLoad,
    afterExcluded,
    atSignal,
    atTouch,
    afterSwap,
    afterAdd,
    afterToggle,
    afterSecondTouch,
  };
})();

/* ──────────────────────────── the classic run ────────────────────────────── */

const classic = await (async () => {
  const mark = probe.calls.length;
  resetTodos();

  const { App } = await import("../../app/src/app");

  const element = host();
  const dispose = render((() => <App />) as never, element);
  await settle();

  const afterMount = {
    calls: probe.calls.slice(mark),
    header: element.querySelector("header.header")?.outerHTML ?? "",
  };

  typeAndEnter(element, "dispatched by identity");
  await settle();

  const afterInteraction = {
    calls: probe.calls.slice(mark),
    rows: rows(element),
    count: element.querySelector(".todo-count")?.textContent ?? "",
    inputValue: element.querySelector<HTMLInputElement>("input.new-todo")!.value,
  };

  return { element, dispose, afterMount, afterInteraction };
})();

/* ───────────────────────── the numbers, as a reading ─────────────────────── */

const countApp = (calls: string[]) => calls.filter(isAppComponent).length;

afterAll(() => {
  classic.dispose();
  resetTodos();

  // `pnpm measure` reads this file and refuses to invent the numbers in it,
  // exactly as it does for the fixtures page. Everything here is a count of
  // something the instruments above observed.
  const path = join(DEMO_ROOT, ".measure/todos-executions.json");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify(
      {
        source: "demo/test/todos-resume.test.tsx",
        page: "todos.html",
        instrument:
          "a vi.mock loader hook on @solidjs/web's createComponent, which every compiled JSX " +
          "component element goes through; names are the invoked functions' own",
        appComponents: APP_COMPONENTS,
        interaction: "type a title into input.new-todo and press Enter",
        classic: {
          componentExecutions: countApp(classic.afterInteraction.calls),
          componentsExecuted: classic.afterInteraction.calls.filter(isAppComponent),
          allComponentsExecuted: classic.afterInteraction.calls,
          componentExecutionsBeforeInteraction: countApp(classic.afterMount.calls),
        },
        resumable: {
          componentExecutions: countApp(resumable.afterAdd.calls),
          componentsExecuted: resumable.afterAdd.calls.filter(isAppComponent),
          allComponentsExecuted: resumable.afterAdd.calls,
          componentExecutionsBeforeInteraction: countApp(resumable.afterLoad.calls),
          /** The deferred group, by the trigger that fetched it. */
          groupTrigger: resumable.atTouch.trigger,
          /**
           * The signal that starts the transfer, and what had run when it
           * did: the two moments are separate, and the second one is what
           * costs an execution.
           */
          prefetchTrigger: resumable.atSignal.prefetchTrigger,
          prefetchesBeforeInteraction: resumable.atSignal.prefetches,
          importsAtPrefetch: resumable.atSignal.imports,
          componentExecutionsAtPrefetch: countApp(resumable.atSignal.calls),
          storesRegisteredAtPrefetch: resumable.atSignal.storeIds,
          groupEvaluationsBeforeInteraction: resumable.afterLoad.groupEvaluations.length,
          groupEvaluationsAfterInteraction: resumable.afterSwap.groupEvaluations.length,
          groupEvaluationsAfterSecondInteraction: resumable.afterSecondTouch.groupEvaluations.length,
          /** Handler artifact modules imported, by stage. */
          handlerChunkLoadsBeforeInteraction: resumable.afterLoad.handlerLoads.length,
          handlerChunkLoadsAfterInteraction: resumable.afterAdd.handlerLoads.length,
          handlerChunkLoadsAfterSecondInteraction: resumable.afterSecondTouch.handlerLoads.length,
          storesRegisteredBeforeInteraction: resumable.afterLoad.storeIds,
          storesRegistered: resumable.afterSwap.storeIds,
        },
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
});

/* ────────────────────────────── the assertions ───────────────────────────── */

describe("the instrument", () => {
  it("records nothing before a page is mounted (negative control)", () => {
    expect(resumable.before.calls).toEqual([]);
    expect(resumable.before.handlerLoads).toEqual([]);
    expect(resumable.before.groupEvaluations).toEqual([]);
  });

  it("sees all five of the app's components on the classic page (positive control)", () => {
    // The point of hooking `createComponent` rather than the module's exports:
    // four of these five are module-local and cannot be wrapped from outside.
    expect(new Set(classic.afterInteraction.calls.filter(isAppComponent))).toEqual(
      new Set(APP_COMPONENTS),
    );
  });
});

describe("nothing of the group is in the browser at load", () => {
  it("evaluates the group module zero times", () => {
    expect(resumable.afterLoad.groupEvaluations).toEqual([]);
    expect(resumable.afterLoad.imports).toBe(0);
  });

  it("runs zero component bodies — four on the classic page, none here", () => {
    expect(countApp(resumable.afterLoad.calls)).toBe(0);
    expect(resumable.afterLoad.calls).toEqual([]);
    // Four of the classic page's five: `TodoItem` is per-todo and the list is
    // empty at load. The fifth runs there on the first todo and here on the
    // first todo after the group has arrived.
    expect(countApp(classic.afterMount.calls)).toBe(4);
  });

  it("imports no handler chunk either", () => {
    expect(resumable.afterLoad.handlerLoads).toEqual([]);
  });

  it("has no live store, because the code that creates it has not run", () => {
    expect(resumable.afterLoad.storeIds).toEqual([]);
  });

  it("serves the resumed component's markup from the document", () => {
    // Byte-identical to what `render()` produces, which is what makes the
    // resumer's child-index locators address the nodes the pass named.
    expect(resumable.afterLoad.header).toBe(classic.afterMount.header);
    expect(resumable.afterLoad.rows).toEqual([]);
  });
});

describe("the group is fetched by the first touch, once", () => {
  it("is not fetched by an event the resumed component owns", () => {
    expect(resumable.afterExcluded.observed).toBe(1);
    expect(resumable.afterExcluded.imports).toBe(0);
    expect(resumable.afterExcluded.queued).toBe(0);
    expect(resumable.afterExcluded.groupEvaluations).toEqual([]);
  });

  it("is fetched exactly once, by the first event on the shell", () => {
    expect(resumable.atTouch.imports).toBe(1);
    expect(resumable.atTouch.trigger).toBe("click on the deferred group");
    expect(resumable.afterSwap.groupEvaluations).toEqual(["todos-group"]);
  });

  it("records the event that fetched it, addressed by path", () => {
    // Recorded, not replayed: the shell has no interactive group DOM to
    // replay into. The record is what carries the event to a page that does.
    expect(resumable.atTouch.queue).toEqual([{ index: 0, type: "click", path: "/0/1" }]);
  });

  it("is not fetched or evaluated again by a later touch", () => {
    expect(resumable.afterSecondTouch.imports).toBe(1);
    expect(resumable.afterSecondTouch.groupEvaluations).toEqual(["todos-group"]);
    expect(resumable.afterSecondTouch.rows).toEqual(resumable.afterAdd.rows);
  });

  it("runs four component bodies when it does run — Header is the one missing", () => {
    expect(countApp(resumable.afterAdd.calls)).toBe(4);
    expect(resumable.afterAdd.calls).not.toContain("Header");
    expect(resumable.afterAdd.calls.filter(isAppComponent)).toEqual([
      "App",
      "MainSection",
      "Footer",
      "TodoItem",
    ]);
  });

  it("replaces Header with an expression, not another component", () => {
    // The substituted mount point is a call, not a component element, so the
    // resumable page does not trade one component body for another: the four
    // above are every component function it invokes that is not a Solid
    // control-flow primitive.
    const extra = resumable.afterAdd.calls.filter(
      name => !isAppComponent(name) && !["Errored", "Loading", "Show", "For", "TodosContext"].includes(name),
    );
    expect(extra).toEqual([]);
  });
});

describe("typing survives the swap", () => {
  it("fetches no handler chunk to get there", () => {
    // The group's arrival is not an event for the resumed component, so its
    // handler is still unfetched: the two lazy paths are independent.
    expect(resumable.afterSwap.handlerLoads).toEqual([]);
    expect(resumable.afterSwap.rows).toEqual([]);
  });

  it("renders the shell again rather than the loaded state", () => {
    // Render-and-replace: the same code, at the same state — the projection
    // is pending again and is not awaited, so what the swap paints is the
    // shell, with the resumed component's markup carried across verbatim. The
    // byte-for-byte form of this claim belongs to the build, which captures
    // the paint synchronously and twice; what is observable here is a few
    // microtasks later, by which time the (empty) projection has resolved.
    expect(resumable.afterSwap.paint).toContain(resumable.afterLoad.header);
    expect(resumable.afterSwap.paint).not.toContain("todo-list");
    expect(resumable.afterSwap.rows).toEqual([]);
  });

  it("keeps the very same input element, with the typed value in it", () => {
    expect(resumable.afterSwap.sameInput).toBe(true);
    expect(resumable.afterSwap.inputValue).toBe("half typed");
  });

  it("restores focus and the caret, which node movement does not carry", () => {
    expect(resumable.afterSwap.focused).toBe(true);
    expect(resumable.afterSwap.selection).toEqual([4, 4]);
  });

  it("registers the live store at the mount point, once the group made one", () => {
    expect(resumable.afterSwap.storeIds).toEqual(
      readManifest(RESUMED[0]).stores.map((store: { id: string }) => store.id),
    );
  });
});

describe("the page works after the group has run", () => {
  it("adds the todo the user typed, through the resumed component", () => {
    expect(resumable.afterAdd.rows).toEqual(["dispatched by identity"]);
    expect(resumable.afterAdd.inputValue).toBe("");
    expect(resumable.afterAdd.dispatches).toBe(1);
    expect(resumable.afterAdd.handlerLoads).toEqual(["app.Header/s0"]);
    expect(resumable.afterAdd.handlerLoadsCounted).toBe(1);
    expect(readManifest(RESUMED[0]).handlers).toHaveLength(1);
  });

  it("went through the real pipeline, not a stand-in", () => {
    // The dispatched function is the store's own `addTodo` — an `action`
    // generator that writes optimistically and then persists. The proof that
    // nothing here is a stub is that the demo API has the row.
    expect(resumable.afterAdd.persisted).toEqual(["dispatched by identity"]);
  });

  it("toggles it, through a sibling that only exists because the group ran", () => {
    expect(resumable.afterToggle.completed).toEqual(["todo completed"]);
    expect(resumable.afterToggle.count).toContain("0 items");
    expect(resumable.afterToggle.persisted).toEqual([true]);
  });

  it("produces the same page the classic variant produces", () => {
    expect(resumable.afterAdd.rows).toEqual(classic.afterInteraction.rows);
    expect(resumable.afterAdd.count).toBe(classic.afterInteraction.count);
    expect(resumable.afterAdd.count).toContain("1 item");
    expect(resumable.afterAdd.inputValue).toBe(classic.afterInteraction.inputValue);
  });
});

describe("the substitution is a build artifact, not a corpus edit", () => {
  it("leaves app/src/app.tsx renderable as itself", () => {
    // The classic half of this very file imported and mounted it.
    expect(readFileSync(APP_SOURCE, "utf8")).toContain("function Header() {");
    expect(classic.afterMount.header).toContain('class="header"');
  });

  it("emits a module with Header's body removed", () => {
    const generated = readFileSync(GENERATED_APP, "utf8");
    expect(generated).not.toContain("function Header");
    expect(generated).not.toContain("onKeyDown");
    expect(generated).not.toContain("addTodo(");
    expect(generated).toContain("{claimHeader(useContext(TodosContext))}");
    // The other four are the corpus's own source, untouched.
    for (const name of ["TodoItem", "MainSection", "Footer", "App"]) {
      expect(generated).toContain(`function ${name}(`);
    }
  });

  it("regenerates byte-identically from the corpus (no drift)", () => {
    expect(substituteHeader(readFileSync(APP_SOURCE, "utf8"))).toBe(readFileSync(GENERATED_APP, "utf8"));
  });
});
