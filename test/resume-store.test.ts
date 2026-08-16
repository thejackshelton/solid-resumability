import { describe, expect, it } from "vitest";

import { createStoreRegistry } from "../src/resume/stores.ts";
import { resumeBundle } from "../src/resume/resumer.ts";
import type { Bundle, HandlerModule } from "../src/resume/registry.ts";

/**
 * S4 — dispatching a resumed handler to a live store action, by identity.
 *
 * The comptime pass (S3) proved one thing about `Header`'s `addTodo`: it is
 * slot `[1, "addTodo"]` of the value `TodosContext`'s single visible provider
 * supplies. It read no body and emitted none. So the resume side's whole job
 * is to turn that identity into the live function at dispatch time — and its
 * whole obligation is to do that *without* learning anything else about it.
 *
 * These tests are written against a hand-built bundle rather than against the
 * corpus's artifacts on purpose: the corpus case is the demo's evidence
 * (`demo/test/todos-resume.test.tsx` drives the real `Header` against the
 * real `createTodos`). What is left for here is the mechanism's edges — the
 * ones a working page never reaches.
 */

const TEMPLATE = '<form><input class="new"></form>';

/** A live "store" of the shape the corpus's provider supplies: `[read, actions]`. */
function liveStore() {
  const seen: unknown[] = [];
  const actions = {
    addTodo(todo: unknown) {
      seen.push(todo);
      return "added";
    },
    notAFunction: 7,
  };
  return { value: [{ rows: [] }, actions] as const, actions, seen };
}

function handlerModule(): HandlerModule {
  return {
    id: "s0",
    event: "keydown",
    locator: "/0",
    captures: [{ name: "addTodo", kind: "action", store: "s0", path: [1, "addTodo"] }],
    // The extracted body, factored over its slot manifest — exactly the shape
    // the emitter writes. It calls the slot; it never inspects it.
    create({ addTodo }: Record<string, unknown>) {
      return (event: Event) => {
        (addTodo as (todo: unknown) => unknown)({
          title: (event.currentTarget as HTMLInputElement).value,
        });
      };
    },
  };
}

function bundle(overrides: Partial<Bundle> = {}): Bundle {
  return {
    component: "Header",
    template: { html: TEMPLATE, root: "/" },
    cells: [],
    // No control flow in this component, and that is the ordinary case.
    regions: [],
    keyedRegions: [],
    stores: [
      {
        id: "s0",
        context: "TodosContext",
        contextModule: "app/src/app.tsx",
        actionsSlot: 1,
        readSlot: null,
        provider: "app/src/app.tsx",
        value: { module: "app/src/todos.ts", factory: "createTodos" },
      },
    ],
    actions: [{ id: "s0a0", store: "s0", name: "addTodo", path: [1, "addTodo"] }],
    reads: [],
    bindings: [],
    wiring: [
      {
        locator: "/0",
        event: "keydown",
        module: "./handlers/s0.js",
        handler: "s0",
        captures: [{ name: "addTodo", kind: "action", store: "s0", path: [1, "addTodo"] }],
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

function typeInto(host: HTMLElement, value: string): void {
  const input = host.querySelector<HTMLInputElement>("input.new")!;
  input.value = value;
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
}

describe("the action registry resolves identity, and only identity", () => {
  it("hands back the store's own function — not a copy, not a wrapper", () => {
    const store = liveStore();
    const registry = createStoreRegistry();
    registry.provide("s0", store.value);

    const resolved = registry.action("s0", [1, "addTodo"]);
    // The soundness line, as an assertion: what the slot gets IS what the
    // store built. A wrapper here would mean the resume path had formed an
    // opinion about a body it was never allowed to read.
    expect(Object.is(resolved, store.actions.addTodo)).toBe(true);
  });

  it("registers by id, and refuses two live values under one identity", () => {
    const registry = createStoreRegistry();
    const first = liveStore().value;
    registry.provide("s0", first);
    registry.provide("s0", first); // idempotent
    expect(registry.ids()).toEqual(["s0"]);
    expect(registry.has("s0")).toBe(true);
    expect(registry.has("s1")).toBe(false);

    expect(() => registry.provide("s0", liveStore().value)).toThrow(/already registered/);
  });

  it("errors on an unregistered store — explicitly, not silently", () => {
    const registry = createStoreRegistry();
    expect(() => registry.action("s0", [1, "addTodo"])).toThrow(/no live store is registered as "s0"/);
  });

  it("errors when the proven path does not reach the live value", () => {
    const registry = createStoreRegistry();
    registry.provide("s0", [{}, {}]);
    expect(() => registry.action("s0", [1, "addTodo"])).toThrow(/is not callable/);
    registry.provide("s1", [{}]);
    expect(() => registry.action("s1", [1, "addTodo"])).toThrow(/has no slot/);
  });

  it("errors when the slot is not callable", () => {
    const registry = createStoreRegistry();
    registry.provide("s0", liveStore().value);
    expect(() => registry.action("s0", [1, "notAFunction"])).toThrow(/is not callable \(got number\)/);
  });
});

const OBJECT_TEMPLATE = '<button class="go">ok</button>';

function liveObjectStore() {
  const seen: unknown[] = [];
  const value = {
    isOpen: () => seen.length > 0,
    toggle() {
      seen.push("toggle");
    },
    setAnchor(_el: unknown) {},
  };
  return { value, seen };
}

function objectActionHandler(): HandlerModule {
  return {
    id: "s0",
    event: "click",
    locator: "/",
    captures: [{ name: "toggle", kind: "action", store: "s0", path: ["toggle"] }],
    create({ toggle }: Record<string, unknown>) {
      return () => {
        (toggle as () => void)();
      };
    },
  };
}

function objectReadHandler(): HandlerModule {
  return {
    id: "s0",
    event: "click",
    locator: "/",
    captures: [{ name: "ctx", kind: "store-read", store: "s0", path: [] }],
    create({ ctx }: Record<string, unknown>) {
      return () => {
        (ctx as { toggle: () => void }).toggle();
      };
    },
  };
}

function objectBundle(overrides: Partial<Bundle> = {}): Bundle {
  return {
    component: "ObjectStoreHost",
    template: { html: OBJECT_TEMPLATE, root: "/" },
    cells: [],
    regions: [],
    keyedRegions: [],
    stores: [
      {
        id: "s0",
        context: "ShelfContext",
        contextModule: "test/fixtures/shapes/object-store-context.tsx",
        provider: "test/fixtures/shapes/object-store-context.tsx",
        keys: ["isOpen", "toggle", "setAnchor"],
      },
    ],
    actions: [{ id: "s0a0", store: "s0", name: "toggle", path: ["toggle"] }],
    reads: [{ id: "s0r", store: "s0", name: "ctx", path: [] }],
    bindings: [],
    wiring: [
      {
        locator: "/",
        event: "click",
        module: "./handlers/s0.js",
        handler: "s0",
        captures: [{ name: "toggle", kind: "action", store: "s0", path: ["toggle"] }],
      },
    ],
    loadHandler: async () => objectActionHandler(),
    ...overrides,
  };
}

function objectMount(): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = OBJECT_TEMPLATE;
  document.body.appendChild(host);
  return host;
}

describe("an object-shaped store joins by identity", () => {
  it("dispatches a member action after provide-before-resume", async () => {
    const store = liveObjectStore();
    const registry = createStoreRegistry();
    registry.provide("s0", store.value);

    const host = objectMount();
    const app = resumeBundle(host, objectBundle(), { stores: registry });
    host.querySelector("button")!.click();
    await app.settled();

    expect(store.seen).toEqual(["toggle"]);
    app.dispose();
  });

  it("waits on a store-read handler slot when provide is deferred", async () => {
    const store = liveObjectStore();
    const registry = createStoreRegistry();
    registry.onMissing((id) => {
      registry.provide(id, store.value);
    });

    const host = objectMount();
    const app = resumeBundle(
      host,
      objectBundle({
        wiring: [
          {
            locator: "/",
            event: "click",
            module: "./handlers/s0.js",
            handler: "s0",
            captures: [{ name: "ctx", kind: "store-read", store: "s0", path: [] }],
          },
        ],
        loadHandler: async () => objectReadHandler(),
      }),
      { stores: registry },
    );

    host.querySelector("button")!.click();
    await app.settled();

    expect(store.seen).toEqual(["toggle"]);
    app.dispose();
  });
});

describe("a resumed handler dispatches to the live store", () => {
  it("calls the real action, with the argument the handler built", async () => {
    const store = liveStore();
    const registry = createStoreRegistry();
    registry.provide("s0", store.value);

    const host = mount();
    const app = resumeBundle(host, bundle(), { stores: registry });

    // Nothing is resolved at resume time: the handler module has not even
    // been fetched, so the store could still be registered after this point.
    expect(app.stats.handlerLoads).toBe(0);

    typeInto(host, "write the note");
    await app.settled();

    expect(store.seen).toEqual([{ title: "write the note" }]);
    expect(app.stats.handlerLoads).toBe(1);
    app.dispose();
  });

  it("restores currentTarget, so an extracted body means what it meant", async () => {
    // The listener is delegated to the container and runs after an await, so
    // the browser's own `currentTarget` is the container (then null). The
    // handler above reads `event.currentTarget.value`, which is the corpus's
    // shape — if it were not restored to the wiring record's element, the
    // read above would have thrown rather than produced the typed title.
    const store = liveStore();
    const registry = createStoreRegistry();
    registry.provide("s0", store.value);
    const host = mount();
    const app = resumeBundle(host, bundle(), { stores: registry });

    typeInto(host, "x");
    await app.settled();

    expect(store.seen).toEqual([{ title: "x" }]);
    app.dispose();
  });

  it("throws at dispatch when the store was never registered", async () => {
    const registry = createStoreRegistry();
    const host = mount();
    const app = resumeBundle(host, bundle(), { stores: registry });

    typeInto(host, "orphan");
    await expect(app.settled()).rejects.toThrow(/no live store is registered as "s0"/);
    app.dispose();
  });

  it("throws at dispatch when the page gave no registry at all", async () => {
    const host = mount();
    const app = resumeBundle(host, bundle(), {});

    typeInto(host, "orphan");
    await expect(app.settled()).rejects.toThrow(/needs a store registry for slot addTodo/);
    app.dispose();
  });

  it("refuses a handler whose action manifest is not the wiring record's", async () => {
    const store = liveStore();
    const registry = createStoreRegistry();
    registry.provide("s0", store.value);
    const host = mount();
    const drifted = bundle({
      loadHandler: async () => ({
        ...handlerModule(),
        captures: [{ name: "addTodo", kind: "action" as const, store: "s0", path: [1, "removeTodo"] }],
      }),
    });
    const app = resumeBundle(host, drifted, { stores: registry });

    typeInto(host, "drift");
    await expect(app.settled()).rejects.toThrow(/capture slots the wiring record does not/);
    app.dispose();
  });
});
