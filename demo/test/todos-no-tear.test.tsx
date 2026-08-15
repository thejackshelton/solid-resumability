import { describe, expect, it, vi } from "vitest";

import { flush } from "solid-js";

import { RESUMED, readTemplate } from "../build/fixtures.mjs";
import { api, resetTodos } from "../src/api-mock.ts";

/**
 * The no-tear scenario: a todo typed and committed before the page has the
 * store to commit it to.
 *
 * `todos-resume.test.tsx` tells the page's story from a first touch on the
 * SHELL. This file tells the one the T001 design calls the tear window: the
 * user goes straight to the resumed `Header`, types, and presses Enter while
 * the deferral group — the framework, the four fallback components and the
 * store `addTodo` belongs to — has not run at all. The dispatch names a store
 * that does not exist yet.
 *
 * What must come out of it, and each is asserted below:
 *
 *   one todo          not zero (the dispatch failing on a missing store, which
 *                     is what W1 witnessed) and not two (the dispatch being
 *                     retried, or run once here and once again on replay);
 *   in arrival order  the keystroke before it is dispatched first, both from
 *                     one queue;
 *   one of everything one group evaluation, one handler chunk, one store
 *                     registration;
 *   nothing early     zero component bodies and zero store before the commit,
 *                     whatever the transfer has already brought down.
 *
 * A page mounts once per process here, as it does there: the store registry
 * refuses to name two live stores with one identity, which is the invariant
 * that makes the swap sound, and a second mount would be asking it for an
 * exemption.
 */

const probe = vi.hoisted(() => ({
  /** Component functions invoked, in call order. */
  calls: [] as string[],
  /** Evaluations of the deferred group module — the transfer, not the run. */
  groupEvaluations: [] as string[],
  /** Handler artifact modules imported. */
  handlerLoads: [] as string[],
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

const APP_COMPONENTS = ["App", "Header", "TodoItem", "MainSection", "Footer"];
const countApp = (calls: string[]) => calls.filter(name => APP_COMPONENTS.includes(name)).length;

const LOADING = '<p class="loading">Loading…</p>';

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

const rows = (root: ParentNode) =>
  [...root.querySelectorAll(".todo-list li label")].map(node => node.textContent);

/** One keystroke, as the browser makes it: the value, then the event. */
function keystroke(input: HTMLInputElement, value: string, key: string): void {
  input.value = value;
  input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
}

const run = await (async () => {
  resetTodos();

  const { bootstrap, createMount, resumed, stores } = await import("../src/todos-resume.ts");
  const { html: template } = await readTemplate(RESUMED[0]);

  // The served page, in the shape `plugin/src/stages/prerender.ts` inlines it.
  const root = document.createElement("div");
  root.id = "root";
  document.body.appendChild(root);
  const section = document.createElement("section");
  section.className = "todoapp";
  section.appendChild(createMount(template));
  section.insertAdjacentHTML("beforeend", LOADING);
  root.appendChild(section);

  const page = bootstrap(root)!;
  const input = root.querySelector<HTMLInputElement>("input.new-todo")!;

  const atLoad = {
    calls: [...probe.calls],
    groupEvaluations: [...probe.groupEvaluations],
    imports: page.group.stats.imports,
    prefetches: page.group.stats.prefetches,
    storeIds: stores.ids(),
  };

  // The user goes to the input. A focus is an interaction signal: it buys the
  // transfer and nothing else.
  input.focus();
  const atSignal = {
    prefetches: page.group.stats.prefetches,
    prefetchTrigger: page.group.prefetchTrigger,
    imports: page.group.stats.imports,
    trigger: page.group.trigger,
    calls: [...probe.calls],
  };

  // Wait for the transfer to land, so what follows is measured against a page
  // that HAS the bytes and still has not run them.
  await page.group.prefetching;
  await settle(2);
  const afterTransfer = {
    groupEvaluations: [...probe.groupEvaluations],
    calls: [...probe.calls],
    imports: page.group.stats.imports,
    storeIds: stores.ids(),
    rows: rows(root),
    paint: root.innerHTML,
  };

  // Typing, then committing — both before anything of the group has executed.
  keystroke(input, "b", "b");
  keystroke(input, "buy milk", "Enter");

  const atEnter = {
    imports: page.group.stats.imports,
    dispatches: resumed.reduce((total, app) => total + app.stats.dispatches, 0),
    storeIds: stores.ids(),
    calls: [...probe.calls],
    rows: rows(root),
    queued: page.group.queue.length,
  };

  for (const app of resumed) await app.settled();
  await settle();

  const afterSettle = {
    trigger: page.group.trigger,
    imports: page.group.stats.imports,
    prefetches: page.group.stats.prefetches,
    replays: page.group.stats.replays,
    queued: page.group.queue.length,
    groupEvaluations: [...probe.groupEvaluations],
    handlerLoads: [...probe.handlerLoads],
    handlerLoadsCounted: resumed.reduce((total, app) => total + app.stats.handlerLoads, 0),
    dispatches: resumed.reduce((total, app) => total + app.stats.dispatches, 0),
    calls: [...probe.calls],
    storeIds: stores.ids(),
    rows: rows(root),
    count: root.querySelector(".todo-count")?.textContent ?? "",
    inputValue: input.value,
    sameInput: root.querySelector("input.new-todo") === input,
    focused: document.activeElement === input,
    persisted: (await api.getTodos()).map(todo => todo.title),
  };

  // And once the store is live, the same gesture takes the plain path.
  keystroke(input, "walk the dog", "Enter");
  for (const app of resumed) await app.settled();
  await settle();

  const afterSecond = {
    imports: page.group.stats.imports,
    groupEvaluations: [...probe.groupEvaluations],
    handlerLoads: [...probe.handlerLoads],
    dispatches: resumed.reduce((total, app) => total + app.stats.dispatches, 0),
    rows: rows(root),
    persisted: (await api.getTodos()).map(todo => todo.title),
  };

  return { root, page, atLoad, atSignal, afterTransfer, atEnter, afterSettle, afterSecond };
})();

describe("before the commit", () => {
  it("has run and transferred nothing at load", () => {
    expect(run.atLoad.calls).toEqual([]);
    expect(run.atLoad.groupEvaluations).toEqual([]);
    expect(run.atLoad.imports).toBe(0);
    expect(run.atLoad.prefetches).toBe(0);
    expect(run.atLoad.storeIds).toEqual([]);
  });

  it("buys the transfer on the first interaction signal, and nothing else", () => {
    expect(run.atSignal.prefetches).toBe(1);
    expect(run.atSignal.prefetchTrigger).toBe("focusin in the resumed mount");
    // A signal is not a commitment: nothing is executed and no DOM changes.
    expect(run.atSignal.imports).toBe(0);
    expect(run.atSignal.trigger).toBeNull();
    expect(run.atSignal.calls).toEqual([]);
  });

  it("holds the transferred group unexecuted — bytes down, nothing run", () => {
    // The distinction W3 has to report: the module is HERE (this is the
    // transfer, and in this environment an `import()` is what performs it) and
    // still zero component bodies have run, no store exists and the shell is
    // untouched.
    expect(run.afterTransfer.groupEvaluations).toEqual(["todos-group"]);
    expect(countApp(run.afterTransfer.calls)).toBe(0);
    expect(run.afterTransfer.imports).toBe(0);
    expect(run.afterTransfer.storeIds).toEqual([]);
    expect(run.afterTransfer.rows).toEqual([]);
    expect(run.afterTransfer.paint).toContain('class="loading"');
  });

  it("takes the keystroke and the Enter with no store to dispatch to", () => {
    // Both events are in the queue, both waiting, and the page has changed in
    // no way at all: this is the instant the tear would happen.
    expect(run.atEnter.imports).toBe(0);
    expect(run.atEnter.dispatches).toBe(2);
    expect(run.atEnter.storeIds).toEqual([]);
    expect(countApp(run.atEnter.calls)).toBe(0);
    expect(run.atEnter.rows).toEqual([]);
    // Events inside the resumed mount are never recorded for replay: the
    // resumed path is handling them, which is what makes one dispatch one.
    expect(run.atEnter.queued).toBe(0);
  });
});

describe("after the commit", () => {
  it("is committed by the dispatch that needed the store", () => {
    expect(run.afterSettle.trigger).toBe('a resumed dispatch needs store "s0"');
    expect(run.afterSettle.imports).toBe(1);
    expect(run.afterSettle.prefetches).toBe(1);
    // The commit joins the transfer: one evaluation of the module, whichever
    // of the two asked for it.
    expect(run.afterSettle.groupEvaluations).toEqual(["todos-group"]);
    expect(run.afterSettle.storeIds).toEqual(["s0"]);
  });

  it("adds exactly one todo — the one the user committed", () => {
    expect(run.afterSettle.rows).toEqual(["buy milk"]);
    expect(run.afterSettle.persisted).toEqual(["buy milk"]);
    expect(run.afterSettle.count).toContain("1 item");
    // Two events dispatched, one todo: the "b" ran too, in front of the
    // Enter, and did what the corpus's handler does with a key that is not
    // Enter — nothing.
    expect(run.afterSettle.dispatches).toBe(2);
    expect(run.afterSettle.handlerLoads).toEqual(["app.Header/s0"]);
    expect(run.afterSettle.handlerLoadsCounted).toBe(1);
    // Nothing was captured for replay, so nothing could be dispatched twice.
    expect(run.afterSettle.replays).toBe(0);
    expect(run.afterSettle.queued).toBe(0);
  });

  it("runs the four fallback components, once, and not Header", () => {
    expect(run.afterSettle.calls.filter(name => APP_COMPONENTS.includes(name))).toEqual([
      "App",
      "MainSection",
      "Footer",
      "TodoItem",
    ]);
  });

  it("keeps the input the user typed into, emptied by the handler", () => {
    expect(run.afterSettle.sameInput).toBe(true);
    expect(run.afterSettle.inputValue).toBe("");
    expect(run.afterSettle.focused).toBe(true);
  });

  it("takes the plain synchronous path for the next one", () => {
    expect(run.afterSecond.rows).toEqual(["buy milk", "walk the dog"]);
    expect(run.afterSecond.persisted).toEqual(["buy milk", "walk the dog"]);
    expect(run.afterSecond.dispatches).toBe(3);
    // Nothing new was fetched or evaluated to get there: the store is live,
    // the handler is bound, and the dispatch resolves its slot synchronously.
    expect(run.afterSecond.imports).toBe(1);
    expect(run.afterSecond.groupEvaluations).toEqual(["todos-group"]);
    expect(run.afterSecond.handlerLoads).toEqual(["app.Header/s0"]);
  });
});
