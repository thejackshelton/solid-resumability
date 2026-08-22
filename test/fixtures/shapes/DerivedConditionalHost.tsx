import { createSignal } from "solid-js";

/**
 * First-party hosts for derived-conditional cargo.
 *
 * An own-frame intrinsic whose one computed attribute is a
 * ConditionalExpression over a derivable condition with both branches
 * derivable. The unseen pairing carries different static text. Nothing
 * here names a library component.
 */

/** Honest pairing: both branches are literals, condition is a cell comparison. */
export function DerivedConditionalHost() {
  const [n, setN] = createSignal(1);
  return (
    <p class="cond" title={n() > 0 ? "on" : "off"}>
      seen
    </p>
  );
}

/** Second instantiation: the same shape, text the build did not see first. */
export function DerivedConditionalUnseen() {
  const [n, setN] = createSignal(1);
  return (
    <p class="cond" title={n() > 0 ? "on" : "off"}>
      unseen
    </p>
  );
}
