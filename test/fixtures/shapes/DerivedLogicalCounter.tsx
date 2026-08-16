import { createSignal } from "solid-js";

/**
 * Counter-instantiation for derived-logical-condition cargo: every clause
 * holds except both sides of the connective being derivable. The right
 * operand is a module-scope binding this pass does not fold. Nothing here
 * names a library component.
 */

let extra = 1;

/** Counter: one side of `||` is not a derivation this pass can fold or measure. */
export function DerivedLogicalCounter() {
  const [n, setN] = createSignal(1);
  return (
    <p class="logical" title={n() || extra ? "on" : "off"}>
      counter
    </p>
  );
}
