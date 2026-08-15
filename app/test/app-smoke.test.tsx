import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/api", async () => {
  const { mockApi } = await import("./api-mock");
  return { api: mockApi };
});

import { App } from "../src/app";
import { apiState, resetApi } from "./api-mock";
import { get, mount, query, queryAll, settle, text, unmountAll } from "./harness";

/**
 * Render/mount smoke per component region. `Header`, `MainSection`,
 * `TodoItem` and `Footer` are module-local in `src/app.tsx` — only `App` is
 * exported — so every region is exercised through the app root.
 */

beforeEach(() => {
  location.hash = "#/";
  resetApi();
});

afterEach(() => {
  unmountAll();
  vi.restoreAllMocks();
});

describe("app root", () => {
  it("mounts the todoapp shell and the header before data settles", () => {
    const host = mount(App);

    expect(query(host, "section.todoapp")).toBeTruthy();
    expect(query(host, "header.header")).toBeTruthy();
    expect(text(host, "header.header h1")).toBe("todos");
    expect(query<HTMLInputElement>(host, "input.new-todo")).toBeTruthy();
  });

  it("renders the Loading fallback while the initial projection is in flight", () => {
    const host = mount(App);

    expect(query(host, "p.loading")).toBeTruthy();
    expect(query(host, "section.main")).toBeNull();
  });

  it("settles to an empty list: no main section, no footer", async () => {
    const host = mount(App);
    await settle();

    expect(query(host, "p.loading")).toBeNull();
    expect(query(host, "section.main")).toBeNull();
    expect(query(host, "footer.footer")).toBeNull();
    expect(apiState.calls).toContain("getTodos");
  });
});

describe("regions with seeded data", () => {
  beforeEach(() => {
    resetApi([
      { id: "a1", title: "write the port", completed: false },
      { id: "a2", title: "wire the fixtures", completed: true }
    ]);
  });

  it("renders MainSection with one TodoItem per todo", async () => {
    const host = mount(App);
    await settle();

    const section = get(host, "section.main");
    expect(query<HTMLInputElement>(section, "input#toggle-all")).toBeTruthy();
    expect(text(section, "label[for='toggle-all']")).toBe("Mark all as complete");

    const items = queryAll(host, "ul.todo-list li.todo");
    expect(items).toHaveLength(2);
    expect(items.map(item => item.querySelector("label")?.textContent)).toEqual([
      "write the port",
      "wire the fixtures"
    ]);
  });

  it("renders each TodoItem with its toggle, label and destroy control", async () => {
    const host = mount(App);
    await settle();

    const first = get(host, "ul.todo-list li.todo");
    const toggle = get<HTMLInputElement>(first, "input.toggle");
    expect(toggle.type).toBe("checkbox");
    expect(toggle.checked).toBe(false);
    expect(query(first, "button.destroy")).toBeTruthy();
    // No error yet, so the retry affordance stays out of the tree.
    expect(query(first, "button.retry")).toBeNull();
  });

  it("marks completed todos with the completed class", async () => {
    const host = mount(App);
    await settle();

    const items = queryAll(host, "ul.todo-list li.todo");
    expect(items[0].classList.contains("completed")).toBe(false);
    expect(items[1].classList.contains("completed")).toBe(true);
  });

  it("renders Footer with the remaining count and the three filters", async () => {
    const host = mount(App);
    await settle();

    const footer = get(host, "footer.footer");
    expect(text(footer, "span.todo-count")).toContain("1");
    expect(text(footer, "span.todo-count")).toContain("item left");
    expect(queryAll(footer, "ul.filters a").map(a => a.textContent)).toEqual([
      "All",
      "Active",
      "Completed"
    ]);
    // One todo is completed, so the bulk-clear affordance is present.
    expect(query(footer, "button.clear-completed")).toBeTruthy();
  });

  it("checks toggle-all only when every todo is completed", async () => {
    resetApi([
      { id: "b1", title: "one", completed: true },
      { id: "b2", title: "two", completed: true }
    ]);
    const host = mount(App);
    await settle();

    expect(get<HTMLInputElement>(host, "input#toggle-all").checked).toBe(true);
  });

  it("hides clear-completed when nothing is completed", async () => {
    resetApi([{ id: "c1", title: "only active", completed: false }]);
    const host = mount(App);
    await settle();

    expect(query(host, "footer.footer")).toBeTruthy();
    expect(query(host, "button.clear-completed")).toBeNull();
  });
});

describe("entry module", () => {
  it("src/main.tsx renders the app into #root", async () => {
    const root = document.createElement("div");
    root.id = "root";
    document.body.appendChild(root);
    try {
      await import("../src/main");
      await settle();
      expect(root.querySelector("section.todoapp")).toBeTruthy();
    } finally {
      root.remove();
    }
  });
});
