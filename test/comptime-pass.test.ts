import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { Analyzer } from "yuku-analyzer";

import { analyzeFixture, classify, emit, runComptime } from "../src/comptime/index.ts";
import type { EmitResult, ProvableAnalysis } from "../src/comptime/types.ts";
import { textBinding } from "./bindings.ts";

/**
 * The comptime pass: does an analysis of *unmodified* Solid source produce a
 * sound provable/fallback verdict, and — for the provable fixture — a complete
 * static artifact set?
 *
 * Vitest runs with cwd at the repo root, so fixture paths are root-relative.
 */

const FIXTURE_A = "src/fixtures/CounterA.tsx";
const FIXTURE_B = "src/fixtures/CounterB.tsx";
const ARTIFACTS = resolve(process.cwd(), "artifacts/CounterA");

const scratchDirs: string[] = [];

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "solid-resumability-"));
  scratchDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
});

/** Reads every emitted file so two runs can be compared byte for byte. */
function snapshot(result: EmitResult): Record<string, string> {
  const out: Record<string, string> = {};
  for (const file of result.files) out[file] = readFileSync(join(result.dir, file), "utf8");
  return out;
}

/**
 * The pass runs once, into a scratch directory, and every assertion below
 * reads from that one run. Nothing in the suite writes the committed
 * `artifacts/CounterA/`: test files run in parallel workers, and those files
 * are imported by tests here and in `parity.test.tsx`. Instead the committed
 * copy is compared against this fresh run, so drift is caught rather than
 * papered over. Regenerate with `pnpm comptime`.
 */
const { analysis, emitted } = runComptime(FIXTURE_A, { outRoot: scratch() });

describe("comptime pass — Fixture A is provable", () => {
  it("classifies the component as provable with no refusals", () => {
    expect(analysis.status).toBe("provable");
    expect(analysis.reasons).toEqual([]);
    expect(analysis.component).toBe("CounterA");
  });

  it("finds exactly one source cell, initialized to the literal 0", () => {
    if (analysis.status !== "provable") throw new Error("expected a provable analysis");

    expect(analysis.cells).toHaveLength(1);
    expect(analysis.cells[0]).toMatchObject({ id: "c0", initial: 0, getter: "count", setter: "setCount" });
  });

  it("finds one text binding and records how the text derives from the cell", () => {
    if (analysis.status !== "provable") throw new Error("expected a provable analysis");

    expect(analysis.bindings).toHaveLength(1);
    const binding = textBinding(analysis.bindings[0]);
    expect(binding.kind).toBe("text");
    // The label is the root's first element child.
    expect(binding.locator).toBe("/0");
    expect(binding.captures).toEqual([{ name: "count", cell: "c0", access: "read" }]);
    // The derivation is kept as the author wrote it, not re-invented.
    expect(binding.expression).toBe('"count: " + count()');
    expect(binding.initialText).toBe("count: 0");
  });

  it("extracts two handlers, both writing the same cell", () => {
    if (analysis.status !== "provable") throw new Error("expected a provable analysis");

    expect(analysis.handlers).toHaveLength(2);
    for (const handler of analysis.handlers) {
      expect(handler.event).toBe("click");
      // Both close over the same getter/setter pair, so both slots point at c0.
      expect(handler.captures).toEqual([
        { name: "count", cell: "c0", access: "read" },
        { name: "setCount", cell: "c0", access: "write" },
      ]);
      expect(
        handler.captures.filter((slot) => "access" in slot && slot.access === "write"),
      ).toHaveLength(1);
    }
    expect(analysis.handlers.map((handler) => handler.locator)).toEqual(["/1", "/2"]);
    expect(analysis.handlers.map((handler) => handler.source)).toEqual([
      "() => setCount(count() + 1)",
      "() => setCount(count() - 1)",
    ]);
  });

  it("wires two click records to lazily-importable handler modules", () => {
    if (analysis.status !== "provable") throw new Error("expected a provable analysis");

    expect(analysis.wiring).toEqual([
      {
        locator: "/1",
        event: "click",
        module: "./handlers/s0.js",
        handler: "s0",
        captures: [
          { name: "count", cell: "c0", access: "read" },
          { name: "setCount", cell: "c0", access: "write" },
        ],
      },
      {
        locator: "/2",
        event: "click",
        module: "./handlers/s1.js",
        handler: "s1",
        captures: [
          { name: "count", cell: "c0", access: "read" },
          { name: "setCount", cell: "c0", access: "write" },
        ],
      },
    ]);
  });

  it("emits all four artifact kinds", () => {
    expect(emitted).not.toBeNull();
    expect(emitted!.files).toEqual([
      "handlers/s0.js", // one lazily-importable module per handler
      "handlers/s1.js",
      "manifest.json",
      "structure.js", // cells + cell -> DOM bindings
      "template.js", // static HTML
      "wiring.js", // locator + event -> handler module
    ]);
  });

  it("matches the artifacts committed under artifacts/CounterA", () => {
    const committed: Record<string, string> = {};
    for (const file of emitted!.files) {
      committed[file] = readFileSync(join(ARTIFACTS, file), "utf8");
    }

    expect(committed, "committed artifacts are stale — run `pnpm comptime`").toEqual(snapshot(emitted!));
  });
});

describe("comptime pass — the emitted artifacts are usable on their own", () => {
  it("re-derives the bound text from a cell value", async () => {
    // @ts-expect-error Generated plain-JS artifact; its shape is the emitter's contract, asserted below.
    const structure = await import("../artifacts/CounterA/structure.js");

    expect(structure.cells).toEqual([{ id: "c0", initial: 0, getter: "count", setter: "setCount" }]);
    // `compute` is the component's own expression, factored over its slots.
    expect(structure.bindings[0].compute({ count: () => 7 })).toBe("count: 7");
  });

  it("runs each extracted handler against cells supplied through its capture slots", async () => {
    // @ts-expect-error Generated plain-JS artifact; its shape is the emitter's contract, asserted below.
    const increment = await import("../artifacts/CounterA/handlers/s0.js");
    // @ts-expect-error Generated plain-JS artifact; its shape is the emitter's contract, asserted below.
    const decrement = await import("../artifacts/CounterA/handlers/s1.js");

    let value = 0;
    const slots = { count: () => value, setCount: (next: number) => void (value = next) };

    increment.create(slots)();
    increment.create(slots)();
    expect(value).toBe(2);

    decrement.create(slots)();
    expect(value).toBe(1);

    // Both handler modules declare the same write slot: one shared cell.
    expect(increment.captures).toEqual(decrement.captures);
    expect(increment.captures.filter((slot: { access: string }) => slot.access === "write")).toEqual([
      { name: "setCount", cell: "c0", access: "write" },
    ]);
  });
});

describe("comptime pass — Fixture B is refused", () => {
  const analysis = analyzeFixture(FIXTURE_B);

  it("classifies the component as fallback and emits nothing", () => {
    expect(analysis.status).toBe("fallback");
    expect(runComptime(FIXTURE_B).emitted).toBeNull();
  });

  it("names the opaque callee the signal escaped into", () => {
    if (analysis.status !== "fallback") throw new Error("expected a fallback analysis");

    const escapes = analysis.reasons.filter((reason) => reason.code === "signal-escapes-to-opaque-callee");
    expect(escapes.length).toBeGreaterThan(0);

    // The refusal is specific: which binding left, into which callee, defined
    // in which module. That is `Symbol.definition()` following the import.
    expect(escapes.map((reason) => reason.detail)).toContainEqual({
      binding: "signal",
      callee: "makeHandlers",
      definedIn: "src/fixtures/counter-helper.ts",
    });
  });

  it("reports that the handlers came back from that helper unseen", () => {
    if (analysis.status !== "fallback") throw new Error("expected a fallback analysis");

    const notInline = analysis.reasons.filter((reason) => reason.code === "handler-not-inline");
    expect(notInline).toHaveLength(2);
    for (const reason of notInline) {
      expect(reason.detail).toMatchObject({
        boundAs: "Identifier",
        from: { callee: "makeHandlers", definedIn: "src/fixtures/counter-helper.ts", opaque: true },
      });
    }
  });

  it("also refuses the derived label, which is computed behind the module boundary", () => {
    if (analysis.status !== "fallback") throw new Error("expected a fallback analysis");

    expect(analysis.reasons.map((reason) => reason.code)).toContain("jsx-dynamic-child-not-derivable");
  });
});

describe("comptime pass — emit refuses an unclosed compute", () => {
  it("names the binding and the free identifier", () => {
    const analysis: ProvableAnalysis = {
      status: "provable",
      component: "Host",
      module: "host.tsx",
      cells: [],
      stores: [],
      actions: [],
      reads: [],
      inlined: [],
      claimedChildren: [],
      bindings: [
        {
          id: "b0",
          kind: "text",
          locator: "/",
          captures: [{ name: "count", cell: "c0", access: "read" }],
          expression: "other()",
          initialText: "",
          initialTextFrom: "derivation",
          origin: "component",
          loc: { start: 0, end: 0, line: 1, column: 1 },
        },
      ],
      regions: [],
      keyedRegions: [],
      handlers: [],
      wiring: [],
      html: "<p></p>",
      reasons: [],
    };
    expect(() => emit(analysis, scratch())).toThrow(
      /emit: b0 compute is not closed: free identifier `other` is not bound by the parameter pattern/,
    );
  });
});

describe("comptime pass — emission is deterministic", () => {
  it("produces identical bytes on two independent runs", () => {
    const first = runComptime(FIXTURE_A, { outRoot: scratch() });
    const second = runComptime(FIXTURE_A, { outRoot: scratch() });

    expect(first.emitted).not.toBeNull();
    expect(second.emitted!.files).toEqual(first.emitted!.files);
    expect(snapshot(second.emitted!)).toEqual(snapshot(first.emitted!));
  });
});

/**
 * Why these two refusal cases are not duplicates of `see-through.test.ts`.
 *
 * What
 * `see-through.test.ts` covers is that the two *codes* fire; what these cover
 * is that they fire on a component **named `CounterA`, at Fixture A's own
 * path** — the negative half of "the verdict is not name-driven".
 *
 * `docs/feasibility-report.md` §5.3 cites all three bullets of this block by
 * line range (`:243-249`, `:251-270`, `:272-288`) and the claim table cites
 * `234-289` whole. Cutting the refusals would have deleted two of the three
 * cited bullets and left dangling line references behind them. `see-through`
 * makes no claim about names, so nothing there backfills it.
 *
 * One of the two is genuinely the suite's only positive assertion of
 * `handler-references-free-name` firing at all: the corpus carries it on
 * exactly one component (`app/src/app.tsx#Header`, via the coverage baseline)
 * and the only other mention anywhere is a `not.toContain` in
 * `props-see-through.test.ts`.
 */
describe("comptime pass — the verdict is analysis-driven, not name-driven", () => {
  /** Classifies an in-memory module, so nothing depends on paths or file names. */
  function classifySource(path: string, source: string) {
    const analyzer = new Analyzer();
    const module = analyzer.addFile(path, source);
    analyzer.link();
    return classify(module);
  }

  it("still proves Fixture A's source under a different path and export name", () => {
    const source = readFileSync(FIXTURE_A, "utf8").replace(/CounterA/g, "Whatever");
    const analysis = classifySource("somewhere/else/Renamed.tsx", source);

    expect(analysis.status).toBe("provable");
    expect(analysis.component).toBe("Whatever");
  });

  it("refuses a component called CounterA whose handler reaches for a global", () => {
    const analysis = classifySource(
      "src/fixtures/CounterA.tsx",
      `import { createSignal } from "solid-js";
       export function CounterA() {
         const [count, setCount] = createSignal(0);
         return (
           <div>
             <span>{"count: " + count()}</span>
             <button onClick={() => setCount(Math.round(count() + 1))}>+</button>
           </div>
         );
       }`,
    );

    expect(analysis.status).toBe("fallback");
    if (analysis.status !== "fallback") return;
    // `Math` resolves to no binding in the module, so the closure is not
    // self-contained and the handler cannot be replayed from slots alone.
    expect(analysis.reasons.map((reason) => reason.code)).toContain("handler-references-free-name");
  });

  it("refuses a locally-defined signal whose setter is handed to another function", () => {
    const analysis = classifySource(
      "src/fixtures/CounterA.tsx",
      `import { createSignal } from "solid-js";
       import { attach } from "./elsewhere";
       export function CounterA() {
         const [count, setCount] = createSignal(0);
         attach(setCount);
         return <div><span>{"count: " + count()}</span></div>;
       }`,
    );

    expect(analysis.status).toBe("fallback");
    if (analysis.status !== "fallback") return;
    expect(analysis.reasons.map((reason) => reason.code)).toContain("signal-escapes-to-opaque-callee");
  });
});

describe("derived-cell admission", () => {
  it("classifies the host as provable with cells [c0, d0] and a folded initial", () => {
    const analysis = analyzeFixture("test/fixtures/shapes/DerivedCellHost.tsx", {
      write: false,
      component: "DerivedCellHost",
    });
    expect(analysis.status).toBe("provable");
    if (analysis.status !== "provable") return;
    expect(analysis.cells.map((cell) => cell.id)).toEqual(["c0", "d0"]);
    expect(analysis.cells[1]).toMatchObject({ id: "d0", initial: "hr", getter: "tagName" });
    expect(analysis.cells[1].setter).toBeUndefined();
  });

  it("refuses an unfoldable initializer by name", () => {
    const analysis = analyzeFixture("test/fixtures/shapes/DerivedCellUnfoldable.tsx", {
      write: false,
      component: "DerivedCellUnfoldable",
    });
    expect(analysis.status).toBe("fallback");
    if (analysis.status !== "fallback") return;
    expect(analysis.reasons.map((reason) => reason.code)).toContain("derived-cell-initial-not-foldable");
  });

  it("refuses a handler-wired input setter by name", () => {
    const analysis = analyzeFixture("test/fixtures/shapes/DerivedCellUnstable.tsx", {
      write: false,
      component: "DerivedCellUnstable",
    });
    expect(analysis.status).toBe("fallback");
    if (analysis.status !== "fallback") return;
    expect(analysis.reasons.map((reason) => reason.code)).toContain("derived-cell-input-not-mount-stable");
  });

  it("emits the derived cell without a setter, and refuses a handler that names it", () => {
    const result = runComptime("test/fixtures/shapes/DerivedCellHost.tsx", {
      component: "DerivedCellHost",
      outRoot: scratch(),
    });
    expect(result.analysis.status).toBe("provable");
    if (result.analysis.status !== "provable" || result.emitted === null) return;
    const structure = readFileSync(join(result.emitted.dir, "structure.js"), "utf8");
    expect(structure).toContain('id: "d0"');
    expect(structure).toContain('initial: "hr"');
    expect(structure).not.toMatch(/id: "d0"[\s\S]*setter:/);

    const forged: ProvableAnalysis = {
      ...result.analysis,
      handlers: [
        {
          id: "s0",
          event: "click",
          locator: "/",
          module: "./handlers/s0.js",
          captures: [{ name: "tagName", cell: "d0", access: "read" }],
          source: "() => {}",
          origin: "component",
          loc: result.analysis.cells[0].loc,
        },
      ],
      wiring: [
        {
          locator: "/",
          event: "click",
          module: "./handlers/s0.js",
          handler: "s0",
          captures: [{ name: "tagName", cell: "d0", access: "read" }],
        },
      ],
    };
    expect(() => emit(forged, scratch())).toThrow(/derived cell d0/);
  });
});

describe("element-projection cell admission", () => {
  it("classifies the host as provable with a projection on d0", () => {
    const analysis = analyzeFixture("test/fixtures/shapes/ElementProjectionHost.tsx", {
      write: false,
      component: "ElementProjectionHost",
    });
    expect(analysis.status).toBe("provable");
    if (analysis.status !== "provable") return;
    expect(analysis.cells.map((cell) => cell.id)).toEqual(["c0", "d0"]);
    expect(analysis.cells[1]).toMatchObject({
      id: "d0",
      initial: "div",
      getter: "tagName",
      projection: {
        host: "c0",
        steps: [
          { kind: "property", name: "tagName" },
          { kind: "call", name: "toLowerCase" },
        ],
      },
    });
  });

  it("refuses a projection of a non-host element by name", () => {
    const analysis = analyzeFixture("test/fixtures/shapes/ElementProjectionCounter.tsx", {
      write: false,
      component: "ElementProjectionOther",
    });
    expect(analysis.status).toBe("fallback");
    if (analysis.status !== "fallback") return;
    expect(analysis.reasons.map((reason) => reason.code)).toContain("element-projection-not-own-host");
  });

  it("refuses getAttribute with a non-literal argument by name", () => {
    const analysis = analyzeFixture("test/fixtures/shapes/ElementProjectionCounter.tsx", {
      write: false,
      component: "ElementProjectionNonLiteral",
    });
    expect(analysis.status).toBe("fallback");
    if (analysis.status !== "fallback") return;
    expect(analysis.reasons.map((reason) => reason.code)).toContain("element-projection-not-pure");
  });

  it("refuses a handler that captures the projection cell", () => {
    const analysis = analyzeFixture("test/fixtures/shapes/ElementProjectionCounter.tsx", {
      write: false,
      component: "ElementProjectionHandler",
    });
    expect(analysis.status).toBe("fallback");
    if (analysis.status !== "fallback") return;
    expect(analysis.reasons.map((reason) => reason.code)).toContain("handler-captures-unprovable-binding");
  });
});

describe("whole-bind object-shaped context — emit and DialogTrigger", () => {
  it("emits object stores by their own keys, not tuple fields", () => {
    const analysis = analyzeFixture("test/fixtures/shapes/ObjectStoreHost.tsx", {
      write: false,
      component: "ObjectStoreHost",
    });
    expect(analysis.status).toBe("provable");
    if (analysis.status !== "provable") return;
    const dir = scratch();
    const result = emit(analysis, dir);
    const structure = readFileSync(join(result.dir, "structure.js"), "utf8");
    expect(structure).toContain("keys:");
    expect(structure).not.toContain("actionsSlot");
    expect(structure).toContain('path: ["toggle"]');
  });

  it("flips DialogTrigger to provable once the claimed-child record widens", () => {
    const analysis = analyzeFixture("demo/node_modules/@kobalte/core/dist/dialog/C9YDO9vc.jsx", {
      write: false,
      component: "DialogTrigger",
    });
    expect(analysis.status).toBe("provable");
    if (analysis.status !== "provable") return;
    expect(analysis.claimedChildren).toHaveLength(1);
    expect(analysis.claimedChildren[0].component).toBe("ButtonRoot");
    expect(analysis.claimedChildren[0].artifact).not.toBe("DvspU6cJ.ButtonRoot");
    expect(analysis.claimedChildren[0].artifact).toMatch(/^DvspU6cJ\.ButtonRoot~/);
    expect(analysis.html).toMatch(/data-component="ButtonRoot"/);
    expect(analysis.html).toContain(`data-resume="${analysis.claimedChildren[0].artifact}"`);
    expect(analysis.html).not.toContain("aria-expanded");
  });
});
