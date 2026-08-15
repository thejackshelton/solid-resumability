import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/api", async () => {
  const { mockApi } = await import("./api-mock");
  return { api: mockApi };
});

import { App } from "../src/app";
import { apiState, failNextWrites, resetApi } from "./api-mock";
import {
  click,
  get,
  mount,
  query,
  queryAll,
  settle,
  text,
  toggleCheckbox,
  typeAndEnter,
  unmountAll
} from "./harness";

function titles(host: ParentNode): string[] {
  return queryAll(host, "ul.todo-list li.todo label").map(label => label.textContent ?? "");
}

function itemFor(host: ParentNode, title: string): HTMLElement {
  const item = queryAll<HTMLElement>(host, "ul.todo-list li.todo").find(
    li => li.querySelector("label")?.textContent === title
  );
  expect(item, `no todo item titled ${title}`).toBeTruthy();
  return item!;
}

async function mountSettled(): Promise<HTMLElement> {
  const host = mount(App);
  await settle();
  return host;
}

beforeEach(() => {
  location.hash = "#/";
  resetApi();
});

afterEach(() => {
  unmountAll();
  vi.restoreAllMocks();
});

describe("add todo", () => {
  it("adds a todo on Enter and clears the input", async () => {
    const host = await mountSettled();
    const input = get<HTMLInputElement>(host, "input.new-todo");

    typeAndEnter(input, "write the port");
    expect(input.value).toBe("");
    // Optimistic write lands before the API resolves.
    expect(titles(host)).toEqual(["write the port"]);

    await settle();
    expect(titles(host)).toEqual(["write the port"]);
    expect(apiState.todos.map(t => t.title)).toEqual(["write the port"]);
  });

  it("ignores non-Enter keys and blank titles", async () => {
    const host = await mountSettled();
    const input = get<HTMLInputElement>(host, "input.new-todo");

    input.value = "not committed";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    await settle();
    expect(query(host, "ul.todo-list")).toBeNull();

    typeAndEnter(input, "   ");
    await settle();
    expect(query(host, "ul.todo-list")).toBeNull();
    expect(apiState.todos).toHaveLength(0);
  });

  it("adds several todos and keeps the remaining count in step", async () => {
    const host = await mountSettled();
    const input = get<HTMLInputElement>(host, "input.new-todo");

    typeAndEnter(input, "first");
    await settle();
    typeAndEnter(input, "second");
    await settle();

    expect(titles(host)).toHaveLength(2);
    expect(text(host, "span.todo-count")).toContain("2");
    expect(text(host, "span.todo-count")).toContain("items left");
  });
});

describe("toggle", () => {
  beforeEach(() => {
    resetApi([
      { id: "t1", title: "alpha", completed: false },
      { id: "t2", title: "beta", completed: false }
    ]);
  });

  it("toggles one todo through the item checkbox", async () => {
    const host = await mountSettled();
    const item = itemFor(host, "alpha");

    toggleCheckbox(get<HTMLInputElement>(item, "input.toggle"));
    await settle();

    expect(itemFor(host, "alpha").classList.contains("completed")).toBe(true);
    expect(itemFor(host, "beta").classList.contains("completed")).toBe(false);
    expect(apiState.todos.find(t => t.id === "t1")?.completed).toBe(true);
    expect(text(host, "span.todo-count")).toContain("1");
  });

  it("toggles a completed todo back to active", async () => {
    resetApi([{ id: "t3", title: "gamma", completed: true }]);
    const host = await mountSettled();

    toggleCheckbox(get<HTMLInputElement>(itemFor(host, "gamma"), "input.toggle"));
    await settle();

    expect(itemFor(host, "gamma").classList.contains("completed")).toBe(false);
    expect(apiState.todos[0].completed).toBe(false);
  });
});

describe("toggle all", () => {
  beforeEach(() => {
    resetApi([
      { id: "u1", title: "alpha", completed: false },
      { id: "u2", title: "beta", completed: true }
    ]);
  });

  it("completes every todo, then clears them all", async () => {
    const host = await mountSettled();

    toggleCheckbox(get<HTMLInputElement>(host, "input#toggle-all"));
    await settle();

    expect(apiState.todos.every(t => t.completed)).toBe(true);
    expect(queryAll(host, "ul.todo-list li.todo.completed")).toHaveLength(2);
    expect(get<HTMLInputElement>(host, "input#toggle-all").checked).toBe(true);

    toggleCheckbox(get<HTMLInputElement>(host, "input#toggle-all"));
    await settle();

    expect(apiState.todos.every(t => !t.completed)).toBe(true);
    expect(queryAll(host, "ul.todo-list li.todo.completed")).toHaveLength(0);
    expect(text(host, "span.todo-count")).toContain("2");
  });
});

describe("hash filters", () => {
  beforeEach(() => {
    resetApi([
      { id: "f1", title: "active one", completed: false },
      { id: "f2", title: "done one", completed: true }
    ]);
  });

  async function setHash(host: HTMLElement, hash: string): Promise<void> {
    location.hash = hash;
    await settle();
    void host;
  }

  it("switches the visible list as the hash changes", async () => {
    const host = await mountSettled();
    expect(titles(host)).toEqual(["active one", "done one"]);

    await setHash(host, "#/active");
    expect(titles(host)).toEqual(["active one"]);

    await setHash(host, "#/completed");
    expect(titles(host)).toEqual(["done one"]);

    await setHash(host, "#/");
    expect(titles(host)).toEqual(["active one", "done one"]);
  });

  it("marks the matching filter link as selected", async () => {
    const host = await mountSettled();
    const selected = () =>
      queryAll(host, "ul.filters a")
        .filter(a => a.classList.contains("selected"))
        .map(a => a.textContent);

    expect(selected()).toEqual(["All"]);

    await setHash(host, "#/active");
    expect(selected()).toEqual(["Active"]);

    await setHash(host, "#/completed");
    expect(selected()).toEqual(["Completed"]);
  });

  it("starts on the filter already present in the URL at mount", async () => {
    location.hash = "#/completed";
    const host = await mountSettled();

    expect(titles(host)).toEqual(["done one"]);
  });
});

describe("clear completed", () => {
  it("removes only the completed todos", async () => {
    resetApi([
      { id: "g1", title: "keep me", completed: false },
      { id: "g2", title: "drop me", completed: true },
      { id: "g3", title: "drop me too", completed: true }
    ]);
    const host = await mountSettled();

    click(get(host, "button.clear-completed"));
    await settle();

    expect(titles(host)).toEqual(["keep me"]);
    expect(apiState.todos.map(t => t.id)).toEqual(["g1"]);
    expect(query(host, "button.clear-completed")).toBeNull();
  });
});

describe("remove todo", () => {
  it("destroys a todo through its destroy button", async () => {
    resetApi([
      { id: "t1", title: "stays", completed: false },
      { id: "t2", title: "goes", completed: false }
    ]);
    const host = await mountSettled();

    click(get(itemFor(host, "goes"), "button.destroy"));
    await settle();

    expect(titles(host)).toEqual(["stays"]);
    expect(apiState.todos.map(t => t.id)).toEqual(["t1"]);
  });
});

describe("error and retry", () => {
  it("surfaces a failed toggle as a retry affordance, then recovers on retry", async () => {
    resetApi([{ id: "e1", title: "flaky", completed: false }]);
    const host = await mountSettled();

    failNextWrites(1);
    toggleCheckbox(get<HTMLInputElement>(itemFor(host, "flaky"), "input.toggle"));
    await settle();

    const errored = itemFor(host, "flaky");
    expect(errored.classList.contains("errored")).toBe(true);
    const retry = get<HTMLButtonElement>(errored, "button.retry");
    expect(retry.title).toBe("Retry toggleTodo");
    // The optimistic write reverted: the server never accepted the toggle.
    expect(apiState.todos[0].completed).toBe(false);

    click(retry);
    await settle();

    const recovered = itemFor(host, "flaky");
    expect(query(recovered, "button.retry")).toBeNull();
    expect(recovered.classList.contains("errored")).toBe(false);
    expect(recovered.classList.contains("completed")).toBe(true);
    expect(apiState.todos[0].completed).toBe(true);
  });

  it("keeps a failed add visible with a retry affordance", async () => {
    const host = await mountSettled();

    failNextWrites(1);
    typeAndEnter(get<HTMLInputElement>(host, "input.new-todo"), "doomed");
    await settle();

    const errored = itemFor(host, "doomed");
    expect(errored.classList.contains("errored")).toBe(true);
    expect(get<HTMLButtonElement>(errored, "button.retry").title).toBe("Retry addTodo");
    expect(apiState.todos).toHaveLength(0);

    click(get(errored, "button.retry"));
    await settle();

    expect(query(itemFor(host, "doomed"), "button.retry")).toBeNull();
    expect(apiState.todos.map(t => t.title)).toEqual(["doomed"]);
  });
});
