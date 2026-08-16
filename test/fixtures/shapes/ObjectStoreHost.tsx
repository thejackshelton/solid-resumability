import { useContext } from "solid-js";

import { ShelfContext, useShelf } from "./object-store-context";

/**
 * First-party hosts for whole-bound object-shaped context admission.
 * Static markup; the store is the only declared source.
 */

export function ObjectStoreHost() {
  const ctx = useContext(ShelfContext);
  return (
    <button class="seen" onClick={ctx.toggle}>
      ok
    </button>
  );
}

/** Second instantiation: the same shape, class the build did not see first. */
export function ObjectStoreUnseen() {
  const ctx = useContext(ShelfContext);
  return (
    <button class="unseen" onClick={ctx.toggle}>
      ok
    </button>
  );
}

export function ObjectStoreHelperHost() {
  const ctx = useShelf();
  return (
    <button class="helper" onClick={ctx.toggle}>
      ok
    </button>
  );
}

export function ObjectStoreReadHost() {
  const ctx = useContext(ShelfContext);
  return <span class="read">{ctx.isOpen() ? "open" : "closed"}</span>;
}
