import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterAll, describe, expect, it } from "vitest";
import { Analyzer, type Module } from "yuku-analyzer";

import { classify, emit } from "../src/comptime/index.ts";
import type { Analysis, ProvableAnalysis, ReasonCode } from "../src/comptime/types.ts";
import { createRegistry, type HandlerModule } from "../src/resume/registry.ts";
import { createStoreRegistry } from "../src/resume/stores.ts";
import { resumeBundle } from "../src/resume/resumer.ts";

/**
 * Two handler refusals, narrowed — and narrowed is the word. Neither code was
 * lifted; each grew exactly one admitted shape, and each shape is one this pass
 * had already proved something about.
 *
 *   `handler-not-inline` admits a bare identifier that resolves to an ADMITTED
 *   ACTION. There is no body to read, because there never was one: an action was
 *   proved by identity — its store and the fixed slot path reaching it — and
 *   handing it to an event prop asks for nothing further. The listener the
 *   resume path installs is the live store's own function at that path, called
 *   with the event exactly as the framework would have called it.
 *
 *   `handler-unsupported-syntax` admits a MEMBER READ rooted at a capture slot.
 *   `state.items.length` inside a handler is the same admission the derivation
 *   walk already makes — the base is an identity, the chain above it is the
 *   author's own source — asked once the event has fired, where there is no
 *   build-time value to get wrong. Groundwork for region-item slots, proved here
 *   over the slot arms that exist today.
 *
 * Every case below is paired with the same shape with one thing changed, because
 * an admission goes wrong by quietly proving something adjacent to what it was
 * given.
 */

const scratchDirs: string[] = [];

function scratch(): string {
  const dir = mkdtempSync(join(process.cwd(), "test", ".artifacts-handler-narrowings-"));
  scratchDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
});

function project(files: Record<string, string>): Map<string, Module> {
  const analyzer = new Analyzer();
  const modules = new Map<string, Module>();
  for (const [path, source] of Object.entries(files)) modules.set(path, analyzer.addFile(path, source));
  analyzer.link();
  return modules;
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

const STORE = `export function createTodos() {
    const data = { items: [] as string[] };
    const actions = {
      clearCompleted() { return data.items.length; },
      addAt(index: number) { return data.items.length + index; },
    };
    return [data, actions] as const;
  }`;

/** One consumer with a single hole: the markup its component returns. */
function panel(markup: string, component = "Panel"): Analysis {
  const files = {
    "store.ts": STORE,
    "app.tsx": `import { createContext, useContext } from "solid-js";
      import { createTodos } from "./store";

      const TodosContext = createContext<ReturnType<typeof createTodos>>();

      function Panel() {
        const [todos, { clearCompleted, addAt }] = useContext(TodosContext);
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
  const module = project(files).get("app.tsx")!;
  return classify(module, component);
}

// ------------------------------------------- handler-not-inline, narrowed

describe("an action handed straight to an event prop", () => {
  const analysis = proved(
    panel(`<footer class="panel"><button class="clear" onClick={clearCompleted}>Clear</button></footer>`),
  );

  it("wires it as an action slot, with no body extracted", () => {
    expect(analysis.handlers).toHaveLength(1);
    const [handler] = analysis.handlers;
    expect(handler).toMatchObject({ id: "s0", event: "click", locator: "/0", origin: "action" });
    expect(handler.captures).toEqual([
      { name: "clearCompleted", kind: "action", store: "s0", path: [1, "clearCompleted"] },
    ]);
    expect(analysis.wiring[0]).toMatchObject({ locator: "/0", event: "click", handler: "s0" });
  });

  it("emits a handler module that hands back the slot itself", () => {
    const dir = join(scratch(), "Panel");
    emit(analysis, dir);
    const source = readFileSync(join(dir, "handlers/s0.js"), "utf8");

    // Nobody wrote this listener, so nothing of anyone's is printed into it.
    expect(source).toContain("export function create({ clearCompleted }) {\n  return clearCompleted;\n}");
    expect(source).toContain("One event handler that IS a store action");
  });

  it("dispatches to the live store's own function, unwrapped", async () => {
    const dir = join(scratch(), "Panel");
    emit(analysis, dir);
    const load = async (file: string) =>
      (await import(pathToFileURL(join(dir, file)).href)) as Record<string, unknown>;

    const registry = createRegistry(
      {
        "/artifacts/Panel/template.js": await load("template.js"),
        "/artifacts/Panel/structure.js": await load("structure.js"),
        "/artifacts/Panel/wiring.js": await load("wiring.js"),
      },
      {
        "/artifacts/Panel/handlers/s0.js": async () =>
          (await load("handlers/s0.js")) as unknown as HandlerModule,
      },
    );

    const calls: Event[] = [];
    const live = [{ items: [] }, { clearCompleted: (event: Event) => calls.push(event) }];
    const stores = createStoreRegistry();
    stores.provide("s0", live);

    const bundle = registry.get("Panel")!;
    const container = document.createElement("div");
    container.innerHTML = bundle.template!.html;
    document.body.appendChild(container);
    const app = resumeBundle(container, bundle, { stores });

    // The slot resolves to the store's own function — nothing wraps it, which is
    // what makes "the listener IS the action" a fact rather than a paraphrase.
    expect(stores.action("s0", [1, "clearCompleted"])).toBe(live[1].clearCompleted);

    container.querySelector("button")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await app.settled();

    expect(calls).toHaveLength(1);
    expect(calls[0].type).toBe("click");

    app.dispose();
    container.remove();
  });

  it("still refuses every other non-inline handler", () => {
    const cases: Record<string, string> = {
      // The store's DATA is not an action, and nothing proved it callable.
      "the read binding": `<footer><button onClick={todos}>x</button></footer>`,
      // A free name with no binding in this module at all.
      "an imported handler": `<footer><button onClick={createTodos}>x</button></footer>`,
      // A member of the actions object, which was never destructured into a slot.
      "a member expression": `<footer><button onClick={todos.items.pop}>x</button></footer>`,
    };
    for (const [name, markup] of Object.entries(cases)) {
      const analysis = panel(markup);
      expect(analysis.status, name).toBe("fallback");
      expect(codesOf(analysis), name).toContain("handler-not-inline");
    }
  });
});

// ------------------------------------ handler-unsupported-syntax, narrowed

describe("a member read rooted at a capture slot, inside a handler", () => {
  const analysis = proved(
    panel(`<footer class="panel"><button onClick={() => addAt(todos.items.length)}>Add</button></footer>`),
  );

  it("captures the store read by identity beside the action", () => {
    expect(analysis.handlers[0].captures).toEqual([
      { name: "addAt", kind: "action", store: "s0", path: [1, "addAt"] },
      { name: "todos", kind: "store-read", store: "s0", path: [0] },
    ]);
    // The chain above the base is the author's own source, printed back out and
    // never evaluated here.
    expect(analysis.handlers[0].source).toContain("todos.items.length");
  });

  it("refuses everything that is not a read through the slot", () => {
    const cases: Record<string, [string, ReasonCode]> = {
      // A write into the store's data. The identity was proved; permission to
      // change what it points at was not.
      "a write": [`() => { todos.items = []; }`, "store-read-escapes"],
      // A method whose body this pass never saw.
      "a method call": [`() => addAt(todos.items.indexOf("x"))`, "store-read-escapes"],
      // A slot chosen at runtime: the artifact would name a path nobody saw.
      "a computed step": [`() => addAt(todos.items[todos.items.length])`, "store-read-escapes"],
      // The binding itself, handed somewhere this pass cannot follow.
      "the binding whole": [`() => addAt(todos)`, "store-read-escapes"],
    };
    for (const [name, [handler, code]] of Object.entries(cases)) {
      const analysis = panel(`<footer><button onClick={${handler}}>x</button></footer>`);
      expect(analysis.status, name).toBe("fallback");
      expect(codesOf(analysis), name).toContain(code);
    }
  });

  it("keeps refusing a capture that is neither a cell nor a store", () => {
    const analysis = panel(`<footer><button onClick={() => addAt(Number(loose))}>x</button></footer>`);
    expect(analysis.status).toBe("fallback");
    expect(codesOf(analysis)).toContain("handler-references-free-name");
  });
});
