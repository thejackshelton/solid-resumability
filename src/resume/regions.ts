/**
 * The keyed-region resolver: which item a dispatch came from, and what that item
 * IS. One `import()` away from `resumer.ts`, taken by the first event that comes
 * through a region container and by nothing else — so a page whose components
 * carry no list never fetches a byte of it.
 *
 * ── Why deferring this loses no event ─────────────────────────────────────
 * The listener set is EAGER ARTIFACT DATA. `keyedRegions[].wiring` names its
 * event types in the same module the resumer already read, so every delegated
 * listener a region needs is installed at resume time, before this file exists.
 * What waits for this module is the RESOLUTION of an event already received and
 * already queued — the same wait a handler's own `import()` and a deferred
 * store's provision take, in the same FIFO, in front of the same `bind()`.
 * Arrival order is the queue's, so nothing overtakes and nothing is dropped.
 *
 * ── What a region does to the DOM ─────────────────────────────────────────
 * Nothing. A region is READ: the container's children are the items, each one
 * states its key, and every address into the list is that key rather than a
 * position. The store's only writer is the group, so until activation this
 * markup is somebody else's — item bindings are recorded and never applied.
 *
 * ── The refusals ──────────────────────────────────────────────────────────
 * Two live here, and they are the reason position is never the fallback: an item
 * carrying no key, and a key the live list does not have. Neither is weakened by
 * arriving later — a build that paints a keyed region owes the keys, and
 * `plugin/src/stages/prerender.ts` asserts exactly that on the captured paint,
 * before the bytes are ever served. The third refusal — a region-item slot asked
 * for outside its region — stays in `resumer.ts`, because that is a question a
 * page can ask before this module has arrived.
 *
 * ── Identity slots ride this same `import()` ──────────────────────────────
 * `fill` is the identity join. It lives here so the eager entry names one
 * lazy module (this one) rather than a second chunk the witness graph
 * would count as a fallback branch. A page that never names an identity
 * slot and never touches a region still never fetches a byte of this file.
 */

import { locate } from "./locate.ts";
import type { IdentityRegistry, SourceBindingIdentity } from "./identities.ts";
import { isActionSlot, isStoreReadSlot, type CaptureSlotSpec, type KeyedRegionSpec, type Slots } from "./registry.ts";
import type { ItemContext, LiveWiring, RegionContainer } from "./resumer.ts";

/**
 * Fills identity-shaped capture slots against a live registry. The error
 * string is the one `test/resume-identity.test.ts` pins.
 */
export function fill(
  slots: Record<string, unknown>,
  captures: ReadonlyArray<{ kind?: string; name: string; source?: SourceBindingIdentity }>,
  site: object,
  options: { identities?: IdentityRegistry },
): void {
  const identities = options.identities;
  for (const slot of captures) {
    if (slot.kind !== "identity") continue;
    if (!identities) {
      throw new Error(`resume: needs an identity registry for slot ${slot.name}`);
    }
    slots[slot.name] = identities.resolve(site, slot.source!);
  }
}

/**
 * One keyed region, as READ off the served page. `items` is key -> element, in
 * the order the markup carried them; nothing ever writes back into it, because
 * nothing on this path inserts, removes or reorders an item.
 */
interface LiveRegion {
  spec: KeyedRegionSpec;
  container: Element;
  items: Map<string, Element>;
}

/** How the resumer resolves slots. Handed in rather than imported: the cells and
 * the store registry it reads through are one resumed component's, and this
 * module holds none of them. */
export type SlotsFor = (captures: CaptureSlotSpec[], item?: ItemContext) => Slots;

/** Everything the resumer asks of a region, once this module has arrived. */
export interface RegionResolver {
  /**
   * The wiring record an event dispatches to, or `null` when it came through a
   * container without reaching anything the region wired.
   */
  record(type: string, target: Node): LiveWiring | null;
  /** The item a context names, out of the region's LIVE list. */
  itemFor(item: ItemContext): unknown;
  /** The stores a dispatch from inside a region needs live, beyond the actions
   * its own record names. */
  stores(record: LiveWiring): string[];
}

/** The one thing a region says when its markup will not say which item is which.
 * One factory, because a child with no key and a dispatch from a child with no
 * key are the same failure caught a moment apart. */
function keyless(spec: KeyedRegionSpec): Error {
  return new Error(`resume: region ${spec.id} has an item with no ${spec.keyAttribute}`);
}

/**
 * Reads every region the resumer located a container for, and answers about them.
 *
 * The key-map walk happens HERE, on arrival, rather than at resume: a child
 * carrying no key is refused before its region resolves a single dispatch, and
 * the alternative — quietly resolving to the neighbour whose position happened
 * to match — is the exact failure the key is for. The refusal reaches the page
 * through the queue, as a rejected dispatch, which is how every other refusal on
 * this path reaches it.
 */
export function installRegions(containers: RegionContainer[], slotsFor: SlotsFor): RegionResolver {
  const regions: LiveRegion[] = containers.map(({ spec, container }) => {
    const items = new Map<string, Element>();
    for (const child of container.children) {
      const key = child.getAttribute(spec.keyAttribute);
      if (key === null) throw keyless(spec);
      items.set(key, child);
    }
    return { spec, container, items };
  });

  const byId = new Map(regions.map((region) => [region.spec.id, region]));

  /**
   * One (region, key, wiring record) triple, made on first use and kept.
   *
   * The key is what the record is FILED under — never the item's position among
   * its siblings — so a page whose served order differs from the one the build
   * saw still dispatches the click on item `b` to item `b`.
   */
  const itemRecords = new Map<string, LiveWiring>();

  return {
    record(type, target) {
      for (const region of regions) {
        if (!region.container.contains(target)) continue;

        // Up to the item: the child of the container this event came through.
        let item = target as Element | null;
        while (item !== null && item.parentElement !== region.container) item = item.parentElement;
        if (item === null) continue;

        const key = item.getAttribute(region.spec.keyAttribute);
        if (key === null || region.items.get(key) !== item) throw keyless(region.spec);

        let index = 0;
        for (const spec of region.spec.wiring) {
          const id = `${region.spec.id} ${key} ${index++}`;
          if (spec.event !== type) continue;
          const element = locate(item, spec.locator);
          if (element !== target && !element.contains(target)) continue;

          let record = itemRecords.get(id);
          if (!record) {
            record = { spec, element, bound: null, item: { region: region.spec.id, key } };
            itemRecords.set(id, record);
          }
          return record;
        }
      }
      return null;
    },

    /** Loud when the key is not there: an item that has gone is not the item
     * beside it. */
    itemFor({ region, key }) {
      const spec = byId.get(region)!.spec;
      for (const candidate of spec.each(slotsFor(spec.captures)) as Iterable<unknown>) {
        let value: unknown = candidate;
        for (const step of spec.keyPath) value = (value as Record<string, unknown>)?.[step];
        if (String(value) === key) return candidate;
      }
      throw new Error(`resume: region ${spec.id} has no item keyed ${key}`);
    },

    /**
     * Two sources, one reason. A region item is resolved by asking the region's
     * own list which item the key names, so the store that list is projected
     * from has to be live before the key can be resolved at all — not just the
     * actions the handler happens to name. And a record dispatching from inside
     * a region reads through the same store for the same reason, so its reads
     * count here too.
     */
    stores(record) {
      const region = byId.get(record.item!.region)!;
      return [...record.spec.captures, ...region.spec.captures]
        .filter((slot) => isActionSlot(slot) || isStoreReadSlot(slot))
        .map((slot) => (slot as { store: string }).store);
    },
  };
}
