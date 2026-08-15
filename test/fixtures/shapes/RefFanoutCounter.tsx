import { createSignal } from "solid-js";

/**
 * Counter-instantiation for array-ref wiring: every clause holds except
 * every array element being a local setter or an identity-class member
 * path. The second element is a local function. Nothing here names a
 * library component.
 */

/** Counter: a local function is not a setter and not an identity-class path. */
export function RefFanoutCounter() {
  const [el, setEl] = createSignal(null);
  const extra = (node: Element) => {
    void node;
  };
  return (
    <p class="fanout" ref={[setEl, extra]}>
      counter
    </p>
  );
}
