import { createContext, For, useContext } from "solid-js";

import { createRoster } from "./roster.ts";

/**
 * A keyed region, in the shape it was cut for: `MainSection`'s list with the
 * todos taken out.
 *
 * The container is the `<ul>` and its ONLY child is the `<For>`, which is what
 * lets the resume path call every one of `container.children` an item. The list
 * is a projection of a store read, so it has no build-time value: the component
 * templates an empty container, and whatever items the page's own first paint
 * carried are READ out of the DOM rather than built.
 *
 * The item body is an inline one-parameter arrow returning a single element, and
 * it uses its item both ways the pass admits — a derivation (`member.name`) and
 * a handler capture (`drop(member.id)`). Neither reads what a member IS: the
 * item is reached by the key its element carries, and the chain above it is the
 * author's own source evaluated against whatever the key found.
 */
export function RosterList() {
  const [roster, { drop }] = useContext(RosterContext);
  return (
    <ul class="roster">
      <For each={roster.members}>
        {member => (
          <li class="member">
            <span class="name">{member.name}</span>
            <button class="drop" onClick={() => drop(member.id)}>
              x
            </button>
          </li>
        )}
      </For>
    </ul>
  );
}

export const RosterContext = createContext<ReturnType<typeof createRoster>>();

/** The provider `RosterList` takes its store from. Rendered by unmodified Solid
 * in the parity probe, so the region's container is real markup rather than a
 * string this pass agreed with itself about. */
export function Roster() {
  return (
    <RosterContext value={createRoster()}>
      <RosterList />
    </RosterContext>
  );
}
