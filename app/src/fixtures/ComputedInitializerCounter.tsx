// Near-miss: signal-initializer-not-literal — the initial value is a computed expression, not a literal.
import { createSignal } from "solid-js";

const SEED = [1, 2, 3];

function initialCount() {
  return SEED.length;
}

export function ComputedInitializerCounter() {
  const [count, setCount] = createSignal(initialCount());

  return (
    <div>
      <span data-testid="computed-init-label">{"count: " + count()}</span>
      <button data-testid="computed-init-inc" onClick={() => setCount(count() + 1)}>
        +
      </button>
    </div>
  );
}
