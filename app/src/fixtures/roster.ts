// Carrier store (T015) — the roster `KeyedRoster.tsx` reads its list out of and
// dispatches its item handler into.
//
// FRAMEWORK-FREE, and that is the load-bearing property rather than a tidiness
// preference. This module is the store partition a resumed page fetches when the
// mount point finds no provided store, so every byte in here lands on the
// resumable page's wire. One framework specifier would put the framework back on
// that wire and void claim 7a — no chunk fetchable without falling back carries
// a store-partition module. The import list is empty, and the test asserts that
// it stays empty rather than asserting a spelling.
//
// Deliberately tiny and deliberately real: the pass admits the LIST by identity
// — this module, this factory, this tuple slot — and never reads what `members`
// contains, so what the members are stays the running page's business.

export interface Member {
  id: string;
  name: string;
}

/**
 * What the next `createRoster()` starts with.
 *
 * A module-level seed rather than a factory argument, for two reasons that point
 * the same way. The pass admits a provider whose value is a CALL to a factory in
 * the analyzed set — `createRoster()`, exactly — so a fixture that took its data
 * through the call site would be a fixture built to dodge that. And the default
 * is EMPTY: an empty roster is what keeps the parity assertion honest, because
 * the build templates the region's container empty and unmodified Solid renders
 * an empty list as nothing at all. A seeded default would make those two agree
 * by accident instead of by construction.
 */
let seed: Member[] = [];

export function seedRoster(members: Member[]): void {
  seed = members;
}

export function createRoster() {
  const data = { members: seed };
  const dropped: string[] = [];
  const actions = {
    /**
     * The region's item action. It RETURNS the line the readout shows, which is
     * the whole point of the third shape: the item handler feeds a cell OUTSIDE
     * the region rather than mutating the region's own DOM, so key identity and
     * DOM invariance are both observable in one click. The body is never read by
     * the pass — an action is admitted by the fixed path that reaches it.
     */
    drop(id: string): string {
      dropped.push(id);
      return `dropped ${id}`;
    },
    dropped: (): readonly string[] => dropped,
  };
  return [data, actions] as const;
}
