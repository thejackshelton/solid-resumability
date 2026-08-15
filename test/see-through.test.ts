import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

import { Analyzer, type Module } from "yuku-analyzer";

import { artifactKey, classify, emit } from "../src/comptime/index.ts";
import type { Analysis, ProvableAnalysis, ReasonCode } from "../src/comptime/types.ts";
import { textBinding } from "./bindings.ts";

/**
 * Module-local component admission, and interprocedural see-through for
 * provably-pure helpers.
 *
 * Two levers, one failure mode. Admission is easy to check — a component
 * either proves or it does not. See-through is not: the way it goes wrong is
 * by *quietly admitting* a helper it cannot actually prove, which widens the
 * trusted subset without anything turning red. So the refusal cases below
 * outnumber the admission cases on purpose, and there is at least one for
 * every guard `summaries.ts` claims to enforce. Each of them is the admitted
 * shape with exactly one thing changed, so a passing refusal test is evidence
 * about that guard and not about some unrelated blocker.
 *
 * Everything is analyzed from in-memory sources: no fixture on disk, no path
 * or file name carries meaning, and the helper genuinely lives in another
 * module so `Symbol.definition()` has a real import chain to follow.
 */

const scratchDirs: string[] = [];

/**
 * A scratch artifact directory *inside* the repo root, not in `os.tmpdir()`: two
 * tests below `import()` what they just emitted, and the dev server only
 * serves files under the project root. Every one of them is removed again in
 * `afterAll`.
 */
function scratch(): string {
  const dir = mkdtempSync(join(process.cwd(), ".artifacts-see-through-"));
  scratchDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
});

/** Analyzes a small multi-module project and classifies the entry's component. */
function classifyProject(files: Record<string, string>, entry: string, component?: string): Analysis {
  const analyzer = new Analyzer();
  let entryModule: Module | undefined;
  for (const [path, source] of Object.entries(files)) {
    const module = analyzer.addFile(path, source);
    if (path === entry) entryModule = module;
  }
  analyzer.link();
  if (entryModule === undefined) throw new Error(`no entry module ${entry}`);
  return classify(entryModule, component);
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

// --------------------------------------------------------------- lever 1

describe("export is packaging, not provability", () => {
  const source = `import { createSignal } from "solid-js";
    function Hidden() {
      const [count, setCount] = createSignal(0);
      return (
        <div>
          <span>{"count: " + count()}</span>
          <button onClick={() => setCount(count() + 1)}>+</button>
        </div>
      );
    }
    export function useHidden() { return Hidden; }`;

  it("proves a component that is never on the module's export surface", () => {
    const analysis = classifyProject({ "src/Local.tsx": source }, "src/Local.tsx");
    const provable = proved(analysis);

    expect(provable.component).toBe("Hidden");
    expect(provable.cells).toHaveLength(1);
    expect(provable.handlers).toHaveLength(1);
  });

  it("proves an exported and a module-local component out of the same module", () => {
    const analysis = classifyProject(
      {
        "src/Pair.tsx": `import { createSignal } from "solid-js";
          export function Shown() {
            const [a, setA] = createSignal(1);
            return <div><span>{a()}</span><button onClick={() => setA(a() + 1)}>+</button></div>;
          }
          function Hidden() {
            const [b, setB] = createSignal(2);
            return <div><span>{b()}</span><button onClick={() => setB(b() + 1)}>+</button></div>;
          }
          export const holder = () => Hidden;`,
      },
      "src/Pair.tsx",
      "Hidden",
    );

    expect(proved(analysis).component).toBe("Hidden");
  });

  it("keys artifacts by module path and local name, not by export name", () => {
    // A module whose stem already spells the component adds nothing to the
    // key — a special case of the rule, not an exception to it.
    expect(artifactKey("src/fixtures/CounterA.tsx", "CounterA")).toBe("CounterA");
    // Five components in one module no longer collide on one directory.
    expect(artifactKey("app/src/app.tsx", "Header")).toBe("app.Header");
    expect(artifactKey("app/src/app.tsx", "Footer")).toBe("app.Footer");
    expect(artifactKey("app/src/app.tsx", "Header")).not.toBe(artifactKey("app/src/app.tsx", "Footer"));
  });

  it("refuses to overwrite one component's artifacts with another's", () => {
    const dir = join(scratch(), "shared-key");

    const first = proved(classifyProject({ "src/Local.tsx": source }, "src/Local.tsx"));
    emit(first, dir);
    // Re-emitting the same pair is the ordinary case and must stay allowed.
    expect(() => emit(first, dir)).not.toThrow();

    const other = proved(classifyProject({ "src/Other.tsx": source }, "src/Other.tsx"));
    expect(() => emit(other, dir)).toThrow(/artifact key collision/);

    // The first component's artifacts are still intact.
    const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
    expect(manifest.module).toBe("src/Local.tsx");
  });

  it("still reports `no-exported-component` when there is no component to find", () => {
    const analysis = classifyProject({ "src/data.ts": `export const rows = [];` }, "src/data.ts");
    expect(codesOf(analysis)).toEqual(["no-exported-component"]);
  });
});

// --------------------------------------------------------------- lever 2

/** The helper module every see-through case varies one line of. */
function helpers(body: string): string {
  return `export type Read = () => number;
    export type Write = (value: number) => void;
    ${body}`;
}

/** A component that hands both accessors to `check`, and is otherwise provable. */
function escapingComponent(): string {
  return `import { createSignal } from "solid-js";
    import { check } from "./helpers";
    export function Counter() {
      const [count, setCount] = createSignal(0);
      check(count, setCount);
      return (
        <div>
          <span>{"count: " + count()}</span>
          <button onClick={() => setCount(count() + 1)}>+</button>
        </div>
      );
    }`;
}

function classifyEscape(helperBody: string): Analysis {
  return classifyProject(
    { "src/Counter.tsx": escapingComponent(), "src/helpers.ts": helpers(helperBody) },
    "src/Counter.tsx",
  );
}

describe("signal-escapes-to-opaque-callee, seen through", () => {
  it("admits an accessor handed to a helper that only calls it correctly", () => {
    const analysis = classifyEscape(
      `export function check(read: Read, write: Write) { return write(read() + 1); }`,
    );

    const provable = proved(analysis);
    // The escape is admitted; nothing about the helper reaches the artifacts,
    // because the helper does not participate in the component's own state.
    expect(provable.cells).toHaveLength(1);
    expect(provable.handlers).toHaveLength(1);
  });

  it("refuses a helper that captures anything beyond its parameters", () => {
    const analysis = classifyEscape(
      `const bias = 1;
       export function check(read: Read, write: Write) { return write(read() + bias); }`,
    );
    expect(codesOf(analysis)).toContain("signal-escapes-to-opaque-callee");
  });

  it("refuses a helper that writes to outer state", () => {
    const analysis = classifyEscape(
      `let seen = 0;
       export function check(read: Read, write: Write) { return (seen = read()) + write(0); }`,
    );
    expect(codesOf(analysis)).toContain("signal-escapes-to-opaque-callee");
  });

  it("refuses a helper that reaches for a global", () => {
    const analysis = classifyEscape(
      `export function check(read: Read, write: Write) { return write(read() + Date.now()); }`,
    );
    expect(codesOf(analysis)).toContain("signal-escapes-to-opaque-callee");
  });

  it("refuses a recursive helper", () => {
    const analysis = classifyEscape(
      `export function check(read: Read, write: Write) { return read() > 0 ? check(read, write) : write(0); }`,
    );
    expect(codesOf(analysis)).toContain("signal-escapes-to-opaque-callee");
  });

  it("refuses a helper that makes a second cross-module hop", () => {
    const analysis = classifyProject(
      {
        "src/Counter.tsx": escapingComponent(),
        "src/helpers.ts": helpers(
          `import { twice } from "./deeper";
           export function check(read: Read, write: Write) { return write(twice(read())); }`,
        ),
        "src/deeper.ts": `export function twice(value: number) { return value * 2; }`,
      },
      "src/Counter.tsx",
    );
    expect(codesOf(analysis)).toContain("signal-escapes-to-opaque-callee");
  });

  it("refuses a helper that uses the accessor as a value rather than calling it", () => {
    const analysis = classifyEscape(
      `export function check(read: Read, write: Write) { return write(read === write ? 1 : 0); }`,
    );
    expect(codesOf(analysis)).toContain("signal-escapes-to-opaque-callee");
  });

  it("refuses a helper that calls the setter with the wrong arity", () => {
    const analysis = classifyEscape(
      `export function check(read: Read, write: Write) { return read() + write(); }`,
    );
    expect(codesOf(analysis)).toContain("signal-escapes-to-opaque-callee");
  });

  it("refuses a helper whose body is more than one returned expression", () => {
    const analysis = classifyEscape(
      `export function check(read: Read, write: Write) {
         const next = read() + 1;
         return write(next);
       }`,
    );
    expect(codesOf(analysis)).toContain("signal-escapes-to-opaque-callee");
  });

  it("refuses an accessor that reaches the helper indirectly", () => {
    // `describeSink` climbs out through member access and array literals to
    // name the sink; see-through deliberately does not follow it there.
    const analysis = classifyProject(
      {
        "src/Counter.tsx": `import { createSignal } from "solid-js";
          import { check } from "./helpers";
          export function Counter() {
            const [count, setCount] = createSignal(0);
            check([count][0], setCount);
            return <div><span>{"count: " + count()}</span></div>;
          }`,
        "src/helpers.ts": helpers(
          `export function check(read: Read, write: Write) { return write(read() + 1); }`,
        ),
      },
      "src/Counter.tsx",
    );
    // Still refused, and still named as an escape into the helper — the point
    // is that the summary was never consulted for a non-direct argument.
    expect(analysis.status).toBe("fallback");
    expect(codesOf(analysis)).toContain("signal-escapes-to-opaque-callee");
  });

  it("refuses when the call's arity does not match the helper's parameters", () => {
    const analysis = classifyProject(
      {
        "src/Counter.tsx": `import { createSignal } from "solid-js";
          import { check } from "./helpers";
          export function Counter() {
            const [count, setCount] = createSignal(0);
            check(count);
            return <div><span>{"count: " + count()}</span></div>;
          }`,
        "src/helpers.ts": helpers(
          `export function check(read: Read, write: Write) { return write(read() + 1); }`,
        ),
      },
      "src/Counter.tsx",
    );
    expect(codesOf(analysis)).toContain("signal-escapes-to-opaque-callee");
  });
});

describe("handler-not-inline, seen through a factory", () => {
  function factoryComponent(binding: string): string {
    return `import { createSignal } from "solid-js";
      import { makeIncrement } from "./helpers";
      export function Counter() {
        const [count, setCount] = createSignal(0);
        ${binding}
        return (
          <div>
            <span>{"count: " + count()}</span>
            <button onClick={increment}>+</button>
          </div>
        );
      }`;
  }

  const FACTORY = `export function makeIncrement(read: Read, write: Write) {
    return () => write(read() + 1);
  }`;

  function classifyFactory(binding: string, factory = FACTORY): Analysis {
    return classifyProject(
      { "src/Counter.tsx": factoryComponent(binding), "src/helpers.ts": helpers(factory) },
      "src/Counter.tsx",
    );
  }

  it("extracts the returned closure with the factory's parameters as capture slots", () => {
    const provable = proved(classifyFactory(`const increment = makeIncrement(count, setCount);`));

    expect(provable.handlers).toHaveLength(1);
    const [handler] = provable.handlers;
    expect(handler.event).toBe("click");
    expect(handler.locator).toBe("/1");
    expect(handler.origin).toBe("helper");
    // The slot *names* are the helper's parameters, because those are the free
    // names in the source being extracted; the cells are the caller's.
    expect(handler.source).toBe("() => write(read() + 1)");
    expect(handler.captures).toEqual([
      { name: "read", cell: "c0", access: "read" },
      { name: "write", cell: "c0", access: "write" },
    ]);
    expect(provable.wiring[0].captures).toEqual(handler.captures);
  });

  it("emits a handler module that actually drives the cell", async () => {
    const provable = proved(classifyFactory(`const increment = makeIncrement(count, setCount);`));
    const result = emit(provable, join(scratch(), "factory"));

    const module = await import(pathToFileURL(join(result.dir, "handlers/s0.js")).href);
    let value = 0;
    module.create({ read: () => value, write: (next: number) => void (value = next) })();
    expect(value).toBe(1);
  });

  it("refuses a factory whose closure captures more than the passed-in accessors", () => {
    const analysis = classifyFactory(
      `const increment = makeIncrement(count, setCount);`,
      `const step = 2;
       export function makeIncrement(read: Read, write: Write) { return () => write(read() + step); }`,
    );
    expect(codesOf(analysis)).toContain("handler-not-inline");
  });

  it("refuses a factory whose closure leaves the handler syntax whitelist", () => {
    const analysis = classifyFactory(
      `const increment = makeIncrement(count, setCount);`,
      `export function makeIncrement(read: Read, write: Write) {
         return () => { for (;;) { write(read()); } };
       }`,
    );
    expect(codesOf(analysis)).toContain("handler-not-inline");
  });

  it("refuses a factory that returns something other than a closure", () => {
    const analysis = classifyFactory(
      `const increment = makeIncrement(count, setCount);`,
      `export function makeIncrement(read: Read, write: Write) { return write(read()); }`,
    );
    expect(codesOf(analysis)).toContain("handler-not-inline");
  });

  it("refuses a handler bound to anything but a plain identifier declarator", () => {
    const analysis = classifyFactory(
      `const [increment] = [makeIncrement(count, setCount)];`,
    );
    expect(codesOf(analysis)).toContain("handler-not-inline");
  });

  it("refuses a handler whose binding is built from something other than accessors", () => {
    const analysis = classifyFactory(`const increment = makeIncrement(count, count);`);
    expect(codesOf(analysis)).toContain("handler-not-inline");
  });

  it("refuses a handler assembled outside the component", () => {
    const analysis = classifyProject(
      {
        "src/Counter.tsx": `import { createSignal } from "solid-js";
          import { makeIncrement } from "./helpers";
          const [shared, setShared] = createSignal(0);
          const increment = makeIncrement(shared, setShared);
          export function Counter() {
            const [count] = createSignal(0);
            return <div><span>{"count: " + count()}</span><button onClick={increment}>+</button></div>;
          }`,
        "src/helpers.ts": helpers(FACTORY),
      },
      "src/Counter.tsx",
    );
    expect(codesOf(analysis)).toContain("handler-not-inline");
  });
});

describe("derived text, folded through a pure formatter", () => {
  function formattingComponent(child: string): string {
    return `import { createSignal } from "solid-js";
      import { formatCount } from "./helpers";
      export function Counter() {
        const [count, setCount] = createSignal(3);
        return (
          <div>
            <span>{${child}}</span>
            <button onClick={() => setCount(count() + 1)}>+</button>
          </div>
        );
      }`;
  }

  const FORMATTER = "export function formatCount(read: Read) { return `count: ${read()}`; }";

  function classifyFormat(child: string, formatter = FORMATTER): Analysis {
    return classifyProject(
      { "src/Counter.tsx": formattingComponent(child), "src/helpers.ts": helpers(formatter) },
      "src/Counter.tsx",
    );
  }

  it("inlines the formatter's body and names the component's own cell in the slots", () => {
    const provable = proved(classifyFormat("formatCount(count)"));

    expect(provable.bindings).toHaveLength(1);
    const binding = textBinding(provable.bindings[0]);
    expect(binding.origin).toBe("helper");
    // The emitted derivation is written in terms of the capture slots, so
    // `formatCount` itself is not referenced by anything that ships.
    expect(binding.expression).toBe("`count: ${count()}`");
    expect(binding.expression).not.toContain("formatCount");
    expect(binding.captures).toEqual([{ name: "count", cell: "c0", access: "read" }]);
    expect(binding.initialText).toBe("count: 3");
    expect(provable.html).toBe("<div><span>count: 3</span><button>+</button></div>");
  });

  it("emits a `compute` that re-derives the text from a supplied cell value", async () => {
    const provable = proved(classifyFormat("formatCount(count)"));
    const result = emit(provable, join(scratch(), "formatter"));

    const structure = await import(pathToFileURL(join(result.dir, "structure.js")).href);
    expect(structure.bindings[0].compute({ count: () => 9 })).toBe("count: 9");
  });

  it("folds a formatter taking a plain value alongside an accessor", () => {
    const provable = proved(
      classifyFormat(
        "formatCount(count, 2)",
        "export function formatCount(read: Read, width: number) { return `count: ${read() + width}`; }",
      ),
    );

    expect(textBinding(provable.bindings[0]).expression).toBe("`count: ${(count() + 2)}`");
    expect(textBinding(provable.bindings[0]).initialText).toBe("count: 5");
    expect(provable.bindings[0].captures).toEqual([{ name: "count", cell: "c0", access: "read" }]);
  });

  it("leaves an unseen-through derivation printed verbatim", () => {
    // The byte-for-byte guarantee the artifacts rely on: a derivation that
    // folded without any substitution keeps the author's own text.
    const provable = proved(classifyFormat(`"count: " + count()`));
    expect(textBinding(provable.bindings[0]).expression).toBe('"count: " + count()');
    expect(provable.bindings[0].origin).toBe("component");
  });

  it("refuses a formatter that captures module state", () => {
    const analysis = classifyFormat(
      "formatCount(count)",
      "const unit = \"x\";\n export function formatCount(read: Read) { return `${unit}: ${read()}`; }",
    );
    expect(codesOf(analysis)).toContain("jsx-dynamic-child-not-derivable");
  });

  it("refuses a formatter that reaches for a global", () => {
    const analysis = classifyFormat(
      "formatCount(count)",
      "export function formatCount(read: Read) { return `count: ${String(read())}`; }",
    );
    expect(codesOf(analysis)).toContain("jsx-dynamic-child-not-derivable");
  });

  it("refuses a formatter that makes a second cross-module hop", () => {
    const analysis = classifyProject(
      {
        "src/Counter.tsx": formattingComponent("formatCount(count)"),
        "src/helpers.ts": helpers(
          "import { label } from \"./deeper\";\n" +
            "export function formatCount(read: Read) { return `${label(read())}`; }",
        ),
        "src/deeper.ts": `export function label(value: number) { return "n" + value; }`,
      },
      "src/Counter.tsx",
    );
    expect(codesOf(analysis)).toContain("jsx-dynamic-child-not-derivable");
  });

  it("refuses a formatter that uses the accessor as a value", () => {
    const analysis = classifyFormat(
      "formatCount(count)",
      "export function formatCount(read: Read) { return `count: ${read}`; }",
    );
    expect(codesOf(analysis)).toContain("jsx-dynamic-child-not-derivable");
  });

  it("refuses a formatter whose argument is itself underivable", () => {
    const analysis = classifyProject(
      {
        "src/Counter.tsx": `import { createSignal } from "solid-js";
          import { formatCount } from "./helpers";
          export function Counter() {
            const [count] = createSignal(3);
            const pair = [count] as const;
            return <div><span>{formatCount(pair[0])}</span></div>;
          }`,
        "src/helpers.ts": helpers(FORMATTER),
      },
      "src/Counter.tsx",
    );
    expect(codesOf(analysis)).toContain("jsx-dynamic-child-not-derivable");
  });
});

describe("conservatism the levers do not touch", () => {
  it("still refuses a handler that calls a pure helper inline", () => {
    // Only three refusals were ruled in. A handler body calling anything but a
    // cell accessor is a separate question, and it is still answered no — the
    // summary machinery does not leak into the handler audit.
    const analysis = classifyProject(
      {
        "src/Counter.tsx": `import { createSignal } from "solid-js";
          import { check } from "./helpers";
          export function Counter() {
            const [count, setCount] = createSignal(0);
            return <div><button onClick={() => check(count, setCount)}>+</button></div>;
          }`,
        "src/helpers.ts": helpers(
          `export function check(read: Read, write: Write) { return write(read() + 1); }`,
        ),
      },
      "src/Counter.tsx",
    );
    expect(codesOf(analysis)).toContain("handler-calls-non-accessor");
  });

  it("still treats the framework itself as an opaque boundary", () => {
    // `solid-js` is outside the analyzed file set, so no summary can ever be
    // built for anything it exports, whatever the helper looks like.
    const analysis = classifyProject(
      {
        "src/Counter.tsx": `import { createSignal, untrack } from "solid-js";
          export function Counter() {
            const [count, setCount] = createSignal(0);
            untrack(count);
            return <div><span>{"count: " + count()}</span><button onClick={() => setCount(count() + 1)}>+</button></div>;
          }`,
      },
      "src/Counter.tsx",
    );
    expect(codesOf(analysis)).toContain("signal-escapes-to-opaque-callee");
  });
});
