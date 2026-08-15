import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterAll, afterEach, describe, expect, it } from "vitest";
import { render } from "@solidjs/web";

import { runComptime } from "../src/comptime/index.ts";
import { createRegistry, type HandlerModule } from "../src/resume/registry.ts";
import { resumeBundle } from "../src/resume/resumer.ts";
import { ToggleRow } from "./fixtures/ToggleRow.tsx";

/**
 * Attribute and class bindings, end to end: classify -> emit -> registry ->
 * resumer, against real DOM.
 *
 * The claim under test is not "the pass admits more". It is that what the pass
 * now admits, it admits for a reason it can state — a named attribute holding a
 * derivation it folded, and a named SET of class names, each with its own
 * condition — and that the resume side reproduces exactly Solid's own DOM
 * semantics for both: presence-not-text for booleans, assignment for the
 * properties markup cannot carry, and add/remove confined to the names in the
 * record.
 *
 * The refusal fixtures are half the proof. `jsx-dynamic-attribute` was NARROWED,
 * not lifted: a class name chosen at runtime and an attribute value with no
 * fixed shape still refuse, each with that one code and nothing else.
 */

const scratchDirs: string[] = [];

/**
 * Inside the repo, not the OS temp dir: these artifacts are `import()`ed below,
 * and Vite resolves what is under the project root. Removed in `afterAll`, the
 * same arrangement `see-through.test.ts` uses for the same reason.
 */
function scratch(): string {
  const dir = mkdtempSync(join(process.cwd(), "test", ".artifacts-binding-kinds-"));
  scratchDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
});

const { analysis, emitted } = runComptime("test/fixtures/ToggleRow.tsx", { outRoot: scratch() });
if (analysis.status !== "provable") {
  throw new Error(`ToggleRow should be provable, got ${JSON.stringify(analysis.reasons)}`);
}
if (emitted === null) throw new Error("ToggleRow emitted no artifacts");

/** The bindings by kind — one class binding, three attribute bindings. */
const classBinding = analysis.bindings.find((binding) => binding.kind === "class")!;
const attributeBindings = analysis.bindings.filter((binding) => binding.kind === "attribute");

describe("comptime — the class list folds into a named set", () => {
  it("keeps the unconditional name static and records one condition per key", () => {
    expect(classBinding).toBeDefined();
    expect(classBinding.locator).toBe("/");
    expect(classBinding.statics).toEqual(["todo"]);
    expect(classBinding.conditions.map((condition) => condition.name)).toEqual(["completed", "pending"]);
    expect(classBinding.initialFrom).toBe("derivation");
  });

  it("prints each condition from the author's own source and folds its first value", () => {
    expect(classBinding.conditions[0]).toMatchObject({ expression: "done()", initial: false });
    expect(classBinding.conditions[1]).toMatchObject({ expression: "!done()", initial: true });
    expect(classBinding.captures).toEqual([{ name: "done", cell: "c0", access: "read" }]);
  });

  it("renders the names that are on at first paint, in Solid's order", () => {
    expect(analysis.html).toContain('<li class="todo pending">');
  });
});

describe("comptime — an attribute binding names its attribute", () => {
  it("records the three attributes with the derivation each holds", () => {
    expect(attributeBindings.map((binding) => binding.attribute)).toEqual(["checked", "title", "disabled"]);
    expect(attributeBindings.map((binding) => binding.expression)).toEqual([
      "done()",
      "`done: ${done()}`",
      "done()",
    ]);
  });

  it("marks the checkbox's checkedness as DOM state rather than markup", () => {
    const [checked, title, disabled] = attributeBindings;
    expect(checked).toMatchObject({ property: true, initialValue: false, locator: "/0" });
    // The other two are ordinary attributes, whatever their value's type.
    expect(title).toMatchObject({ property: false, initialValue: "done: false" });
    expect(disabled).toMatchObject({ property: false, initialValue: false });
  });

  it("states a boolean attribute the way HTML does: presence, not text", () => {
    // `disabled` is false at first paint, so the markup carries no `disabled`;
    // `checked` is a property, so the markup could not carry it either.
    expect(analysis.html).toContain('<input class="toggle" type="checkbox">');
    expect(analysis.html).toContain('<button class="destroy" title="done: false">x</button>');
    expect(analysis.html).not.toContain("disabled");
  });
});

describe("template parity with classic render()", () => {
  const hosts: HTMLElement[] = [];
  const disposers: Array<() => void> = [];

  afterEach(() => {
    while (disposers.length) disposers.pop()!();
    while (hosts.length) hosts.pop()!.remove();
  });

  it("matches the markup Solid itself produces, byte for byte", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    hosts.push(host);
    disposers.push(render(ToggleRow as never, host));

    // The whole slice rests on this: the class list's fold and its ORDER, the
    // absent `disabled`, and the absent `checked` are all claims about what
    // Solid renders. Here Solid renders it.
    expect(host.innerHTML).toBe(analysis.html);
    expect((host.querySelector("input") as HTMLInputElement).checked).toBe(false);
  });
});

describe("resume — the emitted artifacts drive real DOM", () => {
  /** The emitted modules, assembled the way a page assembles them. */
  async function resumed() {
    const load = async (file: string) =>
      (await import(pathToFileURL(join(emitted!.dir, file)).href)) as Record<string, unknown>;

    const template = await load("template.js");
    const structure = await load("structure.js");
    const wiring = await load("wiring.js");

    const handlers: Record<string, () => Promise<HandlerModule>> = {};
    for (const handler of analysis.status === "provable" ? analysis.handlers : []) {
      handlers[`/artifacts/ToggleRow/handlers/${handler.id}.js`] = async () =>
        (await load(`handlers/${handler.id}.js`)) as unknown as HandlerModule;
    }

    const registry = createRegistry(
      {
        "/artifacts/ToggleRow/template.js": template,
        "/artifacts/ToggleRow/structure.js": structure,
        "/artifacts/ToggleRow/wiring.js": wiring,
      },
      handlers,
    );

    const bundle = registry.get("ToggleRow");
    if (!bundle) throw new Error("no bundle for ToggleRow");

    const container = document.createElement("div");
    container.innerHTML = bundle.template!.html;
    document.body.appendChild(container);

    return { container, app: resumeBundle(container, bundle) };
  }

  it("writes the checkbox's initial checkedness, which markup could not carry", async () => {
    const { container, app } = await resumed();
    const input = container.querySelector("input") as HTMLInputElement;

    expect(input.checked).toBe(false);
    expect(input.hasAttribute("checked")).toBe(false);

    app.dispose();
    container.remove();
  });

  it("applies all three kinds when the cell moves", async () => {
    const { container, app } = await resumed();
    const row = container.firstElementChild as HTMLElement;
    const input = container.querySelector("input") as HTMLInputElement;
    const button = container.querySelector("button") as HTMLButtonElement;

    // A class this binding does not own, put here by the page.
    row.classList.add("highlight");

    button.dispatchEvent(new Event("click", { bubbles: true }));
    await app.settled();

    // The class binding toggles both names in its record, and the page's own
    // class is still there: it was never in the record, so it was never touched.
    expect([...row.classList].sort()).toEqual(["completed", "highlight", "todo"]);
    // The property, assigned; still no attribute, exactly as Solid leaves it.
    expect(input.checked).toBe(true);
    expect(input.hasAttribute("checked")).toBe(false);
    // A string attribute, set; a boolean attribute, present and empty.
    expect(button.getAttribute("title")).toBe("done: true");
    expect(button.getAttribute("disabled")).toBe("");

    app.dispose();
    container.remove();
  });

  it("removes a boolean attribute when its derivation turns false again", async () => {
    const { container, app } = await resumed();
    const button = container.querySelector("button") as HTMLButtonElement;
    const input = container.querySelector("input") as HTMLInputElement;
    const row = container.firstElementChild as HTMLElement;

    button.dispatchEvent(new Event("click", { bubbles: true }));
    await app.settled();
    expect(button.hasAttribute("disabled")).toBe(true);

    // Back the other way, through the checkbox's own handler: `false` is the
    // attribute's ABSENCE, not the text "false", and the class names go back
    // the way they came.
    input.checked = false;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await app.settled();

    expect(button.hasAttribute("disabled")).toBe(false);
    expect(button.getAttribute("title")).toBe("done: false");
    expect(row.className).toBe("todo pending");

    app.dispose();
    container.remove();
  });
});

describe("comptime — the narrowing still refuses what it always refused", () => {
  it("refuses a class name chosen at runtime, and nothing else about the component", () => {
    const { analysis: computed } = runComptime("test/fixtures/ComputedClassName.tsx", { write: false });
    expect(computed.status).toBe("fallback");
    expect(computed.reasons.map((reason) => reason.code)).toEqual(["jsx-dynamic-attribute"]);
  });

  it("refuses an attribute value with no fixed shape, and nothing else", () => {
    const { analysis: unfoldable } = runComptime("test/fixtures/UnfoldableAttribute.tsx", { write: false });
    expect(unfoldable.status).toBe("fallback");
    expect(unfoldable.reasons.map((reason) => reason.code)).toEqual(["jsx-dynamic-attribute"]);
  });
});
