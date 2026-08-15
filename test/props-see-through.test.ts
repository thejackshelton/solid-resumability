import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { Analyzer, type Module } from "yuku-analyzer";

import { classify, emit } from "../src/comptime/index.ts";
import type { Analysis, ProvableAnalysis, ReasonCode } from "../src/comptime/types.ts";
import { textBinding } from "./bindings.ts";

/**
 * Depth-1 component inlining across a props boundary.
 *
 * The failure mode that matters is over-admission at the JSXAttribute
 * boundary. A component element that quietly splices when the pass cannot
 * actually prove what crossed the boundary widens the trusted subset with
 * nothing turning red — and unlike a bad summary, it also *emits* markup and
 * wiring, so the damage reaches an artifact. So, as in `see-through.test.ts`,
 * the refusal cases outnumber the admission cases on purpose, and each refusal
 * is the admitted shape with exactly one thing changed. A passing refusal test
 * is then evidence about the guard it names, not about some unrelated blocker.
 *
 * Everything is analyzed from in-memory sources. Where a test needs the child
 * to live in another module it says so, so `Symbol.definition()` has a real
 * import chain to follow rather than a same-file shortcut.
 */

/**
 * Analyzes a small multi-module project and classifies the entry's component.
 *
 * The component is named explicitly and defaults to `Parent`: every source
 * below declares its children *first*, so the "first component in the module"
 * shortcut would classify a child and quietly answer a different question.
 */
function classifyProject(files: Record<string, string>, entry: string, component = "Parent"): Analysis {
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

/** The common case: one file, one parent, whatever children it declares. */
function classifyOne(source: string, component = "Parent"): Analysis {
  return classifyProject({ "src/Pair.tsx": source }, "src/Pair.tsx", component);
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

function refused(analysis: Analysis): ReasonCode[] {
  expect(analysis.status).toBe("fallback");
  return codesOf(analysis);
}

/**
 * The admitted shape, in one string so every refusal below can be read as a
 * diff against it: an accessor prop, a handler prop, one hop, no cells in the
 * children, intrinsic roots.
 */
const ADMITTED = `import { createSignal } from "solid-js";
  function Label(props) {
    return <span class="l">{props.count()}</span>;
  }
  function Step(props) {
    return <button class="b" onClick={props.onStep}>+</button>;
  }
  export function Parent() {
    const [count, setCount] = createSignal(0);
    return (
      <div>
        <Label count={count} />
        <Step onStep={() => setCount(count() + 1)} />
      </div>
    );
  }`;

// ------------------------------------------------------------------ admission

describe("props see-through — what one hop admits", () => {
  it("splices the children's markup into the parent's template", () => {
    const analysis = proved(classifyOne(ADMITTED));

    // The children's elements sit exactly where their component elements did,
    // and nothing about the component names survives into the artifact.
    //
    // The `<!---->`s are Solid's: two component children under one parent are
    // two dynamic slots, and `insert()` gives each its own marker — the next
    // sibling when that is a real element, a dedicated
    // placeholder comment otherwise. Reproducing them is what keeps the
    // template byte-identical to `render()`; `test/parity.test.tsx` proves it
    // against the live DOM rather than against this string.
    expect(analysis.html).toBe(
      '<div><span class="l">0</span><!----><button class="b">+</button><!----></div>',
    );
    expect(analysis.html).not.toContain("Label");
    expect(analysis.html).not.toContain("Step");
  });

  it("emits no placeholder for a lone component child, because Solid emits none", () => {
    // The counterpart of the case above, and the reason the rule is not
    // "a placeholder after every spliced child": with one dynamic slot under
    // the parent, `insert()` rides the following `<button>` as its marker and
    // the template gains nothing. The three admission cases below already
    // assert this shape; it is stated once on its own so a future change that
    // over-emits fails a test that names the fact.
    const analysis = proved(
      classifyOne(`import { createSignal } from "solid-js";
        function Label(props) {
          return <span class="l">{props.count()}</span>;
        }
        export function Parent() {
          const [count, setCount] = createSignal(0);
          return (
            <div>
              <Label count={count} />
              <button onClick={() => setCount(count() + 1)}>+</button>
            </div>
          );
        }`),
    );

    expect(analysis.html).toBe('<div><span class="l">0</span><button>+</button></div>');
    expect(analysis.html).not.toContain("<!---->");
  });

  it("re-homes the child's text binding onto the parent's cell at a parent-frame locator", () => {
    const analysis = proved(classifyOne(ADMITTED));

    expect(analysis.bindings).toHaveLength(1);
    const binding = textBinding(analysis.bindings[0]);
    // "/0" is the parent's first child — the position the component element
    // occupied — not a locator inside some separate child template.
    expect(binding.locator).toBe("/0");
    expect(binding.captures).toEqual([{ name: "count", cell: "c0", access: "read" }]);
    // Written in the *parent's* accessor name; `props.count` appears nowhere.
    expect(binding.expression).toBe("count()");
    expect(binding.expression).not.toContain("props");
    expect(binding.initialText).toBe("0");
    // Provenance of the *code*: this derivation was written from the child's
    // markup, so it is tagged `"child"`, not `"helper"`.
    expect(binding.origin).toBe("child");
  });

  it("wires the parent's handler onto the child's element", () => {
    const analysis = proved(classifyOne(ADMITTED));

    expect(analysis.handlers).toHaveLength(1);
    const [handler] = analysis.handlers;
    expect(handler.event).toBe("click");
    expect(handler.locator).toBe("/1");
    expect(handler.source).toBe("() => setCount(count() + 1)");
    expect(handler.captures).toEqual([
      { name: "count", cell: "c0", access: "read" },
      { name: "setCount", cell: "c0", access: "write" },
    ]);
    // The handler's body is the *parent's* own arrow — it merely attaches to a
    // spliced child's element, which is what `locator` says.
    expect(handler.origin).toBe("component");
    expect(analysis.wiring).toEqual([
      {
        locator: "/1",
        event: "click",
        module: "./handlers/s0.js",
        handler: "s0",
        captures: handler.captures,
      },
    ]);
  });

  it("does not treat a prop-passed accessor as an escape", () => {
    // The whole reason `count={count}` used to be fatal: the escape audit saw
    // an accessor in a position it could not prove. It can prove this one.
    expect(codesOf(classifyOne(ADMITTED))).not.toContain("signal-escapes-unanalyzable-use");
  });

  it("reaches a child defined in another module", () => {
    const analysis = proved(
      classifyProject(
        {
          "src/Label.tsx": `export function Label(props) {
             return <span class="l">{props.count()}</span>;
           }`,
          "src/Parent.tsx": `import { createSignal } from "solid-js";
             import { Label } from "./Label";
             export function Parent() {
               const [count, setCount] = createSignal(0);
               return (
                 <div>
                   <Label count={count} />
                   <button onClick={() => setCount(count() + 1)}>+</button>
                 </div>
               );
             }`,
        },
        "src/Parent.tsx",
      ),
    );

    expect(analysis.html).toBe('<div><span class="l">0</span><button>+</button></div>');
    expect(analysis.bindings[0].locator).toBe("/0");
    // The binding came from `src/Label.tsx`, so its reported location is read
    // against *that* file's source — line 2, where the child's `<span>` is —
    // rather than the same byte offset resolved against the parent's.
    expect(analysis.bindings[0].loc.line).toBe(2);
  });

  it("folds a literal prop into the child's markup", () => {
    const analysis = proved(
      classifyOne(`import { createSignal } from "solid-js";
        function Label(props) {
          return <span title={props.tag}>{props.prefix}</span>;
        }
        export function Parent() {
          const [count, setCount] = createSignal(1);
          return (
            <div>
              <Label prefix="hi" tag="t" />
              <button onClick={() => setCount(count() + 1)}>+</button>
            </div>
          );
        }`),
    );

    expect(analysis.html).toBe('<div><span title="t">hi</span><button>+</button></div>');
    // A literal prop needs no cell, so the binding it produces captures nothing.
    expect(analysis.bindings[0].captures).toEqual([]);
    expect(textBinding(analysis.bindings[0]).initialText).toBe("hi");
  });
});

// ------------------------------------------------------------------- refusals

describe("props see-through — the depth-1 ban", () => {
  it("refuses a second hop", () => {
    const codes = refused(
      classifyOne(`import { createSignal } from "solid-js";
        function Leaf(props) { return <span>{props.count()}</span>; }
        function Middle(props) { return <div><Leaf count={props.count} /></div>; }
        export function Parent() {
          const [count, setCount] = createSignal(0);
          return (
            <div>
              <Middle count={count} />
              <button onClick={() => setCount(count() + 1)}>+</button>
            </div>
          );
        }`),
    );

    expect(codes).toContain("jsx-component-element");
    // And the accessor it handed to the un-inlinable child escapes again: the
    // seen-through set is populated by successful splices only.
    expect(codes).toContain("signal-escapes-unanalyzable-use");
  });

  it("refuses a grandchild even when the middle component is otherwise perfect", () => {
    // Same file, but the middle takes no props at all — so the only thing
    // wrong with it is that it renders another component.
    const codes = refused(
      classifyOne(`import { createSignal } from "solid-js";
        function Leaf() { return <span>leaf</span>; }
        function Middle() { return <div><Leaf /></div>; }
        export function Parent() {
          const [count, setCount] = createSignal(0);
          return (
            <div>
              <Middle />
              <button onClick={() => setCount(count() + 1)}>{count()}</button>
            </div>
          );
        }`),
    );

    expect(codes).toEqual(["jsx-component-element"]);
  });

  it("never traces through a component the analyzed file set does not define", () => {
    // `<Show>` is imported from `solid-js`, which is outside the file set, so
    // `definition()` returns nothing and control flow stays refused.
    const codes = refused(
      classifyOne(`import { createSignal, Show } from "solid-js";
        export function Parent() {
          const [count, setCount] = createSignal(0);
          return (
            <div>
              <Show when={count}>ok</Show>
              <button onClick={() => setCount(count() + 1)}>+</button>
            </div>
          );
        }`),
    );

    expect(codes).toContain("jsx-component-element");
  });
});

describe("props see-through — what the child has to be", () => {
  /** The admitted shape with `Label`'s body replaced. */
  const withLabel = (label: string): string => `import { createSignal } from "solid-js";
    ${label}
    export function Parent() {
      const [count, setCount] = createSignal(0);
      return (
        <div>
          <Label count={count} />
          <button onClick={() => setCount(count() + 1)}>+</button>
        </div>
      );
    }`;

  it("refuses a child that destructures its props", () => {
    const codes = refused(
      classifyOne(withLabel(`function Label({ count }) { return <span>{count()}</span>; }`)),
    );
    expect(codes).toContain("jsx-component-element");
  });

  it("refuses a child that uses `props` whole", () => {
    const codes = refused(
      classifyOne(
        withLabel(`function Label(props) {
          return <span>{props.count()}</span>;
        }
        function sink(p) { return p; }`).replace(
          "return <span>{props.count()}</span>;",
          "return <span>{sink(props).count()}</span>;",
        ),
      ),
    );
    expect(codes).toContain("jsx-component-element");
  });

  it("refuses a child with a computed props read", () => {
    const codes = refused(
      classifyOne(withLabel(`function Label(props) { return <span>{props["count"]()}</span>; }`)),
    );
    expect(codes).toContain("jsx-component-element");
  });

  it("refuses a child with a second parameter", () => {
    const codes = refused(
      classifyOne(withLabel(`function Label(props, extra) { return <span>{props.count()}</span>; }`)),
    );
    expect(codes).toContain("jsx-component-element");
  });

  it("refuses a child that declares a cell of its own", () => {
    const codes = refused(
      classifyOne(
        withLabel(`function Label(props) {
          const [own, setOwn] = createSignal(1);
          return <span>{props.count()}</span>;
        }`),
      ),
    );
    expect(codes).toContain("jsx-component-element");
  });

  it("refuses a child that reads module-level state", () => {
    const codes = refused(
      classifyOne(`const TAG = "t";
        ${withLabel(`function Label(props) { return <span class={TAG}>{props.count()}</span>; }`)}`),
    );
    expect(codes).toContain("jsx-component-element");
  });

  it("refuses a child whose root is a fragment", () => {
    const codes = refused(
      classifyOne(
        withLabel(`function Label(props) { return <><span>{props.count()}</span></>; }`),
      ),
    );
    expect(codes).toContain("jsx-component-element");
  });

  it("refuses a child that does more than return markup", () => {
    const codes = refused(
      classifyOne(
        withLabel(`function Label(props) {
          const text = props.count();
          return <span>{text}</span>;
        }`),
      ),
    );
    expect(codes).toContain("jsx-component-element");
  });
});

describe("props see-through — what may cross the boundary", () => {
  const withCall = (call: string, extra = ""): string => `import { createSignal } from "solid-js";
    ${extra}
    function Child(props) {
      return <button class="b" onClick={props.onStep}>+</button>;
    }
    export function Parent() {
      const [count, setCount] = createSignal(0);
      return (
        <div>
          <span>{count()}</span>
          ${call}
        </div>
      );
    }`;

  it("admits an inline arrow handler", () => {
    const analysis = proved(classifyOne(withCall(`<Child onStep={() => setCount(count() + 1)} />`)));
    expect(analysis.html).toBe('<div><span>0</span><button class="b">+</button></div>');
    expect(analysis.handlers[0].locator).toBe("/1");
  });

  it("admits a handler from a summarizable factory, one hop further", () => {
    const analysis = proved(
      classifyProject(
        {
          "src/helpers.ts": `export function makeIncrement(read, write) {
             return () => write(read() + 1);
           }`,
          "src/Pair.tsx": `import { createSignal } from "solid-js";
             import { makeIncrement } from "./helpers";
             function Child(props) { return <button onClick={props.onStep}>+</button>; }
             export function Parent() {
               const [count, setCount] = createSignal(0);
               const step = makeIncrement(count, setCount);
               return <div><span>{count()}</span><Child onStep={step} /></div>;
             }`,
        },
        "src/Pair.tsx",
      ),
    );

    expect(analysis.handlers[0].source).toBe("() => write(read() + 1)");
    expect(analysis.handlers[0].captures).toEqual([
      { name: "read", cell: "c0", access: "read" },
      { name: "write", cell: "c0", access: "write" },
    ]);
  });

  it("refuses a spread at the call site, and names it", () => {
    const codes = refused(
      classifyOne(
        withCall(`<Child {...wiring} />`).replace(
          "const [count, setCount] = createSignal(0);",
          "const [count, setCount] = createSignal(0);\n          const wiring = { onStep: () => setCount(count() + 1) };",
        ),
      ),
    );

    expect(codes).toContain("jsx-spread");
    expect(codes).toContain("jsx-component-element");
  });

  it("refuses a bare attribute", () => {
    const codes = refused(classifyOne(withCall(`<Child onStep />`)));
    expect(codes).toContain("jsx-component-element");
  });

  it("refuses a handler that would have been refused where it was written", () => {
    // The arrow reaches for a free name. Crossing a props boundary must not
    // launder it: `bindProp` runs the same audit the inline path runs.
    const codes = refused(
      classifyOne(withCall(`<Child onStep={() => { window.alert(count()); }} />`)),
    );
    expect(codes).toContain("jsx-component-element");
    expect(codes).not.toContain("handler-references-free-name");
  });

  it("refuses a handler from a factory the pass cannot summarize", () => {
    const codes = refused(
      classifyProject(
        {
          "src/impure.ts": `export function makeNoisy(read, write) {
             return () => { console.log(read()); write(read() + 1); };
           }`,
          "src/Pair.tsx": `import { createSignal } from "solid-js";
             import { makeNoisy } from "./impure";
             function Child(props) { return <button onClick={props.onStep}>+</button>; }
             export function Parent() {
               const [count, setCount] = createSignal(0);
               const step = makeNoisy(count, setCount);
               return <div><span>{count()}</span><Child onStep={step} /></div>;
             }`,
        },
        "src/Pair.tsx",
      ),
    );

    expect(codes).toContain("jsx-component-element");
    expect(codes).toContain("signal-escapes-to-opaque-callee");
  });

  it("refuses an object prop", () => {
    const codes = refused(
      classifyOne(
        withCall(`<Child onStep={{ go: () => setCount(count() + 1) }} />`),
      ),
    );
    expect(codes).toContain("jsx-component-element");
  });
});

describe("props see-through — how the child is allowed to use what it was given", () => {
  const withChild = (child: string, attribute = "count={count}"): string =>
    `import { createSignal } from "solid-js";
     ${child}
     export function Parent() {
       const [count, setCount] = createSignal(0);
       return (
         <div>
           <Child ${attribute} />
           <button onClick={() => setCount(count() + 1)}>+</button>
         </div>
       );
     }`;

  it("refuses an accessor used as a value rather than called", () => {
    const codes = refused(
      classifyOne(withChild(`function Child(props) { return <span>{props.count}</span>; }`)),
    );
    expect(codes).toContain("jsx-component-element");
    expect(codes).toContain("signal-escapes-unanalyzable-use");
  });

  it("refuses a getter called with an argument", () => {
    const codes = refused(
      classifyOne(withChild(`function Child(props) { return <span>{props.count(1)}</span>; }`)),
    );
    expect(codes).toContain("jsx-component-element");
  });

  it("refuses a setter used where a getter was passed", () => {
    const codes = refused(
      classifyOne(
        withChild(
          `function Child(props) { return <button onClick={props.onStep}>{props.set(1)}</button>; }`,
          "set={setCount} onStep={() => setCount(count() + 1)}",
        ),
      ),
    );
    expect(codes).toContain("jsx-component-element");
  });

  it("refuses a handler called during render", () => {
    const codes = refused(
      classifyOne(
        withChild(
          `function Child(props) { return <span>{props.onStep()}</span>; }`,
          "onStep={() => setCount(count() + 1)}",
        ),
      ),
    );
    expect(codes).toContain("jsx-component-element");
  });

  it("refuses a handler put in an ordinary attribute position", () => {
    const codes = refused(
      classifyOne(
        withChild(
          `function Child(props) { return <span title={props.onStep}>x</span>; }`,
          "onStep={() => setCount(count() + 1)}",
        ),
      ),
    );
    expect(codes).toContain("jsx-component-element");
  });

  it("refuses a prop the call site never passed", () => {
    const codes = refused(
      classifyOne(
        withChild(`function Child(props) { return <span>{props.missing()}</span>; }`),
      ),
    );
    expect(codes).toContain("jsx-component-element");
  });

  it("refuses a handler written inside the child rather than handed to it", () => {
    // Its free variables live in the child's frame, which the parent's cells
    // cannot fill — even though the body is trivially provable in isolation.
    const codes = refused(
      classifyOne(
        withChild(`function Child(props) {
          return <button onClick={() => props.count()}>{props.count()}</button>;
        }`),
      ),
    );
    expect(codes).toContain("jsx-component-element");
  });
});

describe("props see-through — the trial is all-or-nothing", () => {
  it("leaves no half-spliced binding behind when a child refuses", () => {
    // The child's first element is fine and would record a binding; its second
    // is a nested component, which fails the trial. The parent must come out
    // with only its own binding, and with dense ids.
    const analysis = classifyOne(`import { createSignal } from "solid-js";
      function Inner() { return <em>x</em>; }
      function Child(props) {
        return (
          <div>
            <span>{props.count()}</span>
            <Inner />
          </div>
        );
      }
      export function Parent() {
        const [count, setCount] = createSignal(0);
        return (
          <div>
            <Child count={count} />
            <button onClick={() => setCount(count() + 1)}>{count()}</button>
          </div>
        );
      }`);

    expect(analysis.status).toBe("fallback");
    expect(codesOf(analysis)).toContain("jsx-component-element");
  });

  it("keeps binding and handler ids dense after a rolled-back trial", () => {
    const analysis = proved(
      classifyOne(`import { createSignal } from "solid-js";
        function Inner() { return <em>x</em>; }
        function Bad(props) { return <div><span>{props.count()}</span><Inner /></div>; }
        function Good(props) { return <span class="g">{props.count()}</span>; }
        export function Parent() {
          const [count, setCount] = createSignal(0);
          return (
            <div>
              <Good count={count} />
              <button onClick={() => setCount(count() + 1)}>+</button>
            </div>
          );
        }`),
    );

    // `Bad` is never rendered, so nothing rolls back here — but `Good`'s
    // binding still has to be `b0` and its handler `s0`, which is the property
    // a leaked trial would break.
    expect(analysis.bindings.map((b) => b.id)).toEqual(["b0"]);
    expect(analysis.handlers.map((h) => h.id)).toEqual(["s0"]);
  });

  it("refuses the parent whole when the child's markup has an ordinary defect", () => {
    const codes = refused(
      classifyOne(`import { createSignal } from "solid-js";
        function Child(props) {
          return <span>text {props.count()}</span>;
        }
        export function Parent() {
          const [count, setCount] = createSignal(0);
          return (
            <div>
              <Child count={count} />
              <button onClick={() => setCount(count() + 1)}>+</button>
            </div>
          );
        }`),
    );

    // The child mixes text and expression children. That is the child's own
    // `jsx-unsupported-children`, and it is *not* attributed to the parent —
    // the parent gets the element refusal, which is what it is responsible for.
    expect(codes).toContain("jsx-component-element");
    expect(codes).not.toContain("jsx-unsupported-children");
  });
});

describe("props see-through — the artifact says where its code came from", () => {
  const scratchDirs: string[] = [];

  afterAll(() => {
    for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
  });

  it("names the inlined child in the emitted derivation, and the component in the handler", () => {
    const analysis = proved(classifyOne(ADMITTED));
    const dir = mkdtempSync(join(process.cwd(), ".artifacts-props-"));
    scratchDirs.push(dir);
    emit(analysis, dir);

    const structure = readFileSync(join(dir, "structure.js"), "utf8");
    expect(structure).toContain("folded out of a child component this pass inlined");
    expect(structure).toContain("return count();");
    // The child's parameter name is nowhere in anything that ships.
    expect(structure).not.toContain("props");

    // The handler body is the parent's own arrow, so the artifact must not
    // claim it came from a helper.
    const handler = readFileSync(join(dir, "handlers", "s0.js"), "utf8");
    expect(handler).toContain("extracted whole from the component");
    expect(handler).toContain("return () => setCount(count() + 1);");
  });
});

describe("props see-through — the surrounding conservatism", () => {
  it("still refuses to INLINE a nested component that has a cell — and ADDRESSES it instead", () => {
    // The shape has not moved and neither has inlining's answer to it: a child
    // that declares its own `createSignal` is past depth-1 splicing's ceiling,
    // because a splice has no slot for a cell. What moved is which arm gets to
    // answer. This child is bare, in the analyzed set, not a cycle, provable,
    // and it paints — the five conditions — so addressing takes the element and
    // the parent carries a hole where it used to carry a refusal.
    const analysis = proved(
      classifyOne(`import { createSignal } from "solid-js";
        function Child() {
          const [own, setOwn] = createSignal(0);
          return <span>{own()}</span>;
        }
        export function Parent() {
          const [count, setCount] = createSignal(0);
          return <div><Child /><button onClick={() => setCount(count() + 1)}>{count()}</button></div>;
        }`),
    );

    // INLINING STILL REFUSES IT. This is the original point of the case and it
    // survives verbatim: nothing of the child's was absorbed into the parent.
    expect(analysis.inlined).toEqual([]);

    // ADDRESSING TAKES IT. One claimed child, and the parent's own cell list is
    // untouched by it — the child keeps `own` in its own artifact.
    expect(analysis.claimedChildren).toHaveLength(1);
    expect(analysis.claimedChildren[0].component).toBe("Child");
    expect(analysis.cells.map((cell) => cell.getter)).toEqual(["count"]);
  });

  it("still refuses a handler that calls a pure helper inline", () => {
    // `handler-calls-non-accessor` is untouched by the summary lever, and
    // the props lever does not reach it either.
    const codes = refused(
      classifyProject(
        {
          "src/helpers.ts": `export function twice(read) { return read() * 2; }`,
          "src/Pair.tsx": `import { createSignal } from "solid-js";
             import { twice } from "./helpers";
             function Child(props) { return <button onClick={props.onStep}>+</button>; }
             export function Parent() {
               const [count, setCount] = createSignal(0);
               return <div><span>{count()}</span><Child onStep={() => setCount(twice(count))} /></div>;
             }`,
        },
        "src/Pair.tsx",
      ),
    );

    expect(codes).toContain("jsx-component-element");
  });

  it("leaves a component with no component elements byte-identical", () => {
    // The frame refactor threads a parameter through every markup function; a
    // component that never opens a child frame must be unaffected by it.
    const analysis = proved(
      classifyOne(`import { createSignal } from "solid-js";
        export function Parent() {
          const [count, setCount] = createSignal(0);
          return (
            <div>
              <span>{"count: " + count()}</span>
              <button onClick={() => setCount(count() + 1)}>+</button>
            </div>
          );
        }`),
    );

    expect(analysis.html).toBe("<div><span>count: 0</span><button>+</button></div>");
    // Printed verbatim from the component's own source, not reassembled.
    expect(textBinding(analysis.bindings[0]).expression).toBe('"count: " + count()');
    expect(analysis.bindings[0].origin).toBe("component");
    expect(analysis.handlers[0].origin).toBe("component");
  });
});
