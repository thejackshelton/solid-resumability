/**
 * Shared shapes for the comptime pass, JSON-serializable on purpose: a verdict
 * and its refusal reasons have to be machine-readable so a build can route
 * provable components down the resumable path and the rest down Solid's.
 *
 * This module imports nothing from the pass, which is what lets `artifactKey`
 * live here: artifact IDENTITY is a shape, the classifier needs it to stamp a
 * claimed child's address into a parent's template, and `index.ts` — where it
 * used to sit — already imports the classifier.
 */

import { basename, extname } from "pathe";

/**
 * The artifact key: `(module path, local component name)`. Identity to this pass
 * is the module a component lives in and the name it is bound to there, not its
 * export surface — re-export is packaging, and packaging does not reach the
 * verdict. A file stem that already spells the name adds nothing, so
 * `artifacts/CounterA/` stays byte for byte what it was; anything else is
 * qualified by the stem (`app/src/app.tsx` -> `app.Header`), which is what lets
 * five components in one module sit side by side.
 *
 * Short rather than injective on purpose: same-named components in same-named
 * files in different directories collide. `emit` reads the manifest already in
 * the target directory and refuses to write over a DIFFERENT pair, so the
 * collision is a build error rather than a silent merge.
 */
export function artifactKey(modulePath: string, component: string): string {
  const stem = basename(modulePath, extname(modulePath));
  return stem === component ? component : `${stem}.${component}`;
}

/** A byte span in the analyzed source, plus 1-based human coordinates. */
export interface SourceLoc {
  start: number;
  end: number;
  line: number;
  column: number;
}

/** Why a component was refused. Codes are a closed set so a build tool can
 * branch on them; `message` is for humans; `detail` carries what the analysis
 * learned, such as which opaque callee a signal escaped into. */
export const REASON_CODES = [
  /* component shape */
  "no-exported-component",
  /* signal sources */
  "no-signal-source",
  "signal-initializer-not-literal",
  "signal-result-not-bound",
  "signal-binding-not-destructured",
  "signal-escapes-to-opaque-callee",
  "signal-escapes-unanalyzable-use",
  /* store sources (S3) */
  "store-binding-not-provable",
  "store-read-not-provable",
  "store-read-escapes",
  /* handlers */
  "handler-not-inline",
  "handler-captures-unprovable-binding",
  "handler-references-free-name",
  "handler-unsupported-syntax",
  "handler-calls-non-accessor",
  /* control flow */
  "show-branch-not-static-at-capture",
  /* keyed regions (W4) */
  "region-each-not-store-projection",
  "region-body-not-inline-arrow",
  "region-item-not-single-element",
  "region-key-not-derivable",
  "region-nested",
  /* markup */
  "jsx-root-not-element",
  "jsx-component-element",
  "jsx-spread",
  "jsx-dynamic-attribute",
  "jsx-unsupported-children",
  "jsx-dynamic-child-not-derivable",
] as const;

export type ReasonCode = (typeof REASON_CODES)[number];

export interface Reason {
  code: ReasonCode;
  message: string;
  loc: SourceLoc;
  detail?: Record<string, unknown>;
}

/**
 * Where extracted code came from. `"component"` is the author's own source
 * printed verbatim, the one whose artifacts must stay byte-identical;
 * `"helper"` is folded out of a function `summaries.ts` proved; `"child"` out of
 * an inlined component element. Provenance of THE CODE, not of where the
 * artifact attaches — a handler the parent wrote inline and passed to an inlined
 * child is still `"component"`.
 */
export type CodeOrigin = "component" | "helper" | "child";

/** A handler's provenance. No `"child"` case by construction: a handler written
 * inside a child closes over the child's frame, which the parent's cells cannot
 * fill, so it is refused rather than inlined. `"action"` is the case where there
 * is no author code at all: the markup handed a store action straight to the
 * event prop, so the listener IS the action, resolved by identity at resume
 * time, and the handler module carries no body of anyone's. */
export type HandlerOrigin = "component" | "helper" | "action";

/** A serialized literal: the only thing a source cell may start life as. */
export type StaticValue = string | number | boolean | null;

/** One source cell (`createSignal(<literal>)`) or one admitted derived cell.
 * `initial` is the literal, read straight off the AST or folded at the call
 * site. `setter` is absent on a derived cell: the writer stays in the callee. */
export interface CellInfo {
  id: string;
  getter: string;
  setter?: string;
  initial: StaticValue;
  loc: SourceLoc;
}

/**
 * A context-provided store the component takes actions from (S3). Nothing here
 * describes the store's VALUE: it is identified by the `createContext` symbol
 * naming it and the provider proven to supply it, and its contents stay
 * runtime-opaque. `readSlot` is the tuple slot the component bound the store's
 * data from, when it bound one at a fixed numeric index — an identity, exactly
 * like `actionsSlot`, and never a value. `null` means the component destructured
 * a hole there and takes actions only.
 */
export interface StoreInfo {
  id: string;
  /** Local name of the `createContext` binding the component consumed. */
  context: string;
  /** Module that declares that `createContext` call. */
  contextModule: string;
  /** Tuple slot the actions object was destructured from. */
  actionsSlot: number;
  /** Fixed tuple slot the store's data was bound from, or null when unbound. */
  readSlot: number | null;
  /** Where the provider supplying this context's value was found. */
  provider: { module: string; loc: SourceLoc };
  /** The factory whose returned tuple the slot path indexes into. */
  value: { module: string; factory: string };
  loc: SourceLoc;
}

/** One action destructured out of a store, recorded BY IDENTITY: its store and
 * the fixed slot path reaching it from the provider's value. The body is never
 * read, summarized or emitted. */
export interface ActionInfo {
  id: string;
  store: string;
  /** The component-local binding name the extracted code uses. */
  name: string;
  /** Fixed slot path from the provider's value expression, e.g. `[1, "addTodo"]`. */
  path: (string | number)[];
  loc: SourceLoc;
}

/** One store READ binding, recorded exactly the way `ActionInfo` records an
 * action: by identity. `path` is the fixed slot path from the provider's value
 * that reaches the store's data — `[0]` for the usual `[state, actions]` tuple —
 * and stops there. What the data CONTAINS is not read, not folded and not
 * emitted; a derivation that reaches through this binding is printed as the
 * author wrote it and evaluated against the live store at resume time. */
export interface StoreReadInfo {
  id: string;
  store: string;
  /** The component-local binding name the extracted code uses. */
  name: string;
  /** Fixed slot path from the provider's value expression, e.g. `[0]`. */
  path: (string | number)[];
  loc: SourceLoc;
}

/**
 * One entry of a capture-slot manifest: the local name extracted code expects,
 * and what fills it. A CELL slot is `{ name, cell, access }`; an ACTION slot and
 * a STORE-READ slot carry no cell, only the store identity and fixed path. They
 * are told apart by the presence of `kind`, so a cell slot carries no extra
 * field.
 */
export interface CellCaptureSlot {
  name: string;
  cell: string;
  access: "read" | "write";
}

export interface ActionCaptureSlot {
  name: string;
  kind: "action";
  store: string;
  path: (string | number)[];
}

export interface StoreReadCaptureSlot {
  name: string;
  kind: "store-read";
  store: string;
  path: (string | number)[];
}

/**
 * A slot filled with ONE ITEM of a keyed region — the value the author's own
 * body parameter names (`todo` in `{todo => …}`). No value and no position: the
 * item is reached by the KEY the served markup carries on its element, which is
 * what makes a region binding an identity rather than an index. Inside a region,
 * a child's `props.todo` IS this slot, which is how a props-rooted derivation
 * stops being rooted at a props object nobody proved.
 */
export interface RegionItemCaptureSlot {
  name: string;
  kind: "region-item";
  /** The keyed region this item belongs to. */
  region: string;
}

/**
 * A slot filled with ONE identity-shaped prop: binding identity of
 * caller-dependent cargo, never a frozen value. `source` is the parent's
 * source-binding path (a symbol path, not a runtime object). Resume (slice D)
 * joins on that identity; this pass only records it.
 */
export interface IdentityCaptureSlot {
  name: string;
  kind: "identity";
  bindingClass: IdentityBindingClass;
  source: SourceBindingIdentity;
}

export type CaptureSlot =
  | CellCaptureSlot
  | ActionCaptureSlot
  | StoreReadCaptureSlot
  | RegionItemCaptureSlot
  | IdentityCaptureSlot;

/** True for the S3 action-slot arm of a capture manifest. */
export function isActionSlot(slot: CaptureSlot): slot is ActionCaptureSlot {
  return (slot as ActionCaptureSlot).kind === "action";
}

/** True for the store-read arm of a capture manifest. Sits beside
 * `isActionSlot` because the two are the same fact about different slots: a
 * store id plus a fixed path, resolved against the live store. */
export function isStoreReadSlot(slot: CaptureSlot): slot is StoreReadCaptureSlot {
  return (slot as StoreReadCaptureSlot).kind === "store-read";
}

/** True for the region-item arm: one item of a keyed region, reached by key. */
export function isRegionItemSlot(slot: CaptureSlot): slot is RegionItemCaptureSlot {
  return (slot as RegionItemCaptureSlot).kind === "region-item";
}

/** True for the identity-prop arm: binding identity, never a frozen value. */
export function isIdentitySlot(slot: CaptureSlot): slot is IdentityCaptureSlot {
  return (slot as IdentityCaptureSlot).kind === "identity";
}

/** True for the cell arm — the one with no `kind`. Written as its own guard so a
 * consumer that wants a cell says so, rather than subtracting the other four
 * and hoping the list stays complete. */
export function isCellSlot(slot: CaptureSlot): slot is CellCaptureSlot {
  return (slot as { kind?: string }).kind === undefined;
}

/**
 * Where a binding's first-paint value came from. `"derivation"` is the ordinary
 * case: every part folded at build time, so the emitter knows the answer and
 * writes it. A derivation that reaches through a store read has no build-time
 * answer — a store's data is runtime state — so `"capture"` says the value is
 * MEASURED out of the page's captured first paint at this binding's own
 * locator, and the emitted markup carries a hole until a capture supplies it.
 */
export type InitialFrom = "derivation" | "capture";

/**
 * One resolved AST node paired with the capture slot that node stands for.
 * Compared by node identity at print time, never by identifier spelling.
 */
export interface SlotRewrite {
  node: object;
  name: string;
}

/** What every binding carries, whatever it owns on the element it addresses. */
interface BindingCommon {
  id: string;
  /** Addresses the element this binding owns something on. */
  locator: string;
  captures: CaptureSlot[];
  /** Whose source the derivations are: the component's own, a summarized
   * helper's, or an inlined child's. The value is identical either way; the
   * artifact still records which. */
  origin: CodeOrigin;
  loc: SourceLoc;
  /** Resolved-node ↔ slot pairings recorded when the derivation was proven. */
  slotRewrites?: readonly SlotRewrite[];
}

/** A binding that owns its element's `textContent`. */
export interface TextBindingInfo extends BindingCommon {
  kind: "text";
  /** The derivation, printed from source: e.g. `"count: " + count()`. */
  expression: string;
  /** The text this binding's element owns at first paint. */
  initialText: string;
  initialTextFrom: InitialFrom;
}

/**
 * A binding that owns ONE attribute of its element. `attribute` is the rendered
 * HTML name, aliases already applied, so nothing downstream re-reads the JSX
 * spelling. `property` says the DOM keeps this one as element STATE rather than
 * as markup — `input.checked` is the case that matters — which is both why the
 * template carries no attribute for it and why the resume side assigns instead
 * of calling `setAttribute`.
 *
 * `attribute === "ref"` is array-ref wiring, not a rendered attribute. The
 * cargo is `{ locator, targets }`: write captures are cell-write targets,
 * identity captures are forwarded-path targets. Resume locates the element
 * and replays those targets before any effect runs. `expression` is unused
 * on that path (`undefined`); the template carries no `ref` bytes.
 */
export interface AttributeBindingInfo extends BindingCommon {
  kind: "attribute";
  attribute: string;
  property: boolean;
  /** The derivation, printed from source: e.g. `done()`. */
  expression: string;
  /** The value folded at build time; meaningless when measured. */
  initialValue: StaticValue;
  initialValueFrom: InitialFrom;
}

/** One conditional class name: the name, and the derivation that decides it. */
export interface ClassConditionInfo {
  name: string;
  /** The condition, printed from source: e.g. `done()`. */
  expression: string;
  /** Whether the fold put this name on the element at first paint. */
  initial: boolean;
}

/**
 * A binding that owns a NAMED SET of class names on its element — the fold of
 * Solid's array-of-string-and-object `class` form. `statics` are the names the
 * markup carries unconditionally and nothing ever revisits; `conditions` are the
 * ones a derivation decides. A name outside this record is not this binding's,
 * which is what lets the resume side add and remove without clobbering a class
 * the page put there by other means.
 */
export interface ClassBindingInfo extends BindingCommon {
  kind: "class";
  statics: string[];
  conditions: ClassConditionInfo[];
  initialFrom: InitialFrom;
}

/**
 * A binding that owns the rest-attribute set of its element. Bakes no
 * bytes: capture measures the set the spread actually wrote, and resume
 * replays a spread assign of the identity-class rest object. `expression`
 * is the rest identifier, printed from source.
 */
export interface SpreadBindingInfo extends BindingCommon {
  kind: "spread";
  expression: string;
  initialFrom: InitialFrom;
}

export type BindingInfo = TextBindingInfo | AttributeBindingInfo | ClassBindingInfo | SpreadBindingInfo;

/** True for the text arm. Bindings are told apart by `kind`; these two guards
 * exist so a consumer that only ever wanted text keeps reading the fields it
 * always read. */
export function isTextBinding(binding: BindingInfo): binding is TextBindingInfo {
  return binding.kind === "text";
}

export function isAttributeBinding(binding: BindingInfo): binding is AttributeBindingInfo {
  return binding.kind === "attribute";
}

export function isSpreadBinding(binding: BindingInfo): binding is SpreadBindingInfo {
  return binding.kind === "spread";
}

/**
 * A two-state region: one `<Show>`, recorded in the state the build's capture
 * put it in.
 *
 * The degenerate keyed region. There are no keys because there are no items —
 * two states, and the build ships exactly one of them. What makes that sound is
 * that the record is a GUARD rather than a toggle: an absent region has no DOM,
 * contributes no bindings and no wiring, and nothing on the resume path will
 * ever create it. A store write that would flip the guard is a store event, and
 * a store event is the group's, which renders the component the ordinary way —
 * so `Show` never has to build DOM after the fact, which is exactly what keeps
 * "nothing is rendered before activation" true.
 *
 * That is also why the guard may not reach a source cell. A cell is written by a
 * resumed handler, with no group in the picture, so a cell-flippable guard would
 * be a region this page has to create for itself. Refused by name instead.
 */
export interface ShowRegionInfo {
  id: string;
  /**
   * Where the region sits in the component's markup: the locator its element
   * has while it is present. An ABSENT region leaves that position empty, so the
   * locator is a statement about the markup rather than an address anything
   * resolves — and nothing inside an absent region exists to be addressed.
   */
  locator: string;
  /** The guard, printed from source: e.g. `todos.length > 0`. */
  when: string;
  /** The state the build recorded. `false` means the region has no DOM. */
  present: boolean;
  /**
   * Where `present` came from. `"derivation"` is a guard the pass folded whole,
   * so it can never be anything else. `"capture"` is a guard reaching into a
   * store, which has no build-time answer: the region is recorded ABSENT and the
   * page's captured first paint is what makes that a fact — a capture carrying
   * the region's markup fails the build's own template check rather than
   * shipping a shell the artifacts disagree with.
   */
  presentFrom: InitialFrom;
  captures: CaptureSlot[];
  loc: SourceLoc;
}

/**
 * A KEYED REGION: one `<For>`, recorded as a locator-stable CONTAINER plus a
 * per-item locator sub-space addressed by key.
 *
 * `ShowRegionInfo` is the degenerate case of this — two states and no items.
 * This is the bigger sibling, and the whole of what makes it admissible is that
 * the resume path never BUILDS the list. It READS one: walk `container`'s
 * children, take each element's key off `keyAttribute`, and resolve an item's
 * binding or listener as `locate(elementForKey(key), itemLocator)`. Four
 * invariants carry it, and each one is a property of this record rather than of
 * some code that has to behave:
 *
 *   I1 — no rendering, therefore no reconciliation. Nothing is inserted, removed
 *        or reordered before activation, so there is no diff to get wrong.
 *   I2 — identity, not position. `keyPath` is a FIXED path read off the item, so
 *        every binding resolves through a key; a key the served markup does not
 *        carry refuses loudly rather than binding to a neighbour. An INDEX is
 *        position, which is the thing I2 exists to escape, so index-as-key is
 *        refused by name.
 *   I3 — atomicity is inherited. The group boundary rule is stated over shared
 *        reactive sources and a region introduces none.
 *   I4 — one writer. The store does not exist until the group runs, so a
 *        region's DOM is read-only in the resumed window — which is what makes
 *        I1 sufficient rather than merely convenient.
 *
 * `each` is therefore required to be a projection of a STORE read: a list this
 * page could compute for itself would be a list this page would have to render.
 */
export interface KeyedRegionInfo {
  id: string;
  /**
   * The container whose CHILDREN are this region's items. Locator-stable: the
   * `<For>` itself renders nothing the build can see, so the address that
   * survives into the served markup is its parent element's.
   */
  container: string;
  /** The list projection, printed from source: e.g. `filtered()`. */
  each: string;
  /** The slots `each` is expressed over — store identity, never store data. */
  captures: CaptureSlot[];
  /** The body parameter's own name, e.g. `todo`. Item bindings and item handlers
   * are factored over a `region-item` slot under exactly this name. */
  item: string;
  /** Fixed path read off ONE item to get its key, e.g. `["id"]`. Never a
   * function, and never an index. */
  keyPath: (string | number)[];
  /** The attribute an item element carries its key in. Recorded rather than
   * assumed so the carrier is one field to change, not a search. */
  keyAttribute: string;
  /** ONE item's markup, with `keyAttribute` on its root and locators rooted
   * there — the item's own `template.js`, inlined into the region. */
  itemTemplate: string;
  /** Bindings inside one item, addressed from the ITEM element. Nothing on the
   * resume path applies them: I4 makes the region's DOM read-only. */
  itemBindings: BindingInfo[];
  /** Listeners inside one item, addressed from the ITEM element. Attached ONCE
   * at the container and dispatched by key. */
  itemWiring: WiringRecord[];
  loc: SourceLoc;
}

/** One extracted event handler, lazily importable at resume time. */
export interface HandlerInfo {
  id: string;
  /** DOM event name (`click`), lowercased from the JSX prop (`onClick`). */
  event: string;
  /** The element the listener attaches to. */
  locator: string;
  /** Module specifier, relative to the artifact directory. */
  module: string;
  captures: CaptureSlot[];
  /** The handler function, printed verbatim from source. */
  source: string;
  /** Whose source `source` is: an inline handler lifted out of the markup, or
   * the closure a summarized factory returns. Where the listener ATTACHES is
   * `locator`, possibly inside an inlined child. */
  origin: HandlerOrigin;
  loc: SourceLoc;
}

/** A wiring record: DOM locator + event -> handler module + its capture slots. */
export interface WiringRecord {
  locator: string;
  event: string;
  module: string;
  handler: string;
  captures: CaptureSlot[];
}

/** A child component a depth-1 splice absorbed into a provable parent. */
export interface InlinedChild {
  module: string;
  component: string;
}

/**
 * A CLAIMED CHILD: a component element the parent ADDRESSED rather than
 * absorbed. Inlining flattens a child into its parent's template and re-homes
 * its bindings onto the parent's cells; addressing does the opposite — the
 * parent's template leaves an ELEMENT-SHAPED HOLE at `locator` and the child
 * keeps its own artifacts, its own cells and its own resume bundle.
 *
 * The hole is `<div data-resume="{artifact}" data-component="{component}">`,
 * empty, which is exactly the mount container a page already stamps at its root:
 * a nested one is found and resumed by the same `[data-component]` walk, so
 * nothing on the resume side is new. What IS new is that the parent's own
 * markup no longer describes every byte the page will carry, which is why the
 * hole is recorded here rather than left implicit in the HTML.
 */
/** One call-site prop frozen at classify time. Absence of the list is today's BARE contract. */
export interface RecordedProp {
  name: string;
  value: string | number | boolean | null;
}

/** Call-site role of one identity-shaped prop. Names no library or idiom. */
export type IdentityRole = "attribute" | "spread-of-identifier";

/** Binding classes that may be recorded as identity, never as a frozen value. */
export type IdentityBindingClass = "own-props-parameter" | "derived-rest-props-result";

/**
 * Fixed source-binding identity: a symbol path in the PARENT, never a
 * runtime value. `name` is the parent binding; `path` is the member chain
 * from that binding (`["cargo"]` for `props.cargo`, `[]` for a whole-object
 * spread).
 */
export interface SourceBindingIdentity {
  name: string;
  path: (string | number)[];
}

/**
 * One call-site prop recorded by identity. No `value` field: folding
 * caller-dependent cargo is the second-instantiation failure.
 */
export interface IdentityProp {
  name: string;
  role: IdentityRole;
  bindingClass: IdentityBindingClass;
  source: SourceBindingIdentity;
}

export interface ClaimedChild {
  /** The hole in the PARENT's template: the mount container's own address. */
  locator: string;
  /** The child's artifact directory, `artifactKey(module, component)`. */
  artifact: string;
  /** The name the ordinary Solid path knows the child by. */
  component: string;
  /** The module the child is declared in, root-relative. */
  module: string;
  /**
   * v1 build-constants the parent passed, baked into the child's own
   * classification. Manifest-only: never a resume reader, never `structure.js`.
   */
  recordedProps?: RecordedProp[];
  /**
   * v2 identity-shaped record: binding identity of caller-dependent cargo,
   * never a frozen value. Manifest-only on the parent; the child's own
   * `structure.js` carries the matching capture slot when present.
   */
  identityProps?: IdentityProp[];
}

export interface ProvableAnalysis {
  status: "provable";
  component: string;
  module: string;
  cells: CellInfo[];
  /** Context-provided stores this component consumes actions from (S3). */
  stores: StoreInfo[];
  /** Store actions bound in this component, by identity (S3). */
  actions: ActionInfo[];
  /** Store data bound in this component, by identity (S3). Reads only. */
  reads: StoreReadInfo[];
  /** Children whose markup was spliced into this component's template. */
  inlined: InlinedChild[];
  /** Children this component ADDRESSED instead: one element-shaped hole each,
   * in template order. Empty for a component that composes nothing, which is
   * what keeps every artifact emitted before addressing existed byte for byte
   * what it was — the same discipline `regions` and `keyedRegions` follow. */
  claimedChildren: ClaimedChild[];
  bindings: BindingInfo[];
  /** Two-state `<Show>` regions, each in the state the build recorded. Empty for
   * a component with no control flow, which is what keeps every artifact emitted
   * before regions existed byte for byte what it was. */
  regions: ShowRegionInfo[];
  /** Keyed `<For>` regions. Empty for a component with no list, which is what
   * keeps every artifact emitted before keyed regions existed byte for byte what
   * it was — the same discipline `regions` and `stores` follow. */
  keyedRegions: KeyedRegionInfo[];
  handlers: HandlerInfo[];
  wiring: WiringRecord[];
  html: string;
  reasons: [];
  /**
   * Present only when `unmaskAttributeAudit` is on. Absent on the default
   * path, so a flag-OFF analysis is shape-identical to what it was.
   */
  signalDiagnostics?: SignalFamilyRecord;
}

/**
 * Options the classifier itself honours. Default-off diagnostics live here so
 * `analyzeFixture` and `classifySite` share one flag rather than a second
 * channel that could drift.
 */
export interface ClassifyOptions {
  /**
   * When true, a refused component element still runs the intrinsic attribute
   * audit, recording the codes that walk would emit, and resolves each
   * attribute-cargo item through this pass's own binding maps. The same flag
   * records signal-family shapes (initializer AST class, escape-site class,
   * callee identity via this pass's own callee resolution) without moving a
   * verdict. Default false. The recorded lists are diagnostics only: verdict,
   * template, reasons, and artifacts are unchanged in either mode.
   */
  unmaskAttributeAudit?: boolean;
  /**
   * Call-site record for this classification. When set, the component's own
   * props-parameter member reads resolve to these literals; a props use not
   * covered by the record refuses. Slice B's isolated child re-run consumes it.
   */
  recordedProps?: ReadonlyArray<RecordedProp>;
  /**
   * Identity-shaped call-site record. When set, matching props-parameter
   * member reads are measured runtime state (store-read discipline): no
   * frozen value. Slice D/E consume this entry point.
   */
  identityProps?: ReadonlyArray<IdentityProp>;
}

/**
 * One opening attribute, classified by AST kind. Spread arguments are split
 * so a call-valued spread and an identifier rest-spread are never one class.
 * Names are structural; they name no library, component, or idiom.
 */
export type AttributeKindClass =
  | "spread-of-call"
  | "spread-of-identifier"
  | "spread-of-other"
  | "jsx-attribute"
  | "jsx-attribute-other-name";

export interface AttributeKindRecord {
  class: AttributeKindClass;
  astType: string;
  argumentType?: string;
  nameType?: string;
  valueType?: string | null;
}

/**
 * Binding class of one attribute-cargo item, assigned by the classifier's own
 * `referenceOf` / `definition` / accessor / import / context maps. Names no
 * library, component, or idiom.
 */
export type RecordableBindingClass =
  | "own-props-parameter"
  | "derived-rest-props-result"
  | "local-literal-const"
  | "signal-getter"
  | "context-value"
  | "module-import"
  | "other-function-value"
  | "unresolvable";

/** Cargo roles that the recordability instrument prices. Children are out of scope. */
export type AttributeCargoRole =
  | "spread-of-identifier"
  | "spread-of-call"
  | "spread-of-other"
  | "dynamic-attribute"
  | "handler-valued";

export interface AttributeCargoRecord {
  role: AttributeCargoRole;
  class: RecordableBindingClass;
}

/** Classes that are candidates for a recorded-props seat. `unresolvable` is not. */
export const CANDIDATE_RECORDABLE_CLASSES = [
  "own-props-parameter",
  "derived-rest-props-result",
  "local-literal-const",
  "signal-getter",
  "context-value",
  "module-import",
  "other-function-value",
] as const satisfies readonly RecordableBindingClass[];

export function isCandidateRecordable(klass: RecordableBindingClass): boolean {
  return klass !== "unresolvable";
}

/** What the attribute audit would have recorded on one refused component element. */
export interface AttributeAuditRecord {
  locator: string;
  loc: SourceLoc;
  codes: Reason[];
  attributes: AttributeKindRecord[];
  /** Binding-class inventory of the opening's attribute cargo. Flag-ON only. */
  cargo: AttributeCargoRecord[];
  /** True when every cargo item is a candidate-recordable class. */
  entireCargoCandidateRecordable: boolean;
}

/**
 * Structural class of a signal factory's first argument (or of the call when
 * arity is not one). Names no library, component, or idiom.
 */
export type SignalInitializerShape =
  | "absent"
  | "literal"
  | "extra-arguments"
  | "identifier"
  | "call"
  | "member"
  | "array-expression"
  | "object-expression"
  | "conditional"
  | "other";

/**
 * Where a signal identity leaves an analyzable use. Names no library,
 * component, or idiom.
 */
export type SignalEscapeSiteKind =
  | "return"
  | "jsx-attribute"
  | "opaque-call"
  | "object-property"
  | "array-element"
  | "assignment"
  | "closure-capture"
  | "other";

export interface SignalInitializerRecord {
  shape: SignalInitializerShape;
  astType: string | null;
  loc: SourceLoc;
}

/** Callee identity from this pass's own `referenceOf` / `definition()` walk. */
export interface SignalCalleeIdentity {
  callee: string;
  definedIn: string | null;
  opaque: boolean;
}

export interface SignalEscapeRecord {
  code: "signal-escapes-unanalyzable-use" | "signal-escapes-to-opaque-callee";
  site: SignalEscapeSiteKind;
  parent: string | null;
  loc: SourceLoc;
  binding: string;
  callee: SignalCalleeIdentity | null;
}

/** Signal-family inventory recorded only when the unmask flag is on. */
export interface SignalFamilyRecord {
  initializers: SignalInitializerRecord[];
  escapes: SignalEscapeRecord[];
}

export interface FallbackAnalysis {
  status: "fallback";
  component: string;
  module: string;
  reasons: Reason[];
  /**
   * Present only when `unmaskAttributeAudit` is on. Absent on the default
   * path, so a flag-OFF analysis is shape-identical to what it was.
   */
  attributeDiagnostics?: AttributeAuditRecord[];
  /**
   * Present only when `unmaskAttributeAudit` is on. Initializer shapes and
   * escape sites for every factory call this pass already walked. Absent on
   * the default path.
   */
  signalDiagnostics?: SignalFamilyRecord;
}

export type Analysis = ProvableAnalysis | FallbackAnalysis;

export interface EmitResult {
  dir: string;
  files: string[];
}

export interface PassResult {
  analysis: Analysis;
  emitted: EmitResult | null;
}
