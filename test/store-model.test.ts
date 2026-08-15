import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

import { Analyzer, type Module } from "yuku-analyzer";

import { classify, classifySite, emit } from "../src/comptime/index.ts";
import { findComponent } from "../src/comptime/discover.ts";
import { loadProjectFrom } from "../src/comptime/project.ts";
import { isActionSlot, type Analysis, type ProvableAnalysis, type ReasonCode } from "../src/comptime/types.ts";
import { createRegistry } from "../src/resume/registry.ts";
import { createStoreRegistry } from "../src/resume/stores.ts";
import { textBinding } from "./bindings.ts";

/**
 * S3 — the store model: three admissions, and the guards that keep each of
 * them from being wider than it was ruled.
 *
 *   1. **Store/action identity.** A binding is admitted when it traces to a
 *      `createContext` symbol, a *fixed* slot of a statically destructured
 *      `useContext` result, and a provider whose value expression is visible
 *      in the analyzed file set. What is carried into the artifacts is the
 *      identity — store id plus slot path — never the action's body.
 *   2. **The `Date`/`Math` whitelist.** An enumerated set of member calls,
 *      admitted only inside an extracted handler body, and never folded.
 *   3. **Event-object syntax.** Member reads, derived values and a write back
 *      into the event object, inside a handler.
 *
 * Every admission below is paired with at least one refusal that is the
 * admitted shape with exactly one thing changed, because the way an admission
 * goes wrong is by quietly proving something adjacent to what it was given.
 * Sources are analyzed in memory: no path or file name carries meaning, and
 * the provider genuinely lives in another module than the store factory so the
 * cross-module resolution has real chains to follow.
 */

const scratchDirs: string[] = [];

function scratch(): string {
  const dir = mkdtempSync(join(process.cwd(), ".artifacts-s3-"));
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

/** The `reason` details on every `store-binding-not-provable` refusal. */
function storeReasons(analysis: Analysis): string[] {
  return analysis.reasons
    .filter((reason) => reason.code === "store-binding-not-provable")
    .map((reason) => String(reason.detail?.reason));
}

// ------------------------------------------------------------------ the shapes

/** The store factory: a fixed two-slot tuple whose action slot is an object literal. */
const STORE = `export function createStore() {
    const data = { items: [] as string[] };
    const actions = {
      add(label: string) { return data.items.push(label); },
      clear() { return data.items.length; },
    };
    return [data, actions] as const;
  }`;

/**
 * The consumer + provider module, with two holes: the consumer's destructuring
 * line and its handler body. Everything else — the context, the provider, and
 * the markup — is identical across every case below, so a differing verdict is
 * evidence about the hole and not about the scaffolding.
 */
function app(binding: string, handler: string, extra = ""): string {
  return `import { createContext, useContext } from "solid-js";
    import { createStore } from "./store";

    const StoreContext = createContext<ReturnType<typeof createStore>>();
    ${extra}

    function Widget() {
      ${binding}
      return (
        <div>
          <input onKeyDown={e => { ${handler} }} />
        </div>
      );
    }

    export function Shell() {
      return (
        <StoreContext value={createStore()}>
          <Widget />
        </StoreContext>
      );
    }`;
}

function widget(binding: string, handler: string, extra = ""): Analysis {
  return classifyProject({ "src/app.tsx": app(binding, handler, extra), "src/store.ts": STORE }, "src/app.tsx", "Widget");
}

const ADMITTED_BINDING = "const [, { add }] = useContext(StoreContext);";
const ADMITTED_HANDLER = "add(e.currentTarget.value);";

// ------------------------------------------------- admission 1: store identity

describe("S3 admission 1 — a store action is provable by identity", () => {
  it("admits a fixed action slot behind a visible provider", () => {
    const analysis = proved(widget(ADMITTED_BINDING, ADMITTED_HANDLER));

    expect(analysis.stores).toHaveLength(1);
    expect(analysis.stores[0]).toMatchObject({
      id: "s0",
      context: "StoreContext",
      contextModule: "src/app.tsx",
      actionsSlot: 1,
      // The read side is not admitted at all in this slice.
      readSlot: null,
      value: { module: "src/store.ts", factory: "createStore" },
    });
    // The provider was found where it actually is, not assumed.
    expect(analysis.stores[0].provider.module).toBe("src/app.tsx");

    expect(analysis.actions).toEqual([
      expect.objectContaining({ store: "s0", name: "add", path: [1, "add"] }),
    ]);
  });

  it("carries the action into the handler manifest by identity, not by body", () => {
    const analysis = proved(widget(ADMITTED_BINDING, ADMITTED_HANDLER));

    expect(analysis.handlers).toHaveLength(1);
    const [slot] = analysis.handlers[0].captures;
    expect(isActionSlot(slot)).toBe(true);
    expect(slot).toEqual({ name: "add", kind: "action", store: "s0", path: [1, "add"] });

    // The manifest says where the action is. Nothing anywhere says what it
    // does: `data.items.push` is the action's body and must not have travelled.
    expect(JSON.stringify(analysis)).not.toContain("push");
    expect(analysis.handlers[0].source).not.toContain("push");
  });

  it("names every destructured action, and only those", () => {
    const analysis = proved(widget("const [, { add, clear }] = useContext(StoreContext);", "add(e.key); clear();"));
    expect(analysis.actions.map((action) => action.name)).toEqual(["add", "clear"]);
    expect(analysis.actions.map((action) => action.path)).toEqual([
      [1, "add"],
      [1, "clear"],
    ]);
  });

  it("keeps the local alias, and the slot key, when they differ", () => {
    const analysis = proved(widget("const [, { add: push }] = useContext(StoreContext);", "push(e.key);"));
    // The extracted code says `push`; the store's slot is still `add`.
    expect(analysis.actions[0]).toMatchObject({ name: "push", path: [1, "add"] });
  });

  // --- refusal guards

  it("refuses a `useContext` result that is not destructured", () => {
    const analysis = widget("const ctx = useContext(StoreContext); const add = ctx[1].add;", "add(e.key);");
    expect(analysis.status).toBe("fallback");
    expect(storeReasons(analysis)).toEqual(["result-not-destructured"]);
    // And the component is not left looking sourceless: the more specific code
    // replaces `no-signal-source`, it does not sit beside it.
    expect(codesOf(analysis)).not.toContain("no-signal-source");
  });

  it("admits the read slot without admitting a use of it", () => {
    // The slot is fixed and the provider visible, so the binding is a real
    // identity — and an identity nothing has read yet is not a refusal. What
    // this component does with `data` is nothing at all, which is admissible
    // precisely because the pass never had to say what the data is.
    const analysis = proved(widget("const [data, { add }] = useContext(StoreContext);", "add(e.key);"));
    expect(analysis.stores[0].readSlot).toBe(0);
    expect(analysis.reads).toEqual([
      expect.objectContaining({ id: "s0r", store: "s0", name: "data", path: [0] }),
    ]);
  });

  it("refuses an action pattern that is not a fixed slot", () => {
    for (const binding of [
      "const [, actions] = useContext(StoreContext); const add = actions.add;",
      "const [, { add = () => {} }] = useContext(StoreContext);",
      "const [, { ...rest }] = useContext(StoreContext); const add = rest.add;",
    ]) {
      const analysis = widget(binding, "add(e.key);");
      expect(analysis.status, binding).toBe("fallback");
      expect(storeReasons(analysis), binding).toEqual(["actions-slot-not-fixed"]);
    }
  });

  it("refuses a context that is not a `createContext` result", () => {
    const analysis = classifyProject(
      {
        "src/app.tsx": `import { useContext } from "solid-js";
          import { StoreContext } from "./elsewhere";
          export function Widget() {
            const [, { add }] = useContext(StoreContext);
            return <div><button onClick={() => add(1)}>go</button></div>;
          }`,
        "src/elsewhere.ts": `export const StoreContext = { id: 1 };`,
      },
      "src/app.tsx",
      "Widget",
    );
    expect(storeReasons(analysis)).toEqual(["context-not-createContext"]);
  });

  it("refuses an action used anywhere but its own call site", () => {
    const analysis = widget(ADMITTED_BINDING, "const f = add; f(e.key);");
    expect(storeReasons(analysis)).toEqual(["action-escapes"]);
  });
});

describe("S3 admission 1 — provider visibility is a property of the analyzed file set", () => {
  /** The same consumer, with the provider module withheld from the analyzer. */
  const CONSUMER = `import { createContext, useContext } from "solid-js";
    export const StoreContext = createContext<any>();
    export function Widget() {
      const [, { add }] = useContext(StoreContext);
      return <div><input onKeyDown={e => { add(e.key); }} /></div>;
    }`;

  const PROVIDER = `import { StoreContext } from "./consumer";
    import { createStore } from "./store";
    export function Shell() {
      return <StoreContext value={createStore()}><span>x</span></StoreContext>;
    }`;

  it("admits the binding when the provider module is in the set", () => {
    const analysis = proved(
      classifyProject(
        { "src/consumer.tsx": CONSUMER, "src/provider.tsx": PROVIDER, "src/store.ts": STORE },
        "src/consumer.tsx",
        "Widget",
      ),
    );
    // Found across a module boundary, through the import chain — not by
    // assuming the context's own module must hold the provider.
    expect(analysis.stores[0].provider.module).toBe("src/provider.tsx");
    expect(analysis.stores[0].value).toEqual({ module: "src/store.ts", factory: "createStore" });
  });

  it("refuses the identical binding when the provider is outside the set", () => {
    const analysis = classifyProject(
      { "src/consumer.tsx": CONSUMER, "src/store.ts": STORE },
      "src/consumer.tsx",
      "Widget",
    );
    expect(analysis.status).toBe("fallback");
    expect(storeReasons(analysis)).toEqual(["provider-not-visible"]);
  });

  it("refuses when two providers make the value ambiguous", () => {
    const analysis = classifyProject(
      {
        "src/consumer.tsx": CONSUMER,
        "src/provider.tsx": PROVIDER,
        "src/other.tsx": PROVIDER.replace("Shell", "OtherShell"),
        "src/store.ts": STORE,
      },
      "src/consumer.tsx",
      "Widget",
    );
    expect(storeReasons(analysis)).toEqual(["provider-not-visible"]);
  });

  it("refuses when the provider's value expression is not a readable slot shape", () => {
    for (const value of ["{ makeStore() }", "{ [data, actions] }", "{ external }"]) {
      const analysis = classifyProject(
        {
          "src/consumer.tsx": CONSUMER,
          "src/provider.tsx": `import { StoreContext } from "./consumer";
            import { external } from "./store";
            const data = 1, actions = 2;
            function makeStore() { const a = 1; return a; }
            export function Shell() {
              return <StoreContext value=${value}><span>x</span></StoreContext>;
            }`,
          "src/store.ts": `export const external = 1;`,
        },
        "src/consumer.tsx",
        "Widget",
      );
      expect(storeReasons(analysis), value).toEqual(["provider-value-not-readable"]);
    }
  });

  it("refuses when the provider's value has no slot by that name", () => {
    const analysis = classifyProject(
      {
        "src/consumer.tsx": CONSUMER,
        "src/provider.tsx": PROVIDER,
        "src/store.ts": STORE.replace("add(label: string)", "append(label: string)"),
      },
      "src/consumer.tsx",
      "Widget",
    );
    expect(storeReasons(analysis)).toEqual(["action-slot-missing"]);
  });
});

// ------------------------------------------- admission 2: the ambient whitelist

describe("S3 admission 2 — `Date`/`Math` are event-time-only", () => {
  it("admits the enumerated member calls inside a handler", () => {
    const analysis = proved(
      widget(
        ADMITTED_BINDING,
        "add(Date.now() + Math.floor(Math.random() * 10) + Math.min(1, 2) + Math.max(3, 4));",
      ),
    );
    // Nothing was folded: the handler's source still says `Date.now()`, and no
    // cell, binding or initial text anywhere records a number from build time.
    expect(analysis.handlers[0].source).toContain("Date.now()");
    expect(analysis.bindings).toEqual([]);
  });

  it("refuses a whitelisted call in a build-time-derivable position", () => {
    // The soundness line. `Date.now()` in a text binding would have to be
    // *evaluated* to produce `initialText`, and a build-time answer to
    // "what time is it" is a wrong answer, not an optimization.
    const analysis = classifyProject(
      {
        "src/app.tsx": `import { createSignal } from "solid-js";
          export function Clock() {
            const [count, setCount] = createSignal(0);
            return (
              <div>
                <span>{Date.now() + count()}</span>
                <button onClick={() => setCount(count() + 1)}>+</button>
              </div>
            );
          }`,
      },
      "src/app.tsx",
      "Clock",
    );
    expect(analysis.status).toBe("fallback");
    expect(codesOf(analysis)).toContain("jsx-dynamic-child-not-derivable");
    // And nothing in the refusal record carries a folded timestamp.
    expect(JSON.stringify(analysis)).not.toMatch(/\b1[6-9]\d{11}\b/);
  });

  it("refuses a non-enumerated global in a handler", () => {
    for (const body of ["document.title = e.key;", "console.log(e.key);", "add(fetch(e.key));"]) {
      const analysis = widget(ADMITTED_BINDING, body);
      expect(analysis.status, body).toBe("fallback");
      expect(codesOf(analysis), body).toContain("handler-references-free-name");
    }
  });

  it("refuses a non-enumerated member of a whitelisted receiver", () => {
    // The grant is a table of calls, not a namespace. `Math` and `Date` are
    // not admitted wholesale.
    for (const body of ["add(Date.parse(e.key));", "add(Math.sqrt(2));", "add(Math.PI);"]) {
      const analysis = widget(ADMITTED_BINDING, body);
      expect(analysis.status, body).toBe("fallback");
      expect(codesOf(analysis), body).toContain("handler-references-free-name");
    }
  });

  it("refuses a whitelisted receiver handed somewhere as a value", () => {
    const analysis = widget(ADMITTED_BINDING, "add(Math);");
    expect(codesOf(analysis)).toContain("handler-references-free-name");
  });

  it("does not admit the whitelist inside a summarized helper", () => {
    // `summaries.ts` is untouched by this slice: a helper that names an
    // ambient global is still not summarizable, so nothing reaches a build-time
    // fold through the back door.
    const analysis = classifyProject(
      {
        "src/app.tsx": `import { createSignal } from "solid-js";
          import { stamp } from "./helpers";
          export function Counter() {
            const [count, setCount] = createSignal(0);
            return (
              <div>
                <span>{stamp(count())}</span>
                <button onClick={() => setCount(count() + 1)}>+</button>
              </div>
            );
          }`,
        "src/helpers.ts": `export function stamp(n: number) { return n + Date.now(); }`,
      },
      "src/app.tsx",
      "Counter",
    );
    expect(analysis.status).toBe("fallback");
    expect(codesOf(analysis)).toContain("jsx-dynamic-child-not-derivable");
  });
});

// --------------------------------------- admission 3: event-object handler syntax

describe("S3 admission 3 — the event object, at event time", () => {
  it("admits member reads, derived values and a write back into the event", () => {
    const analysis = proved(
      widget(
        ADMITTED_BINDING,
        `if (e.key !== "Enter") return;
         const title = e.currentTarget.value.trim();
         if (!title) return;
         add({ title, at: Date.now(), done: false });
         e.currentTarget.value = "";`,
      ),
    );
    expect(analysis.handlers[0].source).toContain("e.currentTarget.value = \"\"");
    expect(analysis.handlers[0].captures).toEqual([
      { name: "add", kind: "action", store: "s0", path: [1, "add"] },
    ]);
  });

  it("refuses a member read on a captured binding that is not event-time", () => {
    // The rule is "rooted in the handler's own frame", not "any member read".
    // A prop, a module binding or a cell accessor reached into is exactly what
    // stays refused.
    const analysis = classifyProject(
      {
        "src/app.tsx": `import { createContext, useContext } from "solid-js";
          import { createStore } from "./store";
          const StoreContext = createContext<ReturnType<typeof createStore>>();
          function Widget(props: { item: { id: string } }) {
            const [, { add }] = useContext(StoreContext);
            return <div><input onKeyDown={e => { add(props.item.id); }} /></div>;
          }
          export function Shell() {
            return <StoreContext value={createStore()}><Widget item={{ id: "a" }} /></StoreContext>;
          }`,
        "src/store.ts": STORE,
      },
      "src/app.tsx",
      "Widget",
    );
    expect(analysis.status).toBe("fallback");
    expect(codesOf(analysis)).toContain("handler-unsupported-syntax");
  });

  it("refuses a computed member read on the event object", () => {
    const analysis = widget(ADMITTED_BINDING, 'add(e.currentTarget["value"]);');
    expect(analysis.status).toBe("fallback");
    expect(codesOf(analysis)).toContain("handler-unsupported-syntax");
  });

  it("refuses a compound assignment, and an assignment to a non-event target", () => {
    expect(codesOf(widget(ADMITTED_BINDING, 'e.currentTarget.value += "x";'))).toContain(
      "handler-unsupported-syntax",
    );
    expect(codesOf(widget(ADMITTED_BINDING, "add.name = e.key;"))).toContain(
      "handler-unsupported-syntax",
    );
  });

  it("refuses a computed key or a spread in an event-time record", () => {
    for (const body of ["add({ [e.key]: 1 });", "add({ ...e, extra: 1 });"]) {
      expect(codesOf(widget(ADMITTED_BINDING, body)), body).toContain("handler-unsupported-syntax");
    }
  });

  it("does not admit event-object syntax outside a handler", () => {
    // The same member read, in a text binding, where there is no event.
    const analysis = classifyProject(
      {
        "src/app.tsx": `import { createSignal } from "solid-js";
          export function Counter() {
            const [count, setCount] = createSignal(0);
            const box = { label: "x" };
            return (
              <div>
                <span>{box.label}</span>
                <button onClick={() => setCount(count() + 1)}>+</button>
              </div>
            );
          }`,
      },
      "src/app.tsx",
      "Counter",
    );
    expect(analysis.status).toBe("fallback");
    expect(codesOf(analysis)).toContain("jsx-dynamic-child-not-derivable");
  });
});

// ------------------------------------------------------------- Header, emitted

describe("S3 — the corpus's `Header` emits a valid artifact set", () => {
  const ROOT = resolve(process.cwd());
  const modules = loadProjectFrom([join(ROOT, "app/src/app.tsx")], ROOT).modules;
  const module = modules.get("app/src/app.tsx")!;
  const site = findComponent(module, "Header")!;
  const analysis = proved(classifySite(module, site));
  const result = emit(analysis, join(scratch(), "app.Header"));
  const read = (file: string): string => readFileSync(join(result.dir, file), "utf8");

  it("emits the four artifact kinds", () => {
    expect(result.files).toEqual([
      "handlers/s0.js",
      "manifest.json",
      "structure.js",
      "template.js",
      "wiring.js",
    ]);
  });

  it("emits the header markup at initial state", () => {
    expect(analysis.html).toBe(
      '<header class="header"><h1>todos</h1>' +
        '<input class="new-todo" placeholder="What needs to be done?" autofocus=""></header>',
    );
    expect(read("template.js")).toContain(analysis.html.replace(/"/g, '\\"'));
  });

  it("emits store identity and action wiring, and no store value", () => {
    const structure = read("structure.js");
    // No signal of its own: the store is the whole of Header's source.
    expect(analysis.cells).toEqual([]);
    expect(structure).toContain("export const stores = [");
    expect(structure).toContain('context: "TodosContext"');
    expect(structure).toContain('factory: "createTodos"');
    expect(structure).toContain("readSlot: null");
    expect(structure).toContain('path: [1,"addTodo"]');

    // Nothing about the store's *value* is emitted: no initial data, and none
    // of `todos.ts`'s action bodies.
    for (const forbidden of ["createOptimisticStore", "refresh(", "api.", "setTodos"]) {
      expect(structure, forbidden).not.toContain(forbidden);
    }
  });

  it("emits the handler over an action-slot manifest, with its own source", () => {
    const handler = read("handlers/s0.js");
    expect(handler).toContain('{ name: "addTodo", kind: "action", store: "s0", path: [1,"addTodo"] }');
    expect(handler).toContain("export function create({ addTodo })");
    // The author's own body, verbatim — including the two event-time calls and
    // the write back into the input.
    expect(handler).toContain("Date.now()");
    expect(handler).toContain("Math.random()");
    expect(handler).toContain('e.currentTarget.value = ""');
  });

  it("wires the listener to the input, by locator", () => {
    expect(analysis.wiring).toEqual([
      {
        locator: "/1",
        event: "keydown",
        module: "./handlers/s0.js",
        handler: "s0",
        captures: [{ name: "addTodo", kind: "action", store: "s0", path: [1, "addTodo"] }],
      },
    ]);
    expect(read("wiring.js")).toContain('locator: "/1"');
  });

  it("records the same facts in the manifest", () => {
    const manifest = JSON.parse(read("manifest.json"));
    expect(manifest.component).toBe("Header");
    expect(manifest.cells).toEqual([]);
    expect(manifest.stores).toHaveLength(1);
    expect(manifest.stores[0]).toMatchObject({
      context: "TodosContext",
      provider: "app/src/app.tsx",
      readSlot: null,
      value: { module: "app/src/todos.ts", factory: "createTodos" },
    });
    expect(manifest.actions).toEqual([
      { id: "s0a0", store: "s0", name: "addTodo", path: [1, "addTodo"] },
    ]);
  });
});

describe("S3 — artifacts without a store are unchanged", () => {
  it("writes no store keys for a plain signal component", () => {
    const analysis = proved(
      classifyProject(
        {
          "src/app.tsx": `import { createSignal } from "solid-js";
            export function Counter() {
              const [count, setCount] = createSignal(0);
              return (
                <div>
                  <span>{"count: " + count()}</span>
                  <button onClick={() => setCount(count() + 1)}>+</button>
                </div>
              );
            }`,
        },
        "src/app.tsx",
        "Counter",
      ),
    );
    const result = emit(analysis, join(scratch(), "Counter"));
    const structure = readFileSync(join(result.dir, "structure.js"), "utf8");
    const manifest = JSON.parse(readFileSync(join(result.dir, "manifest.json"), "utf8"));

    expect(structure).not.toContain("stores");
    expect(Object.keys(manifest)).not.toContain("stores");
    expect(Object.keys(manifest)).not.toContain("actions");
    // The cell slot shape is byte-identical to what it always was.
    expect(structure).toContain('{ name: "count", cell: "c0", access: "read" },');
  });
});

// -------------------------------------------------------- the store read slice

/**
 * S3, narrowed: a component may bind the store's DATA slot, and read through it.
 *
 * The admission is exactly one fact wider than the action one, and it is the
 * same KIND of fact — `data` is slot 0 of the value this provider supplies for
 * this context, fixed at build time. Everything above the slot is the author's
 * own expression, printed and carried, never evaluated: a store's value is an
 * async projection under an optimistic overlay, so there is no honest build-time
 * initial and the pass does not invent one. The text a store read produces is
 * MEASURED out of the page's captured first paint instead, which is what
 * `initialTextFrom: "capture"` says.
 *
 * The guard that keeps this from being wider than it was ruled is negative and
 * total: the pass admits the references it ITSELF derived a text from, and every
 * other use of the binding — a write, a method call, a hand-off, a capture into
 * a handler — is `store-read-escapes`.
 */

/** The consumer, with a store read in the markup and a store action on the input. */
function readApp(
  binding: string,
  expression: string,
  handler = "add(e.currentTarget.value);",
  attributes = "",
): string {
  return `import { createContext, useContext } from "solid-js";
    import { createStore } from "./store";

    const StoreContext = createContext<ReturnType<typeof createStore>>();

    function Widget() {
      ${binding}
      return (
        <div>
          <span>{${expression}}</span>
          <input ${attributes} onKeyDown={e => { ${handler} }} />
        </div>
      );
    }

    export function Shell() {
      return (
        <StoreContext value={createStore()}>
          <Widget />
        </StoreContext>
      );
    }`;
}

function reader(binding: string, expression: string, handler?: string, attributes?: string): Analysis {
  return classifyProject(
    { "src/app.tsx": readApp(binding, expression, handler, attributes), "src/store.ts": STORE },
    "src/app.tsx",
    "Widget",
  );
}

const READ_BINDING = "const [data, { add }] = useContext(StoreContext);";

describe("S3 admission 4 — a store read is provable by identity", () => {
  const analysis = proved(reader(READ_BINDING, "data.items.length"));

  it("records the read slot as an identity, and the store's arms beside it", () => {
    expect(analysis.stores[0]).toMatchObject({ id: "s0", actionsSlot: 1, readSlot: 0 });
    expect(analysis.reads).toEqual([
      expect.objectContaining({ id: "s0r", store: "s0", name: "data", path: [0] }),
    ]);
    // The path stops at the slot. `items` and `length` are the component's own
    // expression, and the artifact never claims to know what they reach.
    expect(analysis.reads[0].path).toEqual([0]);
  });

  it("carries the read into the binding's capture manifest, by identity", () => {
    const binding = textBinding(analysis.bindings[0]);
    expect(binding.captures).toEqual([{ name: "data", kind: "store-read", store: "s0", path: [0] }]);
    expect(binding.expression).toBe("data.items.length");
  });

  it("measures the initial text instead of folding it", () => {
    const binding = textBinding(analysis.bindings[0]);
    expect(binding.initialTextFrom).toBe("capture");
    expect(binding.initialText).toBe("");
    // And the emitted markup carries no invented value: the span is empty until
    // a build measures its own capture.
    expect(analysis.html).toContain("<span></span>");
  });

  it("still folds a derivation that never touches the store", () => {
    const cell = proved(
      classifyProject(
        {
          "src/app.tsx": `import { createSignal } from "solid-js";
            export function Counter() {
              const [count, setCount] = createSignal(2);
              return (
                <div>
                  <span>{"count: " + count()}</span>
                  <button onClick={() => setCount(count() + 1)}>+</button>
                </div>
              );
            }`,
        },
        "src/app.tsx",
        "Counter",
      ),
    );
    expect(cell.bindings[0]).toMatchObject({ initialText: "count: 2", initialTextFrom: "derivation" });
  });

  it("reaches an ATTRIBUTE through the same read slot, measured the same way", () => {
    // The read model is about the SLOT, not about what the slot's value ends up
    // painting. An attribute binding over it carries the identical capture
    // manifest and the identical answer about its first paint: nobody knows,
    // measure it.
    const withAttribute = proved(reader(READ_BINDING, '"static"', undefined, "checked={data.items.length > 0}"));
    const attribute = withAttribute.bindings.find((binding) => binding.kind === "attribute");
    if (attribute?.kind !== "attribute") throw new Error("expected an attribute binding");

    expect(attribute).toMatchObject({ attribute: "checked", property: true, initialValueFrom: "capture" });
    expect(attribute.expression).toBe("data.items.length > 0");
    expect(attribute.captures).toEqual([{ name: "data", kind: "store-read", store: "s0", path: [0] }]);
    // A measured attribute is a HOLE, exactly as a measured text is: the markup
    // states nothing, and a capture owes the answer.
    expect(withAttribute.html).toContain("<input>");
  });

  it("makes a derivation measured as soon as any part of it is", () => {
    // One unmeasurable part is enough: the pass does not fold around a store
    // read and present the result as a build-time answer.
    const mixed = proved(reader(READ_BINDING, '"left: " + data.items.length'));
    expect(mixed.bindings[0]).toMatchObject({ initialText: "", initialTextFrom: "capture" });
    expect(textBinding(mixed.bindings[0]).expression).toBe('"left: " + data.items.length');
  });

  // --- refusal guards, each the admitted shape with exactly one thing changed

  it("refuses a read bound through an alias rather than the destructuring", () => {
    const analysis = reader(
      "const ctx = useContext(StoreContext); const data = ctx[0]; const { add } = ctx[1];",
      "data.items.length",
    );
    expect(analysis.status).toBe("fallback");
    expect(storeReasons(analysis)).toEqual(["result-not-destructured"]);
  });

  it("refuses a read slot bound by a pattern rather than a plain name", () => {
    for (const binding of [
      "const [{ items }, { add }] = useContext(StoreContext);",
      "const [data = null, { add }] = useContext(StoreContext);",
    ]) {
      const analysis = reader(binding, '"static"');
      expect(analysis.status, binding).toBe("fallback");
      expect(codesOf(analysis), binding).toContain("store-read-not-provable");
      expect(
        analysis.reasons
          .filter((reason) => reason.code === "store-read-not-provable")
          .map((reason) => String(reason.detail?.reason)),
        binding,
      ).toEqual(["store-read-path-not-fixed"]);
    }
  });

  it("refuses a computed step in the read path", () => {
    // `data[key]` reaches a slot chosen at runtime, so the artifact would be
    // naming a path this pass never saw.
    const analysis = reader(READ_BINDING, "data.items[data.cursor]");
    expect(analysis.status).toBe("fallback");
    expect(codesOf(analysis)).toContain("store-read-escapes");
    expect(codesOf(analysis)).toContain("jsx-dynamic-child-not-derivable");
  });

  it("refuses a write through the read binding", () => {
    const analysis = reader(READ_BINDING, "data.items.length", "data.cursor = 1; add(e.key);");
    expect(analysis.status).toBe("fallback");
    expect(codesOf(analysis)).toContain("store-read-escapes");
  });

  it("refuses a read handed anywhere the pass did not derive it", () => {
    for (const expression of ["data.items.filter(x => x).length", "JSON.stringify(data)"]) {
      const analysis = reader(READ_BINDING, expression);
      expect(analysis.status, expression).toBe("fallback");
      expect(codesOf(analysis), expression).toContain("store-read-escapes");
    }
  });

  it("admits a handler reaching THROUGH the read binding for a property", () => {
    // The W3 narrowing, and the one shape that moved. `data.items.length` inside
    // a handler is the same admission the derivation walk already makes — the
    // base is the identity this pass proved, the chain above it is the author's
    // own source — asked once the event has fired, where there is no build-time
    // value to get wrong. The slot travels; the store's data does not.
    const analysis = reader(READ_BINDING, "data.items.length", "add(data.items.length);");
    expect(analysis.status).toBe("provable");

    const handler = proved(analysis).handlers[0];
    expect(handler.captures).toEqual([
      { name: "add", kind: "action", store: "s0", path: [1, "add"] },
      { name: "data", kind: "store-read", store: "s0", path: [0] },
    ]);
  });

  it("still refuses the binding taken whole into a handler", () => {
    // Reaching through is not the same as taking it: `add(data)` hands the
    // store's own data to code this pass never read, which is the escape the
    // whole admission is defined against.
    const analysis = reader(READ_BINDING, "data.items.length", "add(data);");
    expect(analysis.status).toBe("fallback");
    expect(codesOf(analysis)).toContain("store-read-escapes");
  });
});

describe("S3 admission 4 — the read survives emission and resolves by identity", () => {
  const analysis = proved(reader(READ_BINDING, "data.items.length"));
  const result = emit(analysis, join(scratch(), "Widget"));
  const read = (file: string): string => readFileSync(join(result.dir, file), "utf8");

  it("emits the read table and the measured binding, and no store value", () => {
    const structure = read("structure.js");
    expect(structure).toContain("export const reads = [");
    expect(structure).toContain('{ id: "s0r", store: "s0", name: "data", path: [0] },');
    expect(structure).toContain("readSlot: 0");
    expect(structure).toContain('{ name: "data", kind: "store-read", store: "s0", path: [0] },');
    expect(structure).toContain('initialTextFrom: "capture"');
    // The store's own contents never travelled: the factory's data literal is
    // not in the artifact, and neither is any action body.
    for (const forbidden of ["push", "items: []"]) {
      expect(structure, forbidden).not.toContain(forbidden);
    }
  });

  it("resolves the slot through the store registry, unwrapped", async () => {
    const structure = (await import(pathToFileURL(join(result.dir, "structure.js")).href)) as Record<
      string,
      unknown
    >;
    const wiring = (await import(pathToFileURL(join(result.dir, "wiring.js")).href)) as Record<
      string,
      unknown
    >;
    const template = (await import(pathToFileURL(join(result.dir, "template.js")).href)) as Record<
      string,
      unknown
    >;

    const registry = createRegistry(
      {
        "/artifacts/Widget/structure.js": structure,
        "/artifacts/Widget/wiring.js": wiring,
        "/artifacts/Widget/template.js": template,
      },
      {},
    );
    const bundle = registry.get("Widget")!;
    expect(bundle.reads).toEqual([{ id: "s0r", store: "s0", name: "data", path: [0] }]);

    // The live store, created here exactly as a page would create it at its
    // mount point. Nothing was serialized to get here.
    const live = [{ items: ["a", "b"], cursor: 0 }, { add() {} }];
    const stores = createStoreRegistry();
    stores.provide("s0", live);

    // Identity, not value: the slot IS the store's own object. A wrapper would
    // mean the resume path had an opinion about data it never read.
    const slot = stores.read("s0", [0]);
    expect(Object.is(slot, live[0])).toBe(true);

    // And the component's own expression, run over that slot, is the text the
    // page would show — computed on the page, never at build time.
    const binding = bundle.bindings[0];
    if (binding.kind !== "text") throw new Error("expected a text binding");
    expect(binding.initialText).toBe("");
    expect(binding.initialTextFrom).toBe("capture");
    expect(binding.compute({ data: slot })).toBe(2);
  });
});
