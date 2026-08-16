/**
 * The resumer: bring a served page to life without running the component.
 *
 * Input is a container whose `innerHTML` is the template artifact — the same
 * bytes an unmodified `render()` would produce — plus that component's cells,
 * bindings and wiring. Output is an interactive page. What never happens is the
 * component function running: its module is never imported, and neither is
 * `solid-js` or `@solidjs/web`. Solid's signals package survives only as the
 * ORACLE the equivalence suite runs this same page against.
 *
 * Two cells are never made for one `cell` id, so handlers wired to the same cell
 * share one instance — the no-tear property, and the reason slots are bound from
 * the cell table rather than from anything a handler module says. The patch step
 * diffs cell values instead of running an effect because the comptime pass
 * resolved the dependency graph already: each binding lists the cells it reads,
 * so there is nothing for a runtime tracker to discover. No owner, no scheduler,
 * no render effects — just `flush()` to settle the writes a handler queued.
 *
 * Keyed regions are the one thing this module keeps only the DECISION about: it
 * installs their listeners from eager artifact data and asks, per event, whether
 * the target came through a region container. Which item that is, and every
 * refusal that question can produce, is `regions.ts` — one `import()`, taken
 * inside the queue in front of `bind()`, so a page carrying no list never fetches
 * a byte of it.
 *
 * Identity-shaped props resolve in the same `slotsFor` walk cell and store slots
 * already take. Handler identity slots still also ride `regions.ts#fill` so a
 * page whose artifacts name no identity slot and no list — todos is one — never
 * fetches a byte of that module.
 */

import { cellKernel, cellWrite, type CellBackend, type Setter } from "./cells.ts";

import type { IdentityRegistry } from "./identities.ts";
import {
  isActionSlot,
  isCellSlot,
  isIdentitySlot,
  isRegionItemSlot,
  isStoreReadSlot,
  type Bundle,
  type CaptureSlotSpec,
  type IdentityCaptureSlotSpec,
  type KeyedRegionSpec,
  type Slots,
} from "./registry.ts";
import type { RegionResolver } from "./regions.ts";
import type { StoreRegistry } from "./stores.ts";
import { locate } from "./locate.ts";

/** One `import()` of `regions.ts` for the list path and the identity join. */
let regionsRuntime: Promise<{
  fill(slots: Slots, captures: CaptureSlotSpec[], site: object, options: object): void;
  installRegions(
    containers: RegionContainer[],
    slotsFor: (captures: CaptureSlotSpec[], item?: ItemContext) => Slots,
  ): RegionResolver;
}> | null = null;
const regionsModule = () => (regionsRuntime ??= import("./regions.ts"));

export interface Cell {
  id: string;
  get: () => unknown;
  set: Setter<unknown>;
}

export interface ResumeOptions {
  /**
   * Refuse markup that is not this component's template, byte for byte: locators
   * are child indices, so foreign markup would address the wrong nodes. Defaults
   * to true, and is checkable only when the bundle carries a template — where a
   * build inlined it, that check belongs to the build that wrote the markup.
   */
  verifyTemplate?: boolean;

  /** Defaults to the kernel this page ships. Injectable so the suites can drive
   * this same code over Solid's signals and compare: same clicks, same DOM, same
   * stats. No build sets it. */
  cells?: CellBackend;

  /**
   * Where a store action's LIVE value comes from (S4). An artifact names an
   * action by identity — store id plus fixed slot path — and says nothing about
   * the value, so a component with action slots is dispatchable only by a page
   * that registered the live store its provider produced. Optional, since a
   * component without action slots needs none. Resolution is lazy: nothing is
   * looked up until the first event for a wiring record.
   */
  stores?: StoreRegistry;

  /**
   * Where an identity-shaped prop's LIVE value comes from (v2). An artifact
   * names the prop by source-binding identity and says nothing about the
   * value, so a component with identity slots is resolvable only by a page
   * that registered the live cargo at this container's fill site. Optional,
   * since a component without identity slots needs none. Distinct from
   * `stores`: that registry's one-value-per-id contract is what per-instance
   * cargo violates.
   */
  identities?: IdentityRegistry;
}

export interface ResumeStats {
  /** `import()` calls for handler modules: one per wiring record, ever. */
  handlerLoads: number;
  dispatches: number;
  patches: number;
}

export interface ResumedApp {
  component: string;
  cells: ReadonlyMap<string, Cell>;
  stats: Readonly<ResumeStats>;
  settled(): Promise<void>;
  /**
   * Appends `task` at the position the call arrives in. This FIFO is the only
   * ordering here, so a page interleaving a replay with these dispatches puts it
   * HERE rather than in a second queue that would have to agree with this one. A
   * rejected task surfaces at `settled()`, exactly as a failed dispatch does.
   */
  enqueue(task: () => unknown): void;
  dispose(): void;
}

interface LiveBinding {
  spec: Bundle["bindings"][number];
  element: Element;
}

/**
 * A keyed region as the decision point knows it: the record the build emitted,
 * and the element whose children are the items. Which child is which item — and
 * everything answered by knowing that — is `regions.ts`'s.
 */
export interface RegionContainer {
  spec: KeyedRegionSpec;
  container: Element;
}

/** Which item a dispatch came from: the region's id, and the KEY its element
 * carried — never its position among its siblings. */
export interface ItemContext {
  region: string;
  key: string;
}

export interface LiveWiring {
  spec: Bundle["wiring"][number];
  element: Element;
  bound: ((event: Event) => void) | null;
  /** Set for a record inside a keyed region: the item this listener fired from,
   * which is what fills its `region-item` slots. */
  item?: ItemContext;
}

function sameCaptures(a: CaptureSlotSpec[], b: CaptureSlotSpec[]): boolean {
  return (
    a.length === b.length &&
    a.every((slot, i) => {
      const other = b[i];
      if (slot.name !== other.name || isCellSlot(slot) !== isCellSlot(other)) return false;
      if (isCellSlot(slot)) return slot.cell === (other as typeof slot).cell && slot.access === (other as typeof slot).access;
      const x = slot as { kind: string; store?: string; path?: (string | number)[]; region?: string };
      const y = other as typeof x;
      const path = x.path || [];
      const next = y.path || [];
      return x.kind === y.kind && x.store === y.store && x.region === y.region && path.length === next.length && path.every((step, j) => step === next[j]);
    })
  );
}

/** Assigns a DOM-state property, and says whether it moved. `checked` is the
 * case: a checkbox's checkedness is a property, so markup cannot state it and
 * `setAttribute` cannot change it. */
function setProperty(element: Element, name: string, value: unknown): boolean {
  const target = element as unknown as Record<string, unknown>;
  return !Object.is(target[name], value) && ((target[name] = value), true);
}

export function resumeBundle(container: Element, bundle: Bundle, options: ResumeOptions = {}): ResumedApp {
  const component = bundle.component;
  const template = bundle.template;
  const identities = options.identities;
  const stores = options.stores;

  function fail(msg: string): never {
    throw new Error(`resume: ${component} ${msg}`);
  }

  if (template && options.verifyTemplate !== false && container.innerHTML !== template.html) {
    fail(`not ${component}'s template`);
  }

  // Every template artifact roots at "/": the container's only element child.
  const root = (template?.root ?? "/") === "/" ? container.firstElementChild : null;
  if (!root) fail("has no root");

  const { createSignal, flush, untrack } = options.cells ?? cellKernel;

  // One cell per id, created before any behaviour exists to observe them.
  const cells = new Map<string, Cell>();
  for (const spec of bundle.cells) {
    const [get, set] = createSignal<unknown>(spec.initial);
    cells.set(spec.id, { id: spec.id, get, set });
  }

  /**
   * The keyed regions, as far as an eager page needs them: which element holds
   * each one's items.
   *
   * Located here because containment is the DECISION — an event that came
   * through one of these elements is the only thing that fetches `regions.ts`.
   * The walk that reads the items themselves, and the refusal a child with no
   * key earns, arrive with that module: a build that paints a keyed region owes
   * the keys, and the capture stage asserts it on the paint before the page is
   * served.
   */
  const containers: RegionContainer[] = bundle.keyedRegions.map((spec) => ({
    spec,
    container: locate(root, spec.container),
  }));

  /** The resolver, once an event has asked for it. Null is not "no regions" —
   * it is "no event has come through one yet". */
  let regions: RegionResolver | null = null;
  let resolving: Promise<RegionResolver> | null = null;

  /** The one `import()` a region costs, taken once and remembered — including
   * when the module refuses the page's own markup, which every later dispatch
   * from that region then hears again rather than quietly resolving. */
  const regionsArrive = (): Promise<RegionResolver> =>
    (resolving ??= regionsModule().then((module) => (regions = module.installRegions(containers, slotsFor))));

  const liveIdentity = (slot: IdentityCaptureSlotSpec) =>
    identities ? identities.resolve(container, slot.source) : fail(`needs an identity registry for slot ${slot.name}`);

  const cellOf = (id: string, name: string) => cells.get(id) || fail(`has no cell ${id} for slot ${name}`);

  const slotsFor = (captures: CaptureSlotSpec[], item?: ItemContext): Slots => {
    const slots: Slots = {};
    for (const slot of captures) {
      if (isCellSlot(slot)) {
        const cell = cellOf(slot.cell, slot.name);
        slots[slot.name] = slot.access === "write" ? cell.set : cell.get;
        continue;
      }

      if (isRegionItemSlot(slot)) {
        // The item the dispatching element's KEY named. Resolvable only inside
        // its region, because outside one there is no key and therefore no item
        // — and outside one the resolver was never asked for either.
        if (!regions || !item || item.region !== slot.region) {
          fail(`slot ${slot.name} is an item of region ${slot.region}`);
        }
        slots[slot.name] = regions.itemFor(item);
        continue;
      }

      if (isIdentitySlot(slot)) {
        slots[slot.name] = liveIdentity(slot);
        continue;
      }

      // Store arms only. Handler identity slots still also ride
      // `regions.ts#fill` — the same `import()` the list path already names —
      // so a page without identity slots or lists never fetches that module.
      if ((slot as { store?: string }).store) {
        if (!stores) fail(`needs a store registry for slot ${slot.name}`);
        const { store, path } = slot as { store: string; path: (string | number)[] };
        slots[slot.name] = isActionSlot(slot) ? stores.action(store, path) : stores.read(store, path);
      }
    }
    return slots;
  };

  /**
   * One binding, re-derived and written to the DOM. Returns whether anything
   * actually moved, which is what a patch counts.
   *
   * The three kinds are three sentences about the same element. TEXT owns
   * `textContent`. ATTRIBUTE owns one attribute, by the rule HTML states them:
   * `false` and nullish are the attribute's absence, `true` is the empty
   * attribute, and a `property` attribute is DOM state markup cannot express at
   * all, so it is assigned. CLASS owns the NAMES in its record and nothing else:
   * a class the page put on this element by other means is not in the record, is
   * never read, and is never removed.
   */
  const apply = (binding: LiveBinding): boolean => {
    const spec = binding.spec;
    const element = binding.element;
    const slots = slotsFor(spec.captures);

    if (spec.kind === "class") {
      let moved = false;
      for (const entry of spec.classes) {
        const on = !!entry.compute(slots);
        if (element.classList.contains(entry.name) !== on) {
          element.classList.toggle(entry.name, on);
          moved = true;
        }
      }
      return moved;
    }

    if (spec.kind === "spread" || (spec.kind === "attribute" && spec.attribute === "ref")) return false;

    if (spec.kind === "attribute") {
      const value = spec.compute(slots);
      if (spec.property) return setProperty(element, spec.attribute, value);
      const next = value == null || value === false ? null : value === true ? "" : String(value);
      if (element.getAttribute(spec.attribute) === next) return false;
      next === null ? element.removeAttribute(spec.attribute) : element.setAttribute(spec.attribute, next);
      return true;
    }

    const text = spec.compute(slots);
    if (element.textContent === text) return false;
    element.textContent = text;
    return true;
  };

  const bindings: LiveBinding[] = bundle.bindings.map((spec) => ({ spec, element: locate(root, spec.locator) }));

  // Array-ref replay. Must run before any effect that would read the ref
  // cell — createTagName's effect is the case that made a replay-free
  // measured multi-ref unsound. Locate the element, write it into each
  // cell-write target, apply Solid ref semantics to each forwarded path,
  // then flush so a subsequent read sees the element.
  for (const { spec, element } of bindings) {
    if (spec.kind !== "attribute" || spec.attribute !== "ref") continue;
    for (const slot of spec.captures) {
      if (isCellSlot(slot) && slot.access === "write") {
        cellWrite(cellOf(slot.cell, slot.name).set, element);
        continue;
      }
      if (isStoreReadSlot(slot) || isActionSlot(slot)) {
        const path = `[${slot.path.map((step) => (typeof step === "number" ? String(step) : JSON.stringify(step))).join(", ")}]`;
        if (!stores || !stores.has(slot.store)) {
          throw new Error(
            `resume: no live store is registered as ${JSON.stringify(slot.store)}, so the ref at ${path} cannot be replayed`,
          );
        }
        const member = stores.read(slot.store, slot.path);
        if (typeof member === "function") (member as (node: Element) => void)(element);
        else if (member != null && typeof member === "object") (member as { value: unknown }).value = element;
        else {
          throw new Error(
            `resume: store ${JSON.stringify(slot.store)} path ${path} is not a ref target (got ${typeof member})`,
          );
        }
        continue;
      }
      if (isIdentitySlot(slot)) {
        const target = liveIdentity(slot);
        if (target == null) continue;
        if (typeof target === "function") (target as (node: Element) => void)(element);
        else if (typeof target === "object") (target as { value: unknown }).value = element;
      }
    }
  }
  // Own-host projections on the already-held root, same batch as ref writes.
  for (const spec of bundle.cells) {
    const proj = spec.projection;
    const cell = proj && cells.get(spec.id);
    if (!proj || !cell) continue;
    let value: unknown = root;
    for (const step of proj.steps) {
      if (value == null) break;
      value =
        step.kind === "property"
          ? (value as Record<string, unknown>)[step.name]
          : step.kind === "getAttribute"
            ? (value as Element).getAttribute(step.name)
            : (value as Record<string, () => unknown>)[step.name]();
    }
    cellWrite(cell.set, value == null ? spec.initial : value);
  }
  flush();

  // Measured identity rest-spread, then property initials + measured restore.
  // Spreads finish before any restore: a rest object may name the same key a
  // later compute writes, and the compute wins. Ref replay + flush already ran.
  for (const { spec, element } of bindings) {
    if (spec.kind !== "spread") continue;
    for (const slot of spec.captures) {
      if (!isIdentitySlot(slot)) continue;
      const rest = liveIdentity(slot);
      if (rest != null && typeof rest === "object") Object.assign(element, rest);
    }
  }

  // Property-backed folded values, then measured attributes (initialValue null)
  // via equality-guarded apply. One walk: the two arms are disjoint except a
  // measured property, which still writes the folded null then the compute.
  for (const binding of bindings) {
    const spec = binding.spec;
    if (spec.kind !== "attribute" || spec.attribute === "ref") continue;
    if (spec.property === true && spec.initialValue !== undefined) {
      setProperty(binding.element, spec.attribute, spec.initialValue);
    }
    if (spec.initialValue == null && typeof spec.compute === "function") apply(binding);
  }

  const records: LiveWiring[] = bundle.wiring.map((spec) => ({ spec, element: locate(root, spec.locator), bound: null }));

  const stats: ResumeStats = { handlerLoads: 0, dispatches: 0, patches: 0 };

  const patchChanged = (before: Map<string, unknown>) => {
    // Solid 2 batches writes: a setter is invisible to a reader until the graph
    // settles. Handlers were written against that, so the kernel settles before
    // any diff — `test/cells.test.ts` and both `resume-suite` runs are evidence.
    flush();

    const changed = new Set<string>();
    for (const [id, cell] of cells) {
      if (!Object.is(untrack(cell.get), before.get(id))) changed.add(id);
    }
    if (changed.size === 0) return;

    for (const binding of bindings) {
      // A cell slot is the one that names a cell; the identity arms name a store
      // or a region and have no value for a diff to have moved.
      if (!binding.spec.captures.some((slot) => isCellSlot(slot) && changed.has(slot.cell))) continue;
      if (apply(binding)) stats.patches++;
    }
  };

  /**
   * The wait an action slot imposes when its store is not live yet, or `null`.
   * Asking is also telling: `whenProvided` fires `onMissing`, which is how a page
   * keeping the store's code behind a deferred import learns a resumed dispatch
   * wants it. No listener means rejection, so an unprovidable store stays loud.
   */
  const bind = async (record: LiveWiring): Promise<(event: Event) => void> => {
    if (record.bound) return record.bound; // already imported: no churn.

    // Asked for before the import is awaited, so store and handler travel
    // together rather than one after the other. `slotsFor` reports a missing
    // registry itself; a region dispatch may need stores the handler does not name.
    let provision: Promise<unknown> | null = null;
    if (stores) {
      const named = new Set(
        record.spec.captures.filter((slot) => isActionSlot(slot) || isStoreReadSlot(slot)).map((slot) => slot.store),
      );
      if (record.item && regions) for (const id of regions.stores(record)) named.add(id);
      const missing = [...named].filter((id) => !stores.has(id));
      if (missing.length) {
        provision = Promise.all(missing.map((id) => stores.whenProvided(id)));
        void provision.catch(() => {});
      }
    }

    stats.handlerLoads++;
    const module = await bundle.loadHandler(record.spec.module); // the lazy import.

    if (!sameCaptures(module.captures, record.spec.captures)) {
      fail(`handler ${record.spec.handler} capture slots the wiring record does not`);
    }

    // The await sits IN FRONT of slot resolution, never around what it resolves:
    // `slotsFor` still hands over the store's own function, unwrapped, and
    // `Object.is` still holds. Once the store is live this branch is unreachable.
    if (provision) await provision;

    const captures = record.spec.captures;
    const slots = slotsFor(captures, record.item);
    if (captures.some((slot) => (slot as { source?: unknown }).source)) {
      (await regionsModule())["fill"](slots, captures, container, options);
    }
    record.bound = module.create(slots);
    return record.bound;
  };

  const dispatch = async (record: LiveWiring, event: Event) => {
    const handler = await bind(record);
    const before = new Map<string, unknown>();
    for (const [id, cell] of cells) before.set(id, untrack(cell.get));

    // `currentTarget`, restored — what Solid's delegation does, for the same
    // reason. A handler expects the element it was written on (`Header` reads and
    // clears `e.currentTarget.value`), but this listener is delegated and runs
    // after an `import()` settled, by which time the browser reset it to null.
    Object.defineProperty(event, "currentTarget", { configurable: true, get: () => record.element });

    handler(event);
    patchChanged(before);
  };

  // Strictly arrival order, even though the first event for a record waits on a
  // network-shaped `import()` and, where its store is still deferred, on that
  // store being created. Both waits sit inside the queue, so nothing overtakes.
  let queue: Promise<void> = Promise.resolve();
  let failure: unknown = null;

  const append = (task: () => unknown): void => {
    queue = queue
      .then(async () => {
        await task();
      })
      .catch((error) => void (failure ??= error));
  };

  const onEvent = (event: Event) => {
    const target = event.target as Node | null;
    if (!target) return;

    /** The component's own wiring: the record whose element is this target or
     * holds it. Every address here was resolved at resume, off eager artifacts. */
    const wired = (): LiveWiring | undefined =>
      records.find(
        (candidate) =>
          candidate.spec.event === event.type && (candidate.element === target || candidate.element.contains(target)),
      );

    // THE DECISION POINT, and the whole of what a keyed region costs a page
    // before one is touched: did this event come through a region container?
    // Only that fetches the resolver, and the fetch waits INSIDE the queue —
    // beside the handler's own import and a deferred store's provision — rather
    // than in front of the listener that already received this event.
    if (containers.some((region) => region.container.contains(target))) {
      // The event object itself goes into the queue, not a copy: a dispatch that
      // waited for a module still runs against the event the user produced.
      append(async () => {
        const resolver = await regionsArrive();
        // Regions first: an item's listener is the more specific claim on the
        // event, and the container it hangs off is inside whatever else wraps it.
        const record = resolver.record(event.type, target) ?? wired();
        if (!record) return; // inside the list, and wired to nothing.

        stats.dispatches++;
        await dispatch(record, event);
      });
      return;
    }

    const record = wired();
    if (!record) return; // not wired: nothing to resume.

    stats.dispatches++;
    // The event object itself goes into the queue, not a copy: a dispatch that
    // waited for a store still runs against the event the user produced.
    append(() => dispatch(record, event));
  };

  // One delegated listener per wired event type; never one inside the container,
  // and never one per item. A region's listeners are the container's, dispatched
  // by reading the key off whichever item the event came through — which is why
  // adding an item costs no listener and removing one leaks none.
  //
  // Every one of them is installed HERE, at resume, including the regions': the
  // set is eager artifact data, so it is known before `regions.ts` is asked for
  // and there is no window in which a region's event goes unheard.
  const eventTypes = [
    ...new Set([
      ...bundle.wiring.map((record) => record.event),
      ...bundle.keyedRegions.flatMap((region) => region.wiring.map((record) => record.event)),
    ]),
  ];
  for (const type of eventTypes) container.addEventListener(type, onEvent);

  return {
    component,
    cells,
    stats,
    async settled() {
      await queue;
      if (failure !== null) {
        const error = failure;
        failure = null;
        throw error;
      }
    },
    enqueue: append,
    dispose() {
      for (const type of eventTypes) container.removeEventListener(type, onEvent);
    },
  };
}

/**
 * The page-level entry point: a container and a component name in, a resume or a
 * decline out. Declining (`null`) is not an error — a component with no
 * artifacts was refused by the pass, or never analyzed, so the caller should
 * render it the ordinary way.
 */
export function createResumer(registry: { get(component: string): Bundle | undefined }) {
  return function resume(container: Element, component: string, options: ResumeOptions = {}): ResumedApp | null {
    const bundle = registry.get(component);
    if (!bundle) return null;
    return resumeBundle(container, bundle, options);
  };
}
