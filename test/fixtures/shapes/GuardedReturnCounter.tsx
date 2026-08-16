import { createMemo, createSignal } from "solid-js";

import { isPositive } from "./guarded-return";

/**
 * Counters for the guarded-return callback grammar. Each one keeps every
 * clause except one. Nothing here names a library component.
 */

/** Extra statement between the local binding and the null-guard. */
export function GuardedReturnExtraStatement() {
  const [n, setN] = createSignal(1);
  const flag = createMemo(() => {
    const x = n();
    const unused = 0;
    if (x == null) return false;
    return isPositive(x);
  });
  return (
    <p class="guarded" title={flag() ? "on" : "off"}>
      extra
    </p>
  );
}

/** Guard return is a call, not a literal. */
export function GuardedReturnNonLiteral() {
  const [n, setN] = createSignal(1);
  const flag = createMemo(() => {
    const x = n();
    if (x == null) return n();
    return isPositive(x);
  });
  return (
    <p class="guarded" title={flag() ? "on" : "off"}>
      nonliteral
    </p>
  );
}

/** Write through a setter inside the terminal call. */
export function GuardedReturnWrite() {
  const [n, setN] = createSignal(1);
  const flag = createMemo(() => {
    const x = n();
    if (x == null) return false;
    return isPositive(setN(1));
  });
  return (
    <p class="guarded" title={flag() ? "on" : "off"}>
      write
    </p>
  );
}
