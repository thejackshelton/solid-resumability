import { createSignal } from "solid-js";

/**
 * Fixture A — the provable component. Ordinary Solid: one `createSignal(0)`
 * with a literal initializer, two handlers closing over that same getter/setter
 * pair, one derived text binding. No markers, annotations or special imports.
 */
export function CounterA() {
  const [count, setCount] = createSignal(0);

  return (
    <div>
      <span data-testid="a-label">{"count: " + count()}</span>
      <button data-testid="a-inc" onClick={() => setCount(count() + 1)}>
        +
      </button>
      <button data-testid="a-dec" onClick={() => setCount(count() - 1)}>
        -
      </button>
    </div>
  );
}
