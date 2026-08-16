/**
 * The artifact registry: the shape of what the resume path may know about a
 * component, plus the pure function that assembles it. No filesystem, no
 * bundler — two plain records in (the eagerly-evaluated artifact modules, and
 * the THUNKS that would import the handler modules), bundles out. Where the
 * records come from is the caller's business, so a build that emits artifacts
 * elsewhere (the demo does) hands over its own two globs and neither this
 * module nor the resumer changes. A registry being an argument is what keeps
 * an eager glob from riding along with every import of the runtime.
 *
 * Keys are paths in whatever shape the caller's glob produced. The only
 * structure required is the tail: `.../artifacts/<component>/<file>`.
 */

export interface TemplateArtifact {
  /** The component's markup at initial state — byte-identical to `render()`. */
  html: string;
  /** Locator of the component's root element within its container. */
  root: string;
}

export interface ElementProjectionStepSpec {
  kind: "property" | "call" | "getAttribute";
  name: string;
}

export interface ElementProjectionSpec {
  host: string;
  steps: ElementProjectionStepSpec[];
}

export interface CellSpec {
  id: string;
  initial: unknown;
  getter: string;
  setter?: string;
  projection?: ElementProjectionSpec;
}

/** A slot filled from one of the component's own cells. */
export interface CellCaptureSlotSpec {
  name: string;
  cell: string;
  access: "read" | "write";
}

/**
 * A slot filled from a context-provided store action (S3's arm). No cell and no
 * value — a store id and the fixed slot path reaching the action is the whole
 * of what the comptime pass proved. Resolution against a live store is
 * `stores.ts`'s job, at first dispatch.
 */
export interface ActionCaptureSlotSpec {
  name: string;
  kind: "action";
  store: string;
  path: (string | number)[];
}

/**
 * A slot filled from a context-provided store's DATA. The same fact as the
 * action arm, about the other slot: a store id and the fixed path reaching the
 * store's own value. What the extracted expression does with it — `state.todos.length`
 * — is the component's own source and was never evaluated at build time.
 */
export interface StoreReadCaptureSlotSpec {
  name: string;
  kind: "store-read";
  store: string;
  path: (string | number)[];
}

/**
 * A slot filled with ONE ITEM of a keyed region. No value, no index: the item is
 * whichever one the KEY on the dispatching element's item named, looked up in
 * the region's live list. Resolvable only inside its region, which is the same
 * sentence as "a region binding is an identity".
 */
export interface RegionItemCaptureSlotSpec {
  name: string;
  kind: "region-item";
  region: string;
}

/**
 * A slot filled with ONE identity-shaped prop. No value — binding identity
 * of caller-dependent cargo is the whole of what the comptime pass proved.
 * Resolution against a live value provided at the parent's fill site is
 * `identities.ts`'s job. The emit shape is
 * `{ name, kind: "identity", bindingClass, source }`.
 */
export interface IdentityCaptureSlotSpec {
  name: string;
  kind: "identity";
  bindingClass: "own-props-parameter" | "derived-rest-props-result";
  source: { name: string; path: (string | number)[] };
}

export type CaptureSlotSpec =
  | CellCaptureSlotSpec
  | ActionCaptureSlotSpec
  | StoreReadCaptureSlotSpec
  | RegionItemCaptureSlotSpec
  | IdentityCaptureSlotSpec;

/** True for the action arm of a capture manifest. Mirrors `comptime/types.ts`. */
export function isActionSlot(slot: CaptureSlotSpec): slot is ActionCaptureSlotSpec {
  return (slot as ActionCaptureSlotSpec).kind === "action";
}

/** True for the store-read arm. Mirrors `comptime/types.ts`. */
export function isStoreReadSlot(slot: CaptureSlotSpec): slot is StoreReadCaptureSlotSpec {
  return (slot as StoreReadCaptureSlotSpec).kind === "store-read";
}

/** True for the region-item arm. Mirrors `comptime/types.ts`. */
export function isRegionItemSlot(slot: CaptureSlotSpec): slot is RegionItemCaptureSlotSpec {
  return (slot as RegionItemCaptureSlotSpec).kind === "region-item";
}

/** True for the identity-prop arm. Mirrors `comptime/types.ts`. */
export function isIdentitySlot(slot: CaptureSlotSpec): slot is IdentityCaptureSlotSpec {
  return (slot as IdentityCaptureSlotSpec).kind === "identity";
}

/** True for the cell arm — the one with no `kind`. Mirrors `comptime/types.ts`,
 * including the reason it is its own guard: a consumer that wants a cell says
 * so, rather than subtracting the other four and hoping the list stays
 * complete. */
export function isCellSlot(slot: CaptureSlotSpec): slot is CellCaptureSlotSpec {
  return (slot as { kind?: string }).kind === undefined;
}


/**
 * A context-provided store, by identity. Emitted into `structure.js` so a page
 * can register the live value for each id the artifacts name.
 *
 * Tuple and object variants are marked by their own keys: the tuple keeps
 * `actionsSlot` / `readSlot` / `value`; the object carries `keys`.
 */
export interface TupleStoreSpec {
  id: string;
  context: string;
  contextModule: string;
  actionsSlot: number;
  /** The fixed slot the component bound the store's data from, or `null` when it
   * bound none. An identity, like `actionsSlot`: the pass still refuses to
   * freeze what the data IS. */
  readSlot: number | null;
  provider: string;
  value: { module: string; factory: string };
  keys?: undefined;
}

export interface ObjectStoreSpec {
  id: string;
  context: string;
  contextModule: string;
  provider: string;
  keys: string[];
  actionsSlot?: undefined;
  readSlot?: undefined;
  value?: undefined;
}

export type StoreSpec = TupleStoreSpec | ObjectStoreSpec;

export function isTupleStoreSpec(store: StoreSpec): store is TupleStoreSpec {
  return (store as TupleStoreSpec).actionsSlot !== undefined;
}

export function isObjectStoreSpec(store: StoreSpec): store is ObjectStoreSpec {
  return (store as ObjectStoreSpec).keys !== undefined;
}

/** One action of one store, by identity. */
export interface ActionSpec {
  id: string;
  store: string;
  name: string;
  path: (string | number)[];
}

/** One read of one store, by identity. Same shape as an action: the difference
 * is what sits at the end of the path, and that only the live page knows. */
export interface StoreReadSpec {
  id: string;
  store: string;
  name: string;
  path: (string | number)[];
}

/** Slots handed to extracted code: readers are accessors, writers are setters. */
export type Slots = Record<string, unknown>;

interface BindingSpecCommon {
  id: string;
  locator: string;
  captures: CaptureSlotSpec[];
}

/** A binding that owns its element's text. */
export interface TextBindingSpec extends BindingSpecCommon {
  kind: "text";
  initialText: string;
  /** Where `initialText` came from. Absent means `"derivation"` — every artifact
   * emitted before store reads existed says nothing here and means exactly that.
   * `"capture"` means a build measured the text out of its captured first paint,
   * because a derivation reaching into a store has no build-time answer. */
  initialTextFrom?: "derivation" | "capture";
  /** The component's own derivation, factored over its capture slots. */
  compute(slots: Slots): string;
}

/**
 * A binding that owns ONE attribute. `property: true` says the DOM keeps this
 * one as element state rather than as markup — `input.checked` is not the
 * `checked` attribute — so it is assigned, and `initialValue` is written once at
 * resume, because the served bytes could not carry it. Absent `initialValue`
 * means a capture owes it.
 */
export interface AttributeBindingSpec extends BindingSpecCommon {
  kind: "attribute";
  attribute: string;
  property?: boolean;
  initialValue?: unknown;
  initialValueFrom?: "derivation" | "capture";
  compute(slots: Slots): unknown;
}

/** One conditional class name and the derivation that decides it. */
export interface ClassConditionSpec {
  name: string;
  initial?: boolean;
  compute(slots: Slots): unknown;
}

/**
 * A binding that owns a NAMED SET of class names. The names are the whole of its
 * authority: a class the page put on this element by other means is not in the
 * record and is never touched. Unconditional names are not here — the markup
 * carries them and nothing revisits them.
 */
export interface ClassBindingSpec extends BindingSpecCommon {
  kind: "class";
  initialFrom?: "derivation" | "capture";
  classes: ClassConditionSpec[];
}

/**
 * A binding that owns the rest-attribute set of its element. Bakes no
 * bytes: capture measures the set, resume replays a spread assign of the
 * identity-class rest object.
 */
export interface SpreadBindingSpec extends BindingSpecCommon {
  kind: "spread";
  initialFrom?: "derivation" | "capture";
  compute(slots: Slots): unknown;
}

export type BindingSpec = TextBindingSpec | AttributeBindingSpec | ClassBindingSpec | SpreadBindingSpec;

/**
 * A two-state `<Show>` region, in the state the build recorded.
 *
 * There is no resumer branch for this, and that is the design rather than an
 * omission. A region is a GUARD: `present: false` means the served markup does
 * not carry it, so the build emitted no template DOM for it, no binding inside
 * it and no wiring inside it — "installs nothing" is already true by the time
 * these artifacts exist, and code here to not-install it would be code that
 * ships on every page to do nothing. What flips a guard is a store write, and a
 * store write is the group's, which renders the component the ordinary way.
 *
 * The record travels so the claim is READABLE — a page, a test or a later stage
 * can ask what state this build recorded and what guard decided it. `when` is
 * the component's own condition, factored over the same capture slots every
 * other artifact uses; nothing here calls it.
 */
export interface RegionSpec {
  id: string;
  /** Where the region sits: the locator its element has while it is present. */
  locator: string;
  present: boolean;
  /** Absent means `"derivation"` — a guard the build folded whole. `"capture"`
   * means the guard reaches a store, so the region was recorded absent and the
   * page's captured first paint is what proved it. */
  presentFrom?: "derivation" | "capture";
  captures: CaptureSlotSpec[];
  when(slots: Slots): unknown;
}

/**
 * A KEYED REGION: a container whose children are the items, and one item's
 * locator sub-space.
 *
 * Unlike `RegionSpec`, this one the resumer DOES read — but only ever to read.
 * `container` addresses the element whose children are the items; each item
 * carries its key in `keyAttribute`; `wiring` and `bindings` are addressed from
 * an ITEM element rather than from the component's root. `each` and `keyPath`
 * exist for one question and no other: given a key, which item is it. Nothing
 * here inserts, removes or reorders anything, because the group is the only
 * writer the region's store has and the group renders the ordinary way.
 */
export interface KeyedRegionSpec {
  id: string;
  container: string;
  item: string;
  keyAttribute: string;
  keyPath: (string | number)[];
  /** One item's markup, keys included. Not installed by anything here: the
   * served page already carries its own items, and building a second copy is
   * exactly the rendering a resumed window does not do. */
  itemTemplate: string;
  captures: CaptureSlotSpec[];
  each(slots: Slots): unknown;
  /** Bindings inside one item. Recorded, never applied: a region's DOM is
   * read-only until the group takes over. */
  bindings: BindingSpec[];
  wiring: WiringSpec[];
}

export interface WiringSpec {
  locator: string;
  event: string;
  /** Module specifier relative to the artifact directory, e.g. `./handlers/s0.js`. */
  module: string;
  handler: string;
  captures: CaptureSlotSpec[];
}

/** The shape of one lazily-imported handler module. */
export interface HandlerModule {
  id: string;
  event: string;
  locator: string;
  captures: CaptureSlotSpec[];
  create(slots: Slots): (event: Event) => void;
}

export interface Bundle {
  component: string;
  /**
   * The served markup, where the build shipped it to the client. Optional
   * because it is the one artifact the client may already have: a page that
   * inlines the template into its HTML gains nothing from a second copy. When
   * present, the resumer verifies the container against it; when absent, that
   * check belongs to the build that did the inlining.
   */
  template?: TemplateArtifact;
  cells: CellSpec[];
  /**
   * Context-provided stores this component takes actions from — identity only,
   * empty for a component that has none, so a bundle assembled from pre-S3
   * artifacts is unchanged.
   */
  stores: StoreSpec[];
  actions: ActionSpec[];
  /** Store data this component reads, by identity. Empty for a component with
   * none, so a bundle assembled from earlier artifacts is unchanged. */
  reads: StoreReadSpec[];
  bindings: BindingSpec[];
  /** Two-state regions this component's markup declares. Empty for a component
   * with no control flow, so a bundle assembled from earlier artifacts is
   * unchanged — and nothing on the resume path reads it. */
  regions: RegionSpec[];
  /** Keyed `<For>` regions this component's markup declares. Empty for a
   * component with no list, so a bundle assembled from earlier artifacts is
   * unchanged — and a resumer that finds none installs nothing. */
  keyedRegions: KeyedRegionSpec[];
  wiring: WiringSpec[];
  /** Resolves a wiring record's `module` specifier to a pending `import()`. */
  loadHandler(specifier: string): Promise<HandlerModule>;
}

/** A set of components the resume path can be asked about. */
export interface Registry {
  /** Every component with a complete artifact set, in stable order. */
  list(): string[];
  /** The artifacts for one component, or `undefined` when it has none. */
  get(component: string): Bundle | undefined;
}

/** `.../artifacts/<component>/<rest>` — the only structure keys must have. */
const ARTIFACT_PATH = /\/artifacts\/([^/]+)\/(.+)$/;

interface PartialBundle {
  template?: TemplateArtifact;
  cells?: CellSpec[];
  stores?: StoreSpec[];
  actions?: ActionSpec[];
  reads?: StoreReadSpec[];
  bindings?: BindingSpec[];
  regions?: RegionSpec[];
  keyedRegions?: KeyedRegionSpec[];
  wiring?: WiringSpec[];
}

/**
 * Assembles bundles from an eager artifact record and a lazy handler record.
 * `staticModules` holds `template.js` / `structure.js` / `wiring.js` — a build
 * that inlines its templates passes no template ones. `handlerModules` holds
 * thunks, and none is called here: handler code stays unfetched until an event
 * asks for it.
 */
export function createRegistry(
  staticModules: Record<string, Record<string, unknown>>,
  handlerModules: Record<string, () => Promise<HandlerModule>>,
): Registry {
  // component -> (specifier relative to the artifact dir) -> thunk.
  const loaders = new Map<string, Map<string, () => Promise<HandlerModule>>>();
  for (const [path, load] of Object.entries(handlerModules)) {
    const match = ARTIFACT_PATH.exec(path);
    if (!match) continue;
    const [, component, relative] = match;
    const forComponent = loaders.get(component) ?? new Map();
    loaders.set(component, forComponent);
    forComponent.set(relative, load);
  }

  const partials = new Map<string, PartialBundle>();
  for (const [path, module] of Object.entries(staticModules)) {
    const match = ARTIFACT_PATH.exec(path);
    if (!match) continue;
    const [, component, relative] = match;
    if (relative.includes("/")) continue; // handlers/*.js are never eager.

    const partial = partials.get(component) ?? {};
    partials.set(component, partial);

    const kind = relative.replace(/\.js$/, "");
    if (kind === "template") {
      partial.template = { html: module.html as string, root: module.root as string };
    } else if (kind === "structure") {
      partial.cells = module.cells as CellSpec[];
      partial.bindings = module.bindings as BindingSpec[];
      // Emitted only for a component that has one — a structure module from
      // before S3 has no such export and gets the empty arms.
      partial.stores = (module.stores as StoreSpec[] | undefined) ?? [];
      partial.actions = (module.actions as ActionSpec[] | undefined) ?? [];
      partial.reads = (module.reads as StoreReadSpec[] | undefined) ?? [];
      // Emitted only for a component with control flow, exactly like `stores`.
      partial.regions = (module.regions as RegionSpec[] | undefined) ?? [];
      // Emitted only for a component with a list, exactly like `regions`.
      partial.keyedRegions = (module.keyedRegions as KeyedRegionSpec[] | undefined) ?? [];
    } else if (kind === "wiring") {
      partial.wiring = module.wiring as WiringSpec[];
    }
  }

  const bundles = new Map<string, Bundle>();
  for (const [component, partial] of partials) {
    // A component with an incomplete artifact set is not resumable. It is not
    // an error either: it belongs to the ordinary Solid path.
    if (!partial.cells || !partial.bindings || !partial.wiring) continue;
    bundles.set(component, {
      component,
      template: partial.template,
      cells: partial.cells,
      stores: partial.stores ?? [],
      actions: partial.actions ?? [],
      reads: partial.reads ?? [],
      bindings: partial.bindings,
      regions: partial.regions ?? [],
      keyedRegions: partial.keyedRegions ?? [],
      wiring: partial.wiring,
      loadHandler(specifier) {
        // Wiring records address handler modules relative to the artifact dir.
        const relative = specifier.replace(/^\.\//, "");
        const load = loaders.get(component)?.get(relative);
        if (!load) {
          throw new Error(
            `resume: ${component} wires ${specifier}, but no such handler module was built`,
          );
        }
        return load();
      },
    });
  }

  return {
    list: () => [...bundles.keys()].sort(),
    get: (component) => bundles.get(component),
  };
}
