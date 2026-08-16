import { createMemo, createSignal } from "solid-js";

import { isPositive } from "./guarded-return";

/**
 * First-party hosts for the guarded-return memo-callback grammar.
 *
 * Exactly: one const binding of an admitted call, a `== null` guard that
 * returns a literal, and a terminal call of a pure single-return helper.
 * The unseen pairing carries different static text. Nothing here names a
 * library component.
 */

/** Honest pairing: cell read, literal guard, cross-module single-return call. */
export function GuardedReturnHost() {
  const [n, setN] = createSignal(1);
  const flag = createMemo(() => {
    const x = n();
    if (x == null) return false;
    return isPositive(x);
  });
  return (
    <p class="guarded" title={flag() ? "on" : "off"}>
      seen
    </p>
  );
}

/** Second instantiation: the same shape, text the build did not see first. */
export function GuardedReturnUnseen() {
  const [n, setN] = createSignal(1);
  const flag = createMemo(() => {
    const x = n();
    if (x == null) return false;
    return isPositive(x);
  });
  return (
    <p class="guarded" title={flag() ? "on" : "off"}>
      unseen
    </p>
  );
}
