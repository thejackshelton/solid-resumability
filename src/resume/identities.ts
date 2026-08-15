/**
 * The identity registry: how a resumed child reaches a live prop value.
 *
 * Slice C admitted one fact about a caller-dependent prop — it is THIS
 * source-binding identity, a symbol path in the parent, never a frozen
 * value. The child's `structure.js` names
 * `{ kind: "identity", bindingClass, source }` and stops. What lives here
 * is the join, provided at the parent's mount/fill site:
 *
 *   registry.provide(mount, { name: "props", path: ["cargo"] }, liveCargo)
 *   registry.resolve(mount, slot.source)   // Object.is with liveCargo
 *
 * Distinct from StoreRegistry. That family's one-value-per-id contract is
 * exactly what per-instance cargo violates: the same source at two fill
 * sites is two provides, and the two live values stay distinct. No
 * serialization: `provide` keeps a reference created in this same page,
 * so nothing is stringified, snapshotted, or sent. No path walk: the
 * value handed over IS the value, and `Object.is` holds against it.
 *
 * A source never provided at this site throws at resolve — never a silent
 * undefined, because a missing join looking like a missing prop is the
 * one thing worse than a broken page.
 *
 * The resumer's join (`fill`) lives on `regions.ts` so the eager entry
 * names one lazy module rather than a second chunk. This file is the
 * registry constructor, imported only by a page that provides.
 */

/** Fixed source-binding identity: a symbol path in the parent, never a
 * runtime value. Mirrors the comptime emit; duplicated here so the resume
 * path does not import the compiler. */
export interface SourceBindingIdentity {
  name: string;
  path: readonly (string | number)[];
}

export interface IdentityRegistry {
  /** Publishes the live value at THIS fill site. Re-registering the same
   * value at the same site is a no-op. A DIFFERENT value at the same site
   * is an error — one fill, one cargo. The same source at a different
   * site is a different provide: that is the per-instance contract
   * StoreRegistry cannot state. */
  provide(site: object, source: SourceBindingIdentity, value: unknown): void;

  /** The live value provided at `site` for `source`, by `Object.is`.
   * Throws when this site has no provide for that source. */
  resolve(site: object, source: SourceBindingIdentity): unknown;

  /** Whether `site` has a live value for `source` yet. */
  has(site: object, source: SourceBindingIdentity): boolean;
}

/** Compile-time identity only — the path is a symbol chain, not cargo. */
function sourceKey(source: SourceBindingIdentity): string {
  return `${source.name}:${JSON.stringify(source.path)}`;
}

function unregistered(source: SourceBindingIdentity): Error {
  return new Error(
    `resume: no live identity is registered as ${JSON.stringify(source.name)} at this fill site — the page must call ` +
      `provide(<mount>, ${JSON.stringify(source)}, <the live value>) before the slot is read`,
  );
}

export function createIdentityRegistry(): IdentityRegistry {
  /** Per fill site, then per source key. Weak so a discarded mount drops
   * its cargo without a dispose. The VALUE is the reference `provide`
   * received — never a clone, never JSON. */
  const sites = new WeakMap<object, Map<string, unknown>>();

  const bucket = (site: object): Map<string, unknown> => {
    let found = sites.get(site);
    if (!found) {
      found = new Map();
      sites.set(site, found);
    }
    return found;
  };

  return {
    provide(site, source, value) {
      const key = sourceKey(source);
      const live = bucket(site);
      if (live.has(key)) {
        if (Object.is(live.get(key), value)) return;
        throw new Error(
          `resume: identity ${JSON.stringify(source.name)} is already registered at this fill site with a different live value`,
        );
      }
      live.set(key, value);
    },

    resolve(site, source) {
      const live = sites.get(site);
      const key = sourceKey(source);
      if (!live || !live.has(key)) throw unregistered(source);
      // The page's own value, handed back as it is. No copy and no
      // wrapper: `Object.is` holds against what `provide` received.
      return live.get(key);
    },

    has(site, source) {
      return sites.get(site)?.has(sourceKey(source)) === true;
    },
  };
}
