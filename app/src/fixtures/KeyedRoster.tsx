// Keyed-region carrier (T015) — the production sibling of `test/fixtures/
// KeyedList.tsx`, promoted into the corpus so the coverage denominator counts it
// and the demo has something real to mount.
//
// The list fixture proved the region in a test-only file. This one carries the
// THIRD SHAPE the ruling forced: the item handler neither mutates the region's
// DOM nor removes anything from it. It calls the store action and feeds the
// action's RETURN into a cell whose readout sits OUTSIDE the region. So one
// click is evidence for two invariants at once — the key resolved to the right
// item (the readout names it), and the region's markup did not move (nothing in
// the `<ul>` changed).
//
// That readout is also the one unprobed assumption of the whole ruling, stated
// as a fixture rather than as a sentence: a region-item handler that captures a
// CELL SETTER alongside the region-item slot and the store action. Three capture
// kinds in one listener, resolved in the order `classify` resolves them.
import { createContext, createSignal, For, useContext } from "solid-js";

import { createRoster } from "./roster.ts";

/**
 * The mount, in the shape it was cut for.
 *
 * The container is the `<ul>` and its ONLY child is the `<For>`, which is what
 * lets the resume path call every one of `container.children` an item. The list
 * is a projection of a store read, so it has no build-time value: the component
 * templates an EMPTY container and no item markup, and whatever items the page's
 * own first paint carried are READ out of the DOM rather than built.
 *
 * `last` is an ordinary component-scope cell with a literal initializer, and its
 * readout is a sibling of the container, not a descendant of an item. Its
 * binding is therefore the component's own — a flat locator from the component
 * root — while everything under the `<For>` lives in the region's separate
 * address space. The two never meet in the artifacts, which is exactly what the
 * probe is checking.
 *
 * The item body is an inline one-parameter arrow returning a single element, and
 * it uses its item both ways the pass admits — a derivation (`member.name`) and
 * a handler capture (`drop(member.id)`). Neither reads what a member IS: the
 * item is reached by the key its element carries, and the chain above it is the
 * author's own source evaluated against whatever the key found.
 */
export function RosterList() {
  const [roster, { drop }] = useContext(RosterContext);
  const [last, setLast] = createSignal("none");

  return (
    <div class="roster-panel">
      <p class="last">{last()}</p>
      <ul class="roster">
        <For each={roster.members}>
          {member => (
            <li class="member">
              <span class="name">{member.name}</span>
              <button class="drop" onClick={() => setLast(drop(member.id))}>
                x
              </button>
            </li>
          )}
        </For>
      </ul>
    </div>
  );
}

export const RosterContext = createContext<ReturnType<typeof createRoster>>();

/**
 * The provider `RosterList` takes its store from — and an EXPECTED refusal, not
 * a defect to close.
 *
 * `App`'s architectural residue applies here in miniature: the provider call IS
 * the frame, so a resumed `Roster` would have no frame in which to create the
 * store, and `RosterList` below it would be reaching for a store that does not
 * exist yet. Its codes are recorded in `test/carrier-fixture.test.ts` and in the
 * baseline as the shape of that boundary, and the second counted component is
 * why this fixture moves the fixtures denominator by two rather than by one.
 *
 * It earns its place anyway: unmodified Solid renders THIS component in the
 * parity probe, so the region's container is real framework output rather than a
 * string the pass agreed with itself about.
 */
export function Roster() {
  return (
    <RosterContext value={createRoster()}>
      <RosterList />
    </RosterContext>
  );
}
