import { createSignal } from "solid-js";

/** The class name this row wants, chosen elsewhere. */
const flag = "selected";

/**
 * A near miss: everything about this component is provable except the ONE thing
 * that matters — the class name is computed, so the record the pass would write
 * cannot name it. A named set whose names are chosen at runtime is not a named
 * set, and refusing is the only honest answer.
 */
export function ComputedClassName() {
  const [count, setCount] = createSignal(0);
  return (
    <div class={{ [flag]: count() > 0 }}>
      <button onClick={() => setCount(count() + 1)}>+</button>
    </div>
  );
}
