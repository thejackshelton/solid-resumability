import { createSignal } from "solid-js";

/**
 * First-party hosts for derived-logical-condition cargo.
 *
 * An own-frame intrinsic whose one computed attribute is a
 * ConditionalExpression whose test is `||` of two derivable conditions
 * and whose both branches are literals. The unseen pairing carries
 * different static text. Nothing here names a library component.
 */

/** Honest pairing: both sides of `||` are cell reads, branches are literals. */
export function DerivedLogicalHost() {
  const [n, setN] = createSignal(1);
  const [m, setM] = createSignal(0);
  return (
    <p class="logical" title={n() || m() ? "on" : "off"}>
      seen
    </p>
  );
}

/** Second instantiation: the same shape, text the build did not see first. */
export function DerivedLogicalUnseen() {
  const [n, setN] = createSignal(1);
  const [m, setM] = createSignal(0);
  return (
    <p class="logical" title={n() || m() ? "on" : "off"}>
      unseen
    </p>
  );
}
