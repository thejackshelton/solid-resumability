/**
 * The store model (S3): context-provided stores, and the actions a component
 * destructures out of one.
 *
 * Nothing about the store's VALUE is claimed. A `createOptimisticStore`
 * projection, its optimistic overlay, the generator bodies behind each action
 * and every read of the store's data stay outside this module, refused or
 * runtime-opaque. The claim is narrower and purely structural: this local
 * binding is slot `p` of the value THIS provider supplies for THIS context, and
 * the slot is fixed at build time. That is an identity, not a value; the
 * artifacts carry a store id plus a fixed slot path, and extracted handler code
 * calls the binding by the name it already had. No action body is ever read,
 * summarized, inlined or emitted, so the trusted subset grows by one fact per
 * binding — where the action lives, never what it does.
 *
 * Admission needs all five clauses; anything else is
 * `store-binding-not-provable` with a `reason` detail naming the clause.
 *
 *   1. CONTEXT IDENTITY. The argument of `useContext(X)` resolves, through
 *      `Symbol.definition()` and so through import/re-export chains, to a
 *      module-scope binding initialized by a `createContext(...)` whose callee
 *      is imported from a Solid module.
 *   2. FIXED-SLOT DESTRUCTURING. The result is destructured immediately into an
 *      array pattern whose action slot is an object pattern of plain,
 *      non-computed, non-defaulted identifiers. `const ctx = useContext(X)`,
 *      `const [, actions] = …`, `const [, { a = f }] = …` and a rest element
 *      all fail: none names a FIXED slot.
 *   3. FIXED-SLOT READ. The read slot may be a hole, or a plain identifier at a
 *      fixed numeric index. Binding it admits an IDENTITY — this local name is
 *      slot `r` of that same provider's value — and nothing else: the value is
 *      an async projection under an optimistic overlay with no honest
 *      build-time initial, so no read is ever folded and a bound read's text is
 *      measured out of the page's capture instead. An alias (`const ctx =
 *      …; const state = ctx[0]`), a nested or defaulted pattern and a rest
 *      element all fail — none names a fixed slot. Writing through the binding
 *      is not a read and is refused by `classify.ts`, which admits a read
 *      binding only where it itself derived the use.
 *   4. PROVIDER VISIBILITY. Exactly one provider element for that context is
 *      found INSIDE the analyzed file set — the module declaring the context,
 *      or a direct dependent. No whole-program flow: a provider in a file the
 *      analyzer was never given means refusal, the conservative answer.
 *   5. READABLE SLOT SHAPE. The provider's `value` is a call to a function in
 *      the analyzed set whose single `return` hands back an array literal whose
 *      action slot is an object literal with static keys and no spread, never
 *      reassigned. Only the SHAPE is read — nothing is evaluated and no
 *      property's value is inspected beyond being present.
 *
 * `classify.ts` then audits every use of an admitted action binding and refuses
 * anything but a call or an event prop: an action handed anywhere else has left
 * the identity behind, which is the only thing proven here.
 */

import type { Module, Symbol as YukuSymbol } from "yuku-analyzer";

import { contains, makeLocator, unwrap, type Node } from "./ast.ts";
import type { ActionInfo, SourceLoc, StoreInfo, StoreReadInfo } from "./types.ts";

/** Modules whose `createContext` / `useContext` exports count as Solid's. */
const CONTEXT_MODULES = new Set(["solid-js", "@solidjs/signals", "@solidjs/web"]);

/** JSX prop names that carry an event listener rather than an attribute. Solid's
 * own convention, and the same expression `classify.ts` reads them with. */
const EVENT_PROP = /^on([A-Z][A-Za-z0-9]*)$/;

/**
 * True when this occurrence of a binding IS an event prop's value:
 * `onClick={clearCompleted}`.
 *
 * Not an escape, for the same reason a call site is not one. The framework is
 * handed the action itself and calls it with the event — so what reaches that
 * position is the identity this module proved, unchanged and unwrapped, and the
 * artifact can name it with the same fixed slot path a dispatch would use.
 */
function isEventPropValue(m: Module, node: Node): boolean {
  const container: Node = m.parentOf(node);
  if (container == null || container.type !== "JSXExpressionContainer") return false;

  const attribute: Node = m.parentOf(container);
  return (
    attribute != null &&
    attribute.type === "JSXAttribute" &&
    attribute.value === container &&
    attribute.name?.type === "JSXIdentifier" &&
    EVENT_PROP.test(attribute.name.name)
  );
}

/** Why a recognized store binding could not be admitted. */
export type StoreRefusal =
  | "context-not-createContext"
  | "result-not-destructured"
  | "store-read-path-not-fixed"
  | "actions-slot-not-fixed"
  | "provider-not-visible"
  | "provider-value-not-readable"
  | "action-slot-missing"
  | "action-escapes";

export interface StoreBinding {
  store: StoreInfo;
  actions: ActionInfo[];
  /** The store's data, where the component bound it at a fixed slot. */
  reads: StoreReadInfo[];
  /** Symbol id of each destructured action binding -> what it stands for. */
  actionSymbols: Map<number, ActionInfo>;
  /** The destructured read binding: its symbol, the name node that declared it,
   * and what it stands for. `classify.ts` needs all three — the symbol to audit
   * every use, the node to tell the declaration apart from a use. */
  readSites: Array<{ symbol: YukuSymbol; node: Node; read: StoreReadInfo }>;
}

export type StoreOutcome =
  | { kind: "admitted"; binding: StoreBinding }
  | { kind: "refused"; reason: StoreRefusal; message: string; node: Node };

/** Symbol ids of a named import taken from one of Solid's modules. */
function solidImportIds(m: Module, name: string): Set<number> {
  const ids = new Set<number>();
  for (const record of m.imports) {
    if (record.typeOnly || record.local === null) continue;
    if (!CONTEXT_MODULES.has(record.specifier)) continue;
    if (record.name === name) ids.add(record.local.id);
  }
  return ids;
}

/** True when `call` is `useContext(...)` against this module's import of it. */
function isUseContextCall(m: Module, call: Node, ids: Set<number>): boolean {
  const callee = unwrap(call.callee);
  if (callee == null || callee.type !== "Identifier") return false;
  const symbol = m.referenceOf(callee)?.symbol ?? null;
  return symbol !== null && ids.has(symbol.id);
}

/** Every `useContext(...)` call inside a component, in source order. */
export function useContextCalls(m: Module, fn: Node): Node[] {
  const ids = solidImportIds(m, "useContext");
  if (ids.size === 0) return [];
  return m
    .findAll("CallExpression")
    .filter((call: Node) => contains(fn, call) && isUseContextCall(m, call, ids));
}

/** The `createContext()` definition a context argument names, or null. */
function contextDefinitionOf(
  m: Module,
  argument: Node,
): { module: Module; symbol: YukuSymbol; call: Node } | null {
  const identifier = unwrap(argument);
  if (identifier == null || identifier.type !== "Identifier") return null;

  const symbol = m.referenceOf(identifier)?.symbol ?? null;
  if (symbol === null) return null;

  const definition = symbol.definition();
  if (definition == null || definition.symbol == null) return null;

  const mod = definition.module;
  const target = definition.symbol;
  if (target.declarations.length !== 1) return null;

  const declaration: Node = target.declarations[0];
  const declarator: Node = mod.parentOf(declaration);
  if (declarator == null || declarator.type !== "VariableDeclarator") return null;
  if (declarator.id !== declaration || declaration.type !== "Identifier") return null;

  const init = declarator.init == null ? null : unwrap(declarator.init);
  if (init == null || init.type !== "CallExpression") return null;

  const callee = unwrap(init.callee);
  if (callee == null || callee.type !== "Identifier") return null;
  const calleeSymbol = mod.referenceOf(callee)?.symbol ?? null;
  if (calleeSymbol === null) return null;
  if (!solidImportIds(mod, "createContext").has(calleeSymbol.id)) return null;

  // A context whose binding is reassigned has no single identity to name.
  if (target.references.some((reference) => reference.isWrite)) return null;

  return { module: mod, symbol: target, call: init };
}

/**
 * Every provider element for a context. The search space is the declaring module
 * plus its direct dependents — the only modules that can name the binding,
 * since a context reaches a provider by being imported. Deliberately not
 * whole-program flow: it asks which given files mention this exact symbol, and
 * a provider outside that set is not found.
 */
function providersOf(
  contextModule: Module,
  contextSymbol: YukuSymbol,
): Array<{ module: Module; element: Node; value: Node }> {
  const found: Array<{ module: Module; element: Node; value: Node }> = [];
  const searched = new Set<Module>([contextModule, ...contextModule.dependents]);

  for (const mod of searched) {
    for (const element of mod.findAll("JSXElement")) {
      const name = element.openingElement?.name;
      if (name == null || name.type !== "JSXIdentifier") continue;

      const symbol = mod.referenceOf(name)?.symbol ?? null;
      if (symbol === null) continue;
      const definition = symbol.definition();
      if (definition?.symbol == null) continue;
      if (definition.module !== contextModule || definition.symbol.id !== contextSymbol.id) continue;

      const attribute = (element.openingElement.attributes as Node[]).find(
        (candidate: Node) =>
          candidate?.type === "JSXAttribute" &&
          candidate.name?.type === "JSXIdentifier" &&
          candidate.name.name === "value",
      );
      if (attribute == null || attribute.value?.type !== "JSXExpressionContainer") continue;

      const value = unwrap(attribute.value.expression);
      if (value == null) continue;
      found.push({ module: mod, element, value });
    }
  }

  return found;
}

/** The function a symbol names, or null. */
function functionOf(mod: Module, symbol: YukuSymbol): Node | null {
  if (symbol.declarations.length !== 1) return null;
  const declaration: Node = symbol.declarations[0];
  if (declaration == null) return null;

  const isFn = (node: Node): boolean =>
    node != null &&
    (node.type === "FunctionDeclaration" ||
      node.type === "FunctionExpression" ||
      node.type === "ArrowFunctionExpression");

  if (isFn(declaration)) return declaration;
  const parent: Node = mod.parentOf(declaration);
  if (parent == null) return null;
  if (isFn(parent) && parent.id === declaration) return parent;
  if (parent.type === "VariableDeclarator" && parent.id === declaration && parent.init != null) {
    const init = unwrap(parent.init);
    return isFn(init) ? init : null;
  }
  return null;
}

/** The single top-level `return` expression of a function body, or null. */
function singleReturn(fn: Node): Node | null {
  if (fn.body == null) return null;
  if (fn.body.type !== "BlockStatement") return unwrap(fn.body);

  const returns = (fn.body.body as Node[]).filter((statement: Node) => statement.type === "ReturnStatement");
  if (returns.length !== 1 || returns[0].argument == null) return null;
  return unwrap(returns[0].argument);
}

/** The static keys of an object literal, or null when any of them is not static. */
function staticKeys(object: Node): Set<string> | null {
  const keys = new Set<string>();
  for (const property of object.properties as Node[]) {
    if (property == null || property.type !== "Property") return null;
    if (property.computed === true) return null;
    const key = property.key;
    if (key?.type === "Identifier") keys.add(key.name);
    else if (key?.type === "Literal" && typeof key.value === "string") keys.add(key.value);
    else return null;
  }
  return keys;
}

/**
 * The fixed slot names the provider's value exposes at `slot`. Only the SHAPE of
 * the returned tuple is read — which slot holds which named properties. Nothing
 * is evaluated and the factory's body is otherwise untouched.
 */
function slotShapeOf(
  mod: Module,
  value: Node,
  slot: number,
): { module: string; factory: string; names: Set<string>; arity: number } | null {
  if (value.type !== "CallExpression") return null;
  const callee = unwrap(value.callee);
  if (callee == null || callee.type !== "Identifier") return null;

  const symbol = mod.referenceOf(callee)?.symbol ?? null;
  if (symbol === null) return null;
  const definition = symbol.definition();
  if (definition == null || definition.symbol == null) return null;

  const factoryModule = definition.module;
  const fn = functionOf(factoryModule, definition.symbol);
  if (fn === null) return null;

  const returned = singleReturn(fn);
  if (returned == null || returned.type !== "ArrayExpression") return null;

  const element = returned.elements[slot] == null ? null : unwrap(returned.elements[slot]);
  if (element == null) return null;

  let object: Node = element;
  if (element.type === "Identifier") {
    const bound = factoryModule.referenceOf(element)?.symbol ?? null;
    if (bound === null || bound.declarations.length !== 1) return null;
    // A rebound actions object has no single shape.
    if (bound.references.some((reference) => reference.isWrite)) return null;

    const declaration: Node = bound.declarations[0];
    const declarator: Node = factoryModule.parentOf(declaration);
    if (declarator == null || declarator.type !== "VariableDeclarator") return null;
    if (declarator.id !== declaration || declarator.init == null) return null;
    object = unwrap(declarator.init);
  }

  if (object == null || object.type !== "ObjectExpression") return null;

  const names = staticKeys(object);
  if (names === null) return null;

  // `arity` is how many slots the returned tuple literally has: a read slot is
  // fixed only if the value it indexes exists in that literal.
  return { module: factoryModule.path, factory: callee.name, names, arity: returned.elements.length };
}

/** The `{ a, b }` slot of an array pattern, as (key, local symbol) pairs. */
function destructuredActions(
  m: Module,
  pattern: Node,
): Array<{ key: string; symbol: YukuSymbol; node: Node }> | null {
  const out: Array<{ key: string; symbol: YukuSymbol; node: Node }> = [];
  for (const property of pattern.properties as Node[]) {
    if (property == null || property.type !== "Property") return null;
    if (property.computed === true) return null;
    if (property.key?.type !== "Identifier") return null;
    const value = property.value;
    // A default (`AssignmentPattern`) means the slot may not exist; a nested
    // pattern means the binding is not the slot itself.
    if (value?.type !== "Identifier") return null;
    const symbol = m.symbolOf(value);
    if (symbol === null) return null;
    out.push({ key: property.key.name, symbol, node: value });
  }
  return out;
}

/**
 * Classifies the one store binding a component declares. `storeId` is the id to
 * mint; `locOf` reports locations in the COMPONENT's module. A refusal comes
 * back rather than null, because a `useContext` call reaching here is a store
 * source the component genuinely declares and silence would leave it sourceless.
 */
export function classifyStoreBinding(
  m: Module,
  call: Node,
  storeId: string,
  locOf: (node: Node) => SourceLoc,
): StoreOutcome {
  const refuse = (reason: StoreRefusal, message: string, node: Node): StoreOutcome => ({
    kind: "refused",
    reason,
    message,
    node,
  });

  if (call.arguments.length !== 1) {
    return refuse(
      "context-not-createContext",
      `useContext takes exactly one context argument in a provable component; got ${call.arguments.length}.`,
      call,
    );
  }

  const context = contextDefinitionOf(m, call.arguments[0]);
  if (context === null) {
    return refuse(
      "context-not-createContext",
      "The context argument does not resolve to a `createContext` binding inside the analyzed file set.",
      call.arguments[0],
    );
  }

  // --- the binding site: `const [, { … }] = useContext(X)`.
  let node: Node = call;
  let parent: Node = m.parentOf(node);
  while (parent != null && parent.type !== "VariableDeclarator") {
    if (parent.type !== "ParenthesizedExpression" && !parent.type.startsWith("TS")) break;
    node = parent;
    parent = m.parentOf(node);
  }

  if (parent == null || parent.type !== "VariableDeclarator" || parent.init !== node) {
    return refuse(
      "result-not-destructured",
      "The context result is not bound by a destructuring declaration, so no fixed slot can be named.",
      call,
    );
  }

  const pattern = parent.id;
  if (pattern == null || pattern.type !== "ArrayPattern" || pattern.elements.length !== 2) {
    return refuse(
      "result-not-destructured",
      "The context result must be destructured into a fixed two-slot array pattern.",
      pattern ?? call,
    );
  }

  // Clause 3. A hole is the common case; a plain identifier at this fixed index
  // is the read binding. Anything else — a default, a nested pattern, a rest
  // element — names no fixed slot, so there is no identity to record.
  const readSlot = 0;
  const readPattern = pattern.elements[readSlot] == null ? null : unwrap(pattern.elements[readSlot]);
  if (readPattern != null && readPattern.type !== "Identifier") {
    return refuse(
      "store-read-path-not-fixed",
      "The store's read slot is bound by a pattern rather than a plain name, so which fixed slot the binding stands for is not decidable.",
      readPattern,
    );
  }

  const actionsPattern = pattern.elements[1];
  if (actionsPattern == null || actionsPattern.type !== "ObjectPattern") {
    return refuse(
      "actions-slot-not-fixed",
      "The action slot must be destructured into an object pattern of plain identifiers.",
      actionsPattern ?? pattern,
    );
  }

  const destructured = destructuredActions(m, actionsPattern);
  if (destructured === null) {
    return refuse(
      "actions-slot-not-fixed",
      "The action pattern contains a computed key, a default, a rest element or a nested pattern.",
      actionsPattern,
    );
  }

  // --- the provider, inside the analyzed file set.
  const providers = providersOf(context.module, context.symbol);
  if (providers.length !== 1) {
    return refuse(
      "provider-not-visible",
      providers.length === 0
        ? `No provider for \`${context.symbol.name}\` is visible in the analyzed file set, so the value behind this context is unknown.`
        : `\`${context.symbol.name}\` has ${providers.length} providers in the analyzed file set; which value this binding reads is not decidable.`,
      call,
    );
  }

  const [provider] = providers;
  const actionsSlot = 1;
  const shape = slotShapeOf(provider.module, provider.value, actionsSlot);
  if (shape === null) {
    return refuse(
      "provider-value-not-readable",
      "The provider's value is not a call to a function in the analyzed set whose single return is an array literal with a fixed-slot action object.",
      call,
    );
  }

  const missing = destructured.filter((entry) => !shape.names.has(entry.key));
  if (missing.length > 0) {
    return refuse(
      "action-slot-missing",
      `The provider's value has no action slot named \`${missing[0].key}\`.`,
      missing[0].node,
    );
  }

  // Identity is all that was proven, so identity is all a binding may be used
  // as. Two positions preserve it: its own call site, and an event prop, where
  // the framework calls the action for you. An action stored, compared, returned
  // or handed anywhere else has left the slot path behind and can no longer be
  // named by an artifact.
  for (const entry of destructured) {
    for (const reference of entry.symbol.references) {
      if (reference.inTypePosition || reference.node === entry.node) continue;
      const parent: Node = m.parentOf(reference.node);
      if (parent != null && parent.type === "CallExpression" && parent.callee === reference.node) continue;
      if (isEventPropValue(m, reference.node)) continue;
      return refuse(
        "action-escapes",
        `\`${entry.symbol.name}\` is used somewhere other than its own call site, so its action identity is not what reaches that position.`,
        reference.node,
      );
    }
  }

  const providerLoc = makeLocator(provider.module.source)(provider.element);

  // The read binding's symbol, resolved before anything is minted so a pattern
  // the analyzer cannot resolve is a refusal rather than a silent hole.
  if (readPattern !== null && readSlot >= shape.arity) {
    return refuse(
      "store-read-path-not-fixed",
      `The provider's value returns ${shape.arity} slots, so slot ${readSlot} is not a slot this store has.`,
      readPattern,
    );
  }

  const readSymbol = readPattern === null ? null : m.symbolOf(readPattern);
  if (readPattern !== null && readSymbol === null) {
    return refuse(
      "store-read-path-not-fixed",
      "The store's read slot is bound to a name with no resolved binding, so nothing can be said about what reads it.",
      readPattern,
    );
  }

  const store: StoreInfo = {
    id: storeId,
    context: context.symbol.name,
    contextModule: context.module.path,
    actionsSlot,
    readSlot: readSymbol === null ? null : readSlot,
    provider: { module: provider.module.path, loc: providerLoc },
    value: { module: shape.module, factory: shape.factory },
    loc: locOf(call),
  };

  const actions: ActionInfo[] = [];
  const actionSymbols = new Map<number, ActionInfo>();

  destructured.forEach((entry, index) => {
    const action: ActionInfo = {
      id: `${storeId}a${index}`,
      store: storeId,
      name: entry.symbol.name,
      path: [actionsSlot, entry.key],
      loc: locOf(entry.node),
    };
    actions.push(action);
    actionSymbols.set(entry.symbol.id, action);
  });

  const reads: StoreReadInfo[] = [];
  const readSites: StoreBinding["readSites"] = [];

  if (readSymbol !== null && readPattern !== null) {
    // One read per binding, and its path stops at the slot. Everything past the
    // slot — `state.todos.length` — is the author's own expression, evaluated
    // against the live store at resume time and never here.
    const read: StoreReadInfo = {
      id: `${storeId}r`,
      store: storeId,
      name: readSymbol.name,
      path: [readSlot],
      loc: locOf(readPattern),
    };
    reads.push(read);
    readSites.push({ symbol: readSymbol, node: readPattern, read });
  }

  return { kind: "admitted", binding: { store, actions, reads, actionSymbols, readSites } };
}
