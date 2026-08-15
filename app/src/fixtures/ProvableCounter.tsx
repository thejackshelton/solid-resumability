// Provable counter — the positive control: no refusal code should fire here.
import { createSignal } from "solid-js";

export function ProvableCounter() {
  const [count, setCount] = createSignal(0);

  return (
    <div>
      <span data-testid="provable-counter-label">{"count: " + count()}</span>
      <button data-testid="provable-counter-inc" onClick={() => setCount(count() + 1)}>
        +
      </button>
      <button data-testid="provable-counter-dec" onClick={() => setCount(count() - 1)}>
        -
      </button>
    </div>
  );
}
