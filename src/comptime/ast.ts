/**
 * Small AST utilities shared by the classifier and the emitter.
 *
 * Nodes are ESTree/TS-ESTree objects handed out by yuku-analyzer; they are
 * typed as `any` here because the pass only ever touches a hand-checked
 * whitelist of shapes and gains nothing from restating the toolchain's types.
 */

import { generate } from "yuku-codegen";
import type { Program } from "yuku-parser";

import type { SourceLoc, StaticValue } from "./types.ts";

export type Node = any;

/** Wrappers that carry no runtime meaning for this analysis. */
const TRANSPARENT = new Set([
  "ParenthesizedExpression",
  "TSAsExpression",
  "TSSatisfiesExpression",
  "TSNonNullExpression",
  "TSTypeAssertion",
  "TSInstantiationExpression",
]);

/** Strips parens and TS-only expression wrappers to reach the real expression. */
export function unwrap(node: Node): Node {
  let current = node;
  while (current != null && TRANSPARENT.has(current.type)) {
    current = current.expression;
  }
  return current;
}

export function isTransparent(node: Node): boolean {
  return node != null && TRANSPARENT.has(node.type);
}

/** Builds a byte-offset -> line/column mapper for one source text. */
export function makeLocator(source: string): (node: Node) => SourceLoc {
  const lineStarts = [0];
  for (let i = 0; i < source.length; i++) {
    if (source.charCodeAt(i) === 10) lineStarts.push(i + 1);
  }

  return (node: Node): SourceLoc => {
    const start = node?.start ?? 0;
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (lineStarts[mid] <= start) low = mid;
      else high = mid - 1;
    }
    return {
      start,
      end: node?.end ?? 0,
      line: low + 1,
      column: start - lineStarts[low] + 1,
    };
  };
}

/** True when `outer`'s byte span encloses `inner`'s. */
export function contains(outer: Node, inner: Node): boolean {
  return outer.start <= inner.start && inner.end <= outer.end;
}

/**
 * Prints one expression subtree back to source through yuku-codegen.
 *
 * The node is borrowed from the analyzed AST and wrapped in a throwaway
 * Program, so what comes back is byte-for-byte the author's own expression
 * (modulo the printer's formatting) rather than something this pass invented.
 * `strip: true` is set because artifacts are plain JS.
 */
export function printExpression(node: Node): string {
  const program: Program = {
    type: "Program",
    start: 0,
    end: 0,
    sourceType: "module",
    hashbang: null,
    body: [{ type: "ExpressionStatement", start: 0, end: 0, expression: node, directive: null }],
  };

  const result = generate(program, {
    strip: true,
    format: "pretty",
    quotes: "double",
    comments: false,
  });
  if (result.errors.length > 0) {
    throw new Error(`yuku-codegen failed: ${result.errors.map((e) => e.message).join("; ")}`);
  }

  // The wrapper turns the expression into a statement; drop the terminator.
  return result.code.trim().replace(/;$/, "");
}

/** A literal the pass is willing to freeze into an artifact. */
export function literalValue(node: Node): { ok: true; value: StaticValue } | { ok: false } {
  if (node == null) return { ok: true, value: null };
  const inner = unwrap(node);
  if (inner.type !== "Literal") return { ok: false };
  const value = inner.value;
  if (value === null) return { ok: true, value: null };
  const kind = typeof value;
  if (kind === "string" || kind === "number" || kind === "boolean") {
    return { ok: true, value: value as StaticValue };
  }
  // RegExp and bigint literals carry runtime identity; refuse them.
  return { ok: false };
}
