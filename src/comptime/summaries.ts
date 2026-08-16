/**
 * Interprocedural summaries for provably-pure helpers.
 *
 * Treating every callee outside the component's module as a black box is a
 * POLICY, not a limit: yuku-analyzer resolves `Symbol.definition()` across the
 * linked graph, so a helper's AST, scopes, references and captures are in reach.
 * The rule here is that a summary is produced only for a function whose whole
 * body the pass can already prove — `summarize` returns non-null only when all
 * of these hold.
 *
 *   1. The callee resolves, through import/re-export chains, to a function
 *      DEFINITION inside the analyzed file set (one declaration, with a body).
 *   2. Its parameters are plain identifiers — no defaults, rest or patterns —
 *      so an argument maps to a parameter by position and nothing else.
 *   3. `capturesOf(fn)` is EMPTY, which does most of the safety work: no
 *      capture beyond the parameters, no module-level mutable state, and no
 *      recursion, a self-recursive function capturing its own binding.
 *   4. No unresolved value reference occurs inside it, which is how `console`,
 *      `fetch`, `Math`, `Date` and every other ambient global are refused — a
 *      helper that does IO cannot avoid naming something.
 *   5. Every node is in {@link SUMMARY_SYNTAX} (type-only syntax excepted), so
 *      "no impure statement" is structural rather than pattern-matched.
 *   6. Every call targets one of its own parameters — the SECOND-HOP BAN, which
 *      keeps a summary from being built on another and the trusted subset from
 *      growing transitively.
 *   7. Its body is a single `return <expression>`, so there is exactly one value
 *      to reason about.
 *
 * Anything else returns null and the caller refuses as before. A summary narrows
 * the black box; it never widens the trusted subset by assumption.
 *
 * Memo-callback see-through has a second, narrower body shape — not a
 * widening of {@link PureSummary} — matched by {@link matchGuardedReturn}:
 * exactly one const binding of a call, a `== null` guard that returns a
 * literal, and a terminal call. That matcher does not evaluate anything.
 */

import type { Module, Symbol as YukuSymbol } from "yuku-analyzer";

import { contains, isTransparent, unwrap, type Node } from "./ast.ts";
import { HANDLER_SYNTAX, SUMMARY_SYNTAX, isTypeSyntax } from "./syntax.ts";

/** Modules whose `createSignal` export counts as a Solid source cell. */
const SIGNAL_MODULES = new Set(["solid-js", "@solidjs/signals"]);

/** A provably-pure helper, and the single expression it hands back. */
export interface PureSummary {
  module: Module;
  fn: Node;
  /** Parameter identifier nodes, in declaration order. */
  params: Node[];
  /** The symbol behind each parameter, in the same order. */
  paramSymbols: YukuSymbol[];
  returned: Node;
}

/**
 * A cell-owning helper that returns a callee-local getter. Beside
 * {@link PureSummary}, not a widening of it: PureSummary still refuses any
 * body that allocates a cell, and this kind never claims purity.
 *
 * Produced only when the callee body is this shape:
 *
 *   1. `definition()` resolves to one function body in the analyzed set.
 *   2. Parameters are plain identifiers; the call site must use exact arity.
 *   3. Every signal-factory call is array-destructured to callee-local bindings.
 *   4. Every one-argument call whose callee is a parameter or a local setter
 *      targets only those local setters — a write through a passed setter fails.
 *   5. The returned expression is a callee-local getter.
 *
 * A getter argument is admitted only when every reference to that parameter
 * (nested closures included) is a zero-argument call. That check lives on
 * {@link parameterIsGetterOnly}, at the call site, the way
 * {@link parameterIsAccessorOnly} does for a pure helper.
 */
export interface DerivedAccessorSummary {
  module: Module;
  fn: Node;
  params: Node[];
  paramSymbols: YukuSymbol[];
  /** Symbols of the callee-local getters from destructured factory calls. */
  localGetters: YukuSymbol[];
  /** Symbols of the callee-local setters from destructured factory calls. */
  localSetters: YukuSymbol[];
  /** The callee-local getter the function returns. */
  returnedGetter: YukuSymbol;
}

/** The function node behind a symbol, or null when the symbol is not one. */
function functionOf(mod: Module, symbol: YukuSymbol): Node | null {
  // Declaration merging makes "which declaration" a real question; more than one
  // is refused rather than guessed at.
  if (symbol.declarations.length !== 1) return null;

  const declaration: Node = symbol.declarations[0];
  if (declaration == null) return null;
  if (isFunctionNode(declaration)) return declaration;

  const parent: Node = mod.parentOf(declaration);
  if (parent == null) return null;

  // `function f() {}` — the symbol's declaration node is the name identifier.
  if (isFunctionNode(parent) && parent.id === declaration) return parent;

  // `const f = (a) => …` / `const f = function (a) {}`.
  if (parent.type === "VariableDeclarator" && parent.id === declaration && parent.init != null) {
    const init = unwrap(parent.init);
    return isFunctionNode(init) ? init : null;
  }

  return null;
}

function isFunctionNode(node: Node): boolean {
  return (
    node != null &&
    (node.type === "FunctionDeclaration" ||
      node.type === "FunctionExpression" ||
      node.type === "ArrowFunctionExpression")
  );
}

/** The single expression a function returns, or null if it is not that shape. */
function singleReturn(fn: Node): Node | null {
  if (fn.body == null) return null;
  if (fn.body.type !== "BlockStatement") return unwrap(fn.body);

  const statements: Node[] = fn.body.body ?? [];
  if (statements.length !== 1) return null;
  const [only] = statements;
  if (only.type !== "ReturnStatement" || only.argument == null) return null;
  return unwrap(only.argument);
}

/**
 * Every node under `root` admissible, and every call targeting `calleeWhitelist`
 * — the PARAMETER symbol set, which is what makes the second-hop ban
 * structural: no symbol is callable except one the caller handed in.
 */
function bodyIsAdmissible(
  mod: Module,
  root: Node,
  allowed: ReadonlySet<string>,
  calleeWhitelist: ReadonlySet<number>,
): boolean {
  let ok = true;

  mod.walk(
    {
      enter: (node: Node) => {
        if (!ok || isTypeSyntax(node.type)) return;
        if (!allowed.has(node.type)) ok = false;
      },
      CallExpression: (node: Node) => {
        if (!ok) return;
        const callee = unwrap(node.callee);
        if (callee.type !== "Identifier") {
          ok = false;
          return;
        }
        const symbol = mod.referenceOf(callee)?.symbol ?? null;
        if (symbol === null || !calleeWhitelist.has(symbol.id)) ok = false;
      },
    },
    root,
  );

  return ok;
}

/** True when a value reference inside `fn` resolves to no binding at all. */
function namesAGlobal(mod: Module, fn: Node): boolean {
  return mod.unresolvedReferences.some(
    (reference) => !reference.inTypePosition && contains(fn, reference.node),
  );
}

/**
 * Summarizes the helper a callee expression resolves to, or null. `moduleInfo`
 * is the CALLING module; the summary may belong to another one.
 */
export function summarize(moduleInfo: Module, rawCallee: Node): PureSummary | null {
  const callee = unwrap(rawCallee);
  if (callee == null || callee.type !== "Identifier") return null;

  const symbol = moduleInfo.referenceOf(callee)?.symbol ?? null;
  if (symbol === null) return null;

  // Follows import -> export -> re-export chains; null when the chain leaves the
  // analyzed set, which is what happens for `solid-js`. The framework stays an
  // opaque boundary, exactly as a real build sees it.
  const definition = symbol.definition();
  if (definition == null || definition.symbol == null) return null;

  const mod = definition.module;
  const fn = functionOf(mod, definition.symbol);
  if (fn === null || fn.body == null) return null;

  const params: Node[] = fn.params ?? [];
  if (!params.every((param: Node) => param != null && param.type === "Identifier")) return null;

  const paramSymbols: YukuSymbol[] = [];
  for (const param of params) {
    const paramSymbol = mod.symbolOf(param);
    if (paramSymbol === null) return null;
    paramSymbols.push(paramSymbol);
  }

  // (3) No capture at all: no outer state, no module-level mutable registry,
  // and no recursion — a self-call captures the helper's own binding.
  if (mod.capturesOf(fn).length > 0) return null;

  // (4) No ambient global: every IO reach names something unresolvable.
  if (namesAGlobal(mod, fn)) return null;

  // (5) + (6) Structural purity, and the second-hop ban.
  const parameterIds = new Set(paramSymbols.map((paramSymbol) => paramSymbol.id));
  if (!bodyIsAdmissible(mod, fn, SUMMARY_SYNTAX, parameterIds)) return null;

  // (7) One value to reason about.
  const returned = singleReturn(fn);
  if (returned === null) return null;

  return { module: mod, fn, params, paramSymbols, returned };
}

/** Every use of parameter `index` is the accessor shape its caller-side binding
 * allows: `p()` for a getter, `p(x)` for a setter — `classify.ts`'s escape rule.
 * A helper that merely CALLS it correctly is not an escape; one that stores,
 * returns, compares or mis-arities it is. */
export function parameterIsAccessorOnly(
  summary: PureSummary,
  index: number,
  access: "read" | "write",
): boolean {
  const symbol = summary.paramSymbols[index];
  if (symbol === undefined) return false;

  const arity = access === "read" ? 0 : 1;
  return symbol.references.every((reference) => {
    if (reference.inTypePosition) return true;
    const parent: Node = summary.module.parentOf(reference.node);
    return (
      parent != null &&
      parent.type === "CallExpression" &&
      parent.callee === reference.node &&
      parent.arguments.length === arity
    );
  });
}

/** The closure a factory hands back, admitted as a handler only if it also stays
 * inside the HANDLER whitelist — one node narrower than the summary whitelist,
 * so a factory-reached handler clears the same bar as an inline one. */
export function returnedClosure(summary: PureSummary): Node | null {
  const closure = summary.returned;
  if (closure.type !== "ArrowFunctionExpression" && closure.type !== "FunctionExpression") return null;

  const parameterIds = new Set(summary.paramSymbols.map((symbol) => symbol.id));
  if (!bodyIsAdmissible(summary.module, closure, HANDLER_SYNTAX, parameterIds)) return null;

  return closure;
}

/** The index of the parameter a symbol is, or -1. */
export function parameterIndexOf(summary: PureSummary, symbol: YukuSymbol): number {
  return summary.paramSymbols.findIndex((candidate) => candidate.id === symbol.id);
}

/** The function a callee identifier resolves to, or null. Shared by both
 * summary kinds so "one body in the analyzed set" is one walk. */
function resolveCalleeFunction(
  moduleInfo: Module,
  rawCallee: Node,
): { module: Module; fn: Node; params: Node[]; paramSymbols: YukuSymbol[] } | null {
  const callee = unwrap(rawCallee);
  if (callee == null || callee.type !== "Identifier") return null;

  const symbol = moduleInfo.referenceOf(callee)?.symbol ?? null;
  if (symbol === null) return null;

  const definition = symbol.definition();
  if (definition == null || definition.symbol == null) return null;

  const mod = definition.module;
  const fn = functionOf(mod, definition.symbol);
  if (fn === null || fn.body == null) return null;

  const params: Node[] = fn.params ?? [];
  if (!params.every((param: Node) => param != null && param.type === "Identifier")) return null;

  const paramSymbols: YukuSymbol[] = [];
  for (const param of params) {
    const paramSymbol = mod.symbolOf(param);
    if (paramSymbol === null) return null;
    paramSymbols.push(paramSymbol);
  }

  return { module: mod, fn, params, paramSymbols };
}

function signalFactorySymbols(mod: Module): Set<number> {
  const ids = new Set<number>();
  for (const record of mod.imports) {
    if (record.typeOnly || record.local === null) continue;
    if (!SIGNAL_MODULES.has(record.specifier)) continue;
    if (record.name === "createSignal") ids.add(record.local.id);
  }
  return ids;
}

function isFactoryCall(mod: Module, call: Node, factories: Set<number>): boolean {
  const callee = unwrap(call.callee);
  if (callee.type !== "Identifier") return false;
  const symbol = mod.referenceOf(callee)?.symbol ?? null;
  return symbol !== null && factories.has(symbol.id);
}

/** The getter/setter pair a factory call is array-destructured into, or null. */
function factoryBinding(
  mod: Module,
  call: Node,
): { getter: YukuSymbol; setter: YukuSymbol } | null {
  let node: Node = call;
  let parent: Node = mod.parentOf(node);
  while (parent != null && isTransparent(parent)) {
    node = parent;
    parent = mod.parentOf(node);
  }
  if (parent == null || parent.type !== "VariableDeclarator" || parent.init !== node) return null;

  const pattern = parent.id;
  if (
    pattern.type !== "ArrayPattern" ||
    pattern.elements.length !== 2 ||
    !pattern.elements.every((el: Node) => el != null && el.type === "Identifier")
  ) {
    return null;
  }

  const getter = mod.symbolOf(pattern.elements[0]);
  const setter = mod.symbolOf(pattern.elements[1]);
  if (getter === null || setter === null) return null;
  return { getter, setter };
}

/** The single top-level returned expression, or null when the body is not
 * that shape. Nested functions' returns are ignored. */
function topLevelReturned(fn: Node): Node | null {
  if (fn.body == null) return null;
  if (fn.body.type !== "BlockStatement") return unwrap(fn.body);

  const returns = (fn.body.body as Node[]).filter((statement: Node) => statement.type === "ReturnStatement");
  if (returns.length !== 1 || returns[0].argument == null) return null;
  return unwrap(returns[0].argument);
}

function isZeroArgCall(parent: Node, callee: Node): boolean {
  return (
    parent != null &&
    (parent.type === "CallExpression" || parent.type === "OptionalCallExpression") &&
    parent.callee === callee &&
    parent.arguments.length === 0
  );
}

/**
 * Summarizes a cell-owning helper that returns its own getter, or null.
 * Does not consult {@link PureSummary} clauses — a body that allocates a
 * cell is refused there on purpose.
 */
export function summarizeDerivedAccessor(
  moduleInfo: Module,
  rawCallee: Node,
): DerivedAccessorSummary | null {
  const resolved = resolveCalleeFunction(moduleInfo, rawCallee);
  if (resolved === null) return null;

  const { module: mod, fn, params, paramSymbols } = resolved;
  const factories = signalFactorySymbols(mod);
  const localGetters: YukuSymbol[] = [];
  const localSetters: YukuSymbol[] = [];
  const getterIds = new Set<number>();
  const setterIds = new Set<number>();

  for (const call of mod.findAll("CallExpression")) {
    if (!contains(fn, call) || !isFactoryCall(mod, call, factories)) continue;
    const binding = factoryBinding(mod, call);
    if (binding === null) return null;
    localGetters.push(binding.getter);
    localSetters.push(binding.setter);
    getterIds.add(binding.getter.id);
    setterIds.add(binding.setter.id);
  }

  if (localGetters.length === 0) return null;

  const paramIds = new Set(paramSymbols.map((paramSymbol) => paramSymbol.id));
  let writesOk = true;
  mod.walk(
    {
      CallExpression: (node: Node) => {
        if (!writesOk || node.arguments.length !== 1) return;
        const callee = unwrap(node.callee);
        if (callee.type !== "Identifier") return;
        const symbol = mod.referenceOf(callee)?.symbol ?? null;
        if (symbol === null) return;
        if (paramIds.has(symbol.id)) writesOk = false;
        else if (setterIds.has(symbol.id)) return;
      },
    },
    fn,
  );
  if (!writesOk) return null;

  const returned = topLevelReturned(fn);
  if (returned == null || returned.type !== "Identifier") return null;
  const returnedSymbol = mod.referenceOf(returned)?.symbol ?? null;
  if (returnedSymbol === null || !getterIds.has(returnedSymbol.id)) return null;

  return {
    module: mod,
    fn,
    params,
    paramSymbols,
    localGetters,
    localSetters,
    returnedGetter: returnedSymbol,
  };
}

/** Every use of parameter `index` is a zero-argument call — the getter
 * shape, including optional calls, including uses inside nested closures. */
export function parameterIsGetterOnly(summary: DerivedAccessorSummary, index: number): boolean {
  const symbol = summary.paramSymbols[index];
  if (symbol === undefined) return false;

  return symbol.references.every((reference) => {
    if (reference.inTypePosition) return true;
    return isZeroArgCall(summary.module.parentOf(reference.node), reference.node);
  });
}

/**
 * The admitted memo-callback guarded-return shape, or a near-miss.
 *
 * Exact body:
 *   const x = <call>();
 *   if (x == null) return <literal>;
 *   return <call>(...);
 *
 * `kind: "wider"` is a body that starts with that const-call binding and
 * contains an `x == null` guard, but is not the exact three-statement form.
 * `null` means the body is not in this family at all.
 */
export type GuardedReturnMatch =
  | { kind: "exact"; local: Node; call: Node; guardLiteral: Node; terminal: Node }
  | { kind: "wider" };

function localCallBinding(statement: Node): { local: Node; call: Node } | null {
  if (statement == null || statement.type !== "VariableDeclaration") return null;
  if (statement.kind !== "const") return null;
  const declarations: Node[] = statement.declarations ?? [];
  if (declarations.length !== 1) return null;
  const declarator = declarations[0];
  if (declarator == null || declarator.id == null || declarator.id.type !== "Identifier") return null;
  const init = unwrap(declarator.init);
  if (init == null || init.type !== "CallExpression") return null;
  return { local: declarator.id, call: init };
}

function sameLocal(mod: Module, declaration: Node, reference: Node): boolean {
  const declared = mod.symbolOf(declaration);
  const used = mod.referenceOf(reference)?.symbol ?? null;
  return declared !== null && used !== null && declared.id === used.id;
}

function isNullGuardTest(mod: Module, test: Node, local: Node): boolean {
  const expression = unwrap(test);
  if (expression == null || expression.type !== "BinaryExpression" || expression.operator !== "==") {
    return false;
  }
  const left = unwrap(expression.left);
  const right = unwrap(expression.right);
  if (left == null || right == null) return false;
  return (
    left.type === "Identifier" &&
    sameLocal(mod, local, left) &&
    right.type === "Literal" &&
    right.value === null
  );
}

function isStaticLiteral(node: Node): boolean {
  if (node == null || node.type !== "Literal") return false;
  const value = node.value;
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function returnedArgumentOf(consequent: Node): Node | null {
  const node = unwrap(consequent);
  if (node == null) return null;
  if (node.type === "ReturnStatement") {
    return node.argument == null ? null : unwrap(node.argument);
  }
  if (node.type !== "BlockStatement") return null;
  const statements: Node[] = node.body ?? [];
  if (statements.length !== 1 || statements[0].type !== "ReturnStatement") return null;
  return statements[0].argument == null ? null : unwrap(statements[0].argument);
}

/** Matches a function body against the guarded-return grammar. */
export function matchGuardedReturn(mod: Module, fn: Node): GuardedReturnMatch | null {
  if (fn == null || fn.body == null || fn.body.type !== "BlockStatement") return null;
  const statements: Node[] = fn.body.body ?? [];
  if (statements.length === 0) return null;

  const binding = localCallBinding(statements[0]);
  if (binding === null) return null;
  const hasNullGuard = statements.some(
    (statement: Node) =>
      statement != null &&
      statement.type === "IfStatement" &&
      isNullGuardTest(mod, statement.test, binding.local),
  );
  if (!hasNullGuard) return null;

  if (statements.length !== 3) return { kind: "wider" };
  const ifStatement = statements[1];
  const returnStatement = statements[2];
  if (ifStatement == null || ifStatement.type !== "IfStatement") return { kind: "wider" };
  if (ifStatement.alternate != null) return { kind: "wider" };
  if (!isNullGuardTest(mod, ifStatement.test, binding.local)) return { kind: "wider" };
  const guardLiteral = returnedArgumentOf(ifStatement.consequent);
  if (!isStaticLiteral(guardLiteral)) return { kind: "wider" };
  if (returnStatement == null || returnStatement.type !== "ReturnStatement" || returnStatement.argument == null) {
    return { kind: "wider" };
  }
  const terminal = unwrap(returnStatement.argument);
  if (terminal == null || terminal.type !== "CallExpression") return { kind: "wider" };

  return {
    kind: "exact",
    local: binding.local,
    call: binding.call,
    guardLiteral,
    terminal,
  };
}
