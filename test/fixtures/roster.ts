/**
 * The store `RosterList` reads its list out of. Deliberately tiny and
 * deliberately real: the pass admits the LIST by identity — this module, this
 * factory, this tuple slot — and never reads what `members` contains, so what
 * the members are is only ever the running page's business.
 *
 * `drop` is here so the region's item has a listener to wire. Its body is never
 * read either: an action is admitted by the fixed path that reaches it.
 */

export interface Member {
  id: string;
  name: string;
}

/**
 * What the next `createRoster()` starts with. A module-level seed rather than a
 * factory argument, because the pass admits a provider whose value is a CALL to
 * a factory in the analyzed set — `createRoster()`, exactly — and a fixture that
 * took its data through the call site would be a fixture built to dodge that.
 */
let seed: Member[] = [];

export function seedRoster(members: Member[]): void {
  seed = members;
}

export function createRoster() {
  const data = { members: seed };
  const dropped: string[] = [];
  const actions = {
    drop(id: string) {
      dropped.push(id);
      return dropped;
    },
    dropped: () => dropped,
  };
  return [data, actions] as const;
}
