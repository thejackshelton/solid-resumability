import { createMemo, createSignal } from "solid-js";

/**
 * First-party hosts for memo-callback cargo.
 *
 * An own-frame intrinsic whose one computed attribute is a
 * ConditionalExpression over a zero-argument call of a binding
 * initialized to a framework memo whose callback derives. The unseen
 * pairing carries different static text. Nothing here names a library
 * component.
 */

/** Honest pairing: memo callback is a cell comparison, branches are literals. */
export function MemoConditionalHost() {
  const [n, setN] = createSignal(1);
  const isOn = createMemo(() => n() > 0);
  return (
    <p class="memo" title={isOn() ? "on" : "off"}>
      seen
    </p>
  );
}

/** Second instantiation: the same shape, text the build did not see first. */
export function MemoConditionalUnseen() {
  const [n, setN] = createSignal(1);
  const isOn = createMemo(() => n() > 0);
  return (
    <p class="memo" title={isOn() ? "on" : "off"}>
      unseen
    </p>
  );
}
