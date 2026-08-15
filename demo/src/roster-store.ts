/**
 * The roster store, and the one place the document and the store agree.
 *
 * ── The agreement, stated where both sides can see it ─────────────────────
 * `demo/fixtures.html` hand-authors one `<li data-key>` per member of this
 * list. The keys and the ids below are the SAME SET and that is the only thing
 * either side owes the other: a key the store's list does not have is a refusal
 * at the first dispatch from that item (`src/resume/regions.ts`), not a guess at
 * the neighbour.
 *
 *   document order   alan, grace, ada        (demo/fixtures.html, the `<ul>`)
 *   seed order       ada, grace, alan        (ROSTER_MEMBERS, below)
 *
 * The two are deliberately REVERSED. Position and identity therefore disagree
 * for every member but the middle one, so a resume path that resolved a click by
 * counting siblings would name the wrong member in the readout, out loud, on the
 * first click of the demo. A list served in the store's own order would prove
 * nothing: both answers would be the same answer.
 *
 * ── Why this module is framework-free, and stays that way ─────────────────
 * It is the store partition of the resumable fixtures page: the bytes that
 * arrive when a dispatch finds no live store, and nothing else on that page
 * fetches them. `app/src/fixtures/roster.ts` imports nothing at all, this file
 * imports only it, and `scripts/check-zero-eager.mjs` claim 7a is the gate — no
 * chunk that page can fetch WITHOUT falling back may carry a store-partition
 * module. One framework specifier here would put the framework on the wire of a
 * page whose whole claim is that it does not have one.
 *
 * ── One factory, both variants ────────────────────────────────────────────
 * The classic page imports this module statically (it renders `Roster`, which
 * calls `createRoster()` itself, so all it needs from here is the seed) and the
 * resumable page reaches it through one dynamic `import()`. Same members, same
 * factory, same bytes — the variants differ in WHEN they arrive, which is the
 * only difference this demo is ever measuring.
 */

import { createRoster, seedRoster, type Member } from "../../app/src/fixtures/roster.ts";

/**
 * The members the page serves, in the store's order.
 *
 * Data, not markup: the ids are what the document's `data-key` attributes say,
 * and the names are what its `<span class="name">` elements say. Nothing reads
 * one out of the other at runtime — the document carries its own copy because
 * the browser needs no JavaScript to paint it, and this copy exists because the
 * store's list is what a dispatch is resolved against.
 */
export const ROSTER_MEMBERS: Member[] = [
  { id: "ada", name: "Ada" },
  { id: "grace", name: "Grace" },
  { id: "alan", name: "Alan" },
];

/**
 * Seeds the next `createRoster()` and nothing more.
 *
 * The corpus's factory takes its members from module state rather than from an
 * argument (see the note in `app/src/fixtures/roster.ts`: a fixture that took
 * its data through the call site would be a fixture built to dodge the rule the
 * pass actually applies). So the demo's job is to put the members there before
 * a store is created, on whichever path creates it.
 */
export function seedRosterStore(): void {
  seedRoster(ROSTER_MEMBERS);
}

/**
 * The live store the resumed page publishes under the identity the artifacts
 * named.
 *
 * Created here, at the moment a dispatch asks for it, out of the corpus's own
 * factory — `stores.ts` keeps a reference to this value and joins it to the
 * `{ store, path }` the artifacts carry. Nothing is serialized and nothing is
 * snapshotted; the store is born on the page that uses it, a beat later than it
 * would have been on the classic page.
 */
export function createSeededRoster(): ReturnType<typeof createRoster> {
  seedRosterStore();
  return createRoster();
}
