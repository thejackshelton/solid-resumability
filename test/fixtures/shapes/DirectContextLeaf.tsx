import { useContext } from "solid-js";

import { PanelContext } from "./panel-context.ts";

/**
 * S5's CONTROL — the same leaf with the wrapper removed, and nothing else
 * changed.
 *
 * It exists to keep the S5 claim honest. `no-signal-source` is a statement about
 * what the component DECLARES, and the only way to show that the wrapper is what
 * caused it is to take the wrapper away and watch the code change: this leaf
 * declares a context read the pass can see, so it is refused somewhere else
 * entirely — over the shape of the binding, not over the absence of a source.
 *
 * Which also fixes the size of the S5 finding. The wrapper hides a source that
 * exists; it does not create the deeper blocker, and this control is where that
 * distinction is measured rather than asserted.
 */
export function DirectContextLeaf() {
  const panel = useContext(PanelContext);
  panel.release();

  return <p class="leaf">idle</p>;
}
