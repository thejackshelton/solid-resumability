import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { langFromPath, parse, sourceTypeFromPath, walk } from "yuku-parser";
import { print } from "yuku-codegen";
import { Analyzer, SymbolFlags } from "yuku-analyzer";

/**
 * Smoke test for the registry-pinned, zig-backed yuku toolchain — the riskiest
 * dependency of this project. It proves the native bindings load under vitest
 * and that the parser can see the exact constructs the comptime pass (u2)
 * will need to reason about: the two JSX event-handler expressions in
 * Fixture A and the signal they share.
 */

// Vitest runs with cwd at the project root; import.meta.url is not a file: URL
// inside the module runner, so resolve the fixture from the root instead.
const fixturePath = resolve(process.cwd(), "src/fixtures/CounterA.tsx");
const source = readFileSync(fixturePath, "utf8");

function parseFixture() {
  return parse(source, {
    lang: langFromPath(fixturePath),
    sourceType: sourceTypeFromPath(fixturePath),
  });
}

/** Every JSX attribute whose value is an expression container, e.g. onClick={...}. */
function collectJsxExpressionAttributes(program: unknown) {
  const found: Array<{ name: string; expressionType: string; node: any }> = [];

  walk(program as any, {
    JSXAttribute(node: any) {
      if (node.value?.type !== "JSXExpressionContainer") return;
      found.push({
        name: String(node.name?.name),
        expressionType: String(node.value.expression?.type),
        node: node.value.expression,
      });
    },
  });

  return found;
}

function identifiersIn(node: unknown) {
  const names: string[] = [];
  walk(node as any, {
    Identifier(id: any) {
      names.push(id.name);
    },
  });
  return names;
}

describe("yuku toolchain smoke", () => {
  it("parses the Fixture A source without diagnostics", () => {
    const result = parseFixture();

    expect(result.diagnostics).toEqual([]);
    expect(result.program.type).toBe("Program");
    expect(result.program.body.length).toBeGreaterThan(0);
  });

  it("finds exactly the two JSX event-handler expressions", () => {
    const attributes = collectJsxExpressionAttributes(parseFixture().program);
    const handlers = attributes.filter((attr) => /^on[A-Z]/.test(attr.name));

    expect(handlers).toHaveLength(2);
    expect(handlers.map((h) => h.name)).toEqual(["onClick", "onClick"]);

    for (const handler of handlers) {
      expect(handler.expressionType).toBe("ArrowFunctionExpression");
    }
  });

  it("sees both handlers closing over the same signal setter", () => {
    const attributes = collectJsxExpressionAttributes(parseFixture().program);
    const handlers = attributes.filter((attr) => /^on[A-Z]/.test(attr.name));

    // Both handlers read `count` and write through `setCount` — the shared
    // signal the u2 comptime pass must prove is safe to serialize.
    for (const handler of handlers) {
      const names = identifiersIn(handler.node);
      expect(names).toContain("count");
      expect(names).toContain("setCount");
    }
  });

  it("round-trips the fixture back to source through yuku-codegen", () => {
    const printed = print(parseFixture().program as any);

    expect(printed.errors).toEqual([]);
    expect(printed.code).toContain("createSignal");
    expect(printed.code).toContain("onClick");
  });

  /**
   * `yuku-analyzer` is an exact registry pin, and its platform binding
   * (`@yuku-analyzer/binding-darwin-arm64`) is resolved as a real optional
   * dependency by the package manager — no vendored copy, no hand-placed
   * `.node` file. This test is the proof that the published binding loads and
   * that the semantic layer — scopes, symbols, resolved references, closures
   * — actually answers the questions the comptime pass asks of it.
   */
  it("resolves Fixture A's scopes, references and closures via yuku-analyzer", () => {
    const analyzer = new Analyzer();
    const module = analyzer.addFile(fixturePath, source);

    expect(module.diagnostics).toEqual([]);

    // Scope tree: global > module > the component > one per handler arrow.
    expect(module.scopes.map((scope) => scope.kind)).toEqual([
      "global",
      "module",
      "function",
      "function",
      "function",
    ]);

    // Every name in the file binds; nothing leaks to a global.
    expect(module.unresolvedReferences).toEqual([]);

    // The signal accessors are block-scoped bindings of the component itself.
    const count = module.resolve("count", module.scopes[2])!;
    const setCount = module.resolve("setCount", module.scopes[2])!;
    expect(count.has(SymbolFlags.BlockScopedVariable)).toBe(true);
    expect(count.scope.kind).toBe("function");
    expect(setCount.scope).toBe(count.scope);

    // `count` is read three times (the label plus both handlers); `setCount`
    // is called from both handlers.
    expect(count.references).toHaveLength(3);
    expect(setCount.references).toHaveLength(2);

    // Closure analysis: both handlers capture the same two outer bindings.
    const arrows = module.findAll("ArrowFunctionExpression");
    expect(arrows).toHaveLength(2);
    for (const arrow of arrows) {
      const captured = module
        .capturesOf(arrow)
        .map((capture) => capture.symbol)
        .sort((a, b) => a.name.localeCompare(b.name));
      expect(captured.map((symbol) => symbol.name)).toEqual(["count", "setCount"]);
      // Identity, not spelling: the captured symbols are the very bindings
      // declared by the `createSignal` destructuring above.
      expect(captured[0]).toBe(count);
      expect(captured[1]).toBe(setCount);
    }
  });
});
