import { createSignal } from "solid-js";

/**
 * Counter-instantiation for derived-conditional cargo: every clause holds
 * except both branches being derivable. The consequent is a module-scope
 * binding this pass does not fold. Nothing here names a library component.
 */

let extra = "nope";

/** Counter: one branch is not a derivation this pass can fold or measure. */
export function DerivedConditionalCounter() {
  const [n, setN] = createSignal(1);
  return (
    <p class="cond" title={n() > 0 ? extra : "off"}>
      counter
    </p>
  );
}
