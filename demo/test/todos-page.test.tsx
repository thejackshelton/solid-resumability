import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { flush } from "solid-js";
import { render } from "@solidjs/web";

import { App } from "../../app/src/app";
import { api, resetTodos } from "../src/api-mock.ts";

/**
 * The todos page, in the demo's own build.
 *
 * Two things are under test and neither of them is the app, which has its own
 * suite in `app/test/` and is imported here unchanged:
 *
 *   1. the module swap actually happened — the page is running the demo's
 *      fast API and not the app's 400 ms / one-in-three-failures one, which
 *      is what makes the page demo-able and the measurement repeatable;
 *   2. the page still works after the swap. If aliasing `./api` broke the
 *      optimistic store, the demo would be shipping a broken todos page and
 *      the byte comparison would be measuring one.
 *
 * A separate file from the fixtures page on purpose: vitest gives each file
 * its own module registry, and the fixtures page's evidence is an argument
 * about what that registry did and did not load.
 */

const disposers: Array<() => void> = [];

function mount(): HTMLElement {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const dispose = render(App as never, host);
  disposers.push(() => {
    dispose();
    host.remove();
  });
  return host;
}

/**
 * Drains the microtask queue (async projections, `action` generators) plus one
 * macrotask turn, then flushes the graph. No fake timers are needed precisely
 * because the demo API resolves immediately — with the app's real API this
 * helper would have to sleep 400 ms and could still lose a coin flip.
 */
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

function get<E extends Element = HTMLElement>(host: ParentNode, selector: string): E {
  const element = host.querySelector<E>(selector);
  expect(element, `missing element for selector ${selector}`).toBeTruthy();
  return element!;
}

async function addTodo(host: HTMLElement, title: string): Promise<void> {
  const input = get<HTMLInputElement>(host, "input.new-todo");
  input.value = title;
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  flush();
  await settle();
}

beforeEach(() => {
  resetTodos();
});

afterEach(() => {
  while (disposers.length) disposers.pop()!();
  resetTodos();
});

describe("the demo's api module", () => {
  it("is the mock, not the app's fault injector", async () => {
    // The real module rejects ~33% of saves and sleeps 400 ms. Fifty writes
    // through the demo's module: all of them resolve, none of them wait.
    const started = Date.now();
    for (let i = 0; i < 50; i++) {
      await api.addTodo({ id: `t${i}`, title: `todo ${i}`, completed: false });
    }
    expect((await api.getTodos()).length).toBe(50);
    expect(Date.now() - started).toBeLessThan(400);
  });
});

describe("the todos page still works after the swap", () => {
  it("adds a todo and shows it", async () => {
    const host = mount();
    await settle();

    await addTodo(host, "write the measurement");

    expect(get(host, ".todo-list li label").textContent).toBe("write the measurement");
    expect(get(host, ".todo-count").textContent).toContain("1");
  });

  it("toggles one, and the footer follows", async () => {
    const host = mount();
    await settle();
    await addTodo(host, "first");
    await addTodo(host, "second");

    const toggle = get<HTMLInputElement>(host, ".todo-list li input.toggle");
    toggle.checked = true;
    toggle.dispatchEvent(new Event("input", { bubbles: true }));
    flush();
    await settle();

    expect(host.querySelectorAll(".todo-list li.completed")).toHaveLength(1);
    expect(get(host, ".todo-count").textContent).toContain("1");
    expect(get(host, "button.clear-completed")).toBeTruthy();
  });

  it("never shows an error affordance — nothing here fails at random", async () => {
    const host = mount();
    await settle();
    for (const title of ["a", "b", "c", "d", "e"]) await addTodo(host, title);

    expect(host.querySelectorAll(".todo-list li.errored")).toHaveLength(0);
    expect(host.querySelectorAll("button.retry")).toHaveLength(0);
    expect(host.querySelectorAll(".todo-list li")).toHaveLength(5);
  });
});
