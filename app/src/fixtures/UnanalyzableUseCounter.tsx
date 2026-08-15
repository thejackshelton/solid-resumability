// Near-miss: signal-escapes-unanalyzable-use — the accessors are stored in a local array, a non-call use of the binding.
import { createSignal } from "solid-js";

export function UnanalyzableUseCounter() {
  const [count, setCount] = createSignal(0);
  const wiring = [count, setCount] as const;

  return (
    <div>
      <span data-testid="unanalyzable-label">{"count: " + wiring[0]()}</span>
      <button data-testid="unanalyzable-inc" onClick={() => wiring[1](wiring[0]() + 1)}>
        +
      </button>
    </div>
  );
}
