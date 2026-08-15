import { createSignal } from "solid-js";

/** Module state the pass says nothing about. */
const rows = [true, false, true];

/**
 * The other near miss, and the one the real app lands on: `MainSection` writes
 * `checked={allCompleted()}`, where the value comes out of a method call on data
 * this pass never read. The shape is not fixed, so there is no derivation to
 * print and no value to fold, and `jsx-dynamic-attribute` still refuses it —
 * which is the point of narrowing rather than lifting that code.
 */
export function UnfoldableAttribute() {
  const [count, setCount] = createSignal(0);
  return (
    <div>
      <input type="checkbox" checked={rows.every(Boolean)} />
      <button onClick={() => setCount(count() + 1)}>+</button>
    </div>
  );
}
