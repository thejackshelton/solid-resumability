/**
 * The classifier: decides whether a component is PROVABLE — every piece of its
 * interactive state and behaviour reconstructible from static artifacts alone —
 * and, when it is, extracts what the emitter needs.
 *
 * Every judgement rides yuku-analyzer's resolved semantics: symbols, references,
 * scopes, closures, cross-module definitions. Nothing is decided by file name,
 * identifier spelling or source text. Provable means the analysis can show that
 * (1) every source cell is a `createSignal(<literal>)` bound by destructuring;
 * (2) neither accessor ever leaves the component into code this pass cannot
 * prove — only `getter()`, `setter(x)`, a helper `summaries.ts` summarizes, a
 * setter standing in an admitted own-frame array-ref, and a prop handed to an
 * inlined child are admitted; (3) every handler's free
 * variables, per `Module.capturesOf`, resolve only to those accessors; and (4)
 * the markup is static. Anything else is refused with a machine-readable reason.
 *
 * Three properties are load-bearing for the coverage baseline. Discovery is
 * WIDER than provability: every module-scope JSX-returning function is counted
 * and classified. Export is PACKAGING: artifacts are keyed by `(module path,
 * local component name)`. Refusal collection is EXHAUSTIVE: a structural refusal
 * does not abandon the rest of the subtree, so a refusal set is complete, which
 * changes no verdict. See-through moves the boundary of what the pass can SEE,
 * never the bar it holds code to.
 *
 * DEPTH-1 COMPONENT INLINING splices a child's markup into the parent's template
 * and re-homes its bindings and handlers onto the parent's cells. Refused with
 * `jsx-component-element` unless all six hold. (1) The element's name resolves
 * through `Symbol.definition()` to a module-scope component INSIDE the analyzed
 * file set, so `<Show>` and `<For>` stay refused. (2) The child takes at most one
 * plain-identifier props parameter and never uses it whole. (3)
 * `capturesOf(child)` is EMPTY, banning module state, recursion and (naming a
 * component captures its binding) the second hop. (4) The child is a single
 * `return <intrinsic …>` with no cells. (5) Every call-site attribute is a
 * literal, a parent accessor, or a handler the parent could already prove; a
 * spread is refused there with `jsx-spread`. (6) Every `props.X` use conforms to
 * what was passed — an accessor only called with its own arity, a handler only in
 * an event-attribute position, a literal only where the walk folds it.
 *
 * The splice is a TRIAL: appended to the parent's lists and rolled back wholesale
 * if any part of the child's markup refuses, so there is no partial admission.
 * One hop only — inside an inlined child `tryInlineComponent` returns null at
 * once, so a grandchild is refused in the child's frame, which fails the trial
 * and refuses the parent's element too. Nothing is traced through `useContext`,
 * a provider, or whole-program flow.
 *
 * COMPONENT ADDRESSING is the other arm, and it does the opposite. Inlining
 * FLATTENS: the child's markup joins the parent's template and its bindings are
 * re-homed onto the parent's cells, which is why a child owning a
 * `createSignal` is refused there — it is state the parent has no slot for.
 * Addressing keeps the child WHOLE: the parent's template carries an
 * element-shaped hole, `<div data-resume="K" data-component="N"></div>`, and the
 * child is classified and emitted in its own frame with its own cells. Nothing
 * on the resume side is new — a page already finds a mount container by walking
 * `[data-component]`, and a nested one is found by the same walk — so the only
 * missing piece was that a parent's template did not know how to leave a hole.
 *
 * The arms are a LADDER, and a component element is templated by the first
 * that accepts it: `tryShowRegion` -> `tryInlineComponent` ->
 * `tryFoldElementIndirection` -> `tryAddressChild` -> `jsx-component-element`.
 * Inlining stays ahead of addressing because it is strictly cheaper — no
 * second artifact directory, no second eager module, no extra DOM element —
 * and because it is the only arm that preserves byte parity with `render()`.
 *
 * ELEMENT-INDIRECTION FOLD is a call-site splice, not an address. The child's
 * body must be the omit / optional-untrack-guard / Dynamic shape, with those
 * three names resolved by import edge to Solid framework bare specifiers —
 * the same recognition class as `signalFactorySymbols`. Dynamic's body is
 * never classified. The call-site attribute that names the omitted key must
 * be a v1 build-constant string matching `/^[a-z][a-z0-9-]*$/`; any other
 * valuation returns null and falls through to `jsx-component-element`. On
 * success the opening is the recorded tag plus the call-site attributes
 * minus that key, verbatim and in order, run through the same
 * `auditOpeningAttributes` path an intrinsic uses.
 *
 * ARRAY-REF WIRING admits a `ref` attribute on an own-frame intrinsic whose
 * value is an ArrayExpression. Every element must be either the setter of a
 * component-local `createSignal` with no references outside that array (the
 * getter's uses must already be independently admitted), or an identity-class
 * member path (`own-props-parameter` / `derived-rest-props-result` via
 * `sourceBindingOf`). The artifact is an attribute binding
 * `{ attribute: "ref", locator, captures }`: write slots are cell-write
 * targets, identity slots are forwarded-path targets. Resume locates the
 * element, writes it into each named cell, and applies Solid ref semantics
 * (function call vs assignment) to each forwarded path, before any effect
 * runs. A replay-free measured multi-ref is not this admission.
 *
 * MEASURED ATTRIBUTE CARGO admits three derive shapes and one rest-spread,
 * all structural, no user-name match. (a) A zero-argument call of a
 * C1-summarized derived accessor is measured: the getter is not a source
 * cell, so the attribute bakes zero bytes. A zero-argument call of a
 * binding initialized to a framework memo whose callback `derive`s is that
 * callback — the memo is transparent, no new cell. A memo callback that is
 * exactly `const x = <call>(); if (x == null) return <literal>; return
 * <pure-single-return-call>(…)` is that reconstructed derivation; a
 * near-miss of that family refuses `callee-body-not-guarded-return`. A
 * derived-accessor read in that binding stays measured: the deferred write
 * is never evaluated, except an own-host element projection recorded on the
 * cell and restored after ref replay. (b) A member read of an
 * identity-class binding (`own-props-parameter` / `derived-rest-props-result`
 * via `sourceBindingOf`) in a standalone frame is measured. (c) A
 * ConditionalExpression whose test `deriveCondition`s and whose both
 * branches `derive` is measured-propagating. `deriveCondition` walks
 * negation, strict comparison, `==` / `!=` against literal null, and
 * `&&` / `||` of those same shapes. A derived cell whose deferred write is
 * a pure projection of the mount's own host (property chain and/or
 * `getAttribute(<string literal>)`) is recorded with that projection and
 * restored on the already-held ref before any attribute compute reads it.
 * A projection of any other element refuses `element-projection-not-own-host`;
 * a non-pure projection refuses `element-projection-not-pure`. A
 * measured identity rest-spread (`{...ident}`) on an own-frame intrinsic
 * bakes nothing; capture measures the attribute set and resume replays a
 * spread assign. A call-valued or non-identity spread still refuses
 * `jsx-spread`.
 *
 * Addressing is offered in the component's OWN address space only: never
 * through a props boundary (`frame.props !== null`, exactly as inlining's one
 * hop) and never inside a keyed region, whose locators are rooted at an ITEM
 * element rather than at this component's root. Past that, five conditions
 * decide, and each declines BY NAME — every one of them falls through to
 * `jsx-component-element` rather than throwing, so a refused address is a
 * refused element and nothing more:
 *
 *   `ClaimedChildNotBare` — the element carries a child, or an attribute that
 *     is neither a v1 build-constant (an inline literal, including a JSX
 *     expression container wrapping a literal, or an identifier `definition()`
 *     resolves to a module-scope const literal) nor an identity-class named
 *     attribute or identifier rest-spread (`own-props-parameter` or
 *     `derived-rest-props-result` via this pass's own `referenceOf` /
 *     `definition` machinery). Children still refuse: a mount container has no
 *     slot for them. Any other attribute refuses the address the same way as
 *     before — fall through to `jsx-component-element`, no new code.
 *   `ClaimedChildNotInAnalyzedSet` — the name does not resolve through
 *     `Symbol.definition()` to a module-scope component inside the analyzed set.
 *     This is inlining's condition (1), the same resolution, shared rather than
 *     rewritten, which is what keeps `<Show>` and `<For>` outside both arms.
 *   `ClaimedChildCycle` — the child is the enclosing component, or is already on
 *     the addressing stack. A component cannot hold a hole for itself.
 *   `ClaimedChildEmptyTemplate` — the child does not classify provable in its
 *     own frame, or classifies provable and paints NOTHING. The second half is
 *     the load-bearing one: a component whose only region is recorded absent
 *     emits `html === ""`, and a mount for it would ship empty and make the
 *     resumer throw for want of a root element. The build refuses it here
 *     instead, before anything is emitted.
 *   `ClaimedChildParentContentModel` — the immediate parent's tag is one the
 *     HTML parser would REPARSE a `<div>` out of (`p`, `tr`, `tbody`, …). The
 *     served bytes would then hold a different tree than the build addressed,
 *     silently corrupting every child-index locator after it, and no other gate
 *     in this repo would notice.
 */

import { anyOf, charIn, createRegExp, exactly, oneOrMore } from "magic-regexp";
import type { Module, Symbol as YukuSymbol } from "yuku-analyzer";

import {
  contains,
  isTransparent,
  literalValue,
  makeLocator,
  printExpression,
  unwrap,
  type Node,
} from "./ast.ts";
import { findComponent, findComponents, type ComponentSite } from "./discover.ts";
import {
  matchElementProjection,
  matchGuardedReturn,
  matchLiteralDecisionTree,
  parameterIndexOf,
  parameterIsAccessorOnly,
  parameterIsGetterOnly,
  returnedClosure,
  summarize,
  summarizeDerivedAccessor,
  type DerivedAccessorSummary,
  type GuardedReturnMatch,
  type LiteralDecisionTree,
} from "./summaries.ts";
import {
  classifyStoreBinding,
  guardThrowContextCalls,
  isWholeBindAdmittedUse,
  isWholeBindInit,
  isWholeBindReadThroughCall,
  useContextCalls,
} from "./stores.ts";
import { AMBIENT_MEMBER_CALLS, EVENT_TIME_SYNTAX, HANDLER_SYNTAX } from "./syntax.ts";
import {
  artifactKey,
  isActionSlot,
  isCandidateRecordable,
  isCellSlot,
  isIdentitySlot,
  isObjectStore,
  isRegionItemSlot,
  isStoreReadSlot,
} from "./types.ts";
import type {
  ActionInfo,
  Analysis,
  AttributeAuditRecord,
  AttributeCargoRecord,
  AttributeKindRecord,
  BindingInfo,
  CaptureSlot,
  CellInfo,
  ElementProjection,
  SlotRewrite,
  ClaimedChild,
  ClassConditionInfo,
  ClassifyOptions,
  CodeOrigin,
  HandlerInfo,
  HandlerOrigin,
  IdentityBindingClass,
  IdentityProp,
  InlinedChild,
  KeyedRegionInfo,
  Reason,
  ReasonCode,
  RecordableBindingClass,
  RecordedProp,
  ShowRegionInfo,
  SignalCalleeIdentity,
  SignalEscapeRecord,
  SignalEscapeSiteKind,
  SignalFamilyRecord,
  SignalInitializerRecord,
  SignalInitializerShape,
  SourceLoc,
  StaticValue,
  StoreInfo,
  StoreReadInfo,
  WiringRecord,
} from "./types.ts";

/** Modules whose `createSignal` export counts as a Solid source cell. */
const SIGNAL_MODULES = new Set(["solid-js", "@solidjs/signals"]);

/** Modules whose control-flow components are Solid's own. */
const CONTROL_FLOW_MODULES = new Set(["solid-js", "@solidjs/web"]);

/** Solid's own name for the prop a `<Show>` takes its condition from. A fact
 * about the framework's contract, the way `onClick` is — not about any app. */
const SHOW_GUARD_PROP = "when";

/** Solid's own name for the prop a `<For>` takes its list from. */
const FOR_LIST_PROP = "each";

/**
 * The prop a `<For>` may name its key path in, and the default when it names
 * none. A string literal naming a fixed path off the item — `"id"`, or
 * `"meta.id"` — and nothing else: a function is a body this pass would have to
 * read, and an index is position, which is the thing keys exist to escape.
 */
const FOR_KEY_PROP = "key";
const DEFAULT_KEY_PATH = ["id"];

/**
 * The attribute an item element carries its key in. One place, because it is one
 * decision: what the build writes into `itemTemplate` and what the runtime reads
 * off `container.children` are the same fact and must never drift.
 */
const KEY_ATTRIBUTE = "data-key";

const ARITHMETIC = new Set(["+", "-", "*", "/", "%"]);

/** HTML elements that never take a closing tag. */
const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

/** Comparisons a class condition may be built from. Strict only: `==` reaches
 * coercion rules the fold would have to reproduce, and refusing is cheaper than
 * reproducing them. */
const COMPARISON = new Set(["===", "!==", "<", ">", "<=", ">="]);

/** Boolean connectives `deriveCondition` walks. Both sides must themselves
 * derive; a measured side keeps the operator in `source` rather than folding. */
const LOGICAL = new Set(["&&", "||"]);

/** JSX prop names that differ from the HTML attribute they produce. */
const ATTRIBUTE_ALIASES: Record<string, string> = { className: "class", htmlFor: "for" };

/** The JSX props whose name is `class` once aliases are applied. */
const CLASS_PROPS = new Set(["class", "className"]);

/**
 * Props the DOM keeps as element STATE rather than as an attribute, per element.
 * Same table Solid's runtime carries, cut down to what this pass admits: a
 * checkbox's checkedness is not its `checked` attribute, so markup cannot state
 * it and `setAttribute` cannot change it. Deciding this at BUILD time is what
 * keeps the resume side one branch instead of a table it would have to ship.
 */
const STATE_PROPERTIES: Record<string, Set<string>> = {
  input: new Set(["value", "checked"]),
  option: new Set(["value", "selected"]),
  select: new Set(["value"]),
  textarea: new Set(["value"]),
};

/** JSX prop names that carry an event listener rather than an attribute. */
const EVENT_PROP = /^on([A-Z][A-Za-z0-9]*)$/;

interface Accessor {
  cellId: string;
  access: "read" | "write";
  name: string;
  /** True for a callee-local getter bound at a derived-accessor call site.
   * A zero-argument call of that getter is a measured derivation: no source
   * cell, so a template-byte use bakes nothing. */
  derived?: boolean;
}

/** A folded text derivation. `source` goes into `structure.js`'s `compute`, so
 * it must be expressed purely in capture slots; `inlined` records whether any
 * part came from OUTSIDE the component. When nothing did, `source` is the
 * author's expression verbatim, which keeps the artifacts byte-identical.
 * `rewrites` are resolved-node ↔ slot pairings; the printer substitutes at
 * exactly those nodes. */
interface Derived {
  value: StaticValue;
  slots: CaptureSlot[];
  source: string;
  inlined: boolean;
  rewrites: SlotRewrite[];
  /**
   * True once any part of the derivation reached through a store read, which has
   * no build-time value. `value` is then meaningless and nothing folds it: the
   * text is MEASURED out of the page's capture instead, and `source` still
   * recomputes it at resume time from the live store. Measuring propagates
   * upward, so one unmeasurable part makes the whole derivation measured rather
   * than quietly folding around it.
   */
  measured: boolean;
}

/** What a summarized helper's parameter is bound to at a call site: a cell
 * accessor (usable only as `p()` / `p(x)`), an already-folded value, or an
 * object-literal argument whose fields were each derived. */
type ParameterBinding =
  | { kind: "accessor"; accessor: Accessor }
  | { kind: "value"; derived: Derived }
  | { kind: "object"; fields: Map<string, Derived> };

/** What a child's `props.X` stands for once the call site proved what was
 * passed — the whole vocabulary of the props boundary, with no "object",
 * "callback" or "unknown" case. */
type PropBinding =
  | { kind: "accessor"; accessor: Accessor }
  | { kind: "handler"; source: string; slots: CaptureSlot[]; loc: SourceLoc; origin: HandlerOrigin }
  | { kind: "value"; derived: Derived };

type Refuse = (
  code: ReasonCode,
  message: string,
  node: Node,
  detail?: Record<string, unknown>,
) => void;

/**
 * The frame markup is walked in. `props === null` is the component's own:
 * identifiers mean what its scope says and refusals go into its reason list. A
 * non-null `props` is an INLINED CHILD's — only `props.X` resolves, and refusals
 * go into a trial sink that fails the splice rather than blaming the parent.
 */
interface Frame {
  /** The module the JSX being walked lives in — not necessarily the caller's. */
  mod: Module;
  locOf: (node: Node) => SourceLoc;
  props: Map<string, PropBinding> | null;
  /** The symbol id of the child's props parameter, inside a child frame. */
  propsSymbol: number | null;
  refuse: Refuse;
}

const LINE_BREAK = createRegExp(anyOf(exactly("\r\n"), exactly("\r"), exactly("\n")));
const LEADING_INDENT = createRegExp(oneOrMore(charIn("\t ")).at.lineStart());
const TRAILING_INDENT = createRegExp(oneOrMore(charIn("\t ")).at.lineEnd());

/**
 * JSX text collapses per the usual rule: split on newlines, drop the indent that
 * exists only because the markup is indented, drop empty lines, join with one
 * space. The first line keeps its leading run and the last its trailing one —
 * those sit against real content. `<button>\n  +\n</button>` renders as `+`.
 */
export function normalizeJsxText(raw: string): string {
  const lines = raw.split(LINE_BREAK);
  const last = lines.length - 1;

  return lines
    .map((line, index) => {
      const unindented = index === 0 ? line : line.replace(LEADING_INDENT, "");
      return index === last ? unindented : unindented.replace(TRAILING_INDENT, "");
    })
    .filter((line) => line !== "")
    .join(" ");
}

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function childLocator(parent: string, index: number): string {
  return parent === "/" ? `/${index}` : `${parent}/${index}`;
}

/** Solid's placeholder for a dynamic insert: the empty comment node the DOM
 * transform writes in so `insert()` has a marker, which therefore survives into
 * the rendered DOM. */
const COMPONENT_PLACEHOLDER = "<!---->";

/** True for `<Child />`, false for `<div>`: the JSX tag is not an intrinsic. */
function isComponentElement(element: Node): boolean {
  const name = element.openingElement.name;
  return !(name.type === "JSXIdentifier" && /^[a-z]/.test(name.name));
}

/**
 * Structural class of one opening attribute. Spreads split on the argument's
 * AST kind so a call and an identifier are never one class. Names no library.
 */
/**
 * Structural class of a signal factory argument. Names no library, component,
 * or idiom — only the AST kind the verdict path already inspected.
 */
function initializerShapeOf(call: Node): { shape: SignalInitializerShape; astType: string | null } {
  if (call.arguments.length === 0) return { shape: "absent", astType: null };
  if (call.arguments.length > 1) {
    const first = unwrap(call.arguments[0]);
    return { shape: "extra-arguments", astType: first?.type ?? null };
  }
  const arg = unwrap(call.arguments[0]);
  if (literalValue(call.arguments[0]).ok) return { shape: "literal", astType: arg?.type ?? "Literal" };
  if (arg == null) return { shape: "other", astType: null };
  switch (arg.type) {
    case "Identifier":
      return { shape: "identifier", astType: arg.type };
    case "CallExpression":
      return { shape: "call", astType: arg.type };
    case "MemberExpression":
      return { shape: "member", astType: arg.type };
    case "ArrayExpression":
      return { shape: "array-expression", astType: arg.type };
    case "ObjectExpression":
      return { shape: "object-expression", astType: arg.type };
    case "ConditionalExpression":
      return { shape: "conditional", astType: arg.type };
    default:
      return { shape: "other", astType: arg.type };
  }
}

/** `void 0` — UnaryExpression whose operand is the literal 0. */
function isVoid0(node: Node): boolean {
  const inner = unwrap(node);
  if (inner == null || inner.type !== "UnaryExpression" || inner.operator !== "void") return false;
  const argument = unwrap(inner.argument);
  return argument != null && argument.type === "Literal" && argument.value === 0;
}

/** The identifier `undefined` when it names no local binding. */
function isGlobalUndefined(mod: Module, node: Node): boolean {
  const inner = unwrap(node);
  if (inner == null || inner.type !== "Identifier" || inner.name !== "undefined") return false;
  return (mod.referenceOf(inner)?.symbol ?? null) === null;
}

/** The identifier at the bottom of a non-computed member chain, or null. */
function memberBase(node: Node): Node | null {
  let current: Node | null = unwrap(node);
  while (current != null && current.type === "MemberExpression") {
    if (current.computed === true) return null;
    current = unwrap(current.object);
  }
  return current != null && current.type === "Identifier" ? current : null;
}

function joinRewrites(...groups: Array<SlotRewrite[] | undefined>): SlotRewrite[] {
  const out: SlotRewrite[] = [];
  for (const group of groups) {
    if (group !== undefined) out.push(...group);
  }
  return out;
}

/**
 * Prints `root` after substituting each recorded slot name at its resolved
 * node. Mutation is restored so the analyzed AST is unchanged. Empty
 * `rewrites` is `printExpression` — already-closed expressions stay
 * byte-identical.
 */
function printWithSlotRewrites(root: Node, rewrites: readonly SlotRewrite[]): string {
  if (rewrites.length === 0) return printExpression(root);
  const restores: Array<() => void> = [];
  try {
    for (const rewrite of rewrites) {
      restores.push(replaceNodeWithIdentifier(rewrite.node, rewrite.name));
    }
    return printExpression(root);
  } finally {
    for (let index = restores.length - 1; index >= 0; index--) restores[index]!();
  }
}

function replaceNodeWithIdentifier(node: object, name: string): () => void {
  const target = node as Node;
  const saved: Record<string, unknown> = {};
  for (const key of Object.keys(target)) saved[key] = target[key];
  for (const key of Object.keys(target)) delete target[key];
  target.type = "Identifier";
  target.name = name;
  if (typeof saved.start === "number") target.start = saved.start;
  if (typeof saved.end === "number") target.end = saved.end;
  return () => {
    for (const key of Object.keys(target)) delete target[key];
    Object.assign(target, saved);
  };
}

function derivedSource(
  expression: Node,
  parts: { inlined: boolean; source: string; rewrites: SlotRewrite[] },
): string {
  return parts.inlined ? parts.source : printWithSlotRewrites(expression, parts.rewrites);
}

/** A value this seat will freeze as a cell initial: a literal, `void 0`, or
 * the global `undefined`. */
function frozenInitial(mod: Module, node: Node): { ok: true; value: StaticValue } | { ok: false } {
  if (isVoid0(node) || isGlobalUndefined(mod, node)) return { ok: true, value: null };
  return literalValue(node);
}

/** A statically-known object literal whose keys are identifiers or literals
 * and whose values are themselves frozen initials. */
function isLiteralOptionsObject(mod: Module, node: Node): boolean {
  const inner = unwrap(node);
  if (inner == null || inner.type !== "ObjectExpression") return false;
  for (const property of inner.properties ?? []) {
    if (property.type !== "Property" || property.computed === true) return false;
    const key = property.key;
    if (key == null || (key.type !== "Identifier" && key.type !== "Literal")) return false;
    if (!frozenInitial(mod, property.value).ok) return false;
  }
  return true;
}

function attributeKindOf(attribute: Node): AttributeKindRecord {
  if (attribute.type === "JSXSpreadAttribute") {
    const argument = unwrap(attribute.argument);
    const argumentType = argument?.type ?? "unknown";
    const klass: AttributeKindRecord["class"] =
      argumentType === "CallExpression"
        ? "spread-of-call"
        : argumentType === "Identifier"
          ? "spread-of-identifier"
          : "spread-of-other";
    return { class: klass, astType: "JSXSpreadAttribute", argumentType };
  }

  const nameType = attribute.name?.type ?? "unknown";
  const valueType = attribute.value == null ? null : attribute.value.type;
  return {
    class: nameType === "JSXIdentifier" ? "jsx-attribute" : "jsx-attribute-other-name",
    astType: attribute.type ?? "JSXAttribute",
    nameType,
    valueType,
  };
}

/**
 * Tags whose content model an HTML parser ENFORCES by restructuring: a `<div>`
 * written inside one of these does not land where it was written, because the
 * parser closes the open element (`<p>`) or foster-parents the stray content out
 * of the table. Locators here are child INDICES, so a tree the parser rebuilt is
 * a tree every address after the mount point points into wrongly — and unlike a
 * refused element, nothing downstream would ever notice.
 *
 * Frozen, and deliberately a blunt list of tags rather than a model of HTML's
 * insertion modes: this is a refusal, and a refusal that is too broad costs a
 * component its address while a refusal that is too narrow costs a page its
 * correctness.
 */
const REPARSING_PARENTS = new Set([
  "p",
  "ul",
  "ol",
  "dl",
  "dt",
  "dd",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "select",
  "optgroup",
]);

/**
 * The chain of components currently being classified FOR AN ADDRESS, innermost
 * last. Addressing classifies a child in its own frame, which can reach a
 * component element of its own, so the recursion needs a base case that is not
 * "the stack ran out": `<A>` holding `<B>` holding `<A>` is refused at the
 * second `<A>` with `ClaimedChildCycle`.
 *
 * Module-level because the recursion goes through `classifySite`, which is the
 * entry point rather than a closure — and safe to keep there because this pass
 * is synchronous end to end, so no two classifications interleave.
 */
const ADDRESSING_STACK: string[] = [];

/**
 * The child a component element names: the resolution both composition arms
 * share, so the analyzed-set edge is defined in exactly one place.
 * `definition()` follows import and re-export chains and STOPS at that edge,
 * which is what leaves `<Show>` and `<For>` outside inlining and addressing
 * alike, and `componentSiteOf` insists on something `findComponents` counted —
 * so a composed child is always a component the coverage report already knows.
 *
 * A JSXIdentifier in a JSXMemberExpression object is not a recorded
 * reference — `referenceOf` is null there — so that arm uses `resolve()`.
 */
function resolveChildComponent(
  mod: Module,
  element: Node,
): { module: Module; site: ComponentSite } | null {
  const name = element.openingElement.name;
  if (name.type === "JSXIdentifier") {
    const symbol = mod.referenceOf(name)?.symbol ?? null;
    if (symbol === null) return null;
    return siteFromSymbol(symbol);
  }
  if (name.type === "JSXMemberExpression") return resolveMemberComponent(mod, element, name);
  return null;
}

function siteFromSymbol(symbol: YukuSymbol): { module: Module; site: ComponentSite } | null {
  const definition = symbol.definition();
  if (definition == null || definition.symbol == null) return null;
  const site = componentSiteOf(definition.module, definition.symbol);
  if (site === null) return null;
  return { module: definition.module, site };
}

function isImportBinding(mod: Module, symbol: YukuSymbol): boolean {
  return mod.imports.some((record) => record.local?.id === symbol.id);
}

function exportDefinition(
  mod: Module,
  name: string,
  seen: Set<string> = new Set(),
): { module: Module; symbol: YukuSymbol } | null {
  if (seen.has(mod.path)) return null;
  seen.add(mod.path);

  for (const record of mod.exports) {
    if (record.name !== name) continue;
    if (record.local != null) {
      const definition = record.local.definition();
      if (definition == null || definition.symbol == null) return null;
      return { module: definition.module, symbol: definition.symbol };
    }
    if (record.resolvedModule != null && record.fromName != null) {
      return exportDefinition(record.resolvedModule, record.fromName, seen);
    }
  }

  for (const record of mod.exports) {
    if (!record.isStar || record.resolvedModule == null) continue;
    const inner = exportDefinition(record.resolvedModule, name, seen);
    if (inner !== null) return inner;
  }
  return null;
}

function identifierDefinition(mod: Module, node: Node): { module: Module; symbol: YukuSymbol } | null {
  if (node == null || node.type !== "Identifier") return null;
  const symbol = mod.referenceOf(node)?.symbol ?? null;
  if (symbol === null) return null;
  const definition = symbol.definition();
  if (definition == null || definition.symbol == null) return null;
  return { module: definition.module, symbol: definition.symbol };
}

function thunkReturnedIdentifier(fn: Node): Node | null {
  if ((fn.params ?? []).length !== 0) return null;
  const body = fn.body;
  if (body == null) return null;
  if (body.type !== "BlockStatement") return unwrap(body);
  const statements: Node[] = body.body ?? [];
  if (statements.length !== 1 || statements[0].type !== "ReturnStatement") return null;
  return statements[0].argument == null ? null : unwrap(statements[0].argument);
}

function resolvePropertyValue(mod: Module, raw: Node): { module: Module; symbol: YukuSymbol } | null {
  const value = unwrap(raw);
  if (value == null) return null;
  if (value.type === "Identifier") return identifierDefinition(mod, value);
  if (value.type !== "ArrowFunctionExpression" && value.type !== "FunctionExpression") return null;
  return identifierDefinition(mod, thunkReturnedIdentifier(value));
}

function namespaceObjectMember(
  mod: Module,
  symbol: YukuSymbol,
  name: string,
): { module: Module; symbol: YukuSymbol } | null {
  if (symbol.declarations.length !== 1) return null;
  const declaration: Node = symbol.declarations[0];
  const declarator: Node = mod.parentOf(declaration);
  if (declarator == null || declarator.type !== "VariableDeclarator") return null;
  if (declarator.id !== declaration) return null;
  const init = unwrap(declarator.init);
  if (init == null) return null;

  let object: Node | null = null;
  if (init.type === "ObjectExpression") object = init;
  else if (init.type === "CallExpression" && (init.arguments ?? []).length === 1) {
    const argument = unwrap(init.arguments[0]);
    if (argument != null && argument.type === "ObjectExpression") object = argument;
  }
  if (object == null) return null;

  for (const property of object.properties ?? []) {
    if (property == null || property.type !== "Property") continue;
    if (property.computed === true) continue;
    if (property.key?.type !== "Identifier" || property.key.name !== name) continue;
    return resolvePropertyValue(mod, property.value);
  }
  return null;
}

function resolveMemberComponent(
  mod: Module,
  element: Node,
  name: Node,
): { module: Module; site: ComponentSite } | null {
  const object = name.object;
  const property = name.property;
  if (object == null || object.type !== "JSXIdentifier") return null;
  if (property == null || property.type !== "JSXIdentifier") return null;

  const objectSymbol = mod.resolve(object.name, mod.scopeOf(element), "value");
  if (objectSymbol === null) return null;

  const definition = objectSymbol.definition();
  if (definition == null) return null;

  if (definition.symbol == null) {
    const exported = exportDefinition(definition.module, property.name);
    if (exported === null) return null;
    const site = componentSiteOf(exported.module, exported.symbol);
    if (site === null) return null;
    return { module: exported.module, site };
  }

  if (!isImportBinding(mod, objectSymbol)) return null;

  const member = namespaceObjectMember(definition.module, definition.symbol, property.name);
  if (member === null) return null;
  const site = componentSiteOf(member.module, member.symbol);
  if (site === null) return null;
  return { module: member.module, site };
}

/**
 * An identifier `definition()` resolves to a module-scope `const` whose init
 * is a literal this pass will freeze. Follows import/re-export chains; a
 * function-scope const, a `let`, or a non-literal init is not this class.
 */
function moduleScopeConstLiteral(mod: Module, ident: Node): StaticValue | null {
  const symbol = mod.referenceOf(ident)?.symbol ?? null;
  if (symbol === null) return null;
  const definition = symbol.definition();
  if (definition == null || definition.symbol == null) return null;
  const defSymbol = definition.symbol;
  if (defSymbol.scope.kind !== "module") return null;
  if (defSymbol.declarations.length !== 1) return null;

  const declarator: Node = definition.module.parentOf(defSymbol.declarations[0]);
  if (declarator == null || declarator.type !== "VariableDeclarator") return null;
  const declaration: Node = definition.module.parentOf(declarator);
  if (declaration == null || declaration.type !== "VariableDeclaration") return null;
  if (declaration.kind !== "const") return null;

  const init = declarator.init == null ? null : unwrap(declarator.init);
  if (init == null) return null;
  const literal = literalValue(init);
  return literal.ok ? literal.value : null;
}

/** One opening attribute as a v1 build-constant, or null — not this class. */
function buildConstantAttribute(mod: Module, attribute: Node): RecordedProp | null {
  if (attribute.type === "JSXSpreadAttribute") return null;
  if (attribute.name?.type !== "JSXIdentifier") return null;
  const name: string = attribute.name.name;
  const value = attribute.value;

  // `<Child flag />`: JSX's implicit `true`, a boolean literal.
  if (value == null) return { name, value: true };

  if (value.type === "Literal") {
    const literal = literalValue(value);
    return literal.ok ? { name, value: literal.value } : null;
  }

  if (value.type !== "JSXExpressionContainer") return null;
  const expression = unwrap(value.expression);
  if (expression == null || expression.type === "JSXEmptyExpression") return null;

  if (expression.type === "Literal") {
    const literal = literalValue(expression);
    return literal.ok ? { name, value: literal.value } : null;
  }

  if (expression.type === "Identifier") {
    const resolved = moduleScopeConstLiteral(mod, expression);
    return resolved === null ? null : { name, value: resolved };
  }

  return null;
}

function recordsMatch(
  left: ReadonlyArray<RecordedProp> | undefined,
  right: ReadonlyArray<RecordedProp>,
): boolean {
  const prior = left ?? [];
  if (prior.length !== right.length) return false;
  if (prior.length === 0) return true;
  const byName = new Map(prior.map((prop) => [prop.name, prop.value]));
  return right.every((prop) => byName.get(prop.name) === prop.value);
}

function identityKey(prop: IdentityProp): string {
  return JSON.stringify([prop.name, prop.role, prop.bindingClass, prop.source.name, prop.source.path]);
}

function identityRecordsMatch(
  left: ReadonlyArray<IdentityProp> | undefined,
  right: ReadonlyArray<IdentityProp>,
): boolean {
  const prior = left ?? [];
  if (prior.length !== right.length) return false;
  if (prior.length === 0) return true;
  const seen = new Set(prior.map(identityKey));
  return right.every((prop) => seen.has(identityKey(prop)));
}

/**
 * Which all-element children are followed by a `<!---->` placeholder, mirroring
 * `dom-expressions`' CSR marker discipline (`babel-plugin-jsx/src/dom/element.ts`,
 * `transformChildren`). A component child compiles to an `insert()` — a dynamic
 * slot. One slot either appends or rides the next static sibling and the template
 * gains nothing; two or more (`perSlot`) each need their OWN truthy marker.
 * Two facts make the short rule faithful rather than approximate: these children
 * are all JSX elements, so `wrappedByText` is vacuously false; and a static
 * element after a component child always gets a reference allocated, since
 * `detectExpressions` returns true when the PREVIOUS child is a component.
 */
function placeholdersAfter(children: Node[]): boolean[] {
  const isComponent = children.map(isComponentElement);
  const dynamicSlots = isComponent.filter(Boolean).length;
  if (dynamicSlots < 2) return children.map(() => false);

  return isComponent.map((component, index) => {
    if (!component) return false;
    const next = index + 1;
    return next >= children.length || isComponent[next];
  });
}

/** Classifies one component: the named one, or the first in the module.
 * Module-local components are reachable, which an export-only walk cannot do. */
export function classify(module: Module, componentName?: string, options?: ClassifyOptions): Analysis {
  const component = findComponent(module, componentName);
  if (component === null) {
    const locOf = makeLocator(module.source);
    return {
      status: "fallback",
      component: componentName ?? "<unknown>",
      module: module.path,
      reasons: [
        {
          code: "no-exported-component",
          message:
            componentName === undefined
              ? "No module-scope function in this module returns JSX."
              : `No module-scope function named \`${componentName}\` returns JSX in this module.`,
          loc: locOf(module.ast),
        },
      ],
    };
  }
  return classifySite(module, component, options);
}

/** The coverage tool's entry point: one `Analysis` per module-scope component,
 * in source order, so a file holding five yields five verdicts. */
export function classifyAll(module: Module, options?: ClassifyOptions): Analysis[] {
  return findComponents(module).map((site) => classifySite(module, site, options));
}

/** The classifier proper, over an already-discovered component. */
export function classifySite(module: Module, component: ComponentSite, options?: ClassifyOptions): Analysis {
  const moduleInfo = module;
  const locOf = makeLocator(moduleInfo.source);
  const reasons: Reason[] = [];
  const unmaskAttributeAudit = options?.unmaskAttributeAudit === true;
  const attributeDiagnostics: AttributeAuditRecord[] = [];
  const signalInitializers: SignalInitializerRecord[] = [];
  const signalEscapes: SignalEscapeRecord[] = [];
  const recordedByName: Map<string, StaticValue> | null = (() => {
    const list = options?.recordedProps;
    if (list == null || list.length === 0) return null;
    return new Map(list.map((prop) => [prop.name, prop.value]));
  })();
  const identityRecords: ReadonlyArray<IdentityProp> | null = (() => {
    const list = options?.identityProps;
    if (list == null || list.length === 0) return null;
    return list;
  })();
  const identityByName: Map<string, IdentityProp> | null = (() => {
    if (identityRecords === null) return null;
    const map = new Map<string, IdentityProp>();
    for (const prop of identityRecords) {
      if (prop.role === "attribute") map.set(prop.name, prop);
    }
    return map.size > 0 ? map : null;
  })();
  const identitySpread: IdentityProp | null =
    identityRecords?.find((prop) => prop.role === "spread-of-identifier") ?? null;

  const refuse: Refuse = (code, message, node, detail) => {
    reasons.push({ code, message, loc: locOf(node), ...(detail ? { detail } : {}) });
  };

  // Module-local components are admitted: artifacts are keyed by `(module path,
  // local component name)`, so the export surface says nothing about provability.

  // ------------------------------------------------------------- source cells

  /** symbol id -> what that binding is allowed to do. */
  const accessors = new Map<number, Accessor>();
  const cells: CellInfo[] = [];
  /** Setter symbol of each source cell, for the derived-cell mount-stable check. */
  const setterByCell = new Map<string, YukuSymbol>();
  /** Derived-accessor call sites, admitted into `cells` only if captured as a read. */
  const pendingDerived: Array<{
    cellId: string;
    name: string;
    call: Node;
    summary: DerivedAccessorSummary;
  }> = [];

  /** Deferred: an accessor handed to a child as a prop has NOT escaped if the
   * child is inlined, which is only known after the markup walk. */
  const pendingAudits: Array<{ symbol: YukuSymbol; role: "read" | "write" | "opaque" }> = [];

  const factories = signalFactorySymbols(moduleInfo);
  const memoFactories = frameworkExportSymbols(moduleInfo, "createMemo");
  const signalCalls = moduleInfo
    .findAll("CallExpression")
    .filter((call: Node) => contains(component.fn, call) && isFactoryCall(moduleInfo, call, factories));

  signalCalls.forEach((call: Node, index: number) => {
    const cellId = `c${index}`;

    if (unmaskAttributeAudit) {
      const shaped = initializerShapeOf(call);
      signalInitializers.push({
        ...shaped,
        loc: locOf(call.arguments.length === 1 ? call.arguments[0] : call),
      });
    }

    // --- initial value: a literal (including `void 0` / global `undefined`),
    // or that literal plus a statically-known options object of literal values.
    let initial: StaticValue = null;
    if (call.arguments.length > 2) {
      refuse(
        "signal-initializer-not-literal",
        `createSignal takes a literal initial value in a provable component; got ${call.arguments.length} arguments.`,
        call,
      );
    } else if (call.arguments.length >= 1) {
      const frozen = frozenInitial(moduleInfo, call.arguments[0]);
      if (!frozen.ok) {
        refuse(
          "signal-initializer-not-literal",
          "The signal's initial value is computed, so it cannot be frozen into a static artifact.",
          call.arguments[0],
        );
        // No provable initial, but the ACCESSORS still resolve, so the other
        // audits still run. Refused either way, so this never reaches an artifact.
        initial = null;
      } else if (call.arguments.length === 2 && !isLiteralOptionsObject(moduleInfo, call.arguments[1])) {
        refuse(
          "signal-initializer-not-literal",
          "The signal's options argument is not a statically-known object of literal values.",
          call.arguments[1],
        );
        initial = frozen.value;
      } else {
        initial = frozen.value;
      }
    }

    // --- binding site: climb through parens / TS casts to the declarator.
    let node: Node = call;
    let parent: Node = moduleInfo.parentOf(node);
    while (parent != null && isTransparent(parent)) {
      node = parent;
      parent = moduleInfo.parentOf(node);
    }

    if (parent == null || parent.type !== "VariableDeclarator" || parent.init !== node) {
      refuse(
        "signal-result-not-bound",
        "The signal is not bound to a variable declaration, so its accessors cannot be tracked.",
        call,
      );
      return;
    }

    const pattern = parent.id;
    const destructured =
      pattern.type === "ArrayPattern" &&
      pattern.elements.length === 2 &&
      pattern.elements.every((el: Node) => el != null && el.type === "Identifier");

    if (!destructured) {
      // Nothing can be proved about a value whose halves are never named, so
      // every use of the tuple is an escape.
      refuse(
        "signal-binding-not-destructured",
        "The signal is bound as a whole tuple rather than destructured into a getter/setter pair.",
        pattern,
      );
      const tupleSymbol = pattern.type === "Identifier" ? moduleInfo.symbolOf(pattern) : null;
      if (tupleSymbol !== null) pendingAudits.push({ symbol: tupleSymbol, role: "opaque" });
      return;
    }

    const getter = moduleInfo.symbolOf(pattern.elements[0]);
    const setter = moduleInfo.symbolOf(pattern.elements[1]);
    if (getter === null || setter === null) {
      refuse("signal-result-not-bound", "The signal's accessors have no resolved bindings.", pattern);
      return;
    }

    accessors.set(getter.id, { cellId, access: "read", name: getter.name });
    accessors.set(setter.id, { cellId, access: "write", name: setter.name });
    setterByCell.set(cellId, setter);
    cells.push({ id: cellId, getter: getter.name, setter: setter.name, initial, loc: locOf(call) });

    pendingAudits.push({ symbol: getter, role: "read" });
    pendingAudits.push({ symbol: setter, role: "write" });
  });

  // --- derived-accessor results: a callee that owns its own cell and
  // returns that getter. Not a source cell — template-byte uses still refuse.
  let derivedIndex = 0;
  for (const call of moduleInfo.findAll("CallExpression")) {
    if (!contains(component.fn, call) || isFactoryCall(moduleInfo, call, factories)) continue;
    const summary = summarizeDerivedAccessor(moduleInfo, call.callee);
    if (summary === null) continue;
    if (call.arguments.length !== summary.params.length) continue;

    let bound: Node = call;
    let boundParent: Node = moduleInfo.parentOf(bound);
    while (boundParent != null && isTransparent(boundParent)) {
      bound = boundParent;
      boundParent = moduleInfo.parentOf(bound);
    }
    if (boundParent == null || boundParent.type !== "VariableDeclarator" || boundParent.init !== bound) {
      continue;
    }
    const pattern = boundParent.id;
    if (pattern == null || pattern.type !== "Identifier") continue;
    const result = moduleInfo.symbolOf(pattern);
    if (result === null) continue;

    const cellId = `d${derivedIndex++}`;
    accessors.set(result.id, {
      cellId,
      access: "read",
      name: result.name,
      derived: true,
    });
    pendingDerived.push({ cellId, name: result.name, call, summary });
    pendingAudits.push({ symbol: result, role: "read" });
  }

  // ------------------------------------------------------------ store sources
  //
  // S3. Resumable state may come from a context-provided store rather than a
  // signal; `stores.ts` holds the five clauses. What is admitted is IDENTITY —
  // which provider supplies the context, which fixed slot each binding names —
  // never a value.

  const stores: StoreInfo[] = [];
  const actions: ActionInfo[] = [];
  const reads: StoreReadInfo[] = [];
  /** symbol id -> the action identity that binding stands for. */
  const actionSlots = new Map<number, ActionInfo>();
  /** symbol id -> the store-read identity that binding stands for. */
  const readSlots = new Map<number, StoreReadInfo>();
  /** The same bindings, with the symbol and declaring node the audit needs. */
  const readSites: Array<{ symbol: YukuSymbol; node: Node; read: StoreReadInfo }> = [];
  /** Every reference to a read binding this pass DERIVED a text from. The escape
   * audit admits exactly these and refuses the rest, so a use the pass did not
   * itself prove — a write, a method call, a capture into a handler — is named
   * rather than tolerated. */
  const derivedReads = new Set<Node>();
  /** Every reference to a read binding a handler body was admitted to reach
   * THROUGH, as the root of a plain member read. Kept apart from `derivedReads`
   * because it is a different admission: nothing was derived here and nothing
   * folded — the property is read off the live store once the event has fired. */
  const slotReads = new Set<Node>();

  const contextCalls = useContextCalls(moduleInfo, component.fn);
  const helperContextCalls = guardThrowContextCalls(moduleInfo, component.fn);

  const admitStoreOutcome = (outcome: ReturnType<typeof classifyStoreBinding>): void => {
    if (outcome.kind === "refused") {
      // One code for the store's identity, one for the read slot in particular:
      // a binding refused for its read path is a different fix than a binding
      // whose provider could not be found at all.
      const code: ReasonCode =
        outcome.reason === "store-read-path-not-fixed" ? "store-read-not-provable" : "store-binding-not-provable";
      refuse(code, outcome.message, outcome.node, { reason: outcome.reason });
      return;
    }
    stores.push(outcome.binding.store);
    actions.push(...outcome.binding.actions);
    reads.push(...outcome.binding.reads);
    for (const [symbolId, action] of outcome.binding.actionSymbols) actionSlots.set(symbolId, action);
    for (const site of outcome.binding.readSites) {
      readSlots.set(site.symbol.id, site.read);
      readSites.push(site);
    }
  };

  contextCalls.forEach((call: Node, index: number) => {
    admitStoreOutcome(classifyStoreBinding(moduleInfo, call, `s${index}`, locOf));
  });

  let helperStoreIndex = contextCalls.length;
  for (const call of helperContextCalls) {
    if (!isWholeBindInit(moduleInfo, call)) continue;
    admitStoreOutcome(classifyStoreBinding(moduleInfo, call, `s${helperStoreIndex}`, locOf));
    helperStoreIndex++;
  }

  // "Has a source cell at all" is about the PRESENCE of a factory call, so this
  // keys on `signalCalls` rather than `reasons.length === 0`: unmaskable, and no
  // double-report of a signal found but refused. A `useContext` counts as a
  // declared source either way — `store-binding-not-provable` already says the
  // source could not be named.
  if (signalCalls.length === 0 && contextCalls.length === 0 && helperContextCalls.length === 0) {
    refuse("no-signal-source", "The component declares no source cell to resume.", component.fn);
  }

  /** Escape analysis. An accessor may only appear as the callee of a call —
   * `count()` or `setCount(x)`. Every other use hands it (or its tuple) to code
   * this pass cannot see, and the component is refused by name. */
  function auditUses(symbol: YukuSymbol, role: "read" | "write" | "opaque"): void {
    for (const reference of symbol.references) {
      if (reference.inTypePosition) continue;

      if (role !== "opaque") {
        const parent = moduleInfo.parentOf(reference.node);
        if (
          parent != null &&
          parent.type === "CallExpression" &&
          parent.callee === reference.node &&
          parent.arguments.length === (role === "read" ? 0 : 1)
        ) {
          continue;
        }

        // Not an escape: a helper whose whole body summarizes and which only
        // calls that parameter the way the accessor allows. Anything the summary
        // cannot prove falls through to the refusals below.
        if (escapeIsSeenThrough(reference.node, role)) continue;

        // Nor a child the markup walk actually inlined: the set is populated
        // only by a SUCCESSFUL splice, so a refused child still escapes here.
        if (seenThroughProps.has(reference.node)) continue;

        // Nor a setter standing in an admitted own-frame array-ref. The set
        // is populated only by a successful collect, so a refused array
        // still escapes here.
        if (seenThroughArrayRef.has(reference.node)) continue;
      }

      const sinkInfo = describeSink(reference.node);
      if (sinkInfo !== null && sinkInfo.opaque) {
        refuse(
          "signal-escapes-to-opaque-callee",
          `\`${symbol.name}\` escapes into \`${sinkInfo.callee}\`, which is defined outside this component (${sinkInfo.definedIn ?? "an external module"}); what it does with the signal is invisible to this analysis.`,
          reference.node,
          { binding: symbol.name, callee: sinkInfo.callee, definedIn: sinkInfo.definedIn },
        );
        recordSignalEscape("signal-escapes-to-opaque-callee", reference.node, symbol.name, sinkInfo);
      } else {
        refuse(
          "signal-escapes-unanalyzable-use",
          `\`${symbol.name}\` is used in a position this pass cannot prove safe.`,
          reference.node,
          { binding: symbol.name, parent: moduleInfo.parentOf(reference.node)?.type ?? null },
        );
        recordSignalEscape("signal-escapes-unanalyzable-use", reference.node, symbol.name, sinkInfo);
      }
    }
  }

  /**
   * True when an accessor reference is a DIRECT argument of a summarizing call
   * whose matching parameter is used only as that accessor. "Direct" is
   * load-bearing: `describeSink` climbs out through member access, array
   * literals and spreads, but an accessor reached that way sits inside a value
   * the summary says nothing about. Only `helper(count)` is seen through.
   */
  function escapeIsSeenThrough(node: Node, role: "read" | "write"): boolean {
    const parent: Node = moduleInfo.parentOf(node);
    if (parent == null || parent.type !== "CallExpression") return false;

    const index = (parent.arguments as Node[]).indexOf(node);
    if (index < 0) return false;

    const summary = summarize(moduleInfo, parent.callee);
    if (summary !== null) {
      // Exact arity: a defaulted or dropped parameter makes the match a guess.
      if (parent.arguments.length !== summary.params.length) return false;
      return parameterIsAccessorOnly(summary, index, role);
    }

    if (role !== "read") return false;
    const derived = summarizeDerivedAccessor(moduleInfo, parent.callee);
    if (derived === null) return false;
    if (parent.arguments.length !== derived.params.length) return false;
    return parameterIsGetterOnly(derived, index);
  }

  /** Follows a value outward to the call it is passed into, if any. */
  function describeSink(
    from: Node,
  ): { callee: string; definedIn: string | null; opaque: boolean } | null {
    let node: Node = from;
    let parent: Node = moduleInfo.parentOf(node);

    while (parent != null) {
      if (parent.type === "CallExpression" || parent.type === "NewExpression") {
        return parent.arguments.includes(node) ? describeCallee(parent.callee) : null;
      }
      if (
        isTransparent(parent) ||
        parent.type === "MemberExpression" ||
        parent.type === "ArrayExpression" ||
        parent.type === "SpreadElement"
      ) {
        node = parent;
        parent = moduleInfo.parentOf(node);
        continue;
      }
      return null;
    }
    return null;
  }

  /** Resolves a callee to its defining module, following import chains. */
  function describeCallee(rawCallee: Node): { callee: string; definedIn: string | null; opaque: boolean } {
    const callee = unwrap(rawCallee);
    if (callee.type !== "Identifier") {
      return { callee: printExpression(callee), definedIn: null, opaque: true };
    }
    const symbol = moduleInfo.referenceOf(callee)?.symbol ?? null;
    if (symbol === null) return { callee: callee.name, definedIn: null, opaque: true };

    const definition = symbol.definition();
    const definedIn = definition?.module.path ?? null;
    // Opaque means "not defined in the component's own module": a
    // single-component analysis treats anything across a boundary as a box.
    return { callee: callee.name, definedIn, opaque: definedIn === null || definedIn !== moduleInfo.path };
  }

  /**
   * Diagnostic-only climb: the verdict path's {@link describeSink} stops at a
   * property or object literal, which is why an options-object hand-off publishes
   * as unanalyzable-use rather than opaque-callee. This walk continues through
   * those nodes so the instrument can name the enclosing callee without moving
   * the verdict. Same {@link describeCallee} as the refuse path.
   */
  function describeEnclosingCall(from: Node): SignalCalleeIdentity | null {
    let node: Node = from;
    let parent: Node = moduleInfo.parentOf(node);

    while (parent != null) {
      if (parent.type === "CallExpression" || parent.type === "NewExpression") {
        return parent.arguments.includes(node) ? describeCallee(parent.callee) : null;
      }
      if (
        isTransparent(parent) ||
        parent.type === "MemberExpression" ||
        parent.type === "ArrayExpression" ||
        parent.type === "SpreadElement" ||
        parent.type === "Property" ||
        parent.type === "ObjectExpression"
      ) {
        node = parent;
        parent = moduleInfo.parentOf(node);
        continue;
      }
      return null;
    }
    return null;
  }

  function escapeSiteKind(from: Node, sinkInfo: SignalCalleeIdentity | null): SignalEscapeSiteKind {
    if (sinkInfo !== null && sinkInfo.opaque) return "opaque-call";

    let node: Node = from;
    let parent: Node = moduleInfo.parentOf(node);
    while (parent != null && (isTransparent(parent) || parent.type === "JSXExpressionContainer")) {
      node = parent;
      parent = moduleInfo.parentOf(node);
    }
    if (parent == null) return "other";
    switch (parent.type) {
      case "ReturnStatement":
        return "return";
      case "JSXAttribute":
        return "jsx-attribute";
      case "Property":
        return "object-property";
      case "ArrayExpression":
        return "array-element";
      case "AssignmentExpression":
        return "assignment";
      case "ArrowFunctionExpression":
      case "FunctionExpression":
      case "FunctionDeclaration":
        return "closure-capture";
      default:
        return "other";
    }
  }

  function recordSignalEscape(
    code: SignalEscapeRecord["code"],
    node: Node,
    binding: string,
    sinkInfo: SignalCalleeIdentity | null,
  ): void {
    if (!unmaskAttributeAudit) return;
    const enclosing = code === "signal-escapes-to-opaque-callee" ? sinkInfo : describeEnclosingCall(node);
    signalEscapes.push({
      code,
      site: escapeSiteKind(node, sinkInfo),
      parent: moduleInfo.parentOf(node)?.type ?? null,
      loc: locOf(node),
      binding,
      callee: enclosing,
    });
  }

  // ------------------------------------------------------------------ markup

  const bindings: BindingInfo[] = [];
  /**
   * Where a binding lands, and what its id is prefixed with. Swapped for the
   * duration of a keyed region's item body: an item's locators are rooted at the
   * ITEM element rather than at the component's root, so the two address spaces
   * must never share a list. The component's own sink is the default and its
   * prefix is empty, which is why every artifact emitted before keyed regions
   * existed still numbers its bindings `b0`, `b1`, … exactly as it did.
   */
  let sink: { bindings: BindingInfo[]; prefix: string } = { bindings, prefix: "" };
  /** Two-state `<Show>` regions, in source order. */
  const regions: ShowRegionInfo[] = [];
  /** Keyed `<For>` regions, in source order. */
  const keyedRegions: KeyedRegionInfo[] = [];
  /** Handlers that belong to a region ITEM. Their wiring is the region's, keyed
   * by item, so it is kept out of the component's own flat wiring list. */
  const regionHandlers = new Set<string>();
  /** Symbol id of a region's body parameter -> the slot standing for one item.
   * Populated while that body is walked, which is the only scope the parameter
   * exists in. */
  const itemSlots = new Map<number, CaptureSlot & { kind: "region-item" }>();
  /** True while a region's item body is being walked, so a `<For>` inside one is
   * refused by name rather than admitted as a second region. */
  let insideRegion = false;
  /** Symbol ids `<Show>` resolves to in this module, if it imports one. Read
   * during the markup walk below, so it is resolved before the walk starts. */
  const showSymbols = controlFlowSymbols(moduleInfo, "Show");
  /** The same, for `<For>`: the keyed region's own element. */
  const forSymbols = controlFlowSymbols(moduleInfo, "For");
  const handlers: HandlerInfo[] = [];
  /** Children a depth-1 splice absorbed. The coverage report records `inlinedBy`
   * from this, so a component only rendered through a provable parent is not
   * counted as a bare refusal. */
  const inlined: InlinedChild[] = [];

  /** Children this component ADDRESSED rather than absorbed, in template order:
   * one element-shaped hole each, and the artifact that fills it. */
  const claimedChildren: ClaimedChild[] = [];

  /** Accessor references a SUCCESSFUL splice proved safe — the identifier inside
   * `<Child count={count} />`. A refused child leaves its props escaping. */
  const seenThroughProps = new Set<Node>();
  /** Setter identifiers an admitted own-frame array-ref proved safe. */
  const seenThroughArrayRef = new Set<Node>();

  /**
   * Every author expression the markup walk CONSUMED for output, in this
   * module's own coordinates — one attribute, one expression child, one item
   * body at a time.
   *
   * This is the walk's own record of what it reached, taken where it reached
   * it rather than reconstructed afterwards, and it is what makes "no emitted
   * artifact reaches this" a fact rather than an argument. An element the walk
   * never entered puts nothing here: an absent region returns before its child
   * is visited, so the child's attributes and children are not consumed, and
   * neither is anything they name.
   */
  const reachedFromOutput: Node[] = [];

  /** Records one consumed expression. Own-module only: a span is meaningless
   * across sources, and an inlined child cannot name this component's bindings
   * anyway (`capturesOf(child)` is empty before a splice is offered). */
  function reach(frame: Frame, node: Node): void {
    if (node == null || frame.mod !== moduleInfo) return;
    reachedFromOutput.push(node);
  }

  const ownFrame: Frame = { mod: moduleInfo, locOf, props: null, propsSymbol: null, refuse };

  /**
   * The component's own props parameter, when it is a single identifier — the
   * same shape `inlinableChild` already names. Used only by the flag-ON
   * recordability instrument; the verdict never reads it. Initialized before
   * the markup walk because the diagnostic path reads it during that walk.
   */
  const ownPropsSymbol: YukuSymbol | null = (() => {
    const params: Node[] = component.fn.params ?? [];
    if (params.length === 0) return null;
    let param: Node = params[0];
    if (param?.type === "AssignmentPattern") param = param.left;
    if (param == null || param.type !== "Identifier") return null;
    return moduleInfo.symbolOf(param);
  })();

  /** A `props.X` member this classification was handed as a recorded literal. */
  function recordedValueOf(node: Node): Derived | null {
    if (recordedByName === null || ownPropsSymbol === null) return null;
    const expression = unwrap(node);
    if (expression == null || expression.type !== "MemberExpression") return null;
    if (expression.computed === true) return null;
    if (expression.property?.type !== "Identifier") return null;
    const object = unwrap(expression.object);
    if (object == null || object.type !== "Identifier") return null;
    const symbol = moduleInfo.referenceOf(object)?.symbol ?? null;
    if (symbol === null || symbol.id !== ownPropsSymbol.id) return null;
    if (!recordedByName.has(expression.property.name)) return null;
    const value = recordedByName.get(expression.property.name) as StaticValue;
    return {
      value,
      slots: [],
      source: JSON.stringify(value),
      inlined: false,
      measured: false,
      rewrites: [],
    };
  }

  /**
   * A `props.X` member this classification was handed as identity: measured
   * runtime state, never a frozen value. A spread identity covers every
   * member; a named identity covers only that name.
   */
  function identityOf(node: Node): { prop: IdentityProp; member: string } | null {
    if ((identityByName === null && identitySpread === null) || ownPropsSymbol === null) return null;
    const expression = unwrap(node);
    if (expression == null || expression.type !== "MemberExpression") return null;
    if (expression.computed === true) return null;
    if (expression.property?.type !== "Identifier") return null;
    const object = unwrap(expression.object);
    if (object == null || object.type !== "Identifier") return null;
    const symbol = moduleInfo.referenceOf(object)?.symbol ?? null;
    if (symbol === null || symbol.id !== ownPropsSymbol.id) return null;
    const member: string = expression.property.name;
    const named = identityByName?.get(member);
    if (named !== undefined) return { prop: named, member };
    if (identitySpread !== null) return { prop: identitySpread, member };
    return null;
  }

  function identitySlotOf(identity: { prop: IdentityProp; member: string }): CaptureSlot {
    return {
      name: identity.member,
      kind: "identity",
      bindingClass: identity.prop.bindingClass,
      source: identity.prop.source,
    };
  }

  /**
   * A member read of an identity-class binding in this component's own
   * frame, with no parent-handed identity record. Measured: the member is
   * runtime cargo, never a frozen value.
   */
  function standaloneIdentityMember(node: Node): CaptureSlot | null {
    const source = sourceBindingOf(node);
    if (source === null || source.path.length === 0) return null;
    return {
      name: String(source.path[source.path.length - 1]),
      kind: "identity",
      bindingClass: source.class,
      source: { name: source.name, path: source.path },
    };
  }

  const root = unwrap(component.returnArgument);
  let html = "";

  if (root == null || root.type !== "JSXElement") {
    refuse(
      "jsx-root-not-element",
      "The component's returned markup is not a single JSX element.",
      component.returnArgument ?? component.fn,
    );
    // The root shape is refused, but the markup under it is real code with its
    // own defects. Nothing is templated: `html` stays empty.
    for (const child of rootFallbackChildren(root)) visitNode(ownFrame, child, "/");
  } else {
    html = visitElement(ownFrame, root, "/");
  }

  /** The JSX elements under a root this pass refused to template. */
  function rootFallbackChildren(node: Node): Node[] {
    if (node == null) return [];
    if (node.type === "JSXFragment") return jsxChildren(node);
    if (node.type === "ArrayExpression") {
      return (node.elements as Node[]).filter((el: Node) => el != null).map((el: Node) => unwrap(el));
    }
    return [];
  }

  /** Children with insignificant whitespace-only text dropped. */
  function jsxChildren(element: Node): Node[] {
    return element.children.filter(
      (child: Node) => !(child.type === "JSXText" && normalizeJsxText(child.value) === ""),
    );
  }

  /** Dispatches one child node for its refusals; returns nothing templatable. */
  function visitNode(frame: Frame, node: Node, locator: string): void {
    if (node == null) return;
    // `templating: false`. Every caller of this is a walk whose MARKUP was
    // already given up on — under a refused component element, under a root
    // this pass would not template, under a `<Show>` whose guard refused. The
    // refusals below it are still collected, because a refusal set is
    // exhaustive; an ADDRESS is not, because there is no template for it to be
    // an address into. Offering the arm here would quietly retire a
    // `jsx-component-element` in markup nothing will ever carry.
    if (node.type === "JSXElement") visitElement(frame, node, locator, null, false);
    else if (node.type === "JSXFragment") {
      jsxChildren(node).forEach((child, index) => visitNode(frame, child, childLocator(locator, index)));
    } else if (node.type === "JSXExpressionContainer") probeExpressionChild(frame, node);
  }

  function isFunctionNode(node: Node): boolean {
    return (
      node != null &&
      (node.type === "ArrowFunctionExpression" ||
        node.type === "FunctionExpression" ||
        node.type === "FunctionDeclaration")
    );
  }

  function isCallNode(node: Node): boolean {
    return node != null && (node.type === "CallExpression" || node.type === "OptionalCallExpression");
  }

  function isMemberNode(node: Node): boolean {
    return node != null && (node.type === "MemberExpression" || node.type === "OptionalMemberExpression");
  }

  function isContextInit(node: Node): boolean {
    const inner = unwrap(node);
    return inner != null && contextCalls.some((call) => call === inner);
  }

  function isImportedSymbol(symbol: YukuSymbol): boolean {
    if (moduleInfo.imports.some((record) => record.local?.id === symbol.id)) return true;
    const definition = symbol.definition();
    return definition != null && definition.module.path !== moduleInfo.path;
  }

  function tracesToOwnProps(node: Node, seen: Set<number> = new Set()): boolean {
    const expression = unwrap(node);
    if (expression == null) return false;
    if (expression.type === "Identifier") {
      const symbol = moduleInfo.referenceOf(expression)?.symbol ?? null;
      if (symbol === null) return false;
      if (ownPropsSymbol !== null && symbol.id === ownPropsSymbol.id) return true;
      if (seen.has(symbol.id)) return false;
      seen.add(symbol.id);
      return declarationTracesToOwnProps(symbol, seen);
    }
    if (isMemberNode(expression)) return tracesToOwnProps(expression.object, seen);
    return false;
  }

  function callTakesOwnProps(call: Node, seen: Set<number>): boolean {
    for (const argument of call.arguments ?? []) {
      if (argument == null) continue;
      if (argument.type === "SpreadElement") {
        if (tracesToOwnProps(argument.argument, seen)) return true;
        continue;
      }
      if (tracesToOwnProps(argument, seen)) return true;
    }
    return false;
  }

  function declarationTracesToOwnProps(symbol: YukuSymbol, seen: Set<number>): boolean {
    if (symbol.declarations.length !== 1) return false;
    let node: Node = symbol.declarations[0];
    for (let depth = 0; node != null && depth < 8; depth++) {
      const parent: Node = moduleInfo.parentOf(node);
      if (parent == null) return false;
      if (parent.type === "VariableDeclarator") {
        const init = parent.init == null ? null : unwrap(parent.init);
        if (init == null) return false;
        if (isCallNode(init)) return callTakesOwnProps(init, seen);
        return tracesToOwnProps(init, seen);
      }
      node = parent;
    }
    return false;
  }

  function classIfComponentParam(declaration: Node): RecordableBindingClass | null {
    let node: Node = declaration;
    let sawRest = false;
    for (let depth = 0; node != null && depth < 8; depth++) {
      const parent: Node = moduleInfo.parentOf(node);
      if (parent == null) return null;
      if (parent.type === "RestElement") sawRest = true;
      if (
        parent.type === "FunctionDeclaration" ||
        parent.type === "FunctionExpression" ||
        parent.type === "ArrowFunctionExpression"
      ) {
        if (parent !== component.fn) return null;
        return sawRest ? "derived-rest-props-result" : "own-props-parameter";
      }
      if (parent.type === "VariableDeclarator") return null;
      node = parent;
    }
    return null;
  }

  function classFromDeclaration(symbol: YukuSymbol): RecordableBindingClass | null {
    if (symbol.declarations.length !== 1) return null;
    const declaration: Node = symbol.declarations[0];
    if (declaration == null) return null;

    const paramClass = classIfComponentParam(declaration);
    if (paramClass !== null) return paramClass;

    const declParent: Node = moduleInfo.parentOf(declaration);
    if (declParent != null && declParent.type === "FunctionDeclaration" && declParent.id === declaration) {
      return "other-function-value";
    }

    let node: Node = declaration;
    let sawRest = false;
    for (let depth = 0; node != null && depth < 8; depth++) {
      const parent: Node = moduleInfo.parentOf(node);
      if (parent == null) break;
      if (parent.type === "RestElement") sawRest = true;
      if (parent.type === "VariableDeclarator") {
        const init = parent.init == null ? null : unwrap(parent.init);
        if (init == null) return null;
        if (isContextInit(init)) return "context-value";
        if (isCallNode(init) && callTakesOwnProps(init, new Set())) return "derived-rest-props-result";
        if (sawRest && tracesToOwnProps(init)) return "derived-rest-props-result";
        if (tracesToOwnProps(init)) return "own-props-parameter";
        if (literalValue(init).ok) return "local-literal-const";
        if (isFunctionNode(init)) return "other-function-value";
        return null;
      }
      node = parent;
    }
    return null;
  }

  function classOfResolvedSymbol(symbol: YukuSymbol | null): RecordableBindingClass {
    if (symbol === null) return "unresolvable";
    if (accessors.has(symbol.id)) return "signal-getter";
    if (readSlots.has(symbol.id) || actionSlots.has(symbol.id)) return "context-value";
    if (ownPropsSymbol !== null && symbol.id === ownPropsSymbol.id) return "own-props-parameter";
    if (isImportedSymbol(symbol)) return "module-import";
    return classFromDeclaration(symbol) ?? "unresolvable";
  }

  function classOfSimpleExpression(node: Node | null): RecordableBindingClass | null {
    if (node == null) return "unresolvable";
    const expression = unwrap(node);
    if (expression == null) return "unresolvable";
    if (expression.type === "ChainExpression") return classOfSimpleExpression(expression.expression);
    if (literalValue(expression).ok) return "local-literal-const";
    if (isFunctionNode(expression)) return "other-function-value";
    if (expression.type === "Identifier") {
      return classOfResolvedSymbol(moduleInfo.referenceOf(expression)?.symbol ?? null);
    }
    if (isMemberNode(expression)) {
      if (expression.computed === true) return "unresolvable";
      return classOfSimpleExpression(expression.object);
    }
    if (isCallNode(expression)) return classOfSimpleExpression(expression.callee);
    return null;
  }

  /**
   * One recorded class for an attribute-cargo expression, using this pass's
   * own `referenceOf` / `definition` / accessor / import / context maps.
   * Mixed free bindings are `unresolvable`.
   */
  function recordableClassOf(node: Node | null): RecordableBindingClass {
    const simple = classOfSimpleExpression(node);
    if (simple !== null) return simple;
    if (node == null) return "unresolvable";

    const classes = new Set<RecordableBindingClass>();
    for (const ident of moduleInfo.findAll("Identifier")) {
      if (!contains(node, ident)) continue;
      const reference = moduleInfo.referenceOf(ident);
      if (reference == null || reference.inTypePosition) continue;
      classes.add(classOfResolvedSymbol(reference.symbol));
    }
    if (classes.size === 1) {
      const [only] = classes;
      return only ?? "unresolvable";
    }
    return "unresolvable";
  }

  function cargoOfOpening(frame: Frame, attributes: Node[]): AttributeCargoRecord[] {
    const cargo: AttributeCargoRecord[] = [];
    for (const attribute of attributes) {
      const kind = attributeKindOf(attribute);
      if (kind.class === "spread-of-identifier") {
        cargo.push({ role: "spread-of-identifier", class: recordableClassOf(unwrap(attribute.argument)) });
        continue;
      }
      if (kind.class === "spread-of-call" || kind.class === "spread-of-other") {
        cargo.push({ role: kind.class, class: "unresolvable" });
        continue;
      }
      if (attribute.name?.type !== "JSXIdentifier") {
        cargo.push({ role: "dynamic-attribute", class: "unresolvable" });
        continue;
      }
      const propName: string = attribute.name.name;
      if (EVENT_PROP.exec(propName) !== null) {
        const expression =
          attribute.value?.type === "JSXExpressionContainer" ? unwrap(attribute.value.expression) : null;
        cargo.push({ role: "handler-valued", class: recordableClassOf(expression) });
        continue;
      }
      if (attribute.value == null) continue;
      if (attributeText(frame, attribute) !== undefined) continue;
      const expression =
        attribute.value.type === "JSXExpressionContainer" ? unwrap(attribute.value.expression) : attribute.value;
      cargo.push({ role: "dynamic-attribute", class: recordableClassOf(expression) });
    }
    return cargo;
  }

  /**
   * Snapshot of every sink the attribute audit may write. The diagnostic path
   * runs the same loop as an intrinsic, then restores, so flag-ON cannot move
   * a reason, handler, binding, or escape-audit set.
   */
  function snapshotAuditState(): {
    reasons: number;
    handlers: number;
    bindings: number;
    slotReads: Set<Node>;
    derivedReads: Set<Node>;
    arrayRef: Set<Node>;
  } {
    return {
      reasons: reasons.length,
      handlers: handlers.length,
      bindings: sink.bindings.length,
      slotReads: new Set(slotReads),
      derivedReads: new Set(derivedReads),
      arrayRef: new Set(seenThroughArrayRef),
    };
  }

  function restoreAuditState(snap: ReturnType<typeof snapshotAuditState>): void {
    reasons.length = snap.reasons;
    handlers.length = snap.handlers;
    sink.bindings.length = snap.bindings;
    slotReads.clear();
    for (const node of snap.slotReads) slotReads.add(node);
    derivedReads.clear();
    for (const node of snap.derivedReads) derivedReads.add(node);
    seenThroughArrayRef.clear();
    for (const node of snap.arrayRef) seenThroughArrayRef.add(node);
  }

  /**
   * THE attribute audit: the loop an intrinsic runs at the opening. One
   * function, two callers — the templating path keeps the string; the
   * diagnostic path records codes and rolls the sinks back. A copy of these
   * rules anywhere else is the drift this instrument exists to prevent.
   */
  function auditOpeningAttributes(
    frame: Frame,
    attributes: Node[],
    locator: string,
    tag: string,
    onKind?: (kind: AttributeKindRecord) => void,
  ): string {
    let open = "";

    for (const attribute of attributes) {
      onKind?.(attributeKindOf(attribute));

      if (attribute.type === "JSXSpreadAttribute") {
        const spread = collectMeasuredRestSpread(frame, attribute, locator);
        if (spread !== null) {
          open += spread;
          continue;
        }
        frame.refuse("jsx-spread", "Spread attributes hide the element's real props.", attribute);
        continue;
      }
      if (attribute.name.type !== "JSXIdentifier") {
        frame.refuse("jsx-dynamic-attribute", "Namespaced attributes are not supported.", attribute);
        continue;
      }

      const propName: string = attribute.name.name;
      const event = EVENT_PROP.exec(propName);
      if (event !== null) {
        collectHandler(frame, attribute, event[1].toLowerCase(), locator);
        continue;
      }

      if (attribute.value == null) {
        open += ` ${ATTRIBUTE_ALIASES[propName] ?? propName}=""`;
        continue;
      }

      const rendered = attributeText(frame, attribute);
      if (rendered !== undefined) {
        open += renderAttribute(ATTRIBUTE_ALIASES[propName] ?? propName, rendered);
        continue;
      }

      // Not static. Three fixed shapes are admitted anyway, because the pass can
      // say exactly what they do: a class list folded into named conditions, one
      // attribute whose value is a derivation this pass already folds, and an
      // own-frame array-ref whose every element is a local setter or an
      // identity-class member path.
      const bound = CLASS_PROPS.has(propName)
        ? collectClassBinding(frame, attribute, locator)
        : propName === "ref"
          ? (collectArrayRefWiring(frame, attribute, locator) ??
            collectAttributeBinding(frame, attribute, propName, tag, locator))
          : collectAttributeBinding(frame, attribute, propName, tag, locator);
      if (bound !== null) {
        open += bound;
        continue;
      }

      frame.refuse(
        "jsx-dynamic-attribute",
        `Attribute \`${propName}\` is computed, so its rendered value is not static.`,
        attribute,
      );
    }

    return open;
  }

  /**
   * Runs {@link auditOpeningAttributes} on a refused component element and
   * keeps only the recorded codes and kinds. Verdict, reasons, template, and
   * artifacts stay what the refuse path already produced.
   */
  function recordMaskedAttributeAudit(frame: Frame, element: Node, locator: string): void {
    const opening = element.openingElement;
    const name = opening.name;
    const tag = name.type === "JSXIdentifier" ? name.name : "";
    const kinds: AttributeKindRecord[] = [];
    const snap = snapshotAuditState();
    auditOpeningAttributes(frame, opening.attributes, locator, tag, (kind) => kinds.push(kind));
    const codes = reasons.slice(snap.reasons);
    restoreAuditState(snap);
    const cargo = cargoOfOpening(frame, opening.attributes);
    attributeDiagnostics.push({
      locator,
      loc: locOf(element),
      codes,
      attributes: kinds,
      cargo,
      entireCargoCandidateRecordable: cargo.every((item) => isCandidateRecordable(item.class)),
    });
  }

  /**
   * Validates one element, collects its bindings/handlers, and builds its HTML.
   *
   * `parentTag` is the tag of the element this one is written INSIDE, in the
   * served markup rather than in the JSX — `visitChildren` is the only caller
   * that knows one, and a `<Show>` passes its own down because a region's branch
   * lands exactly where the region does. Only `tryAddressChild` reads it, and
   * only to refuse: `null` means "no enclosing element", which is the root's
   * case and is never a reparse.
   *
   * `templating` says whether this call's markup is KEPT. False on every walk
   * reached through `visitNode`, where the return value is discarded and the
   * visit exists only to collect refusals.
   */
  function visitElement(
    frame: Frame,
    element: Node,
    locator: string,
    parentTag: string | null = null,
    templating = true,
  ): string {
    const opening = element.openingElement;
    const name = opening.name;

    // Reached, before anything is decided about the element: every prop of an
    // element the walk entered is an expression this page's markup consumes —
    // an intrinsic attribute, a listener, a `<Show>`'s guard, a `<For>`'s list,
    // a spliced child's prop. What is deliberately NOT reached here is the
    // element's children, which have their own visits and their own answer.
    for (const attribute of opening.attributes) reach(frame, attribute);

    if (isComponentElement(element)) {
      // Control flow first: `<Show>` resolves outside the analyzed file set, so
      // the splice below could never see through it anyway.
      const region = tryShowRegion(frame, element, locator, parentTag, templating);
      if (region !== null) return region;

      // One hop. Anything the splice cannot prove returns null and lands below.
      const spliced = tryInlineComponent(frame, element, locator);
      if (spliced !== null) return spliced;

      // Recorded-constant tag on the omit/guard/Dynamic body: splice an
      // intrinsic and reuse the opening audit. Any other tag valuation
      // returns null and lands on `jsx-component-element` exactly as today.
      const folded = templating ? tryFoldElementIndirection(frame, element, locator) : null;
      if (folded !== null) return folded;

      // The child the parent could not absorb may still be one it can ADDRESS:
      // a hole here, and the child's own artifacts filling it.
      const addressed = templating ? tryAddressChild(frame, element, locator, parentTag) : null;
      if (addressed !== null) return addressed;

      frame.refuse(
        "jsx-component-element",
        "The markup contains a nested component; only intrinsic elements can be templated statically.",
        element,
      );
      // Children carry their own codes; ATTRIBUTES are deliberately not audited
      // into the verdict, since on a component element they are props, not
      // rendered attributes. The opt-in diagnostic reuses the same audit and
      // rolls it back, so nothing here becomes a reason or a template byte.
      if (unmaskAttributeAudit) recordMaskedAttributeAudit(frame, element, locator);
      jsxChildren(element).forEach((child, index) => visitNode(frame, child, childLocator(locator, index)));
      return "";
    }

    return visitIntrinsicElement(frame, name.name, opening.attributes, element, locator);
  }

  /**
   * THE intrinsic opening: tag + `auditOpeningAttributes` + children. The
   * element-indirection fold calls this with a recorded tag and the call-site
   * attributes minus the tag key so those rules are never copied.
   */
  function visitIntrinsicElement(
    frame: Frame,
    tag: string,
    attributes: Node[],
    element: Node,
    locator: string,
  ): string {
    let open = `<${tag}`;
    open += auditOpeningAttributes(frame, attributes, locator, tag);
    open += ">";
    if (VOID_ELEMENTS.has(tag)) return open;

    return open + visitChildren(frame, element, locator, tag) + `</${tag}>`;
  }

  /**
   * The static value an attribute renders to, or undefined: a string literal in
   * the component's own frame, plus `props.X` standing for a call-site literal
   * inside an inlined child — admitted only when the derivation folds with no
   * capture slots, which is what makes it static rather than a binding.
   * `undefined` means "not static"; `null` is a folded value like any other.
   */
  function attributeText(frame: Frame, attribute: Node): StaticValue | undefined {
    const literal = literalValue(attribute.value);
    if (literal.ok && typeof literal.value === "string") return literal.value;

    if (attribute.value?.type !== "JSXExpressionContainer") return undefined;
    const expression = unwrap(attribute.value.expression);
    if (expression == null || expression.type === "JSXEmptyExpression") return undefined;

    if (frame.props === null) {
      const recorded = recordedValueOf(expression);
      if (recorded === null || recorded.slots.length > 0 || recorded.measured) return undefined;
      return recorded.value;
    }

    const derived = derive(frame.mod, expression, null, frame);
    if (derived === null || derived.slots.length > 0 || derived.measured) return undefined;
    return derived.value;
  }

  /**
   * One attribute, rendered the way HTML states it. A boolean is presence, not
   * text: `true` is the empty attribute and `false` is no attribute at all, which
   * is the rule Solid's own `setAttribute` follows. Everything else is its text.
   */
  function renderAttribute(name: string, value: StaticValue): string {
    if (value === false || value === null) return "";
    if (value === true) return ` ${name}=""`;
    return ` ${name}="${escapeAttribute(String(value))}"`;
  }

  /**
   * An own-frame `ref={[setter, identityPath, …]}`. Returns `""` (refs are not
   * markup) when every element is a local setter with no references outside
   * the array, or an identity-class member path. Otherwise null, so the
   * attribute stays refused.
   *
   * Cargo is an attribute binding `{ attribute: "ref", locator, captures }`:
   * write slots are cell-write targets, identity slots are forwarded-path
   * targets. Resume replays those targets onto the located element before
   * effects run. Offered only in the component's own frame — an inlined
   * child's `ref` is not this component's cell table.
   */
  function collectArrayRefWiring(frame: Frame, attribute: Node, locator: string): string | null {
    if (frame.props !== null) return null;
    if (attribute.value?.type !== "JSXExpressionContainer") return null;
    const expression = unwrap(attribute.value.expression);
    if (expression == null || expression.type !== "ArrayExpression") return null;
    if (expression.elements.length === 0) return null;

    const slots: CaptureSlot[] = [];
    const setterNodes: Node[] = [];

    for (const raw of expression.elements as Node[]) {
      if (raw == null || raw.type === "SpreadElement") return null;
      const element = unwrap(raw);
      if (element == null) return null;

      if (element.type === "Identifier") {
        const symbol = frame.mod.referenceOf(element)?.symbol ?? null;
        const accessor = symbol === null ? undefined : accessors.get(symbol.id);
        if (accessor !== undefined && accessor.access === "write" && accessor.derived !== true) {
          for (const reference of symbol!.references) {
            if (reference.inTypePosition) continue;
            if (!contains(expression, reference.node)) return null;
          }
          slots.push({ name: accessor.name, cell: accessor.cellId, access: "write" });
          setterNodes.push(element);
          continue;
        }
      }

      if (
        element.type === "MemberExpression" &&
        element.computed !== true &&
        element.property?.type === "Identifier"
      ) {
        const object = unwrap(element.object);
        if (object != null && object.type === "Identifier") {
          const symbol = frame.mod.referenceOf(object)?.symbol ?? null;
          const read = symbol === null ? undefined : readSlots.get(symbol.id);
          if (read !== undefined && read.path.length === 0) {
            frame.refuse(
              "jsx-dynamic-attribute",
              "A ref array element names a store member, and a store capture is not emittable in a ref binding.",
              element,
              { reason: "ref-store-slot-not-emittable", store: read.store, path: [element.property.name] },
            );
            return "";
          }
        }
      }

      const source = sourceBindingOf(element);
      if (source === null || source.path.length === 0) return null;
      const member = String(source.path[source.path.length - 1]);
      slots.push({
        name: member,
        kind: "identity",
        bindingClass: source.class,
        source: { name: source.name, path: source.path },
      });
    }

    for (const node of setterNodes) seenThroughArrayRef.add(node);

    sink.bindings.push({
      id: `${sink.prefix}b${sink.bindings.length}`,
      kind: "attribute",
      locator,
      attribute: "ref",
      property: false,
      captures: sortedSlots(slots),
      expression: "undefined",
      initialValue: null,
      initialValueFrom: "derivation",
      origin: "component",
      loc: frame.locOf(attribute),
    });

    return "";
  }

  /**
   * An own-frame identifier rest-spread of an identity-class binding.
   * Bakes nothing: capture measures the attribute set, resume replays a
   * spread assign. Call-valued and non-identity spreads stay refused.
   */
  function collectMeasuredRestSpread(frame: Frame, attribute: Node, locator: string): string | null {
    if (frame.props !== null) return null;
    const argument = unwrap(attribute.argument);
    if (argument == null || argument.type !== "Identifier") return null;
    const source = sourceBindingOf(argument);
    if (source === null) return null;

    sink.bindings.push({
      id: `${sink.prefix}b${sink.bindings.length}`,
      kind: "spread",
      locator,
      captures: sortedSlots([
        {
          name: argument.name,
          kind: "identity",
          bindingClass: source.class,
          source: { name: source.name, path: source.path },
        },
      ]),
      expression: argument.name,
      initialFrom: "capture",
      origin: "component",
      loc: frame.locOf(attribute),
    });

    return "";
  }

  /**
   * One attribute whose value is a derivation rather than a constant — the
   * `checked={done()}` shape. Returns the markup the template carries for it, or
   * null to leave the attribute refused.
   *
   * Two of these render nothing. A PROPERTY-backed attribute is DOM state markup
   * cannot state at all (a checkbox's checkedness is not its `checked`
   * attribute), so the artifact carries the folded value and the resume side
   * writes it. A MEASURED derivation — one reaching through a store read — has no
   * build-time answer, so the attribute is a hole a capture fills, exactly as a
   * measured text binding's text is.
   */
  function collectAttributeBinding(
    frame: Frame,
    attribute: Node,
    propName: string,
    tag: string,
    locator: string,
  ): string | null {
    if (attribute.value?.type !== "JSXExpressionContainer") return null;
    const expression = unwrap(attribute.value.expression);
    if (expression == null || expression.type === "JSXEmptyExpression") return null;

    const derived = deriveCondition(frame, expression);
    if (derived === null) return null;
    // A non-measured identity would reach template bytes. Measured identity
    // bakes nothing: capture fills the hole.
    if (derived.slots.some(isIdentitySlot) && !derived.measured) return null;

    const name = ATTRIBUTE_ALIASES[propName] ?? propName;
    const property = STATE_PROPERTIES[tag]?.has(propName) === true;
    const initialValue = derived.measured ? null : derived.value;

    sink.bindings.push({
      id: `${sink.prefix}b${sink.bindings.length}`,
      kind: "attribute",
      locator,
      attribute: name,
      property,
      captures: sortedSlots(derived.slots),
      expression: derived.source,
      initialValue,
      initialValueFrom: derived.measured ? "capture" : "derivation",
      origin: derived.inlined ? "helper" : "component",
      loc: frame.locOf(attribute),
      slotRewrites: derived.rewrites,
    });

    if (property || derived.measured) return "";
    return renderAttribute(name, initialValue);
  }

  /**
   * Solid's array-of-string-and-object `class` form, folded into a class-list
   * record: the names the markup carries unconditionally, and the names a
   * derivation decides. Returns the `class` attribute the template carries, or
   * null to leave it refused.
   *
   * The fold is the whole admission. A condition that folds with no capture slots
   * can never change, so it collapses into the static names and no binding
   * records it; a class list where every condition collapses is an ordinary
   * static attribute. What survives is a NAMED set, which is what lets the resume
   * side add and remove without touching a class it does not own.
   */
  function collectClassBinding(frame: Frame, attribute: Node, locator: string): string | null {
    if (attribute.value?.type !== "JSXExpressionContainer") return null;
    const value = unwrap(attribute.value.expression);
    if (value == null) return null;

    // `class={["a", { b: cond }]}` and the degenerate `class={{ b: cond }}`.
    const parts: Node[] =
      value.type === "ArrayExpression"
        ? (value.elements as Node[]).filter((element: Node) => element != null).map((element: Node) => unwrap(element))
        : value.type === "ObjectExpression"
          ? [value]
          : [];
    if (parts.length === 0) return null;

    const statics: string[] = [];
    const conditions: ClassConditionInfo[] = [];
    const slots = new Map<string, CaptureSlot>();
    const rewrites: SlotRewrite[] = [];
    let measured = false;
    let inlined = false;

    /** A class name is one word: Solid splits a spaced key, and a fold that
     * splits is a fold that has to re-join, so the multi-word key is refused. */
    const addStatic = (name: string): boolean => {
      if (name === "" || /\s/.test(name)) return false;
      if (!statics.includes(name)) statics.push(name);
      return true;
    };

    for (const part of parts) {
      if (part.type === "Literal" || part.type === "TemplateLiteral") {
        const literal = literalValue(part);
        if (!literal.ok || typeof literal.value !== "string") return null;
        if (!addStatic(literal.value)) return null;
        continue;
      }

      if (part.type !== "ObjectExpression") return null;

      for (const property of part.properties as Node[]) {
        // A spread hides which names the object carries, and a computed key is a
        // name chosen at runtime — neither can be recorded as a named set.
        if (property.type !== "Property" || property.computed === true) return null;

        const key = property.key;
        const name =
          key?.type === "Identifier"
            ? key.name
            : key?.type === "Literal" && typeof key.value === "string"
              ? key.value
              : null;
        if (name === null || name === "" || /\s/.test(name)) return null;

        const condition = deriveCondition(frame, property.value);
        if (condition === null) return null;
        if (condition.slots.some(isIdentitySlot)) return null;

        if (condition.slots.length === 0 && !condition.measured) {
          // Nothing can ever change it, so it is not a binding: it is a name the
          // markup carries or one it does not.
          if (condition.value && !addStatic(name)) return null;
          continue;
        }

        measured = measured || condition.measured;
        inlined = inlined || condition.inlined;
        for (const slot of condition.slots) slots.set(slot.name, slot);
        rewrites.push(...condition.rewrites);
        conditions.push({
          name,
          expression: condition.source,
          initial: !condition.measured && Boolean(condition.value),
        });
      }
    }

    // Solid renders this list by adding every truthy name in order, so the
    // markup's class attribute is exactly those names, and absent when none.
    const names = measured
      ? statics
      : [...statics, ...conditions.filter((condition) => condition.initial).map((condition) => condition.name)];

    if (conditions.length > 0) {
      sink.bindings.push({
        id: `${sink.prefix}b${sink.bindings.length}`,
        kind: "class",
        locator,
        statics,
        conditions,
        initialFrom: measured ? "capture" : "derivation",
        captures: sortedSlots([...slots.values()]),
        origin: inlined ? "helper" : "component",
        loc: frame.locOf(attribute),
        slotRewrites: rewrites,
      });
    }

    return names.length === 0 ? "" : ` class="${escapeAttribute(names.join(" "))}"`;
  }

  /** Capture slots in one stable order, deduplicated by name upstream. */
  function sortedSlots(slots: CaptureSlot[]): CaptureSlot[] {
    const byName = new Map<string, CaptureSlot>();
    for (const slot of slots) byName.set(slot.name, slot);
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * The derivation walk plus the boolean shapes an attribute or a class
   * condition needs: negation, a strict comparison, and `&&` / `||` of
   * those same shapes. Deliberately NOT part of `derive` itself — a text
   * child that compares two values is a different question, asked in a
   * different slice, and widening the walk here would answer it by accident.
   */
  function deriveCondition(
    frame: Frame,
    node: Node,
    env: Map<number, ParameterBinding> | null = null,
    mod: Module = frame.mod,
  ): Derived | null {
    const expression = unwrap(node);
    if (expression == null) return null;

    if (expression.type === "UnaryExpression" && expression.operator === "!") {
      const argument = deriveCondition(frame, expression.argument, env, mod);
      if (argument === null) return null;
      const rewrites = argument.rewrites;
      return {
        value: argument.measured ? false : !argument.value,
        measured: argument.measured,
        slots: argument.slots,
        // Parenthesized when reassembled, for the reason arithmetic is.
        source: derivedSource(expression, {
          inlined: argument.inlined,
          source: `!(${argument.source})`,
          rewrites,
        }),
        inlined: argument.inlined,
        rewrites,
      };
    }

    if (expression.type === "LogicalExpression" && LOGICAL.has(expression.operator)) {
      const left = deriveCondition(frame, expression.left, env, mod);
      const right = deriveCondition(frame, expression.right, env, mod);
      if (left === null || right === null) return null;
      const measured = left.measured || right.measured;
      const inlined = left.inlined || right.inlined;
      const rewrites = joinRewrites(left.rewrites, right.rewrites);
      return {
        value: measured
          ? false
          : expression.operator === "&&"
            ? left.value && right.value
            : left.value || right.value,
        measured,
        slots: [...left.slots, ...right.slots],
        source: derivedSource(expression, {
          inlined,
          source: `(${left.source} ${expression.operator} ${right.source})`,
          rewrites,
        }),
        inlined,
        rewrites,
      };
    }

    if (expression.type === "BinaryExpression" && COMPARISON.has(expression.operator)) {
      const left = deriveCondition(frame, expression.left, env, mod);
      const right = deriveCondition(frame, expression.right, env, mod);
      if (left === null || right === null) return null;
      const measured = left.measured || right.measured;
      const inlined = left.inlined || right.inlined;
      const rewrites = joinRewrites(left.rewrites, right.rewrites);
      return {
        value: measured ? false : compare(expression.operator, left.value, right.value),
        measured,
        slots: [...left.slots, ...right.slots],
        source: derivedSource(expression, {
          inlined,
          source: `(${left.source} ${expression.operator} ${right.source})`,
          rewrites,
        }),
        inlined,
        rewrites,
      };
    }

    if (
      expression.type === "BinaryExpression" &&
      (expression.operator === "==" || expression.operator === "!=") &&
      nullLiteralSide(expression) !== null
    ) {
      const left = deriveCondition(frame, expression.left, env, mod);
      const right = deriveCondition(frame, expression.right, env, mod);
      if (left === null || right === null) return null;
      const measured = left.measured || right.measured;
      const inlined = left.inlined || right.inlined;
      const rewrites = joinRewrites(left.rewrites, right.rewrites);
      return {
        value: measured ? false : compare(expression.operator, left.value, right.value),
        measured,
        slots: [...left.slots, ...right.slots],
        source: derivedSource(expression, {
          inlined,
          source: `(${left.source} ${expression.operator} ${right.source})`,
          rewrites,
        }),
        inlined,
        rewrites,
      };
    }

    return derive(mod, expression, env, frame);
  }

  // -------------------------------------------------------- two-state regions

  /**
   * One `<Show>`, admitted as a two-state region in the state the build records
   * — or null, leaving the element to the refusals under it.
   *
   * The region is a GUARD, not a toggle. Present, it is ordinary markup and its
   * child is walked like any other element. Absent, it has no DOM, and its child
   * is not walked at all: nothing inside it is templated, bound, wired or even
   * audited, because nothing inside it exists on the served page and nothing on
   * the resume path will ever create it. A store write that would flip the guard
   * is a store event, and a store event belongs to the group, which renders the
   * component the ordinary way — so this pass never owes the page a `<Show>` it
   * has to build after the fact.
   *
   * The guard is therefore allowed to reach a store and forbidden to reach a
   * source cell: the store's writer is the group, the cell's writer is a resumed
   * handler on this very page. A guard the page itself can flip would need DOM
   * this design does not create, so it is refused by name rather than pinned.
   */
  function tryShowRegion(
    frame: Frame,
    element: Node,
    locator: string,
    parentTag: string | null,
    templating: boolean,
  ): string | null {
    // The component's own frame only. Through a props boundary the guard would
    // have to fold across a second hop, which see-through does not do.
    if (frame.props !== null || frame.mod !== moduleInfo) return null;

    const name = element.openingElement.name;
    if (name.type !== "JSXIdentifier") return null;
    const symbol = frame.mod.referenceOf(name)?.symbol ?? null;
    if (symbol === null || !showSymbols.has(symbol.id)) return null;

    // `<Show when={…}><element /></Show>`, exactly. A `fallback`, a keyed form,
    // a render-prop child and two children are four other shapes, each with its
    // own answer, and none of them is this one — they fall through unchanged.
    const attributes: Node[] = element.openingElement.attributes;
    if (attributes.length !== 1) return null;
    const attribute: Node = attributes[0];
    if (attribute.type !== "JSXAttribute") return null;
    if (attribute.name?.type !== "JSXIdentifier" || attribute.name.name !== SHOW_GUARD_PROP) return null;
    if (attribute.value?.type !== "JSXExpressionContainer") return null;

    const children = jsxChildren(element);
    if (children.length !== 1 || children[0].type !== "JSXElement") return null;

    /** Reports the guard's refusal, then keeps walking: the branch was not
     * decided, but the markup under it is real code with its own defects. */
    const refuseGuard = (message: string): string => {
      frame.refuse("show-branch-not-static-at-capture", message, attribute);
      visitNode(frame, children[0], locator);
      return "";
    };

    const guard = unwrap(attribute.value.expression);
    const derived =
      guard == null || guard.type === "JSXEmptyExpression" ? null : deriveCondition(frame, guard);

    if (derived === null) {
      return refuseGuard(
        "A `<Show>` guard has to be a derivation this pass can fold or measure. This one is " +
          "neither, so which of the two branches the served markup carries cannot be settled " +
          "before the page runs — and a region whose state the build does not know is a region " +
          "the resume path would have to render.",
      );
    }

    const cell = derived.slots.find(isCellSlot);
    if (cell !== undefined) {
      return refuseGuard(
        `This \`<Show>\`'s guard reads \`${cell.name}\`, a source cell a resumed handler on this ` +
          "page writes. A region is a guard rather than a toggle: an absent one has no DOM and " +
          "nothing here builds it, so a guard this page can flip for itself is refused instead " +
          "of being quietly pinned to whatever it said at build time.",
      );
    }

    // A whole-bind read-through call is a method on the provider value, not a
    // data-slot projection. Recording the region absent would skip the child
    // and hide every refusal under it.
    if (derived.slots.some((slot) => isStoreReadSlot(slot) && slot.path.length === 0)) {
      return refuseGuard(
        "A `<Show>` guard that is a read-through call of a whole-bound context has no build-time " +
          "branch, and recording the region absent would skip markup this pass still has to see.",
      );
    }

    // A guard reaching into a store has no build-time answer, so the region is
    // recorded ABSENT and the page's captured first paint is what makes that a
    // fact: a capture carrying the region's markup fails the build's own
    // template check rather than shipping a shell the artifacts disagree with.
    const present = derived.measured ? false : Boolean(derived.value);

    regions.push({
      id: `r${regions.length}`,
      locator,
      when: derived.source,
      present,
      presentFrom: derived.measured ? "capture" : "derivation",
      captures: sortedSlots(derived.slots),
      loc: frame.locOf(element),
    });

    // The branch lands exactly where the region does, so it inherits the
    // region's own enclosing tag rather than starting a fresh content model.
    return present ? visitElement(frame, children[0], locator, parentTag, templating) : "";
  }

  // ------------------------------------------------------------ keyed regions

  /** True for a `<For>` this module imported from Solid. Spelling is irrelevant:
   * the symbol is resolved through the module's own import records. */
  function isForElement(frame: Frame, element: Node): boolean {
    const name = element.openingElement.name;
    if (name.type !== "JSXIdentifier") return false;
    const symbol = frame.mod.referenceOf(name)?.symbol ?? null;
    return symbol !== null && forSymbols.has(symbol.id);
  }

  /**
   * Adds one attribute to a rendered element's open tag, immediately before the
   * `>`. Last, not first, because the only other writer of this attribute is a
   * capture stage calling `setAttribute` on parsed markup, and every serializer
   * writes a newly set attribute after the ones the bytes already carried.
   * Quotes are tracked so a `>` inside an attribute VALUE is not mistaken for
   * the end of the tag.
   */
  function insertAttribute(markup: string, attribute: string): string {
    let quoted = false;
    for (let index = 0; index < markup.length; index++) {
      const character = markup[index];
      if (character === '"') quoted = !quoted;
      else if (character === ">" && !quoted) {
        const at = markup[index - 1] === "/" ? index - 1 : index;
        return markup.slice(0, at) + attribute + markup.slice(at);
      }
    }
    return markup;
  }

  /** The fixed key path a `<For>`'s `key` prop names, or null when it names one
   * this pass will not take. A string literal only: `"id"`, `"meta.id"`. */
  function keyPathOf(attribute: Node): (string | number)[] | null {
    const literal = literalValue(attribute.value);
    if (!literal.ok || typeof literal.value !== "string") return null;
    const path = literal.value.split(".");
    if (path.length === 0 || path.some((step) => step === "")) return null;
    return path;
  }

  /**
   * One `<For>`, admitted as a KEYED REGION — or null, leaving the element to
   * whatever refusal it already had.
   *
   * `container` is the locator of the element whose CHILDREN are the items, not
   * of the `<For>`: a `<For>` renders nothing the build can address, and the
   * address that survives into the served markup is its parent's. That is also
   * why the caller only offers a `<For>` that is its container's ONLY child —
   * the runtime walks every one of `container.children` and calls each one an
   * item, so a sibling would make that walk a lie.
   *
   * Everything past the "this really is Solid's `<For>`" test refuses BY NAME.
   * The five names are the five ways a list stops being readable:
   *
   *   `region-each-not-store-projection` — the list is not a projection of a
   *     store read, so it is a list this page could compute for itself, which is
   *     a list this page would have to RENDER. I1 dies there.
   *   `region-body-not-inline-arrow` — the body is not an inline arrow, so its
   *     item parameter is not a name this pass can factor an artifact over.
   *   `region-key-not-derivable` — including index-as-key. An index is POSITION,
   *     and I2 exists to escape position.
   *   `region-item-not-single-element` — an item that is not one element has no
   *     element to carry its key or root its locators.
   *   `region-nested` — a region inside a region is a second address space under
   *     the first, and nothing here reads two.
   */
  function tryKeyedRegion(frame: Frame, element: Node, container: string): string | null {
    // The component's own frame only, exactly as `<Show>`: through a props
    // boundary the list would have to fold across a second hop.
    if (frame.props !== null || frame.mod !== moduleInfo) return null;
    if (!isForElement(frame, element)) return null;

    // A `<For>` is offered the region straight from `visitChildren`, so this is
    // where its own props are consumed: the list, the key, and the body whose
    // item template the region renders.
    for (const attribute of element.openingElement.attributes) reach(frame, attribute);
    for (const child of jsxChildren(element)) reach(frame, child);

    if (insideRegion) {
      frame.refuse(
        "region-nested",
        "This `<For>` is inside another region's item. A region is one container and one " +
          "per-item address space; nesting a second one under the first would make an item's " +
          "locators depend on which list they were reached through, and nothing on the resume " +
          "path reads two.",
        element,
      );
      return "";
    }

    const attributes: Node[] = element.openingElement.attributes;
    const named = new Map<string, Node>();
    for (const attribute of attributes) {
      if (attribute.type !== "JSXAttribute" || attribute.name?.type !== "JSXIdentifier") continue;
      named.set(attribute.name.name, attribute);
    }

    const each = named.get(FOR_LIST_PROP);
    const unknown = [...named.keys()].filter((name) => name !== FOR_LIST_PROP && name !== FOR_KEY_PROP);
    if (each === undefined || each.value?.type !== "JSXExpressionContainer" || unknown.length > 0) {
      frame.refuse(
        "region-each-not-store-projection",
        "A keyed region is `<For each={…}>` with an optional `key`, and nothing else. " +
          `This one ${each === undefined ? "has no `each`" : `also takes \`${unknown.join("`, `")}\``}.`,
        element,
      );
      return "";
    }

    const list = unwrap(each.value.expression);
    const derived = list == null || list.type === "JSXEmptyExpression" ? null : deriveText(frame, list);
    const projection =
      derived !== null && derived.slots.length > 0 && derived.slots.every(isStoreReadSlot);

    if (!projection) {
      frame.refuse(
        "region-each-not-store-projection",
        "A keyed region's list has to be a projection of a store this pass admitted. This one " +
          "is not, so it is a list this page can compute for itself — and a list this page " +
          "computes is a list this page has to render, which is the one thing a resumed window " +
          "does not do.",
        each,
      );
      return "";
    }

    const children = jsxChildren(element);
    const body = children.length === 1 && children[0].type === "JSXExpressionContainer"
      ? unwrap(children[0].expression)
      : null;

    if (body == null || body.type !== "ArrowFunctionExpression") {
      frame.refuse(
        "region-body-not-inline-arrow",
        "A keyed region's body has to be an inline arrow taking the item. Anything else is a " +
          "function whose parameter this pass never saw, so there is no name to factor an " +
          "item's bindings and listeners over.",
        children[0] ?? element,
      );
      return "";
    }

    const parameters: Node[] = body.params;
    if (parameters.length !== 1 || parameters[0]?.type !== "Identifier") {
      frame.refuse(
        "region-key-not-derivable",
        "A keyed region's body takes the item and nothing else. Solid's second body parameter " +
          "is the item's INDEX, and an index is position — which is precisely what a key exists " +
          "to escape, so a body that asks for one is refused rather than keyed by it.",
        parameters[1] ?? body,
      );
      return "";
    }

    const keyAttribute = named.get(FOR_KEY_PROP);
    const keyPath = keyAttribute === undefined ? DEFAULT_KEY_PATH : keyPathOf(keyAttribute);
    if (keyPath === null) {
      frame.refuse(
        "region-key-not-derivable",
        "A `key` has to name a FIXED path read off the item — `key=\"id\"`, `key=\"meta.id\"`. A " +
          "function is a body this pass would have to read, and a computed key is an answer " +
          "only the running page has; neither is something the served markup can already carry.",
        keyAttribute!,
      );
      return "";
    }

    const returned = unwrap(body.body);
    const item =
      returned != null && returned.type === "JSXElement"
        ? returned
        : null;

    if (item === null) {
      frame.refuse(
        "region-item-not-single-element",
        "A keyed region's item has to be a single element. A fragment, a list or a bare " +
          "expression gives the item no element to carry its key on and nothing to root its " +
          "own locators at.",
        body.body ?? body,
      );
      return "";
    }

    // Committed: this is a region. Everything under it is walked in an address
    // space of its own — locators rooted at the ITEM, bindings in the region's
    // own list, handlers wired by key rather than by locator alone.
    const id = `k${keyedRegions.length}`;
    const parameter = parameters[0];
    // `symbolOf`, not `referenceOf`: the body parameter is a DECLARATION, and a
    // declaration is not a reference to itself.
    const parameterSymbol = moduleInfo.symbolOf(parameter);
    const slot: CaptureSlot & { kind: "region-item" } = {
      name: parameter.name,
      kind: "region-item",
      region: id,
    };
    if (parameterSymbol !== null) itemSlots.set(parameterSymbol.id, slot);

    const itemBindings: BindingInfo[] = [];
    const outerSink = sink;
    const handlerMark = handlers.length;
    sink = { bindings: itemBindings, prefix: id };
    insideRegion = true;
    const rendered = visitElement(frame, item, "/");
    insideRegion = false;
    sink = outerSink;

    const itemHandlers = handlers.slice(handlerMark);
    for (const handler of itemHandlers) regionHandlers.add(handler.id);

    keyedRegions.push({
      id,
      container,
      each: derived.source,
      captures: sortedSlots(derived.slots),
      item: parameter.name,
      keyPath,
      keyAttribute: KEY_ATTRIBUTE,
      itemTemplate: rendered === "" ? "" : insertAttribute(rendered, ` ${KEY_ATTRIBUTE}=""`),
      itemBindings,
      itemWiring: itemHandlers.map((handler) => ({
        locator: handler.locator,
        event: handler.event,
        module: handler.module,
        handler: handler.id,
        captures: handler.captures,
      })),
      loc: frame.locOf(element),
    });

    // The region contributes NO markup to the component's own template. The list
    // has no build-time value, so the container is served empty and whatever
    // items the page's own first paint carried are read out of the DOM — never
    // built here, which is I1 stated as an emitted fact rather than as a promise.
    return "";
  }

  function visitChildren(frame: Frame, element: Node, locator: string, tag: string): string {
    const children: Node[] = jsxChildren(element);

    if (children.length === 0) return "";

    // A keyed region owns its container's children WHOLESALE: the runtime walks
    // every one of `container.children` and calls each an item. So a `<For>` is
    // offered the region only where it is the container's one and only child;
    // beside a sibling it keeps whatever refusal it already had.
    if (children.length === 1 && children[0].type === "JSXElement") {
      const region = tryKeyedRegion(frame, children[0], locator);
      if (region !== null) return region;
    }

    if (children.length === 1 && children[0].type === "JSXText") {
      return escapeText(normalizeJsxText(children[0].value));
    }

    if (children.length === 1 && children[0].type === "JSXExpressionContainer") {
      return collectTextBinding(frame, children[0], locator);
    }

    if (children.every((child: Node) => child.type === "JSXElement")) {
      // Decided from the JSX shape before any child is walked: marker discipline
      // is a property of the CALL SITE, not of what a spliced child rendered.
      const placeholders = placeholdersAfter(children);

      // A locator is an ELEMENT index in the served markup, and an absent region
      // puts no element there — so the index advances per element PRODUCED, not
      // per JSX child written. Before two-state regions existed every child of a
      // provable component produced exactly one element, which is why this
      // counter leaves every locator emitted so far exactly where it was.
      let elementIndex = 0;
      let markup = "";
      for (const [index, child] of children.entries()) {
        const rendered = visitElement(frame, child, childLocator(locator, elementIndex), tag);
        if (rendered !== "") elementIndex += 1;
        markup += placeholders[index] ? rendered + COMPONENT_PLACEHOLDER : rendered;
      }
      return markup;
    }

    // Mixed text and dynamic children make child indices depend on how the
    // framework splits text nodes; refuse rather than guess.
    frame.refuse(
      "jsx-unsupported-children",
      "Element mixes text and expression children, so its child node positions are not statically knowable.",
      element,
    );
    // Keep walking anyway. No binding is recorded — their DOM positions are what
    // was just refused — but their own refusals are real.
    children.forEach((child, index) => visitNode(frame, child, childLocator(locator, index)));
    return "";
  }

  /** Derivable-or-not without recording a binding: used where the child
   * positions were already refused, so nothing could address the derivation. */
  function probeExpressionChild(frame: Frame, container: Node): void {
    reach(frame, container);
    const expression = unwrap(container.expression);
    if (expression == null || expression.type === "JSXEmptyExpression") return;
    const derived = deriveText(frame, expression);
    if (derived !== null && !(derived.slots.some(isIdentitySlot) && identityRecords === null)) return;
    frame.refuse(
      "jsx-dynamic-child-not-derivable",
      "This text child is not derivable from cell values and literals alone.",
      container,
    );
  }

  /** A lone expression child owns the element's text. The binding is addressed by
   * the ELEMENT's locator, and the derivation is kept as source. */
  function collectTextBinding(frame: Frame, container: Node, locator: string): string {
    reach(frame, container);
    const expression = unwrap(container.expression);
    if (expression == null || expression.type === "JSXEmptyExpression") return "";

    const derived = deriveText(frame, expression);
    if (derived === null || (derived.slots.some(isIdentitySlot) && identityRecords === null)) {
      frame.refuse(
        "jsx-dynamic-child-not-derivable",
        "This text child is not derivable from cell values and literals alone.",
        container,
      );
      return "";
    }

    const slots = new Map<string, CaptureSlot>();
    for (const slot of derived.slots) slots.set(slot.name, slot);

    // A derivation that reached through a store read has no build-time answer.
    // The text is left empty and marked as the capture's to supply — measured
    // out of the page's first paint at this same locator, where the byte-identical
    // captures are what make it a fact rather than a snapshot.
    const initialText = derived.measured ? "" : String(derived.value);
    sink.bindings.push({
      id: `${sink.prefix}b${sink.bindings.length}`,
      kind: "text",
      locator,
      captures: [...slots.values()].sort((a, b) => a.name.localeCompare(b.name)),
      // The author's expression, or the folded body: capture slots either way.
      expression: derived.source,
      initialText,
      initialTextFrom: derived.measured ? "capture" : "derivation",
      origin: derived.inlined ? "helper" : "component",
      // A binding lifted out of another module reports a location in THAT source.
      loc: frame.locOf(container),
      slotRewrites: derived.rewrites,
    });

    return escapeText(initialText);
  }

  /**
   * The zero-parameter framework-memo callback bound to `callee`, or null.
   * The memo itself is not a cell: see-through substitutes the callback
   * at each zero-argument call.
   */
  function memoCallbackNode(mod: Module, callee: Node): Node | null {
    if (callee.type !== "Identifier") return null;
    const symbol = mod.referenceOf(callee)?.symbol ?? null;
    if (symbol === null || symbol.declarations.length !== 1) return null;
    const declaration: Node = symbol.declarations[0];
    const parent: Node = mod.parentOf(declaration);
    if (parent == null || parent.type !== "VariableDeclarator" || parent.id !== declaration) {
      return null;
    }
    const init = unwrap(parent.init);
    if (init == null || init.type !== "CallExpression") return null;
    const initCallee = unwrap(init.callee);
    if (initCallee == null || initCallee.type !== "Identifier") return null;
    const initSymbol = mod.referenceOf(initCallee)?.symbol ?? null;
    if (initSymbol === null || !memoFactories.has(initSymbol.id)) return null;
    if (init.arguments.length < 1) return null;
    const callback = unwrap(init.arguments[0]);
    if (
      callback == null ||
      (callback.type !== "ArrowFunctionExpression" && callback.type !== "FunctionExpression")
    ) {
      return null;
    }
    if ((callback.params?.length ?? 0) !== 0) return null;
    return callback.body == null ? null : callback;
  }

  function singleReturnArgument(callback: Node): Node | null {
    if (callback.body == null) return null;
    if (callback.body.type !== "BlockStatement") return unwrap(callback.body);
    const returns = (callback.body.body as Node[]).filter(
      (statement: Node) => statement.type === "ReturnStatement",
    );
    if (returns.length !== 1 || returns[0].argument == null) return null;
    return unwrap(returns[0].argument);
  }

  function callbackHasWrite(callback: Node): boolean {
    let found = false;
    moduleInfo.walk(
      {
        AssignmentExpression: () => {
          found = true;
        },
        UpdateExpression: () => {
          found = true;
        },
        CallExpression: (node: Node) => {
          if (found) return;
          const callee = unwrap(node.callee);
          if (callee == null || callee.type !== "Identifier") return;
          const symbol = moduleInfo.referenceOf(callee)?.symbol ?? null;
          if (symbol === null) return;
          const accessor = accessors.get(symbol.id);
          if (accessor !== undefined && accessor.access === "write") found = true;
        },
      },
      callback,
    );
    return found;
  }

  function bindGuardedArg(
    frame: Frame,
    argument: Node,
    localSymbol: YukuSymbol | null,
    scrutinee: Derived,
  ): ParameterBinding | null {
    if (argument.type === "Identifier" && localSymbol !== null) {
      const argumentSymbol = moduleInfo.referenceOf(argument)?.symbol ?? null;
      if (argumentSymbol !== null && argumentSymbol.id === localSymbol.id) {
        return { kind: "value", derived: scrutinee };
      }
    }

    if (argument.type === "ObjectExpression") {
      const fields = new Map<string, Derived>();
      for (const property of argument.properties ?? []) {
        if (property.type !== "Property" || property.computed === true) return null;
        if (property.key?.type !== "Identifier") return null;
        const fieldNode = unwrap(property.value);
        if (fieldNode != null && fieldNode.type === "Identifier" && localSymbol !== null) {
          const fieldSymbol = moduleInfo.referenceOf(fieldNode)?.symbol ?? null;
          if (fieldSymbol !== null && fieldSymbol.id === localSymbol.id) {
            fields.set(property.key.name, scrutinee);
            continue;
          }
        }
        const field = derive(moduleInfo, property.value, null, frame);
        if (field === null) return null;
        fields.set(property.key.name, field);
      }
      return { kind: "object", fields };
    }

    const accessor = accessorOf(argument);
    if (accessor !== null) return { kind: "accessor", accessor };

    const derived = derive(moduleInfo, argument, null, frame);
    return derived === null ? null : { kind: "value", derived };
  }

  function joinTernary(test: Derived, consequent: Derived, alternate: Derived): Derived {
    const measured = test.measured || consequent.measured || alternate.measured;
    const inlined = test.inlined || consequent.inlined || alternate.inlined;
    const rewrites = joinRewrites(test.rewrites, consequent.rewrites, alternate.rewrites);
    return {
      value: measured ? "" : test.value ? consequent.value : alternate.value,
      measured,
      slots: [...test.slots, ...consequent.slots, ...alternate.slots],
      source: `(${test.source} ? ${consequent.source} : ${alternate.source})`,
      inlined,
      rewrites,
    };
  }

  function deriveDecisionTree(
    frame: Frame,
    tree: LiteralDecisionTree,
    env: Map<number, ParameterBinding>,
  ): Derived | null {
    const inner = new Map(env);
    for (const local of tree.locals) {
      const init = derive(tree.module, local.init, inner, frame);
      if (init === null) return null;
      const symbol = tree.module.symbolOf(local.local);
      if (symbol === null) return null;
      inner.set(symbol.id, { kind: "value", derived: init });
    }

    let current = deriveCondition(frame, tree.otherwise, inner, tree.module);
    if (current === null) return null;
    for (let index = tree.branches.length - 1; index >= 0; index--) {
      const branch = tree.branches[index];
      const test = deriveCondition(frame, branch.test, inner, tree.module);
      const value = deriveCondition(frame, branch.value, inner, tree.module);
      if (test === null || value === null) return null;
      current = joinTernary(test, value, current);
    }
    return current;
  }

  function deriveGuardedReturn(frame: Frame, match: Extract<GuardedReturnMatch, { kind: "exact" }>): Derived | null {
    const guard = literalValue(match.guardLiteral);
    if (!guard.ok) return null;

    const scrutinee = derive(moduleInfo, match.call, null, frame);
    if (scrutinee === null) return null;

    const args: Node[] = match.terminal.arguments ?? [];
    const localSymbol = moduleInfo.symbolOf(match.local);

    const bindArgs = (paramSymbols: YukuSymbol[]): Map<number, ParameterBinding> | null => {
      if (args.length !== paramSymbols.length) return null;
      const env = new Map<number, ParameterBinding>();
      for (let index = 0; index < args.length; index++) {
        const argument = unwrap(args[index]);
        if (argument == null) return null;
        const bound = bindGuardedArg(frame, argument, localSymbol, scrutinee);
        if (bound === null) return null;
        env.set(paramSymbols[index].id, bound);
      }
      return env;
    };

    const summary = summarize(moduleInfo, match.terminal.callee);
    let thenBranch: Derived | null = null;
    if (summary !== null) {
      const env = bindArgs(summary.paramSymbols);
      if (env !== null) {
        thenBranch = deriveCondition(frame, summary.returned, env, summary.module);
      }
    }
    if (thenBranch === null) {
      const tree = matchLiteralDecisionTree(moduleInfo, match.terminal.callee);
      if (tree === null) {
        return null;
      }
      const env = bindArgs(tree.paramSymbols);
      if (env === null) {
        return null;
      }
      thenBranch = deriveDecisionTree(frame, tree, env);
    }
    if (thenBranch === null) return null;

    const measured = scrutinee.measured || thenBranch.measured;
    const rewrites = joinRewrites(scrutinee.rewrites, thenBranch.rewrites);
    return {
      value: measured ? "" : scrutinee.value == null ? guard.value : thenBranch.value,
      measured,
      slots: [...scrutinee.slots, ...thenBranch.slots],
      source: `(${scrutinee.source} == null) ? ${JSON.stringify(guard.value)} : ${thenBranch.source}`,
      inlined: true,
      rewrites,
    };
  }

  function deriveMemoCallback(frame: Frame, callee: Node): Derived | null {
    const callback = memoCallbackNode(frame.mod, callee);
    if (callback === null) return null;

    const guarded = matchGuardedReturn(frame.mod, callback);
    if (guarded?.kind === "wider" || (guarded?.kind === "exact" && callbackHasWrite(callback))) {
      frame.refuse(
        "callee-body-not-guarded-return",
        "The callback body is not the admitted guarded-return shape: one const binding of a call, a null-guard that returns a literal, and a terminal call.",
        callback,
      );
      return null;
    }
    if (guarded?.kind === "exact") {
      return deriveGuardedReturn(frame, guarded);
    }

    const body = singleReturnArgument(callback);
    if (body === null) return null;
    return deriveCondition(frame, body);
  }

  function deriveText(frame: Frame, node: Node): Derived | null {
    return derive(frame.mod, node, null, frame);
  }

  /**
   * The derivation walk, in one of three frames. Null `env` and null
   * `frame.props` is the COMPONENT's own: an identifier means what its scope
   * says, a nullary call is a cell read. Null `env` with `frame.props` is an
   * INLINED CHILD's: only `props.X` resolves, and `props.count()` folds under the
   * PARENT's accessor name, since that is what the slot carries. A non-null `env`
   * is a HELPER frame, where the only bindings are the helper's parameters.
   * Neither non-own frame opens another, so see-through is one hop.
   */
  function derive(
    mod: Module,
    node: Node,
    env: Map<number, ParameterBinding> | null,
    frame: Frame,
  ): Derived | null {
    const expression = unwrap(node);
    if (expression == null) return null;
    if (expression.type === "ChainExpression") return derive(mod, expression.expression, env, frame);
    /** The author's own text, used whenever nothing beneath was substituted. */
    const verbatim = (): string => printExpression(expression);

    if (expression.type === "Literal") {
      const literal = literalValue(expression);
      return literal.ok
        ? { value: literal.value, slots: [], source: verbatim(), inlined: false, measured: false, rewrites: [] }
        : null;
    }

    if (isVoid0(expression)) {
      return { value: null, slots: [], source: verbatim(), inlined: false, measured: false, rewrites: [] };
    }

    // Only reachable in a helper frame: a parameter standing for a plain value.
    // The global `undefined` is a frozen initial in every frame, same seat as
    // the cell-initializer widening.
    if (expression.type === "Identifier") {
      if (isGlobalUndefined(mod, expression)) {
        return { value: null, slots: [], source: verbatim(), inlined: false, measured: false, rewrites: [] };
      }
      if (env === null) return null;
      const symbol = mod.referenceOf(expression)?.symbol ?? null;
      const bound = symbol === null ? undefined : env.get(symbol.id);
      if (bound === undefined || bound.kind !== "value") return null;
      return { ...bound.derived, inlined: true };
    }

    if (expression.type === "MemberExpression" || expression.type === "OptionalMemberExpression") {
      if (env !== null && expression.computed !== true && expression.property?.type === "Identifier") {
        const object = unwrap(expression.object);
        if (object != null && object.type === "Identifier") {
          const symbol = mod.referenceOf(object)?.symbol ?? null;
          const bound = symbol === null ? undefined : env.get(symbol.id);
          if (bound?.kind === "object") {
            const field = bound.fields.get(expression.property.name);
            return field === undefined ? null : { ...field, inlined: true };
          }
        }
      }

      // A read of the store's data: `state.todos.length`. The BASE is what was
      // proven — slot `path` of this provider's value — and the property chain
      // above it is the author's own expression, carried as source and evaluated
      // against the live store, never here.
      // Only in the component's OWN frame: a helper's parameters and a child's
      // props are the only bindings those frames have, and a store binding that
      // reached one of them left the component through a position this pass says
      // nothing about.
      const read = env === null && frame.props === null && mod === moduleInfo ? storeReadChain(expression) : null;
      if (read !== null) {
        derivedReads.add(read.base);
        const rewrites = [{ node: read.base, name: read.info.name }];
        return {
          value: "",
          slots: [{ name: read.info.name, kind: "store-read", store: read.info.store, path: read.info.path }],
          source: printWithSlotRewrites(expression, rewrites),
          inlined: false,
          measured: true,
          rewrites,
        };
      }

      // One item of a keyed region: `todo.title`. Identity again — the slot is
      // the item the KEY reached, and the chain above it is the author's own
      // expression. Measured for the same reason a store read is: at build time
      // there is no list, so the text is read out of the item's served markup.
      const itemRead =
        env === null && frame.props === null && mod === moduleInfo ? regionItemChain(expression) : null;
      if (itemRead !== null) {
        const base = memberBase(expression);
        const rewrites = base != null ? [{ node: base, name: itemRead.name }] : [];
        return {
          value: "",
          slots: [itemRead],
          source: printWithSlotRewrites(expression, rewrites),
          inlined: false,
          measured: true,
          rewrites,
        };
      }

      // Own-frame recorded props: a props-parameter member the call site froze.
      if (env === null && frame.props === null) {
        const recorded = recordedValueOf(expression);
        if (recorded !== null) return recorded;
        const identity = identityOf(expression);
        if (identity !== null) {
          const slot = identitySlotOf(identity);
          const base = memberBase(expression);
          const rewrites = base != null ? [{ node: base, name: slot.name }] : [];
          return {
            value: "",
            slots: [slot],
            source: printWithSlotRewrites(expression, rewrites),
            inlined: false,
            measured: true,
            rewrites,
          };
        }
        const standalone = standaloneIdentityMember(expression);
        if (standalone !== null) {
          const base = memberBase(expression);
          const rewrites = base != null ? [{ node: base, name: standalone.name }] : [];
          return {
            value: "",
            slots: [standalone],
            source: printWithSlotRewrites(expression, rewrites),
            inlined: false,
            measured: true,
            rewrites,
          };
        }
      }

      // Inlined-child frame only: `props.X` standing for a call-site literal.
      if (env !== null) return null;
      const bound = propBindingOf(frame, expression);
      if (bound === null || bound.kind !== "value") return null;
      return { ...bound.derived, inlined: true };
    }

    if (expression.type === "CallExpression" || expression.type === "OptionalCallExpression") {
      const callee = unwrap(expression.callee);

      const hostRead = deriveOwnElementRead(mod, expression, env, frame);
      if (hostRead !== null) return hostRead;

      const method = derivePureMethod(mod, expression, env, frame);
      if (method !== null) return method;

      // `props.count()` inside an inlined child: a read of the *parent's* cell.
      if (callee != null && (callee.type === "MemberExpression" || callee.type === "OptionalMemberExpression")) {
        if (
          env === null &&
          frame.props === null &&
          mod === moduleInfo &&
          callee.computed !== true &&
          callee.property?.type === "Identifier"
        ) {
          const object = unwrap(callee.object);
          if (object != null && object.type === "Identifier") {
            const symbol = mod.referenceOf(object)?.symbol ?? null;
            const read = symbol === null ? undefined : readSlots.get(symbol.id);
            if (read !== undefined && read.path.length === 0) {
              derivedReads.add(object);
              const rewrites = [{ node: object, name: read.name }];
              return {
                value: "",
                slots: [{ name: read.name, kind: "store-read", store: read.store, path: read.path }],
                source: printWithSlotRewrites(expression, rewrites),
                inlined: false,
                measured: true,
                rewrites,
              };
            }
          }
        }
        if (env !== null) return null;
        const bound = propBindingOf(frame, callee);
        if (bound === null || bound.kind !== "accessor") return null;
        const accessor = bound.accessor;
        if (accessor.access !== "read" || expression.arguments.length !== 0) return null;
        const cell = cells.find((candidate) => candidate.id === accessor.cellId);
        if (cell === undefined) return null;
        return {
          value: cell.initial,
          slots: [{ name: accessor.name, cell: cell.id, access: "read" }],
          // `props.count` means nothing to the artifact; the slot name is the
          // parent's own accessor.
          source: `${accessor.name}()`,
          inlined: true,
          measured: false,
          rewrites: [],
        };
      }

      if (callee.type !== "Identifier") return null;
      const symbol = mod.referenceOf(callee)?.symbol ?? null;

      // A cell read: `count()` in the component, or a getter-bound parameter.
      const accessor =
        symbol === null
          ? undefined
          : env === null
            ? accessors.get(symbol.id)
            : envAccessor(env, symbol.id);

      if (accessor !== undefined) {
        const rewrites = [{ node: callee, name: accessor.name }];
        if (accessor.derived) {
          if (accessor.access !== "read" || expression.arguments.length !== 0) return null;
          return {
            value: "",
            slots: [{ name: accessor.name, cell: accessor.cellId, access: "read" }],
            source: env === null ? printWithSlotRewrites(expression, rewrites) : `${accessor.name}()`,
            inlined: env !== null,
            measured: true,
            rewrites,
          };
        }
        if (accessor.access !== "read" || expression.arguments.length !== 0) return null;
        const cell = cells.find((candidate) => candidate.id === accessor.cellId);
        if (cell === undefined) return null;
        return {
          value: cell.initial,
          slots: [{ name: accessor.name, cell: cell.id, access: "read" }],
          // In a helper frame the printed callee is the HELPER's parameter name,
          // meaningless to the artifact; the slot name is what gets written.
          source: env === null ? printWithSlotRewrites(expression, rewrites) : `${accessor.name}()`,
          inlined: env !== null,
          measured: false,
          rewrites,
        };
      }

      // A zero-argument call of a binding initialized to a framework memo
      // whose callback derives is that callback. The memo is transparent:
      // resume never reconstructs it, and no new cell is allocated.
      if (env === null && frame.props === null && expression.arguments.length === 0) {
        const derived = deriveMemoCallback(frame, callee);
        // `inlined` forces the reconstructed source: the memo name is not a
        // resume-time slot, so the author's call must not be printed.
        if (derived !== null) return { ...derived, inlined: true };
      }

      // A summarizable pure formatter, folded against this call site's
      // arguments. Refused inside a helper frame or an inlined child: one hop in
      // each direction, never two composed.
      if (env !== null || frame.props !== null) return null;
      return deriveThroughFormatter(frame, expression);
    }

    if (expression.type === "BinaryExpression" && ARITHMETIC.has(expression.operator)) {
      const left = derive(mod, expression.left, env, frame);
      const right = derive(mod, expression.right, env, frame);
      if (left === null || right === null) return null;
      // A measured part has no value to fold, so nothing is folded: the operator
      // stays in `source` and the whole derivation is measured.
      const measured = left.measured || right.measured;
      const value = measured ? "" : fold(expression.operator, left.value, right.value);
      if (value === undefined) return null;
      const inlined = left.inlined || right.inlined;
      const rewrites = joinRewrites(left.rewrites, right.rewrites);
      return {
        value,
        measured,
        slots: [...left.slots, ...right.slots],
        // Parenthesized when reassembled: the parts no longer sit in the source
        // positions whose precedence made them safe.
        source: derivedSource(expression, {
          inlined,
          source: `(${left.source} ${expression.operator} ${right.source})`,
          rewrites,
        }),
        inlined,
        rewrites,
      };
    }

    if (isVoid0(expression)) {
      return { value: null, slots: [], source: verbatim(), inlined: false, measured: false, rewrites: [] };
    }

    if (expression.type === "ConditionalExpression") {
      const condition = deriveCondition(frame, expression.test, env, mod);
      const consequent = derive(mod, expression.consequent, env, frame);
      const alternate = derive(mod, expression.alternate, env, frame);
      if (condition === null || consequent === null || alternate === null) return null;
      const measured = condition.measured || consequent.measured || alternate.measured;
      const inlined = condition.inlined || consequent.inlined || alternate.inlined;
      const rewrites = joinRewrites(condition.rewrites, consequent.rewrites, alternate.rewrites);
      return {
        value: measured ? "" : condition.value ? consequent.value : alternate.value,
        measured,
        slots: [...condition.slots, ...consequent.slots, ...alternate.slots],
        source: derivedSource(expression, {
          inlined,
          source: `(${condition.source} ? ${consequent.source} : ${alternate.source})`,
          rewrites,
        }),
        inlined,
        rewrites,
      };
    }

    if (expression.type === "UnaryExpression" && (expression.operator === "-" || expression.operator === "+")) {
      const argument = derive(mod, expression.argument, env, frame);
      if (argument === null) return null;
      const numeric = Number(argument.value);
      return {
        value: argument.measured ? "" : expression.operator === "-" ? -numeric : numeric,
        measured: argument.measured,
        slots: argument.slots,
        source: derivedSource(expression, {
          inlined: argument.inlined,
          source: `(${expression.operator}${argument.source})`,
          rewrites: argument.rewrites,
        }),
        inlined: argument.inlined,
        rewrites: argument.rewrites,
      };
    }

    if (expression.type === "TemplateLiteral") {
      let value = "";
      let rebuilt = "";
      let inlined = false;
      let measured = false;
      const slots: CaptureSlot[] = [];
      const rewrites: SlotRewrite[] = [];

      for (let i = 0; i < expression.quasis.length; i++) {
        const quasi = expression.quasis[i];
        value += quasi.value.cooked ?? quasi.value.raw;
        rebuilt += quasi.value.raw;
        if (i < expression.expressions.length) {
          const part = derive(mod, expression.expressions[i], env, frame);
          if (part === null) return null;
          value += String(part.value);
          rebuilt += `\${${part.source}}`;
          inlined = inlined || part.inlined;
          measured = measured || part.measured;
          slots.push(...part.slots);
          rewrites.push(...part.rewrites);
        }
      }

      return {
        value: measured ? "" : value,
        slots,
        source: derivedSource(expression, { inlined, source: `\`${rebuilt}\``, rewrites }),
        inlined,
        measured,
        rewrites,
      };
    }

    return null;
  }

  /**
   * The store read a member expression bottoms out in, or null.
   *
   * `state.todos.length` is a chain of NON-COMPUTED property reads whose base
   * identifier is an admitted read binding. Computed steps are refused here
   * rather than at the base: `state[key]` reaches a slot chosen at runtime, and
   * the artifact would be naming a path the pass never saw. Nothing above the
   * base is proven — the chain is source, and the base is identity.
   */
  function storeReadChain(node: Node): { info: StoreReadInfo; base: Node } | null {
    let current: Node | null = unwrap(node);
    while (current != null && current.type === "MemberExpression") {
      if (current.computed === true) return null;
      current = unwrap(current.object);
    }
    if (current == null || current.type !== "Identifier") return null;

    const symbol = moduleInfo.referenceOf(current)?.symbol ?? null;
    if (symbol === null) return null;
    const info = readSlots.get(symbol.id);
    return info === undefined ? null : { info, base: current };
  }

  /**
   * The region-item slot a non-computed member chain is rooted at — `todo` in
   * `todo.title` — or null.
   *
   * The same shape `storeReadChain` proves, about the other kind of identity: the
   * BASE is what was admitted, and the property chain above it is the author's
   * own source, carried verbatim and evaluated against the item the key reached.
   * Nothing here reads what an item CONTAINS, because at build time there are no
   * items.
   */
  function regionItemChain(node: Node): (CaptureSlot & { kind: "region-item" }) | null {
    let current: Node | null = unwrap(node);
    while (current != null && current.type === "MemberExpression") {
      if (current.computed === true) return null;
      current = unwrap(current.object);
    }
    if (current == null || current.type !== "Identifier") return null;

    const symbol = moduleInfo.referenceOf(current)?.symbol ?? null;
    return symbol === null ? null : (itemSlots.get(symbol.id) ?? null);
  }

  /** The accessor a helper-frame parameter symbol stands for, if it is one. */
  function envAccessor(env: Map<number, ParameterBinding>, symbolId: number): Accessor | undefined {
    const bound = env.get(symbolId);
    return bound !== undefined && bound.kind === "accessor" ? bound.accessor : undefined;
  }

  /** Folds `format(a, b)` by summarizing `format` and deriving its returned
   * expression against the call site's arguments. A parameter handed an accessor
   * must be used only as that accessor — the escape audit's rule — so a formatter
   * that leaks it somewhere the fold cannot see is refused. */
  function deriveThroughFormatter(frame: Frame, call: Node): Derived | null {
    const summary = summarize(moduleInfo, call.callee);
    if (summary === null) return null;

    const args: Node[] = call.arguments;
    if (args.length !== summary.params.length) return null;

    const env = new Map<number, ParameterBinding>();
    for (let index = 0; index < args.length; index++) {
      const argument = unwrap(args[index]);
      if (argument == null) return null;

      const accessor = accessorOf(argument);
      if (accessor !== null) {
        if (!parameterIsAccessorOnly(summary, index, accessor.access)) return null;
        env.set(summary.paramSymbols[index].id, { kind: "accessor", accessor });
        continue;
      }

      const derived = derive(moduleInfo, argument, null, frame);
      if (derived === null) return null;
      env.set(summary.paramSymbols[index].id, { kind: "value", derived });
    }

    const folded = derive(summary.module, summary.returned, env, frame);
    return folded === null ? null : { ...folded, inlined: true };
  }

  /** The cell accessor an expression names directly, or null. */
  function accessorOf(node: Node): Accessor | null {
    const expression = unwrap(node);
    if (expression == null || expression.type !== "Identifier") return null;
    const symbol = moduleInfo.referenceOf(expression)?.symbol ?? null;
    if (symbol === null) return null;
    return accessors.get(symbol.id) ?? null;
  }

  function frozenModuleStringArray(mod: Module, node: Node): string[] | null {
    const ident = unwrap(node);
    if (ident == null || ident.type !== "Identifier") return null;
    const symbol = mod.referenceOf(ident)?.symbol ?? null;
    if (symbol === null || symbol.declarations.length !== 1) return null;
    const declaration: Node = symbol.declarations[0];
    const parent: Node = mod.parentOf(declaration);
    if (parent == null || parent.type !== "VariableDeclarator" || parent.id !== declaration) return null;
    const grand: Node = mod.parentOf(parent);
    if (grand == null || grand.type !== "VariableDeclaration" || grand.kind !== "const") return null;
    const init = unwrap(parent.init);
    if (init == null || init.type !== "ArrayExpression") return null;
    const values: string[] = [];
    for (const element of init.elements ?? []) {
      if (element == null) return null;
      const literal = literalValue(unwrap(element));
      if (!literal.ok || typeof literal.value !== "string") return null;
      values.push(literal.value);
    }
    return values;
  }

  function derivePureMethod(
    mod: Module,
    call: Node,
    env: Map<number, ParameterBinding> | null,
    frame: Frame,
  ): Derived | null {
    const callee = unwrap(call.callee);
    if (callee == null || (callee.type !== "MemberExpression" && callee.type !== "OptionalMemberExpression")) {
      return null;
    }
    if (callee.computed === true || callee.property?.type !== "Identifier") return null;
    const name: string = callee.property.name;
    const args: Node[] = call.arguments ?? [];

    if ((name === "toLowerCase" || name === "toUpperCase" || name === "trim") && args.length === 0) {
      const object = derive(mod, callee.object, env, frame);
      if (object === null) return null;
      const text = typeof object.value === "string" ? object.value : "";
      const next =
        name === "toLowerCase" ? text.toLowerCase() : name === "toUpperCase" ? text.toUpperCase() : text.trim();
      return {
        value: object.measured ? "" : next,
        measured: object.measured,
        slots: object.slots,
        source: `${object.source}.${name}()`,
        inlined: true,
        rewrites: object.rewrites,
      };
    }

    if (name === "indexOf" && args.length === 1) {
      const table = frozenModuleStringArray(mod, callee.object);
      if (table === null) return null;
      const needle = derive(mod, args[0], env, frame);
      if (needle === null) return null;
      const index = typeof needle.value === "string" ? table.indexOf(needle.value) : -1;
      return {
        value: needle.measured ? "" : index,
        measured: needle.measured,
        slots: needle.slots,
        source: `${JSON.stringify(table)}.indexOf(${needle.source})`,
        inlined: true,
        rewrites: needle.rewrites,
      };
    }

    return null;
  }

  function deriveOwnElementRead(
    mod: Module,
    node: Node,
    env: Map<number, ParameterBinding> | null,
    frame: Frame,
  ): Derived | null {
    if (env !== null || frame.props !== null || mod !== moduleInfo) return null;
    const getterIds = new Set<number>();
    for (const [id, accessor] of accessors) {
      if (accessor.access === "read") getterIds.add(id);
    }
    const match = matchElementProjection(mod, node, getterIds);
    if (match === null || match.kind !== "projection" || match.steps.length === 0) return null;
    const accessor = accessors.get(match.getterId);
    if (accessor === undefined || accessor.access !== "read") return null;
    const rewrites = [{ node: match.base, name: accessor.name }];
    return {
      value: "",
      slots: [{ name: accessor.name, cell: accessor.cellId, access: "read" }],
      source: printWithSlotRewrites(node, rewrites),
      inlined: false,
      measured: true,
      rewrites,
    };
  }

  // ------------------------------------------------------- props see-through

  /** The `PropBinding` a `props.X` expression stands for in this frame, or null. */
  function propBindingOf(frame: Frame, node: Node): PropBinding | null {
    if (frame.props === null || frame.propsSymbol === null) return null;

    const expression = unwrap(node);
    if (expression == null || expression.type !== "MemberExpression") return null;
    if (expression.computed === true) return null;
    if (expression.property?.type !== "Identifier") return null;

    const object = unwrap(expression.object);
    if (object == null || object.type !== "Identifier") return null;

    const symbol = frame.mod.referenceOf(object)?.symbol ?? null;
    if (symbol === null || symbol.id !== frame.propsSymbol) return null;

    return frame.props.get(expression.property.name) ?? null;
  }

  /** Splices a child's markup into the parent's template, or returns null and
   * leaves the element refused. The trial discipline is the safety property:
   * the first refusal rolls both lists back to their marks, so there is no state
   * in which half a child has been admitted. */
  function tryInlineComponent(frame: Frame, element: Node, locator: string): string | null {
    // One hop. A grandchild falls through to `jsx-component-element` in the
    // child's frame, which fails this trial and refuses the parent's element.
    if (frame.props !== null) return null;

    // Condition (1), resolved once for both arms: `definition()` follows
    // import/re-export chains and stops at the edge of the analyzed set, so
    // `<Show>` and `<For>` resolve outside it.
    const resolved = resolveChildComponent(frame.mod, element);
    if (resolved === null) return null;

    const childModule: Module = resolved.module;
    const child = resolved.site;

    const shape = inlinableChild(childModule, child);
    if (shape === null) return null;

    const props = new Map<string, PropBinding>();
    const passedAccessors: Node[] = [];

    for (const attribute of element.openingElement.attributes) {
      if (attribute.type === "JSXSpreadAttribute") {
        // Reported at the call site rather than swallowed: a spread is what
        // makes the child's props unnameable, and naming them comes first.
        frame.refuse(
          "jsx-spread",
          "Spread attributes hide which props the child component receives.",
          attribute,
        );
        return null;
      }
      if (attribute.name?.type !== "JSXIdentifier") return null;

      const bound = bindProp(frame, attribute, passedAccessors);
      if (bound === null) return null;
      props.set(attribute.name.name, bound);
    }

    // A child that takes no props parameter can be handed no props.
    if (shape.propsSymbol === null && props.size > 0) return null;
    if (shape.propsSymbol !== null && !propUsesConform(childModule, shape.propsSymbol, props)) {
      return null;
    }

    const bindingSink = sink.bindings;
    const bindingMark = bindingSink.length;
    const handlerMark = handlers.length;
    let refused = false;

    const childFrame: Frame = {
      mod: childModule,
      locOf: childModule === moduleInfo ? locOf : makeLocator(childModule.source),
      props,
      propsSymbol: shape.propsSymbol?.id ?? null,
      refuse: () => {
        refused = true;
      },
    };

    const spliced = visitElement(childFrame, shape.root, locator);

    if (refused) {
      bindingSink.length = bindingMark;
      handlers.length = handlerMark;
      return null;
    }

    // Every binding the child contributed came from the child's markup. Handlers
    // are NOT re-marked: a handler artifact's code is always the parent's or a
    // summarized factory's, and `locator` already places it inside the splice.
    const childOrigin: CodeOrigin = "child";
    for (let i = bindingMark; i < bindingSink.length; i++) bindingSink[i].origin = childOrigin;
    for (const node of passedAccessors) seenThroughProps.add(node);
    inlined.push({ module: childModule.path, component: child.name });

    return spliced;
  }

  /**
   * Splices a child's omit/guard/Dynamic body as an intrinsic at this
   * call site, or returns null and leaves the element to the rest of the
   * ladder. The tag is the call-site build-constant for the omitted key;
   * attributes other than that key are forwarded verbatim, in order, into
   * {@link visitIntrinsicElement}. Dynamic's body is never classified.
   */
  function tryFoldElementIndirection(frame: Frame, element: Node, locator: string): string | null {
    const resolved = resolveChildComponent(frame.mod, element);
    if (resolved === null) return null;

    const key = elementIndirectionKey(resolved.module, resolved.site);
    if (key === null) return null;

    let tagAttribute: Node | null = null;
    const kept: Node[] = [];
    for (const attribute of element.openingElement.attributes) {
      if (
        attribute.type !== "JSXSpreadAttribute" &&
        attribute.name?.type === "JSXIdentifier" &&
        attribute.name.name === key
      ) {
        if (tagAttribute !== null) return null;
        tagAttribute = attribute;
        continue;
      }
      kept.push(attribute);
    }
    if (tagAttribute === null) return null;

    const constant = buildConstantAttribute(frame.mod, tagAttribute);
    if (constant === null || typeof constant.value !== "string") return null;
    if (!/^[a-z][a-z0-9-]*$/.test(constant.value)) return null;

    return visitIntrinsicElement(frame, constant.value, kept, element, locator);
  }

  /**
   * One opening attribute or identifier rest-spread as identity, or null —
   * not this class. Resolves through this pass's own `referenceOf` /
   * `recordableClassOf` machinery (which itself uses `definition()` for
   * imported bindings). No frozen value is recorded.
   */
  function sourceBindingOf(
    node: Node,
  ): { name: string; path: (string | number)[]; class: IdentityBindingClass } | null {
    const expression = unwrap(node);
    if (expression == null) return null;

    if (expression.type === "Identifier") {
      const klass = recordableClassOf(expression);
      if (klass !== "own-props-parameter" && klass !== "derived-rest-props-result") return null;
      return { name: expression.name, path: [], class: klass };
    }

    if (isMemberNode(expression)) {
      const path: (string | number)[] = [];
      let current: Node | null = expression;
      while (current != null && isMemberNode(current)) {
        if (current.computed === true) return null;
        if (current.property?.type !== "Identifier") return null;
        path.unshift(current.property.name);
        current = unwrap(current.object);
      }
      if (current == null || current.type !== "Identifier") return null;
      const klass = recordableClassOf(current);
      if (klass !== "own-props-parameter" && klass !== "derived-rest-props-result") return null;
      return { name: current.name, path, class: klass };
    }

    return null;
  }

  function identityAttribute(attribute: Node): IdentityProp | null {
    if (attribute.type === "JSXSpreadAttribute") {
      const argument = unwrap(attribute.argument);
      if (argument == null || argument.type !== "Identifier") return null;
      const source = sourceBindingOf(argument);
      if (source === null) return null;
      return {
        name: argument.name,
        role: "spread-of-identifier",
        bindingClass: source.class,
        source: { name: source.name, path: source.path },
      };
    }
    if (attribute.name?.type !== "JSXIdentifier") return null;
    const name: string = attribute.name.name;
    if (attribute.value?.type !== "JSXExpressionContainer") return null;
    const expression = unwrap(attribute.value.expression);
    if (expression == null || expression.type === "JSXEmptyExpression") return null;
    const source = sourceBindingOf(expression);
    if (source === null) return null;
    return {
      name,
      role: "attribute",
      bindingClass: source.class,
      source: { name: source.name, path: source.path },
    };
  }

  /**
   * ADDRESSES a child instead of absorbing it: returns the element-shaped hole
   * the parent's template carries, or null and leaves the element to
   * `jsx-component-element`.
   *
   * Nothing is spliced, so there is no trial and nothing to roll back — the
   * child is classified in its OWN frame, keeps its own cells, and is emitted
   * into its own artifact directory by the same `runComptime` that emits any
   * other provable component. What this records is an ADDRESS, and the whole of
   * the parent's claim is: at `locator` there is an empty element, and the
   * artifact named on it is what fills it.
   *
   * The five ways it declines are named in this file's header; each returns null
   * here, which is a refused element and nothing louder.
   */
  function tryAddressChild(
    frame: Frame,
    element: Node,
    locator: string,
    parentTag: string | null,
  ): string | null {
    // This component's own address space only. Through a props boundary the hole
    // would sit inside markup being flattened into someone else's template; in a
    // keyed region's item body the locator is rooted at an ITEM element, and
    // `claimedChildren` is addressed from the component's root. Neither is a
    // narrowing of the five conditions — it is where the arm is offered at all,
    // exactly as inlining's one hop is.
    if (frame.props !== null || frame.mod !== moduleInfo || insideRegion) return null;

    // (1) BARE — `ClaimedChildNotBare`. Children still refuse: a mount
    // container has nowhere to put them. Attributes no longer refuse the
    // address when every one is a v1 build-constant or an identity-class
    // named attribute / identifier rest-spread. Any other attribute falls
    // through to `jsx-component-element`, same as today — no new code.
    if (jsxChildren(element).length > 0) return null;

    const recorded: RecordedProp[] = [];
    const identities: IdentityProp[] = [];
    for (const attribute of element.openingElement.attributes) {
      const constant = buildConstantAttribute(frame.mod, attribute);
      if (constant !== null) {
        recorded.push(constant);
        continue;
      }
      const identity = identityAttribute(attribute);
      if (identity !== null) {
        identities.push(identity);
        continue;
      }
      return null;
    }

    // (5) CONTENT MODEL — `ClaimedChildParentContentModel`. Checked before the
    // child is classified, because a recursion this markup can never carry is
    // work nobody should pay for.
    if (parentTag !== null && REPARSING_PARENTS.has(parentTag)) return null;

    // (2) ANALYZED SET — `ClaimedChildNotInAnalyzedSet`. Inlining's condition
    // (1), the same resolution, shared rather than rewritten.
    const resolved = resolveChildComponent(frame.mod, element);
    if (resolved === null) return null;

    const childModule: Module = resolved.module;
    const child = resolved.site;

    // (3) CYCLE — `ClaimedChildCycle`. The stack holds the chain of components
    // being classified for an address, so `<A>` -> `<B>` -> `<A>` stops at the
    // second `<A>` rather than at a recursion limit.
    const self = `${moduleInfo.path}#${component.name}`;
    const claimed = `${childModule.path}#${child.name}`;
    if (claimed === self || ADDRESSING_STACK.includes(claimed)) return null;

    // (4) PROVABLE, AND IT PAINTS — `ClaimedChildEmptyTemplate`. A child that
    // refuses has no artifacts to mount; a child that proves and paints nothing
    // — one whose only region the build recorded ABSENT emits `html === ""` —
    // would ship an empty mount, and the resumer throws for want of a root
    // element in the container. Both are the same fact from the parent's seat:
    // there is no markup to fill this hole with.
    ADDRESSING_STACK.push(self);
    let childAnalysis: Analysis;
    try {
      childAnalysis = classifySite(childModule, child, {
        ...options,
        recordedProps: recorded.length > 0 ? recorded : undefined,
        identityProps: identities.length > 0 ? identities : undefined,
      });
    } finally {
      ADDRESSING_STACK.pop();
    }
    if (childAnalysis.status !== "provable" || childAnalysis.html === "") return null;

    const artifact = artifactKey(childModule.path, child.name);

    // Artifact identity: one artifact per recorded valuation AND per identity
    // record. A second address of the same child with a different record is
    // declined.
    const prior = claimedChildren.find((entry) => entry.artifact === artifact);
    if (
      prior !== undefined &&
      (!recordsMatch(prior.recordedProps, recorded) || !identityRecordsMatch(prior.identityProps, identities))
    ) {
      return null;
    }

    claimedChildren.push({
      locator,
      artifact,
      component: child.name,
      module: childModule.path,
      ...(recorded.length > 0 ? { recordedProps: recorded } : {}),
      ...(identities.length > 0 ? { identityProps: identities } : {}),
    });

    // The mount container a page already knows how to resume: `data-resume` is
    // the artifact id the build stamped, `data-component` the name the ordinary
    // Solid path knows it by. Empty on purpose — the hole is the point.
    return (
      `<div data-resume="${escapeAttribute(artifact)}"` +
      ` data-component="${escapeAttribute(child.name)}"></div>`
    );
  }

  /** What one call-site attribute proves about the prop it fills. Three things
   * are admissible, and they are the three the child's own uses are checked
   * against: a cell accessor, a handler this pass could already prove, and a
   * value the derivation walk folds. Everything else refuses the element. */
  function bindProp(frame: Frame, attribute: Node, passedAccessors: Node[]): PropBinding | null {
    const value = attribute.value;
    // `<Child flag />`: an implicit `true` this pass has no cell shape for.
    if (value == null) return null;

    if (value.type === "Literal") {
      const literal = literalValue(value);
      if (!literal.ok) return null;
      return {
        kind: "value",
        derived: {
          value: literal.value,
          slots: [],
          source: printExpression(value),
          inlined: true,
          measured: false,
          rewrites: [],
        },
      };
    }

    if (value.type !== "JSXExpressionContainer") return null;
    const expression = unwrap(value.expression);
    if (expression == null || expression.type === "JSXEmptyExpression") return null;

    const accessor = accessorOf(expression);
    if (accessor !== null) {
      passedAccessors.push(expression);
      return { kind: "accessor", accessor };
    }

    if (expression.type === "ArrowFunctionExpression" || expression.type === "FunctionExpression") {
      // The audit an inline handler gets, with its refusals diverted: crossing a
      // props boundary does not admit a handler that would have been refused.
      let rejected = false;
      const slots = auditHandlerBody(expression, () => {
        rejected = true;
      });
      if (rejected) return null;
      return {
        kind: "handler",
        source: printExpression(expression),
        slots,
        loc: locOf(expression),
        origin: "component",
      };
    }

    const factored = handlerFromFactory(expression);
    if (factored !== null) {
      return {
        kind: "handler",
        source: factored.source,
        slots: factored.slots,
        loc: factored.loc,
        origin: "helper",
      };
    }

    const derived = derive(frame.mod, expression, null, frame);
    return derived === null ? null : { kind: "value", derived: { ...derived, inlined: true } };
  }

  // ---------------------------------------------------------------- handlers

  function collectHandler(frame: Frame, attribute: Node, event: string, locator: string): void {
    const value = attribute.value;
    const expression = value?.type === "JSXExpressionContainer" ? unwrap(value.expression) : null;

    // Inside an inlined child, only a handler the CALL SITE proved is
    // admissible: one written in the child closes over scope the parent's cells
    // cannot fill.
    if (frame.props !== null) {
      const bound = expression == null ? null : propBindingOf(frame, expression);
      if (bound !== null && bound.kind === "handler") {
        pushHandler(event, locator, bound.source, bound.slots, bound.loc, bound.origin);
        return;
      }
      frame.refuse(
        "handler-not-inline",
        "Inside an inlined child, an event handler must be a prop whose value the call site proved.",
        attribute,
      );
      return;
    }

    if (
      expression == null ||
      (expression.type !== "ArrowFunctionExpression" && expression.type !== "FunctionExpression")
    ) {
      // A store action handed straight to the event prop. There is no body to
      // extract and none is invented: the listener IS the action, resolved at
      // resume time from the same identity every other action slot uses, and
      // called with the event exactly as the framework would have called it.
      const action = expression == null ? null : actionHandler(expression);
      if (action !== null) {
        pushHandler(event, locator, action.name, [action.slot], action.loc, "action");
        return;
      }

      const identityEvent = expression == null ? null : identityEventHandler(expression);
      if (identityEvent !== null) {
        pushHandler(event, locator, identityEvent.name, [identityEvent.slot], identityEvent.loc, "component");
        return;
      }

      // Still provable if it came from a summarizable factory whose closure
      // captures nothing but the accessors handed in.
      const factored = expression == null ? null : handlerFromFactory(expression);
      if (factored !== null) {
        pushHandler(event, locator, factored.source, factored.slots, factored.loc, "helper");
        return;
      }

      frame.refuse(
        "handler-not-inline",
        "The event handler is not an inline function, so its body and captures are invisible to this analysis.",
        attribute,
        describeHandlerOrigin(value?.expression ?? null),
      );
      return;
    }

    pushHandler(
      event,
      locator,
      printExpression(expression),
      auditHandlerBody(expression),
      locOf(expression),
      "component",
    );
  }

  function pushHandler(
    event: string,
    locator: string,
    source: string,
    captures: CaptureSlot[],
    loc: SourceLoc,
    origin: HandlerOrigin,
  ): void {
    const id = `s${handlers.length}`;
    handlers.push({ id, event, locator, module: `./handlers/${id}.js`, captures, source, origin, loc });
  }

  /**
   * The store action a bare `onClick={clearCompleted}` names, or null.
   *
   * This is the one handler with no code in it. An action was admitted by
   * IDENTITY — its store and the fixed slot path reaching it — and its body was
   * never read, so handing it to an event prop asks the pass for nothing it has
   * not already proved: the artifact carries the slot, and the listener the
   * resume path installs is whatever the live store put at that path. Every
   * other non-inline shape keeps refusing, because every other shape is a
   * function this pass would have to have seen.
   */
  function actionHandler(raw: Node): { name: string; slot: CaptureSlot; loc: SourceLoc } | null {
    const inner = unwrap(raw);
    if (inner == null) return null;

    if (inner.type === "Identifier") {
      const symbol = moduleInfo.referenceOf(inner)?.symbol ?? null;
      if (symbol === null) return null;

      const action = actionSlots.get(symbol.id);
      if (action === undefined) return null;

      return {
        name: symbol.name,
        slot: { name: symbol.name, kind: "action", store: action.store, path: action.path },
        loc: locOf(inner),
      };
    }

    if (inner.type === "MemberExpression" && inner.computed !== true && inner.property?.type === "Identifier") {
      const object = unwrap(inner.object);
      if (object == null || object.type !== "Identifier") return null;
      const symbol = moduleInfo.referenceOf(object)?.symbol ?? null;
      if (symbol === null) return null;
      const read = readSlots.get(symbol.id);
      if (read === undefined || read.path.length !== 0) return null;
      const key: string = inner.property.name;
      const store = stores.find((candidate) => candidate.id === read.store);
      if (store === undefined || !isObjectStore(store) || !store.keys.includes(key)) return null;
      return {
        name: key,
        slot: { name: key, kind: "action", store: read.store, path: [key] },
        loc: locOf(inner),
      };
    }

    return null;
  }

  /** An identity-class event prop: `onClick={props.onClick}`. The listener
   * IS the identity slot; no body is extracted and no value is frozen. */
  function identityEventHandler(raw: Node): { name: string; slot: CaptureSlot; loc: SourceLoc } | null {
    const identity = identityOf(raw);
    if (identity === null) return null;
    return {
      name: identity.member,
      slot: identitySlotOf(identity),
      loc: locOf(raw),
    };
  }

  /**
   * Sees through `const increment = makeIncrement(count, setCount)` to the
   * closure returned. All four must hold: the binding is a plain identifier
   * declared INSIDE this component and initialized by a single call; the callee
   * summarizes and returns a closure inside `HANDLER_SYNTAX`; every argument is
   * one of this component's accessors, used inside the factory only as that
   * accessor; the closure's free variables are EXACTLY the factory's parameters.
   */
  function handlerFromFactory(
    raw: Node,
  ): { source: string; slots: CaptureSlot[]; loc: SourceLoc } | null {
    const inner = unwrap(raw);
    if (inner == null || inner.type !== "Identifier") return null;

    const symbol = moduleInfo.referenceOf(inner)?.symbol ?? null;
    if (symbol === null || symbol.declarations.length !== 1) return null;
    // A rebound handler has no single value to extract.
    if (symbol.references.some((reference) => reference.isWrite)) return null;

    const declaration: Node = symbol.declarations[0];
    const declarator: Node = moduleInfo.parentOf(declaration);
    if (declarator == null || declarator.type !== "VariableDeclarator") return null;
    if (declarator.id !== declaration || declaration.type !== "Identifier") return null;
    if (!contains(component.fn, declarator)) return null;

    const init = declarator.init == null ? null : unwrap(declarator.init);
    if (init == null || init.type !== "CallExpression") return null;

    const summary = summarize(moduleInfo, init.callee);
    if (summary === null) return null;

    const args: Node[] = init.arguments;
    if (args.length !== summary.params.length) return null;

    const bound: Accessor[] = [];
    for (let index = 0; index < args.length; index++) {
      const accessor = accessorOf(args[index]);
      if (accessor === null) return null;
      if (!parameterIsAccessorOnly(summary, index, accessor.access)) return null;
      bound.push(accessor);
    }

    const closure = returnedClosure(summary);
    if (closure === null) return null;

    const slots: CaptureSlot[] = [];
    for (const capture of summary.module.capturesOf(closure)) {
      const index = parameterIndexOf(summary, capture.symbol);
      if (index < 0) return null;
      slots.push({ name: capture.symbol.name, cell: bound[index].cellId, access: bound[index].access });
    }

    return {
      source: printExpression(closure),
      slots: slots.sort((a, b) => a.name.localeCompare(b.name)),
      // A location in THIS module: the binding is where a reader would look.
      loc: locOf(declarator),
    };
  }

  /** Says where a non-inline handler came from, so the refusal names the black box. */
  function describeHandlerOrigin(expression: Node): Record<string, unknown> | undefined {
    if (expression == null) return undefined;
    const inner = unwrap(expression);
    if (inner.type !== "Identifier") return { boundAs: inner.type };

    const symbol = moduleInfo.referenceOf(inner)?.symbol ?? null;
    if (symbol === null) return { boundAs: "Identifier", binding: inner.name };

    // Climb out through the pattern to the declarator the handler came from.
    let node: Node = symbol.declarations[0] ?? null;
    for (let depth = 0; node != null && depth < 6; depth++) {
      const parent: Node = moduleInfo.parentOf(node);
      if (parent == null) break;
      if (parent.type === "VariableDeclarator") {
        const init = parent.init == null ? null : unwrap(parent.init);
        if (init != null && init.type === "CallExpression") {
          const calleeInfo = describeCallee(init.callee);
          return { boundAs: "Identifier", binding: inner.name, from: calleeInfo };
        }
        break;
      }
      node = parent;
    }

    return { boundAs: "Identifier", binding: inner.name };
  }

  // ------------------------------------------------------------- event time
  //
  // S3, admissions 2 and 3. One question: does this expression exist only once
  // the event has fired? Such a value never reaches the derivation walk, so
  // admitting it in a handler body cannot put a build-time answer anywhere.
  // The prevention is structural — `derive` does not know any of this.

  /** `Date.now` / `Math.random` / …: an enumerated ambient member. */
  function isAmbientMember(member: Node): boolean {
    if (member == null || member.type !== "MemberExpression" || member.computed === true) return false;
    const object = member.object;
    if (object == null || object.type !== "Identifier") return false;
    // Only a genuinely free name is ambient; a local named `Math` is not.
    if ((moduleInfo.referenceOf(object)?.symbol ?? null) !== null) return false;
    const methods = AMBIENT_MEMBER_CALLS.get(object.name);
    if (methods === undefined) return false;
    return member.property?.type === "Identifier" && methods.has(member.property.name);
  }

  /** True when a free-name occurrence is the receiver of an enumerated call. */
  function isAmbientReceiver(node: Node): boolean {
    const member: Node = moduleInfo.parentOf(node);
    if (member == null || member.type !== "MemberExpression" || member.object !== node) return false;
    if (!isAmbientMember(member)) return false;
    const call: Node = moduleInfo.parentOf(member);
    return call != null && call.type === "CallExpression" && call.callee === member;
  }

  /**
   * True for an expression whose every part exists only at event time: the
   * handler's parameters and locals, literals, the enumerated ambient calls, and
   * member reads layered on those. Accessors and action bindings are EXCLUDED —
   * both are capture slots, and reaching into one as an object would observe
   * something this pass proved nothing about.
   */
  function isEventTimeValue(fn: Node, node: Node): boolean {
    const expression = unwrap(node);
    if (expression == null) return false;

    if (expression.type === "Literal") return true;

    if (expression.type === "Identifier") {
      const symbol = moduleInfo.referenceOf(expression)?.symbol ?? null;
      if (symbol === null) return false;
      if (accessors.has(symbol.id) || actionSlots.has(symbol.id) || readSlots.has(symbol.id)) return false;
      // Declared inside the handler: a parameter, or a local of its body.
      return contains(fn, symbol.scope.node);
    }

    if (expression.type === "MemberExpression") {
      if (expression.computed === true) return false;
      if (expression.property?.type !== "Identifier") return false;
      if (isAmbientMember(expression)) return true;
      return isEventTimeValue(fn, expression.object);
    }

    if (expression.type === "CallExpression") {
      const callee = unwrap(expression.callee);
      if (callee == null || callee.type !== "MemberExpression") return false;
      if (!isEventTimeValue(fn, callee)) return false;
      return (expression.arguments as Node[]).every(
        (argument: Node) => argument != null && argument.type !== "SpreadElement",
      );
    }

    return false;
  }

  /** The structural side of {@link EVENT_TIME_SYNTAX}: a node type in that set is
   * admitted only in the exact shape the ruling names. */
  function isEventTimeSyntax(fn: Node, node: Node): boolean {
    // A plain member read whose base is a capture slot: `state.todos.length`,
    // asked once the event has fired. The base is the identity the pass already
    // proved and the chain above it is the author's own source, which is exactly
    // the derivation walk's admission — moved to event time, where there is no
    // build-time value to get wrong. A CALL through the chain is not this shape
    // and still refuses below, and neither is an assignment into it.
    if (node.type === "MemberExpression") {
      return (
        isEventTimeValue(fn, node) ||
        storeReadChain(node) !== null ||
        regionItemChain(node) !== null ||
        identityOf(node) !== null
      );
    }

    // `e.currentTarget.value = ""` — a plain write back into the event object.
    // A compound operator or a non-event-time target is not this shape.
    if (node.type === "AssignmentExpression") {
      return (
        node.operator === "=" &&
        node.left?.type === "MemberExpression" &&
        isEventTimeValue(fn, node.left)
      );
    }

    // A record assembled at event time — Header hands one to `addTodo`. Static
    // keys only: a computed key or a spread hides the record's shape.
    if (node.type === "ObjectExpression") {
      return (node.properties as Node[]).every(
        (property: Node) => property != null && property.type === "Property" && property.computed !== true,
      );
    }

    if (node.type === "Property") {
      const parent: Node = moduleInfo.parentOf(node);
      return parent != null && parent.type === "ObjectExpression" && node.computed !== true;
    }

    return false;
  }

  /**
   * True when this occurrence of a binding is READ THROUGH for a property:
   * `state` in `state.todos.length`, and nothing else.
   *
   * The whole non-computed chain is climbed, because `state.todos.length` is one
   * read rather than three, and then what sits ABOVE the chain decides. An
   * assignment target is a write; a callee is a method whose body this pass
   * never saw; a bare `state` handed to anything is the binding itself leaving.
   * All three stay the escape audit's, under its own name.
   */
  function isSlotMemberRead(reference: { node: Node }): boolean {
    let node: Node = reference.node;
    let parent: Node = moduleInfo.parentOf(node);
    if (parent == null || parent.type !== "MemberExpression" || parent.object !== node) return false;

    while (parent != null && parent.type === "MemberExpression" && parent.object === node) {
      if (parent.computed === true || parent.property?.type !== "Identifier") return false;
      node = parent;
      parent = moduleInfo.parentOf(node);
    }

    if (parent == null) return true;
    if (parent.type === "AssignmentExpression" && parent.left === node) return false;
    if (parent.type === "UpdateExpression") return false;
    if (parent.type === "CallExpression" && parent.callee === node) return false;
    return true;
  }

  /** Proves an inline handler self-contained: free variables that are cell
   * accessors and nothing else, no globals, a body inside the supported syntax.
   * `bindProp` passes a diverting `recordRefusal`, because a handler audited as a
   * CANDIDATE PROP VALUE must be admitted whole or leave no trace. */
  function auditHandlerBody(fn: Node, recordRefusal: Refuse = refuse): CaptureSlot[] {
    const slots: CaptureSlot[] = [];

    // `capturesOf` is the load-bearing query: shadowing- and alias-correct free
    // variables, computed from the resolved reference table, not from names.
    for (const capture of moduleInfo.capturesOf(fn)) {
      // S3: a store action is a legal capture, recorded by identity — its store
      // and the fixed slot path. The body is not read here or anywhere else.
      const action = actionSlots.get(capture.symbol.id);
      if (action !== undefined) {
        slots.push({ name: capture.symbol.name, kind: "action", store: action.store, path: action.path });
        continue;
      }

      // A store READ, captured the same way: store id and the fixed path, never
      // a value. Admitted only where every occurrence READS THROUGH the binding
      // for a property. Anything else is left alone here — the escape audit
      // names it `store-read-escapes`, and a handler is not a second place to
      // decide what a read binding may be used for.
      const read = readSlots.get(capture.symbol.id);
      if (read !== undefined) {
        if (read.path.length === 0) {
          if (capture.references.every((reference) => isWholeBindReadThroughCall(moduleInfo, reference.node))) {
            slots.push({ name: capture.symbol.name, kind: "store-read", store: read.store, path: read.path });
            for (const reference of capture.references) slotReads.add(reference.node);
          }
          continue;
        }
        if (capture.references.every(isSlotMemberRead)) {
          slots.push({ name: capture.symbol.name, kind: "store-read", store: read.store, path: read.path });
          for (const reference of capture.references) slotReads.add(reference.node);
        }
        continue;
      }

      // One item of a keyed region. Legal without qualification, unlike a store
      // read: an item is a VALUE this handler was handed, with no writer to
      // race and nothing behind it to observe. The listener is attached at the
      // container and the item is whichever one the dispatching element's key
      // named, which is what makes this slot an identity rather than a position.
      const item = itemSlots.get(capture.symbol.id);
      if (item !== undefined) {
        slots.push(item);
        continue;
      }

      if (ownPropsSymbol !== null && capture.symbol.id === ownPropsSymbol.id && identityRecords !== null) {
        if (!capture.references.every(isSlotMemberRead)) {
          recordRefusal(
            "handler-captures-unprovable-binding",
            `The handler closes over \`${capture.symbol.name}\`, which is not a provable cell accessor.`,
            capture.references[0]?.node ?? fn,
            { binding: capture.symbol.name, declaredInScope: capture.symbol.scope.kind },
          );
          continue;
        }
        const seen = new Set<string>();
        let uncovered = false;
        for (const reference of capture.references) {
          const parent: Node = moduleInfo.parentOf(reference.node);
          const identity = parent == null ? null : identityOf(parent);
          if (identity === null) {
            uncovered = true;
            break;
          }
          if (seen.has(identity.member)) continue;
          seen.add(identity.member);
          slots.push(identitySlotOf(identity));
        }
        if (uncovered) {
          recordRefusal(
            "handler-captures-unprovable-binding",
            `The handler closes over \`${capture.symbol.name}\`, which is not a provable cell accessor.`,
            capture.references[0]?.node ?? fn,
            { binding: capture.symbol.name, declaredInScope: capture.symbol.scope.kind },
          );
        }
        continue;
      }

      const accessor = accessors.get(capture.symbol.id);
      if (accessor === undefined || accessor.derived) {
        recordRefusal(
          "handler-captures-unprovable-binding",
          `The handler closes over \`${capture.symbol.name}\`, which is not a provable cell accessor.`,
          capture.references[0]?.node ?? fn,
          { binding: capture.symbol.name, declaredInScope: capture.symbol.scope.kind },
        );
        continue;
      }
      slots.push({ name: capture.symbol.name, cell: accessor.cellId, access: accessor.access });
    }

    for (const reference of moduleInfo.unresolvedReferences) {
      if (!contains(fn, reference.node) || reference.inTypePosition) continue;
      // S3, admission 2: `Date` and `Math` are admitted as the receiver of an
      // enumerated member call and nowhere else.
      if (isAmbientReceiver(reference.node)) continue;
      recordRefusal(
        "handler-references-free-name",
        `The handler references the free name \`${reference.name}\`, which has no binding in this module.`,
        reference.node,
        { binding: reference.name },
      );
    }

    moduleInfo.walk(
      {
        enter: (node: Node) => {
          if (HANDLER_SYNTAX.has(node.type)) return;
          // S3, admission 3: event-time syntax, only where the structural check
          // holds. None of it is reachable from the derivation walk.
          if (EVENT_TIME_SYNTAX.has(node.type) && isEventTimeSyntax(fn, node)) return;
          recordRefusal(
            "handler-unsupported-syntax",
            `The handler contains a \`${node.type}\`, which this pass does not prove.`,
            node,
          );
        },
        CallExpression: (node: Node) => {
          const callee = unwrap(node.callee);
          if (callee.type !== "Identifier") {
            // An enumerated ambient call, or a method call on a value that only
            // exists once the event fired. Neither is ever evaluated here.
            if (isEventTimeValue(fn, node)) return;
            recordRefusal("handler-calls-non-accessor", "The handler calls a computed callee.", node);
            return;
          }
          const symbol = moduleInfo.referenceOf(callee)?.symbol ?? null;
          if (symbol === null) return; // already reported as a free name

          // S3: dispatching a store action, admitted by identity. Arity is a
          // property of the body, which this pass refuses to read.
          if (actionSlots.has(symbol.id)) return;

          const accessor = accessors.get(symbol.id);
          if (accessor !== undefined) {
            const arity = accessor.access === "read" ? 0 : 1;
            if (node.arguments.length !== arity) {
              recordRefusal(
                "handler-calls-non-accessor",
                `\`${callee.name}\` is a cell ${accessor.access === "read" ? "getter" : "setter"} called with ${node.arguments.length} arguments.`,
                node,
              );
            }
            return;
          }

          if (contains(fn, symbol.scope.node)) return; // declared inside the handler

          recordRefusal(
            "handler-calls-non-accessor",
            `The handler calls \`${callee.name}\`, which is neither a cell accessor nor local to the handler.`,
            node,
            { ...describeCallee(callee) },
          );
        },
      },
      fn,
    );

    return slots.sort((a, b) => a.name.localeCompare(b.name));
  }

  // ------------------------------------------------------- emitted reachability

  /**
   * The value a name declared INSIDE this component stands for: the function it
   * is, or the expression it was initialized with. A parameter and a
   * destructured element both come back null — neither has a value written
   * here, so neither is something the walk can follow into.
   */
  function localValueOf(symbol: YukuSymbol): Node | null {
    if (symbol.declarations.length !== 1) return null;
    const declaration: Node = symbol.declarations[0];
    if (declaration == null || !contains(component.fn, declaration)) return null;

    const parent: Node = moduleInfo.parentOf(declaration);
    if (parent == null) return null;
    if (parent.type === "FunctionDeclaration" && parent.id === declaration) return parent;
    if (parent.type === "VariableDeclarator" && parent.id === declaration) return parent.init ?? null;
    return null;
  }

  /**
   * Closes `reachedFromOutput` over the component's own local names.
   *
   * The walk reaches expressions; an expression reaches whatever it NAMES, and
   * a name declared in this component stands for a value written here — a
   * derivation closure, a helper, a constant. So `checked={allCompleted()}`
   * reaches `allCompleted`'s body, which reaches anything that body names, to a
   * fixpoint. Nothing outside the component is followed: a module-scope binding
   * is not something this component's markup owns.
   */
  for (let index = 0; index < reachedFromOutput.length; index++) {
    moduleInfo.walk(
      {
        Identifier: (identifier: Node) => {
          const symbol = moduleInfo.referenceOf(identifier)?.symbol ?? null;
          if (symbol === null) return;
          const value = localValueOf(symbol);
          if (value === null || reachedFromOutput.includes(value)) return;
          reachedFromOutput.push(value);
        },
      },
      reachedFromOutput[index],
    );
  }

  /** True when this node sits inside something the emitted output reaches. */
  function reachesEmittedOutput(node: Node): boolean {
    return reachedFromOutput.some((reached) => contains(reached, node));
  }

  /**
   * True when this occurrence of a binding is ASSIGNED THROUGH:
   * `state.done = true`, `state.items.length++`, `delete state.x`. The whole
   * member chain is climbed first, computed steps included, because the
   * question is only what happens at the top of it.
   *
   * These are never exempted by the reachability narrowing below. Reachability
   * says nobody reads this; it says nothing about a component that writes to a
   * store while it renders, and the narrowing is not the place to start
   * claiming things about that.
   *
   * It is deliberately the SYNTACTIC arm and not "every mutation": a method
   * call cannot be told apart from a read — `todos.filter(…)` and
   * `todos.push(…)` are the same shape — which is exactly why the audit refused
   * every one of them to begin with, and exactly why the narrowing rests on
   * reachability rather than on a fresh opinion about what a use does. What is
   * claimed for an unreached method call is only that nothing this pass emits
   * reaches it, which is the same claim made for an unreached read.
   */
  function mutatesThroughRead(from: Node): boolean {
    let node: Node = from;
    let parent: Node = moduleInfo.parentOf(node);
    while (parent != null && parent.type === "MemberExpression" && parent.object === node) {
      node = parent;
      parent = moduleInfo.parentOf(node);
    }
    if (parent == null) return false;
    if (parent.type === "AssignmentExpression" && parent.left === node) return true;
    if (parent.type === "UpdateExpression") return true;
    return parent.type === "UnaryExpression" && parent.operator === "delete";
  }

  // ------------------------------------------------------------------ escapes

  // After the markup walk, because an accessor passed to a child the walk
  // inlined has not escaped.
  for (const audit of pendingAudits) auditUses(audit.symbol, audit.role);

  // A store read is admitted as an identity and used as one: the pass records
  // every reference it DERIVED a text from, and everything else is an escape.
  // That is deliberately the strictest possible rule, and it is what keeps the
  // admission at "reads only" — a write (`state.done = true`), a method call
  // (`state.todos.filter(…)`) and a hand-off to any other function all land
  // here, because none of them is a use this pass proved. The one addition since
  // is a handler reaching THROUGH the binding for a property, and it earns its
  // place by being RECORDED as admitted rather than by weakening the rule.
  //
  // And one narrowing, the exact parallel of a measured guard's child never
  // being walked: a use that NO EMITTED ARTIFACT REACHES is not a blocker. A
  // component whose outer region is absent emits a template with nothing in it,
  // no binding, no wiring and no keyed region; the local derivation its markup
  // would have called is, to everything this pass emits, code that is not there.
  // Refusing it would be refusing a component for the contents of a branch the
  // build already recorded as not served.
  //
  // Three clauses keep that narrowing honest, and all three are load-bearing:
  //
  //   - REACHABILITY, never reference count. The question is not how many times
  //     the name appears; it is whether emitted output reaches it. A derivation
  //     called once from a served attribute is reached; a derivation called
  //     twice from an absent branch is not.
  //   - THE GUARD ITSELF IS EMITTED OUTPUT. `<Show when={todos.length > 0}>` is
  //     an attribute of an element the walk entered, so the guard — and
  //     everything the guard names — is reached and stays fully analyzed. That
  //     is what makes the region's own `present: false` a proven fact rather
  //     than a convenience.
  //   - RECORD THE REGION PRESENT AND THE REFUSAL COMES BACK. Presence is what
  //     makes the walk enter the branch, which is what reaches the derivation.
  //     Nothing here has to be remembered for that to happen; it falls out of
  //     the walk, which is why the narrowing cannot be true in one direction
  //     only.
  //
  // A WRITE is exempted by none of it — see `mutatesThroughRead`.
  for (const site of readSites) {
    for (const reference of site.symbol.references) {
      if (reference.inTypePosition || reference.node === site.node) continue;
      if (derivedReads.has(reference.node) || slotReads.has(reference.node)) continue;
      if (site.read.path.length === 0 && isWholeBindAdmittedUse(moduleInfo, reference.node)) continue;
      if (!mutatesThroughRead(reference.node) && !reachesEmittedOutput(reference.node)) continue;
      refuse(
        "store-read-escapes",
        `\`${site.read.name}\` stands for slot ${JSON.stringify(site.read.path)} of store \`${site.read.store}\`, and this use is not a text derivation this pass performed: reading the store's data into this component's own markup is the whole of what was admitted.`,
        reference.node,
        { binding: site.read.name, store: site.read.store, path: site.read.path },
      );
    }
  }

  // ------------------------------------------------------------------ derived cells
  //
  // A derived accessor is recorded in `cells` only when a binding compute
  // captured it as a cell-read. The factory initializer must fold to a literal
  // over the call-site arguments; every argument must be foldable-to-literal or
  // a getter whose setter's only admitted seats are mount-time ref replay.

  const capturedReads = new Set<string>();
  const collectCellReads = (slots: CaptureSlot[]): void => {
    for (const slot of slots) {
      if (isCellSlot(slot) && slot.access === "read") capturedReads.add(slot.cell);
    }
  };
  for (const binding of bindings) collectCellReads(binding.captures);
  for (const region of regions) collectCellReads(region.captures);
  for (const region of keyedRegions) {
    collectCellReads(region.captures);
    for (const binding of region.itemBindings) collectCellReads(binding.captures);
  }

  function topLevelReturned(fn: Node): Node | null {
    if (fn.body == null) return null;
    if (fn.body.type !== "BlockStatement") return unwrap(fn.body);
    const returns = (fn.body.body as Node[]).filter((statement: Node) => statement.type === "ReturnStatement");
    if (returns.length !== 1 || returns[0].argument == null) return null;
    return unwrap(returns[0].argument);
  }

  function factoryInitializerOf(summary: DerivedAccessorSummary): Node | null | undefined {
    const factories = signalFactorySymbols(summary.module);
    for (const call of summary.module.findAll("CallExpression")) {
      if (!contains(summary.fn, call) || !isFactoryCall(summary.module, call, factories)) continue;
      let node: Node = call;
      let parent: Node = summary.module.parentOf(node);
      while (parent != null && isTransparent(parent)) {
        node = parent;
        parent = summary.module.parentOf(node);
      }
      if (parent == null || parent.type !== "VariableDeclarator" || parent.init !== node) continue;
      const pattern = parent.id;
      if (pattern?.type !== "ArrayPattern" || pattern.elements.length !== 2) continue;
      const getter = summary.module.symbolOf(pattern.elements[0]);
      if (getter === null || getter.id !== summary.returnedGetter.id) continue;
      return call.arguments.length === 0 ? null : call.arguments[0];
    }
    return undefined;
  }

  type FoldBinding =
    | { kind: "literal"; value: StaticValue }
    | { kind: "closure"; returned: Node }
    | { kind: "getter" };

  function isLiteralReturningClosure(node: Node): boolean {
    if (node == null) return false;
    if (node.type !== "ArrowFunctionExpression" && node.type !== "FunctionExpression") return false;
    if ((node.params?.length ?? 0) !== 0) return false;
    const returned = topLevelReturned(node);
    return returned != null && frozenInitial(moduleInfo, returned).ok;
  }

  function bindCallSiteArg(arg: Node): FoldBinding | null {
    const inner = unwrap(arg);
    const frozen = frozenInitial(moduleInfo, inner);
    if (frozen.ok) return { kind: "literal", value: frozen.value };
    if (isLiteralReturningClosure(inner)) {
      const returned = topLevelReturned(inner);
      return returned == null ? null : { kind: "closure", returned };
    }
    const accessor = accessorOf(inner);
    if (accessor !== null && accessor.access === "read" && accessor.derived !== true) {
      return { kind: "getter" };
    }
    return null;
  }

  function argFoldableToLiteral(arg: Node): boolean {
    const inner = unwrap(arg);
    return frozenInitial(moduleInfo, inner).ok || isLiteralReturningClosure(inner);
  }

  function setterOnlyRefReplay(cellId: string): boolean {
    const setter = setterByCell.get(cellId);
    if (setter === undefined) return false;
    for (const reference of setter.references) {
      if (reference.inTypePosition) continue;
      if (!seenThroughArrayRef.has(reference.node)) return false;
    }
    return true;
  }

  function functionOfSymbol(mod: Module, symbol: YukuSymbol): Node | null {
    if (symbol.declarations.length !== 1) return null;
    const declaration: Node = symbol.declarations[0];
    if (declaration == null) return null;
    if (
      declaration.type === "FunctionDeclaration" ||
      declaration.type === "FunctionExpression" ||
      declaration.type === "ArrowFunctionExpression"
    ) {
      return declaration;
    }
    const parent: Node = mod.parentOf(declaration);
    if (parent == null) return null;
    if (
      (parent.type === "FunctionDeclaration" || parent.type === "FunctionExpression") &&
      parent.id === declaration
    ) {
      return parent;
    }
    if (parent.type === "VariableDeclarator" && parent.id === declaration && parent.init != null) {
      const init = unwrap(parent.init);
      return init.type === "ArrowFunctionExpression" || init.type === "FunctionExpression" ? init : null;
    }
    return null;
  }

  function foldThroughSingleReturn(
    mod: Module,
    call: Node,
    env: Map<number, FoldBinding>,
  ): { ok: true; value: StaticValue } | { ok: false } | null {
    const args: Node[] = call.arguments ?? [];
    const summary = summarize(mod, call.callee);
    if (summary !== null && args.length === summary.params.length) {
      const innerEnv = new Map<number, FoldBinding>();
      for (let index = 0; index < summary.params.length; index++) {
        const folded = foldStatic(mod, args[index], env);
        if (!folded.ok) return { ok: false };
        innerEnv.set(summary.paramSymbols[index].id, { kind: "literal", value: folded.value });
      }
      return foldStatic(summary.module, summary.returned, innerEnv);
    }

    const callee = unwrap(call.callee);
    if (callee == null || callee.type !== "Identifier") return null;
    const symbol = mod.referenceOf(callee)?.symbol ?? null;
    if (symbol === null) return null;
    const definition = symbol.definition();
    if (definition == null || definition.symbol == null) return null;
    const fnMod = definition.module;
    const fn = functionOfSymbol(fnMod, definition.symbol);
    if (fn == null) return null;
    const params: Node[] = fn.params ?? [];
    if (params.length !== args.length) return null;
    if (!params.every((param: Node) => param != null && param.type === "Identifier")) return null;
    const returned = topLevelReturned(fn);
    if (returned == null) return null;
    const innerEnv = new Map<number, FoldBinding>();
    for (let index = 0; index < params.length; index++) {
      const paramSymbol = fnMod.symbolOf(params[index]);
      if (paramSymbol === null) return null;
      const folded = foldStatic(mod, args[index], env);
      if (!folded.ok) return { ok: false };
      innerEnv.set(paramSymbol.id, { kind: "literal", value: folded.value });
    }
    return foldStatic(fnMod, returned, innerEnv);
  }

  function foldStatic(
    mod: Module,
    node: Node,
    env: Map<number, FoldBinding>,
  ): { ok: true; value: StaticValue } | { ok: false } {
    const inner = unwrap(node);
    if (inner == null) return { ok: false };

    const frozen = frozenInitial(mod, inner);
    if (frozen.ok) return frozen;

    if (inner.type === "ChainExpression") return foldStatic(mod, inner.expression, env);

    if (inner.type === "Identifier") {
      const symbol = mod.referenceOf(inner)?.symbol ?? null;
      if (symbol === null) return { ok: false };
      const bound = env.get(symbol.id);
      return bound?.kind === "literal" ? { ok: true, value: bound.value } : { ok: false };
    }

    if (inner.type === "CallExpression" || inner.type === "OptionalCallExpression") {
      if ((inner.arguments?.length ?? 0) === 0) {
        const callee = unwrap(inner.callee);
        if (callee?.type === "Identifier") {
          const symbol = mod.referenceOf(callee)?.symbol ?? null;
          const bound = symbol === null ? undefined : env.get(symbol.id);
          if (bound?.kind === "closure") return foldStatic(mod, bound.returned, env);
          if (
            bound?.kind === "literal" &&
            (inner.type === "OptionalCallExpression" || inner.optional === true) &&
            bound.value === null
          ) {
            return { ok: true, value: null };
          }
          return { ok: false };
        }
      }

      const through = foldThroughSingleReturn(mod, inner, env);
      if (through !== null) return through;
      return { ok: false };
    }

    if (inner.type === "UnaryExpression" && inner.operator === "typeof") {
      const argument = foldStatic(mod, inner.argument, env);
      if (!argument.ok) return { ok: false };
      return { ok: true, value: argument.value === null ? "object" : typeof argument.value };
    }

    if (inner.type === "BinaryExpression" && (inner.operator === "===" || inner.operator === "!==")) {
      const left = foldStatic(mod, inner.left, env);
      const right = foldStatic(mod, inner.right, env);
      if (!left.ok || !right.ok) return { ok: false };
      const equal = left.value === right.value;
      return { ok: true, value: inner.operator === "===" ? equal : !equal };
    }

    if (inner.type === "ConditionalExpression") {
      const test = foldStatic(mod, inner.test, env);
      if (!test.ok) return { ok: false };
      return foldStatic(mod, test.value ? inner.consequent : inner.alternate, env);
    }

    return { ok: false };
  }

  function foldDerivedCellInitial(
    pending: (typeof pendingDerived)[number],
  ): { ok: true; value: StaticValue } | { ok: false } {
    const initializer = factoryInitializerOf(pending.summary);
    if (initializer === undefined) return { ok: false };
    if (initializer === null) return { ok: true, value: null };

    const args: Node[] = pending.call.arguments;
    if (args.length !== pending.summary.params.length) return { ok: false };

    const env = new Map<number, FoldBinding>();
    for (let index = 0; index < args.length; index++) {
      const bound = bindCallSiteArg(args[index]);
      if (bound !== null) env.set(pending.summary.paramSymbols[index].id, bound);
    }
    return foldStatic(pending.summary.module, initializer, env);
  }

  function derivedCellInputsMountStable(pending: (typeof pendingDerived)[number]): boolean {
    const args: Node[] = pending.call.arguments;
    if (args.length !== pending.summary.params.length) return false;
    for (const arg of args) {
      if (argFoldableToLiteral(arg)) continue;
      const accessor = accessorOf(unwrap(arg));
      if (
        accessor !== null &&
        accessor.access === "read" &&
        accessor.derived !== true &&
        setterOnlyRefReplay(accessor.cellId)
      ) {
        continue;
      }
      return false;
    }
    return true;
  }

  function writerSetsParam(mod: Module, fn: Node, setterIds: ReadonlySet<number>, param: Node): boolean {
    const paramSymbol = mod.symbolOf(param);
    if (paramSymbol === null) return false;
    let writes = 0;
    let ok = true;
    mod.walk(
      {
        CallExpression: (node: Node) => {
          if (!ok || (node.arguments?.length ?? 0) !== 1) return;
          const callee = unwrap(node.callee);
          if (callee == null || callee.type !== "Identifier") return;
          const symbol = mod.referenceOf(callee)?.symbol ?? null;
          if (symbol === null || !setterIds.has(symbol.id)) return;
          writes++;
          const arg = unwrap(node.arguments[0]);
          if (arg == null || arg.type !== "Identifier") {
            ok = false;
            return;
          }
          const argSymbol = mod.referenceOf(arg)?.symbol ?? null;
          if (argSymbol === null || argSymbol.id !== paramSymbol.id) ok = false;
        },
      },
      fn,
    );
    return ok && writes === 1;
  }

  function deferredWriteValue(summary: DerivedAccessorSummary): Node | null {
    const setterIds = new Set(summary.localSetters.map((setter) => setter.id));

    for (const call of summary.module.findAll("CallExpression")) {
      if (!contains(summary.fn, call) || (call.arguments?.length ?? 0) !== 2) continue;
      const compute = unwrap(call.arguments[0]);
      const writer = unwrap(call.arguments[1]);
      if (!isFunctionNode(compute) || !isFunctionNode(writer)) continue;
      if ((compute.params?.length ?? 0) !== 0) continue;
      if ((writer.params?.length ?? 0) !== 1) continue;
      const param = writer.params[0];
      if (param == null || param.type !== "Identifier") continue;
      if (!writerSetsParam(summary.module, writer, setterIds, param)) continue;
      const returned = topLevelReturned(compute);
      if (returned != null) return returned;
    }

    for (const call of summary.module.findAll("CallExpression")) {
      if (!contains(summary.fn, call) || (call.arguments?.length ?? 0) !== 1) continue;
      const callee = unwrap(call.callee);
      if (callee == null || callee.type !== "Identifier") continue;
      const symbol = summary.module.referenceOf(callee)?.symbol ?? null;
      if (symbol === null || !setterIds.has(symbol.id)) continue;
      const arg = unwrap(call.arguments[0]);
      if (arg == null || arg.type === "Identifier") continue;
      return arg;
    }

    return null;
  }

  function rootRefWriteCells(): Set<string> {
    const ids = new Set<string>();
    for (const binding of bindings) {
      if (binding.kind !== "attribute" || binding.attribute !== "ref") continue;
      if (binding.locator !== "/") continue;
      for (const slot of binding.captures) {
        if (isCellSlot(slot) && slot.access === "write") ids.add(slot.cell);
      }
    }
    return ids;
  }

  function callSiteGetterCell(arg: Node): string | null {
    const accessor = accessorOf(unwrap(arg));
    if (accessor === null || accessor.access !== "read" || accessor.derived === true) return null;
    return accessor.cellId;
  }

  function elementProjectionOf(
    pending: (typeof pendingDerived)[number],
  ): { projection: ElementProjection } | { refuse: ReasonCode; message: string } | null {
    const written = deferredWriteValue(pending.summary);
    if (written == null) return null;

    const getterIds = new Set<number>();
    for (let index = 0; index < pending.summary.paramSymbols.length; index++) {
      if (parameterIsGetterOnly(pending.summary, index)) {
        getterIds.add(pending.summary.paramSymbols[index].id);
      }
    }
    if (getterIds.size === 0) return null;

    const match = matchElementProjection(pending.summary.module, written, getterIds);
    if (match === null) return null;
    if (match.kind === "not-pure") {
      return {
        refuse: "element-projection-not-pure",
        message:
          "The derived cell's deferred write is an element projection that is not a property chain or getAttribute of a string literal.",
      };
    }
    if (match.kind === "not-own-host") {
      return {
        refuse: "element-projection-not-own-host",
        message: "The derived cell's deferred write projects an element other than a getter parameter of the helper.",
      };
    }
    if (match.steps.length === 0) return null;

    const paramIndex = pending.summary.paramSymbols.findIndex((symbol) => symbol.id === match.getterId);
    if (paramIndex < 0) return null;
    const hostCell = callSiteGetterCell(pending.call.arguments[paramIndex]);
    const ownHost = rootRefWriteCells();
    if (hostCell === null || !ownHost.has(hostCell)) {
      return {
        refuse: "element-projection-not-own-host",
        message: "The derived cell's deferred write projects an element other than the mount's own host.",
      };
    }

    return { projection: { host: hostCell, steps: match.steps } };
  }

  const projectionCells = new Set<string>();

  for (const pending of pendingDerived) {
    if (!capturedReads.has(pending.cellId)) continue;

    const folded = foldDerivedCellInitial(pending);
    if (!folded.ok) {
      refuse(
        "derived-cell-initial-not-foldable",
        "The derived cell's factory initializer does not fold to a literal over the call-site arguments.",
        pending.call,
      );
      continue;
    }

    if (!derivedCellInputsMountStable(pending)) {
      refuse(
        "derived-cell-input-not-mount-stable",
        "A call-site argument of the derived-cell helper is neither foldable to a literal nor a getter of a component cell whose setter's only admitted seats are mount-time ref replay.",
        pending.call,
      );
      continue;
    }

    const projected = elementProjectionOf(pending);
    if (projected !== null && "refuse" in projected) {
      refuse(projected.refuse, projected.message, pending.call);
      continue;
    }

    if (projected !== null) projectionCells.add(pending.cellId);

    cells.push({
      id: pending.cellId,
      getter: pending.name,
      initial: folded.value,
      loc: locOf(pending.call),
      ...(projected === null ? {} : { projection: projected.projection }),
    });
  }

  if (projectionCells.size > 0) {
    for (const handler of handlers) {
      if (handler.captures.some((slot) => isCellSlot(slot) && projectionCells.has(slot.cell))) {
        refuse(
          "element-projection-not-pure",
          "A handler captures an element-projection cell; projection cells are binding computes only.",
          component.fn,
        );
      }
    }
  }

  // ------------------------------------------------------------------ verdict

  const signalDiagnostics: SignalFamilyRecord = {
    initializers: signalInitializers,
    escapes: signalEscapes,
  };

  if (reasons.length > 0) {
    return {
      status: "fallback",
      component: component.name,
      module: moduleInfo.path,
      reasons,
      ...(unmaskAttributeAudit ? { attributeDiagnostics, signalDiagnostics } : {}),
    };
  }

  // A region item's handler is wired BY KEY, inside its region, so it is not in
  // the component's own flat list — its locator is rooted at an item element and
  // would address something else entirely from the component's root.
  const wiring: WiringRecord[] = handlers
    .filter((handler) => !regionHandlers.has(handler.id))
    .map((handler) => ({
      locator: handler.locator,
      event: handler.event,
      module: handler.module,
      handler: handler.id,
      captures: handler.captures,
    }));

  return {
    status: "provable",
    component: component.name,
    module: moduleInfo.path,
    cells,
    stores,
    actions,
    reads,
    inlined,
    claimedChildren,
    bindings,
    regions,
    keyedRegions,
    handlers,
    wiring,
    html,
    reasons: [],
    ...(unmaskAttributeAudit ? { signalDiagnostics } : {}),
  };
}

// --------------------------------------------------------------------- helpers

/** Symbol ids of every `createSignal` imported from a Solid signal module. */
function signalFactorySymbols(moduleInfo: Module): Set<number> {
  const ids = new Set<number>();
  for (const record of moduleInfo.imports) {
    if (record.typeOnly || record.local === null) continue;
    if (!SIGNAL_MODULES.has(record.specifier)) continue;
    if (record.name === "createSignal") ids.add(record.local.id);
  }
  return ids;
}

/**
 * Symbol ids of one Solid control-flow export, resolved through the module's
 * own import records rather than matched on how the file spells it. `Show`
 * imported under another name is still Solid's `Show`; a local component the
 * author happened to call `Show` is not, and neither is one from anywhere else.
 */
function controlFlowSymbols(moduleInfo: Module, exported: string): Set<number> {
  const ids = new Set<number>();
  for (const record of moduleInfo.imports) {
    if (record.typeOnly || record.local === null) continue;
    if (!CONTROL_FLOW_MODULES.has(record.specifier)) continue;
    if (record.name === exported) ids.add(record.local.id);
  }
  return ids;
}

/**
 * Symbol ids of one Solid framework export, resolved through the module's
 * own import records. Same recognition class as {@link signalFactorySymbols}:
 * specifier is a framework bare specifier, `record.name` is the export, and
 * local spelling is irrelevant.
 */
function frameworkExportSymbols(moduleInfo: Module, exported: string): Set<number> {
  const ids = new Set<number>();
  for (const record of moduleInfo.imports) {
    if (record.typeOnly || record.local === null) continue;
    if (!SIGNAL_MODULES.has(record.specifier) && !CONTROL_FLOW_MODULES.has(record.specifier)) {
      continue;
    }
    if (record.name === exported) ids.add(record.local.id);
  }
  return ids;
}

function refersToFrameworkExport(mod: Module, node: Node, symbols: Set<number>): boolean {
  const ident = unwrap(node);
  if (ident == null) return false;
  if (ident.type !== "Identifier" && ident.type !== "JSXIdentifier") return false;
  const symbol = mod.referenceOf(ident)?.symbol ?? null;
  return symbol !== null && symbols.has(symbol.id);
}

/** `props.K` against a known props-parameter symbol, or null. */
function propsMemberKey(mod: Module, node: Node, propsSymbol: YukuSymbol): string | null {
  const expression = unwrap(node);
  if (expression == null || expression.type !== "MemberExpression") return null;
  if (expression.computed === true) return null;
  if (expression.property?.type !== "Identifier") return null;
  const object = unwrap(expression.object);
  if (object == null || object.type !== "Identifier") return null;
  const symbol = mod.referenceOf(object)?.symbol ?? null;
  if (symbol === null || symbol.id !== propsSymbol.id) return null;
  return expression.property.name;
}

function matchOmitBinding(
  mod: Module,
  statement: Node,
  propsSymbol: YukuSymbol,
  omitSymbols: Set<number>,
): { restSymbol: YukuSymbol; key: string } | null {
  if (statement.type !== "VariableDeclaration" || statement.kind !== "const") return null;
  const declarators: Node[] = statement.declarations ?? [];
  if (declarators.length !== 1) return null;
  const declarator = declarators[0];
  if (declarator.id?.type !== "Identifier") return null;
  const init = unwrap(declarator.init);
  if (init == null || init.type !== "CallExpression") return null;
  if (!refersToFrameworkExport(mod, init.callee, omitSymbols)) return null;
  if (init.arguments.length !== 2) return null;
  const propsArg = unwrap(init.arguments[0]);
  if (propsArg == null || propsArg.type !== "Identifier") return null;
  const propsRef = mod.referenceOf(propsArg)?.symbol ?? null;
  if (propsRef === null || propsRef.id !== propsSymbol.id) return null;
  const keyLiteral = literalValue(init.arguments[1]);
  if (!keyLiteral.ok || typeof keyLiteral.value !== "string") return null;
  const restSymbol = mod.symbolOf(declarator.id);
  if (restSymbol === null) return null;
  return { restSymbol, key: keyLiteral.value };
}

function matchUntrackGuard(
  mod: Module,
  statement: Node,
  propsSymbol: YukuSymbol,
  untrackSymbols: Set<number>,
): string | null {
  if (statement.type !== "IfStatement") return null;
  if (statement.alternate != null) return null;
  const test = unwrap(statement.test);
  if (test == null || test.type !== "UnaryExpression" || test.operator !== "!") return null;
  const call = unwrap(test.argument);
  if (call == null || call.type !== "CallExpression") return null;
  if (!refersToFrameworkExport(mod, call.callee, untrackSymbols)) return null;
  if (call.arguments.length !== 1) return null;
  const fn = unwrap(call.arguments[0]);
  if (fn == null || (fn.type !== "ArrowFunctionExpression" && fn.type !== "FunctionExpression")) {
    return null;
  }
  if ((fn.params ?? []).length !== 0) return null;
  let body: Node = unwrap(fn.body);
  if (fn.body?.type === "BlockStatement") {
    const statements: Node[] = fn.body.body ?? [];
    if (statements.length !== 1 || statements[0].type !== "ReturnStatement") return null;
    body = unwrap(statements[0].argument);
  }
  const key = propsMemberKey(mod, body, propsSymbol);
  if (key === null) return null;

  let consequent: Node = statement.consequent;
  if (consequent.type === "BlockStatement") {
    const statements: Node[] = consequent.body ?? [];
    if (statements.length !== 1) return null;
    consequent = statements[0];
  }
  if (consequent.type !== "ThrowStatement") return null;
  return key;
}

function matchDynamicReturn(
  mod: Module,
  statement: Node,
  propsSymbol: YukuSymbol,
  restSymbol: YukuSymbol,
  dynamicSymbols: Set<number>,
): string | null {
  if (statement.type !== "ReturnStatement") return null;
  const element = unwrap(statement.argument);
  if (element == null || element.type !== "JSXElement") return null;
  const name = element.openingElement.name;
  if (name.type !== "JSXIdentifier") return null;
  if (!refersToFrameworkExport(mod, name, dynamicSymbols)) return null;

  const attributes: Node[] = element.openingElement.attributes ?? [];
  if (attributes.length !== 2) return null;

  const spread = attributes[0];
  if (spread.type !== "JSXSpreadAttribute") return null;
  const spreadArg = unwrap(spread.argument);
  if (spreadArg == null || spreadArg.type !== "Identifier") return null;
  const spreadSymbol = mod.referenceOf(spreadArg)?.symbol ?? null;
  if (spreadSymbol === null || spreadSymbol.id !== restSymbol.id) return null;

  const component = attributes[1];
  if (component.type === "JSXSpreadAttribute") return null;
  if (component.name?.type !== "JSXIdentifier" || component.name.name !== "component") return null;
  if (component.value?.type !== "JSXExpressionContainer") return null;
  const key = propsMemberKey(mod, component.value.expression, propsSymbol);
  if (key === null) return null;

  const children: Node[] = (element.children ?? []).filter(
    (child: Node) => !(child.type === "JSXText" && String(child.value).trim() === ""),
  );
  if (children.length > 0) return null;
  return key;
}

/**
 * The omitted key `K` when `site` is exactly the element-indirection body,
 * or null. Guard may sit before or after the omit binding; the return is
 * last. No user-component name is consulted.
 */
function elementIndirectionKey(mod: Module, site: ComponentSite): string | null {
  const fn: Node = site.fn;
  const params: Node[] = fn.params ?? [];
  if (params.length !== 1) return null;
  const param: Node = params[0];
  if (param == null || param.type !== "Identifier") return null;
  const propsSymbol = mod.symbolOf(param);
  if (propsSymbol === null) return null;

  if (fn.body == null || fn.body.type !== "BlockStatement") return null;
  const statements: Node[] = fn.body.body ?? [];
  if (statements.length < 2 || statements.length > 3) return null;
  if (statements[statements.length - 1].type !== "ReturnStatement") return null;

  const omitSymbols = frameworkExportSymbols(mod, "omit");
  const untrackSymbols = frameworkExportSymbols(mod, "untrack");
  const dynamicSymbols = frameworkExportSymbols(mod, "Dynamic");
  if (omitSymbols.size === 0 || dynamicSymbols.size === 0) return null;

  let omitMatch: { restSymbol: YukuSymbol; key: string } | null = null;
  let guardKey: string | null = null;
  let returnStmt: Node | null = null;

  for (const statement of statements) {
    if (statement.type === "VariableDeclaration") {
      if (omitMatch !== null) return null;
      omitMatch = matchOmitBinding(mod, statement, propsSymbol, omitSymbols);
      if (omitMatch === null) return null;
      continue;
    }
    if (statement.type === "IfStatement") {
      if (guardKey !== null) return null;
      guardKey = matchUntrackGuard(mod, statement, propsSymbol, untrackSymbols);
      if (guardKey === null) return null;
      continue;
    }
    if (statement.type === "ReturnStatement") {
      if (returnStmt !== null) return null;
      returnStmt = statement;
      continue;
    }
    return null;
  }

  if (omitMatch === null || returnStmt === null) return null;
  const returnKey = matchDynamicReturn(mod, returnStmt, propsSymbol, omitMatch.restSymbol, dynamicSymbols);
  if (returnKey === null || returnKey !== omitMatch.key) return null;
  if (guardKey !== null && guardKey !== omitMatch.key) return null;
  return omitMatch.key;
}

function isFactoryCall(moduleInfo: Module, call: Node, factories: Set<number>): boolean {
  const callee = unwrap(call.callee);
  if (callee.type !== "Identifier") return false;
  const symbol = moduleInfo.referenceOf(callee)?.symbol ?? null;
  return symbol !== null && factories.has(symbol.id);
}

/** The discovered component a symbol names, or null. Going through
 * `findComponents` rather than any JSX-returning function is deliberate: it is
 * the definition the coverage denominator uses, so an inlined child is always
 * something the report counted in its own right. */
function componentSiteOf(mod: Module, symbol: YukuSymbol): ComponentSite | null {
  if (symbol.declarations.length !== 1) return null;

  const declaration: Node = symbol.declarations[0];
  if (declaration == null) return null;

  const parent: Node = mod.parentOf(declaration);
  if (parent == null) return null;

  let fn: Node = null;
  if (parent.type === "FunctionDeclaration" && parent.id === declaration) fn = parent;
  else if (parent.type === "VariableDeclarator" && parent.id === declaration && parent.init != null) {
    fn = unwrap(parent.init);
  }
  if (fn == null) return null;

  return findComponents(mod).find((site) => site.fn === fn) ?? null;
}

/** The shape a child must have before a single prop is looked at: at most one
 * plain props parameter never used whole, no free names, one statement, no
 * cells, an intrinsic root. `capturesOf(fn).length === 0` does the most work —
 * naming ANYTHING from module scope is refused. */
function inlinableChild(
  mod: Module,
  site: ComponentSite,
): { root: Node; propsSymbol: YukuSymbol | null } | null {
  const fn: Node = site.fn;

  const params: Node[] = fn.params ?? [];
  if (params.length > 1) return null;

  let propsSymbol: YukuSymbol | null = null;
  if (params.length === 1) {
    const param: Node = params[0];
    // A destructured or defaulted parameter has no single binding to check.
    if (param == null || param.type !== "Identifier") return null;

    const symbol = mod.symbolOf(param);
    if (symbol === null) return null;

    // Never used whole — which rules out `{...props}` and `store(props)`.
    for (const reference of symbol.references) {
      if (reference.inTypePosition) continue;
      if (reference.isWrite) return null;
      const parent: Node = mod.parentOf(reference.node);
      if (
        parent == null ||
        parent.type !== "MemberExpression" ||
        parent.object !== reference.node ||
        parent.computed === true ||
        parent.property?.type !== "Identifier"
      ) {
        return null;
      }
    }

    propsSymbol = symbol;
  }

  if (mod.capturesOf(fn).length > 0) return null;
  const namesAGlobal = mod.unresolvedReferences.some(
    (reference) => !reference.inTypePosition && contains(fn, reference.node),
  );
  if (namesAGlobal) return null;

  // Exactly one thing happens: it hands back markup, which is what makes
  // "declares no cells" structural rather than pattern-matched.
  if (fn.body == null) return null;
  if (fn.body.type === "BlockStatement") {
    const statements: Node[] = fn.body.body ?? [];
    if (statements.length !== 1 || statements[0].type !== "ReturnStatement") return null;
  }

  // A `createSignal` inside the child is state the parent has no slot for.
  const factories = signalFactorySymbols(mod);
  if (factories.size > 0) {
    const declaresCells = mod
      .findAll("CallExpression")
      .some((call: Node) => contains(fn, call) && isFactoryCall(mod, call, factories));
    if (declaresCells) return null;
  }

  const root = unwrap(site.returnArgument);
  if (root == null || root.type !== "JSXElement") return null;

  const name = root.openingElement.name;
  if (name.type !== "JSXIdentifier" || !/^[a-z]/.test(name.name)) return null;

  return { root, propsSymbol };
}

/** The mirror of `parameterIsAccessorOnly`, at the props boundary. An ACCESSOR
 * may only be called with its own arity; a HANDLER may only sit in an
 * event-attribute position; a LITERAL is left to the derivation walk. */
function propUsesConform(
  mod: Module,
  propsSymbol: YukuSymbol,
  props: Map<string, PropBinding>,
): boolean {
  return propsSymbol.references.every((reference) => {
    if (reference.inTypePosition) return true;

    // `inlinableChild` already proved every reference has this shape.
    const member: Node = mod.parentOf(reference.node);
    const bound = props.get(member.property.name);
    if (bound === undefined) return false;

    const parent: Node = mod.parentOf(member);

    if (bound.kind === "accessor") {
      const arity = bound.accessor.access === "read" ? 0 : 1;
      return (
        parent != null &&
        parent.type === "CallExpression" &&
        parent.callee === member &&
        parent.arguments.length === arity
      );
    }

    if (bound.kind === "handler") {
      if (parent == null || parent.type !== "JSXExpressionContainer") return false;
      const attribute: Node = mod.parentOf(parent);
      return (
        attribute != null &&
        attribute.type === "JSXAttribute" &&
        attribute.value === parent &&
        attribute.name?.type === "JSXIdentifier" &&
        EVENT_PROP.test(attribute.name.name)
      );
    }

    return true;
  });
}

function fold(operator: string, left: StaticValue, right: StaticValue): StaticValue | undefined {
  switch (operator) {
    case "+":
      return (left as never) + (right as never);
    case "-":
      return Number(left) - Number(right);
    case "*":
      return Number(left) * Number(right);
    case "/":
      return Number(left) / Number(right);
    case "%":
      return Number(left) % Number(right);
    default:
      return undefined;
  }
}

/** The comparison half, kept apart from `fold` because it answers a different
 * question: `fold` produces a value, this produces a verdict. Strict operators
 * only, so what is folded here is what JavaScript would decide at runtime. */
function nullLiteralSide(expression: Node): "left" | "right" | null {
  const left = unwrap(expression.left);
  const right = unwrap(expression.right);
  if (left != null && left.type === "Literal" && left.value === null) return "left";
  if (right != null && right.type === "Literal" && right.value === null) return "right";
  return null;
}

function compare(operator: string, left: StaticValue, right: StaticValue): boolean {
  switch (operator) {
    case "===":
      return left === right;
    case "!==":
      return left !== right;
    case "==":
      return left == right;
    case "!=":
      return left != right;
    case "<":
      return (left as never) < (right as never);
    case ">":
      return (left as never) > (right as never);
    case "<=":
      return (left as never) <= (right as never);
    default:
      return (left as never) >= (right as never);
  }
}
