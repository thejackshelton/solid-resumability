import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_DEFER_EVENTS,
  DEFAULT_DEFER_SIGNALS,
  deferGroup,
  pathTo,
  type DeferOptions,
} from "../../src/resume/defer.ts";

/**
 * The deferral loader on its own, with no page around it.
 *
 * `todos-resume.test.tsx` is the page-level story — one shell, one group, one
 * first touch. What that story cannot show twice is here: a page has exactly
 * one group, so the ordering rules (which events
 * signal, which commit, which are recorded, which belong to a resumed
 * component, in what order they take effect) need a root that can be thrown
 * away and made again.
 */

const disposers: Array<() => void> = [];

afterEach(() => {
  while (disposers.length) disposers.pop()!();
  document.body.replaceChildren();
});

const SHELL =
  '<section><p>shell</p><input class="field"></section>' + '<div data-resume="X"><input class="resumed"></div>';

/**
 * A shell with something to click in it and a resumed subtree next to it.
 *
 *   <div id="root">
 *     <section>                        the deferred group's markup
 *       <p>…</p>
 *       <input class="field">
 *     </section>
 *     <div data-resume="X">            a component that is already live
 *       <input class="resumed">
 *     </div>
 *   </div>
 *
 * `load` re-renders the same markup — the group's render-and-replace, in
 * miniature — so a replay has a tree of new nodes to resolve its paths
 * against, and a listener on the root to be observed by.
 */
function shell(overrides: Partial<DeferOptions> = {}) {
  const root = document.createElement("div");
  root.innerHTML = SHELL;
  document.body.appendChild(root);

  const loads: string[] = [];
  const transfers: string[] = [];
  const replayed: Array<{ type: string; target: Element; value?: string }> = [];

  const group = deferGroup({
    root,
    resumed: () => root.querySelector('[data-resume="X"]'),
    signalsWithinResumed: ["keydown"],
    prefetch: () => void transfers.push("group"),
    // Async, as the real one is: the group arrives by `import()`, so its
    // listeners cannot attach before the event that committed it has finished
    // dispatching. Attaching them synchronously inside the capture listener
    // would hand the group the very event this loader just recorded.
    load: async () => {
      loads.push("group");
      await Promise.resolve();
      // Render-and-replace: every node the shell had is discarded and made
      // again by the same markup, which is why a replay addresses its target
      // by path rather than by holding on to the element.
      root.innerHTML = SHELL;
      for (const type of ["click", "input", "keydown"]) {
        root.addEventListener(type, (event) =>
          replayed.push({
            type: event.type,
            target: event.target as Element,
            value: (event.target as HTMLInputElement).value,
          }),
        );
      }
    },
    ...overrides,
  });
  disposers.push(() => {
    group.dispose();
    root.remove();
  });

  return {
    root,
    group,
    loads,
    transfers,
    replayed,
    field: () => root.querySelector<HTMLInputElement>("input.field")!,
    resumed: () => root.querySelector<HTMLInputElement>("input.resumed")!,
    paragraph: () => root.querySelector<HTMLParagraphElement>("p")!,
  };
}

const click = (node: Element) => node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
const keydown = (node: Element, key: string) =>
  node.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
const pointerdown = (node: Element) => node.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
const focusin = (node: Element) => node.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));

describe("the loader loads once, and only for an interaction", () => {
  it("has fetched nothing before anything happens", () => {
    const page = shell();
    expect(page.loads).toEqual([]);
    expect(page.transfers).toEqual([]);
    expect(page.group.stats.imports).toBe(0);
    expect(page.group.stats.prefetches).toBe(0);
    expect(page.group.trigger).toBeNull();
    expect(page.group.prefetchTrigger).toBeNull();
    expect(page.group.loading).toBeNull();
  });

  it("starts the group on the first qualifying event", async () => {
    const page = shell();
    click(page.paragraph());
    await page.group.settled();

    expect(page.loads).toEqual(["group"]);
    expect(page.group.stats.imports).toBe(1);
    expect(page.group.trigger).toBe("click on the deferred group");
  });

  it("makes exactly one request for a burst of events", async () => {
    const page = shell();
    pointerdown(page.field());
    click(page.field());
    page.field().dispatchEvent(new Event("input", { bubbles: true }));
    await page.group.settled();

    // The listeners come off inside the first trigger, so the burst is one
    // recorded event and one load rather than three of each.
    expect(page.loads).toEqual(["group"]);
    expect(page.group.stats.imports).toBe(1);
    expect(page.group.queue).toHaveLength(1);
  });

  it("stops listening the moment the group is asked for", async () => {
    const page = shell();
    click(page.paragraph());
    await page.group.settled();

    const observed = page.group.stats.observed;
    click(page.field());
    // Nothing can be both recorded here and handled by the group.
    expect(page.group.stats.observed).toBe(observed);
    expect(page.group.stats.imports).toBe(1);
  });

  it("listens for the five event types a first touch can arrive as", () => {
    expect([...DEFAULT_DEFER_EVENTS]).toEqual(["pointerdown", "click", "input", "change", "keydown"]);
  });
});

describe("a signal buys the transfer, not the execution", () => {
  it("names the two events that are interaction signals anywhere in the root", () => {
    expect([...DEFAULT_DEFER_SIGNALS]).toEqual(["pointerdown", "focusin"]);
  });

  it("prefetches on a focusin, and executes nothing", () => {
    const page = shell();
    focusin(page.field());

    expect(page.transfers).toEqual(["group"]);
    expect(page.loads).toEqual([]);
    expect(page.group.stats.prefetches).toBe(1);
    expect(page.group.stats.imports).toBe(0);
    expect(page.group.prefetchTrigger).toBe("focusin on the deferred group");
    expect(page.group.trigger).toBeNull();
    expect(page.group.queue).toEqual([]);
  });

  it("keeps listening after a signal, so the committing event is still recorded", async () => {
    const page = shell();
    focusin(page.field());
    click(page.paragraph());
    await page.group.settled();

    expect(page.transfers).toEqual(["group"]);
    expect(page.loads).toEqual(["group"]);
    expect(page.group.queue).toEqual([{ index: 0, type: "click", path: "/0/0" }]);
  });

  it("transfers once however many signals arrive", () => {
    const page = shell();
    focusin(page.field());
    pointerdown(page.resumed());
    keydown(page.resumed(), "a");

    expect(page.transfers).toEqual(["group"]);
    expect(page.group.stats.prefetches).toBe(1);
    expect(page.group.stats.imports).toBe(0);
  });

  it("does not prefetch after the group has been committed", async () => {
    const page = shell();
    click(page.paragraph());
    await page.group.settled();
    focusin(page.root);

    expect(page.transfers).toEqual([]);
    expect(page.group.stats.prefetches).toBe(0);
  });
});

describe("the resumed subtree owns its own events", () => {
  it("does not record, trigger or transfer on a click inside it", () => {
    const page = shell();
    click(page.resumed());

    expect(page.loads).toEqual([]);
    expect(page.transfers).toEqual([]);
    expect(page.group.queue).toEqual([]);
    expect(page.group.stats.observed).toBe(1);
  });

  it("transfers on a keystroke inside it, and still records nothing", () => {
    const page = shell();
    keydown(page.resumed(), "a");

    // The signal: a keystroke in a resumed field says the rest of the page is
    // about to be needed, so its bytes start travelling. The keystroke itself
    // belongs to the resumed path, which is handling it, and what commits the
    // group is that path asking for a store the group has not created yet.
    expect(page.transfers).toEqual(["group"]);
    expect(page.loads).toEqual([]);
    expect(page.group.prefetchTrigger).toBe("keydown in the resumed mount");
    expect(page.group.trigger).toBeNull();
    expect(page.group.queue).toEqual([]);
  });

  it("transfers on a pointerdown inside it", () => {
    const page = shell();
    pointerdown(page.resumed());

    expect(page.transfers).toEqual(["group"]);
    expect(page.group.prefetchTrigger).toBe("pointerdown in the resumed mount");
    expect(page.group.stats.imports).toBe(0);
  });
});

describe("what a recorded event carries", () => {
  it("records the type, the path and the payload, in arrival order", async () => {
    const page = shell();
    page.field().value = "typed";
    page.field().dispatchEvent(new Event("input", { bubbles: true }));
    await page.group.settled();

    expect(page.group.queue).toEqual([{ index: 0, type: "input", path: "/0/1", value: "typed" }]);
  });

  it("addresses nodes the way the locators do", () => {
    const page = shell();
    expect(pathTo(page.root, page.root)).toBe("/");
    expect(pathTo(page.root, page.paragraph())).toBe("/0/0");
    expect(pathTo(page.root, page.field())).toBe("/0/1");
    expect(pathTo(page.root, page.paragraph().firstChild!)).toBe("/0/0");
    expect(pathTo(page.root, document.createElement("div"))).toBeNull();
  });

  it("records a checkbox's state, not its element", async () => {
    const page = shell();
    const box = document.createElement("input");
    box.type = "checkbox";
    page.root.firstElementChild!.appendChild(box);

    click(box);
    await page.group.settled();

    // Checkedness as the group would have seen it: the activation behaviour
    // runs before the event is dispatched, so the recorded state is the state
    // the click produced, not the one it started from.
    expect(page.group.queue).toEqual([{ index: 0, type: "click", path: "/0/2", value: "on", checked: true }]);
  });
});

describe("a recorded event is replayed against the tree the group rendered", () => {
  it("dispatches the same type at the same path, on the new node", async () => {
    const page = shell();
    const before = page.field();
    before.value = "typed before the group existed";
    before.dispatchEvent(new Event("input", { bubbles: true }));
    await page.group.settled();

    expect(page.group.stats.replays).toBe(1);
    expect(page.replayed).toHaveLength(1);
    expect(page.replayed[0].type).toBe("input");
    // The node the path resolved to in the new tree — not the one the user
    // typed into, which the render discarded.
    expect(page.replayed[0].target).toBe(page.field());
    expect(page.replayed[0].target).not.toBe(before);
    // The state the interaction produced, restored before the dispatch.
    expect(page.replayed[0].value).toBe("typed before the group existed");
  });

  it("carries a keystroke's key across", async () => {
    const page = shell();
    keydown(page.field(), "Enter");
    await page.group.settled();

    expect(page.replayed.map((entry) => entry.type)).toEqual(["keydown"]);
    expect(page.group.stats.replays).toBe(1);
  });

  it("drops an event whose path has no counterpart in the new tree", async () => {
    const page = shell();
    const orphan = document.createElement("button");
    page.root.firstElementChild!.appendChild(orphan);
    click(orphan);
    await page.group.settled();

    // Recorded at `/0/2`, which the re-render does not produce: an event with
    // nowhere to go is dropped, not aimed at whatever now sits nearby.
    expect(page.group.queue).toHaveLength(1);
    expect(page.group.stats.replays).toBe(0);
    expect(page.replayed).toEqual([]);
  });
});

describe("one FIFO across the boundary", () => {
  /** A stand-in for the dispatch queue of a component resumed alongside. */
  function sharedQueue() {
    const order: string[] = [];
    let chain: Promise<void> = Promise.resolve();
    const enqueue = (task: () => unknown) => {
      chain = chain.then(async () => void (await task())).catch(() => {});
    };
    return { order, enqueue, drained: () => chain };
  }

  it("replays a captured event before a dispatch that arrived after it", async () => {
    const queue = sharedQueue();
    const page = shell({
      enqueue: queue.enqueue,
      load: async () => {
        await Promise.resolve();
        page.root.innerHTML = SHELL;
        page.root.addEventListener("click", () => queue.order.push("replay"));
      },
    });

    click(page.paragraph()); // arrives first
    queue.enqueue(() => void queue.order.push("dispatch")); // arrives second
    await queue.drained();

    expect(queue.order).toEqual(["replay", "dispatch"]);
  });

  it("runs a dispatch that arrived first before the replay of a later event", async () => {
    const queue = sharedQueue();
    const page = shell({
      enqueue: queue.enqueue,
      load: async () => {
        await Promise.resolve();
        page.root.innerHTML = SHELL;
        page.root.addEventListener("click", () => queue.order.push("replay"));
      },
    });

    // A dispatch whose store has not arrived: parked in the queue, and the
    // replay of an event that lands afterwards must not overtake it.
    let release!: () => void;
    const provided = new Promise<void>((resolve) => (release = resolve));
    queue.enqueue(async () => {
      await provided;
      queue.order.push("dispatch");
    });
    click(page.paragraph());
    release();
    await queue.drained();

    expect(queue.order).toEqual(["dispatch", "replay"]);
  });
});

describe("hash links are native navigation", () => {
  function withLink() {
    const page = shell();
    const link = document.createElement("a");
    link.href = "#/active";
    link.textContent = "Active";
    page.root.firstElementChild!.appendChild(link);
    return { page, link };
  }

  it("commits the group without recording or preventing the click", async () => {
    const { page, link } = withLink();
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(event);
    await page.group.settled();

    expect(page.group.trigger).toBe("click on a hash link");
    expect(page.group.queue).toEqual([]);
    expect(page.group.stats.replays).toBe(0);
    // Not prevented: the browser's own hash navigation is the correct
    // behaviour, and the group reads `location.hash` when it runs.
    expect(event.defaultPrevented).toBe(false);
  });

  it("records nothing for a click on a child of the link either", async () => {
    const { page, link } = withLink();
    const span = document.createElement("span");
    link.appendChild(span);
    click(span);
    await page.group.settled();

    expect(page.group.queue).toEqual([]);
    expect(page.group.stats.imports).toBe(1);
  });
});
