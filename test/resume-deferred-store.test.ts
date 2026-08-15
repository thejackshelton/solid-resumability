import { describe, expect, it } from "vitest";

import { createStoreRegistry } from "../src/resume/stores.ts";
import { resumeBundle } from "../src/resume/resumer.ts";
import type { Bundle, HandlerModule } from "../src/resume/registry.ts";

/**
 * W2 — a dispatch that arrives before the store exists.
 *
 * `resume-store.test.ts` covers the join when the live value is already there.
 * This file covers the window a deferred group opens: the page holds the code
 * that CREATES the store behind an `import()`, so a resumed handler can be
 * dispatched at a moment when `s0` names nothing at all.
 *
 * The ruling under test, from the T001 design: the wait goes IN FRONT of slot
 * resolution, inside the resumer's per-component FIFO. Nothing is wrapped, so
 * what the handler receives is still the store's own function; nothing is
 * dropped, so the event the user produced is the event that dispatches; and
 * nothing overtakes anything, so what the user did in order happens in order.
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
  };
  return { value: [{ rows: [] }, actions] as const, actions, seen };
}

/** What the handler was handed, recorded without being touched. */
interface Received {
  slots: unknown[];
  events: Event[];
}

function handlerModule(received: Received): HandlerModule {
  return {
    id: "s0",
    event: "keydown",
    locator: "/0",
    captures: [{ name: "addTodo", kind: "action", store: "s0", path: [1, "addTodo"] }],
    create({ addTodo }: Record<string, unknown>) {
      received.slots.push(addTodo);
      return (event: Event) => {
        received.events.push(event);
        (addTodo as (todo: unknown) => unknown)({ title: (event.currentTarget as HTMLInputElement).value });
      };
    },
  };
}

function bundle(received: Received): Bundle {
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
    loadHandler: async () => handlerModule(received),
  };
}

function mount(): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = TEMPLATE;
  document.body.appendChild(host);
  return host;
}

function typeInto(host: HTMLElement, value: string, key = "Enter"): Event {
  const input = host.querySelector<HTMLInputElement>("input.new")!;
  input.value = value;
  const event = new KeyboardEvent("keydown", { key, bubbles: true });
  input.dispatchEvent(event);
  return event;
}

describe("the registry can be waited for", () => {
  it("resolves at once for a store that is already live", async () => {
    const registry = createStoreRegistry();
    registry.onMissing(() => {});
    registry.provide("s0", liveStore().value);
    await expect(registry.whenProvided("s0")).resolves.toBeUndefined();
  });

  it("reports the miss to the hook, and resolves when the value lands", async () => {
    const registry = createStoreRegistry();
    const missed: string[] = [];
    registry.onMissing((id) => missed.push(id));

    const waited = registry.whenProvided("s0");
    expect(missed).toEqual(["s0"]);
    expect(registry.has("s0")).toBe(false);

    registry.provide("s0", liveStore().value);
    await expect(waited).resolves.toBeUndefined();
    expect(registry.has("s0")).toBe(true);
  });

  it("gives every waiter for one id the same promise, and one miss each", async () => {
    const registry = createStoreRegistry();
    const missed: string[] = [];
    registry.onMissing((id) => missed.push(id));

    const first = registry.whenProvided("s0");
    const second = registry.whenProvided("s0");
    expect(first).toBe(second);
    // Once per waiting dispatch: the hook is the page's standing answer, and
    // the thing it starts is idempotent.
    expect(missed).toEqual(["s0", "s0"]);

    registry.provide("s0", liveStore().value);
    await Promise.all([first, second]);
  });

  it("refuses to wait for a miss nothing has claimed", async () => {
    const registry = createStoreRegistry();
    // No hook: nothing would ever provide the store, and a dispatch parked
    // forever is worse than one that fails with the reason.
    await expect(registry.whenProvided("s0")).rejects.toThrow(/no live store is registered as "s0"/);
  });

  it("stops reporting to a hook that unregistered", async () => {
    const registry = createStoreRegistry();
    const missed: string[] = [];
    const off = registry.onMissing((id) => missed.push(id));
    off();

    await expect(registry.whenProvided("s0")).rejects.toThrow(/no live store is registered as "s0"/);
    expect(missed).toEqual([]);
  });

  it("lets the hook provide synchronously without losing the resolution", async () => {
    const registry = createStoreRegistry();
    const store = liveStore();
    registry.onMissing((id) => registry.provide(id, store.value));

    await expect(registry.whenProvided("s0")).resolves.toBeUndefined();
    expect(registry.action("s0", [1, "addTodo"])).toBe(store.actions.addTodo);
  });
});

describe("a dispatch that arrives before the store does", () => {
  it("waits, then dispatches the original event to the store's own function", async () => {
    const registry = createStoreRegistry();
    const store = liveStore();
    const received: Received = { slots: [], events: [] };

    // The page's standing answer: a miss starts the group, which creates the
    // store and provides it. A macrotask stands in for the import here.
    let asked = 0;
    registry.onMissing((id) => {
      asked++;
      setTimeout(() => registry.provide(id, store.value), 0);
    });

    const host = mount();
    const app = resumeBundle(host, bundle(received), { stores: registry });

    const event = typeInto(host, "typed before the store existed");
    // Nothing has resolved yet: the store does not exist, so neither does the
    // slot, and the dispatch is parked in the queue with its event.
    expect(store.seen).toEqual([]);

    await app.settled();

    expect(asked).toBe(1);
    expect(store.seen).toEqual([{ title: "typed before the store existed" }]);
    // The event the user produced, not a record of what it said.
    expect(received.events).toEqual([event]);
    // The soundness line, on the deferred path too: the function that landed
    // in the slot IS the store's own. The wait went in front of resolution,
    // never around what it resolved.
    expect(Object.is(received.slots[0], store.actions.addTodo)).toBe(true);
    app.dispose();
  });

  it("keeps the arrival order of everything queued behind the wait", async () => {
    const registry = createStoreRegistry();
    const store = liveStore();
    const received: Received = { slots: [], events: [] };
    registry.onMissing((id) => void setTimeout(() => registry.provide(id, store.value), 0));

    const host = mount();
    const app = resumeBundle(host, bundle(received), { stores: registry });

    const first = typeInto(host, "first", "a");
    const second = typeInto(host, "second", "b");
    const third = typeInto(host, "third", "Enter");
    await app.settled();

    // Order, as identity: the three event objects reach the handler in the
    // order the user produced them, none of them dropped and none overtaking.
    expect(received.events).toEqual([first, second, third]);
    // What each one READS is the input's value at dispatch time, which is the
    // last one typed — the same thing a browser gives a handler that runs
    // late, and the reason the replay path (which cannot keep its nodes)
    // records values while this path (which keeps its node) does not.
    expect(store.seen).toEqual([{ title: "third" }, { title: "third" }, { title: "third" }]);
    // One import, one binding, three dispatches: the wait is a property of
    // the first dispatch, not of the path.
    expect(app.stats.handlerLoads).toBe(1);
    expect(app.stats.dispatches).toBe(3);
    expect(received.slots).toHaveLength(1);
    app.dispose();
  });

  it("interleaves a task enqueued from outside in arrival order", async () => {
    const registry = createStoreRegistry();
    const store = liveStore();
    const received: Received = { slots: [], events: [] };
    registry.onMissing((id) => void setTimeout(() => registry.provide(id, store.value), 0));

    const order: string[] = [];
    const host = mount();
    const app = resumeBundle(host, bundle(received), { stores: registry });

    // The seam the deferral loader uses: a replay of an event captured for a
    // part of the page that is not live yet goes into THIS queue, so the one
    // pre-activation order is one queue rather than two that agree.
    app.enqueue(() => order.push("before"));
    typeInto(host, "waited");
    app.enqueue(() => order.push("after"));
    await app.settled();

    expect(order).toEqual(["before", "after"]);
    // The dispatch sat between them: it was queued after "before" and it
    // resolved before "after" ran, wait and all.
    expect(store.seen).toEqual([{ title: "waited" }]);
    app.dispose();
  });

  it("adds no wait once the store is live", async () => {
    const registry = createStoreRegistry();
    const store = liveStore();
    const received: Received = { slots: [], events: [] };
    let asked = 0;
    registry.onMissing(() => asked++);
    registry.provide("s0", store.value);

    const host = mount();
    const app = resumeBundle(host, bundle(received), { stores: registry });
    typeInto(host, "after the store");
    await app.settled();

    // The hook is never consulted: `has` is true, so resolution is the plain
    // synchronous path the page has always had.
    expect(asked).toBe(0);
    expect(store.seen).toEqual([{ title: "after the store" }]);
    app.dispose();
  });

  it("surfaces a rejected task the same way a failed dispatch surfaces", async () => {
    const registry = createStoreRegistry();
    registry.provide("s0", liveStore().value);
    const host = mount();
    const app = resumeBundle(host, bundle({ slots: [], events: [] }), { stores: registry });

    app.enqueue(() => Promise.reject(new Error("replay: nowhere to dispatch")));
    await expect(app.settled()).rejects.toThrow(/nowhere to dispatch/);
    app.dispose();
  });
});
