/**
 * Component discovery answers the question the coverage metric needs — every
 * MODULE-SCOPE JSX-returning function, exported or not, several per file
 * allowed — rather than "which exported function returns JSX".
 *
 * Module-scope means a NAMED BINDING declared directly in the module body:
 * `function Foo()`, `export function Foo()`, `const Foo = () => <div/>`,
 * `export default function Foo()` and its anonymous form (named `default`).
 * An anonymous function EXPRESSION at module scope is not a component:
 * `render(() => <App />, root)` returns JSX from a module-scope arrow, but it is
 * an argument, and counting it would inflate the denominator with call-site
 * callbacks. The discriminator is the binding, not the lexical position.
 *
 * Returning JSX means a concise arrow body that is JSX, a top-level `return` of
 * JSX in a block body, or either returning an ARRAY containing JSX. A Solid
 * component may return `[<a/>, <b/>]`; the classifier refuses that shape with
 * `jsx-root-not-element`, but it must be discovered before it can be refused,
 * and a component discovery cannot see is one silently missing from the
 * denominator. Widening here can only add refused components, never provable
 * ones.
 *
 * Not widened: JSX returned only from a nested block (inside an `if`, a loop, a
 * `try`). Nothing in the corpus does it, so the choice is unobservable in the
 * baseline and guessing would invent a rule the evidence cannot check.
 */

import type { Module } from "yuku-analyzer";

import { unwrap, type Node } from "./ast.ts";

export interface ComponentSite {
  /** The binding name, or `default` for an anonymous default export. */
  name: string;
  /** The function node itself. */
  fn: Node;
  /** The expression the function hands back (a JSX node, or its wrapper). */
  returnArgument: Node;
  /** True when the binding is part of this module's export surface. */
  exported: boolean;
}

/** True for a JSX node, or for an array literal holding at least one. */
function isMarkup(value: Node): boolean {
  if (value == null) return false;
  if (value.type.startsWith("JSX")) return true;
  if (value.type !== "ArrayExpression") return false;
  return (value.elements as Node[]).some(
    (element: Node) => element != null && unwrap(element)?.type?.startsWith("JSX") === true,
  );
}

/** The JSX a function hands back, if it hands back JSX. */
export function returnedJsx(fn: Node): Node | null {
  if (fn.body != null && fn.body.type !== "BlockStatement") {
    return isMarkup(unwrap(fn.body)) ? fn.body : null;
  }

  for (const statement of fn.body?.body ?? []) {
    if (statement.type !== "ReturnStatement" || statement.argument == null) continue;
    if (isMarkup(unwrap(statement.argument))) return statement.argument;
  }
  return null;
}

function isFunction(node: Node): boolean {
  return (
    node != null &&
    (node.type === "FunctionDeclaration" ||
      node.type === "FunctionExpression" ||
      node.type === "ArrowFunctionExpression")
  );
}

/** Symbol ids backing this module's export surface. */
function exportedSymbolIds(moduleInfo: Module): Set<number> {
  const ids = new Set<number>();
  for (const record of moduleInfo.exports) {
    if (record.typeOnly || record.local === null) continue;
    ids.add(record.local.id);
  }
  return ids;
}

/**
 * Every module-scope JSX-returning function, in source order — which is what
 * makes the coverage report stable across runs without a tie-prone second key.
 */
export function findComponents(moduleInfo: Module): ComponentSite[] {
  const exported = exportedSymbolIds(moduleInfo);
  const sites: ComponentSite[] = [];

  const isExported = (nameNode: Node, fallback: boolean): boolean => {
    if (nameNode == null) return fallback;
    const symbol = moduleInfo.symbolOf(nameNode);
    return symbol === null ? fallback : exported.has(symbol.id);
  };

  const consider = (fn: Node, name: string, nameNode: Node, exportedByForm: boolean): void => {
    if (!isFunction(fn)) return;
    const returned = returnedJsx(fn);
    if (returned === null) return;
    sites.push({ name, fn, returnArgument: returned, exported: isExported(nameNode, exportedByForm) });
  };

  for (const statement of moduleInfo.ast.body as Node[]) {
    let node: Node = statement;
    let exportedByForm = false;

    if (node.type === "ExportNamedDeclaration") {
      if (node.declaration == null) continue;
      node = node.declaration;
      exportedByForm = true;
    } else if (node.type === "ExportDefaultDeclaration") {
      node = node.declaration;
      exportedByForm = true;
    }

    if (node == null) continue;

    if (node.type === "FunctionDeclaration") {
      consider(node, node.id?.name ?? "default", node.id ?? null, exportedByForm);
      continue;
    }

    // `export default () => <div/>` — a function with no binding of its own.
    if (exportedByForm && isFunction(node)) {
      consider(node, node.id?.name ?? "default", node.id ?? null, true);
      continue;
    }

    if (node.type === "VariableDeclaration") {
      for (const declarator of node.declarations as Node[]) {
        if (declarator.id?.type !== "Identifier" || declarator.init == null) continue;
        consider(unwrap(declarator.init), declarator.id.name, declarator.id, exportedByForm);
      }
    }
  }

  return sites;
}

/**
 * One component by name, or the first in the module. `classify(module)` on a
 * one-component file returns that component; `classify(module, "Header")`
 * reaches a module-local component an export-only walk cannot see.
 */
export function findComponent(moduleInfo: Module, wanted?: string): ComponentSite | null {
  const sites = findComponents(moduleInfo);
  if (wanted === undefined) return sites[0] ?? null;
  return sites.find((site) => site.name === wanted) ?? null;
}
