// Near-miss: signal-result-not-bound — the createSignal call lands in an object property, not a variable declarator.
import { createSignal } from "solid-js";

export function UnboundSignalCounter() {
  const state = { count: createSignal(0) };

  return (
    <div>
      <span data-testid="unbound-label">{"count: " + state.count[0]()}</span>
      <button data-testid="unbound-inc" onClick={() => state.count[1](state.count[0]() + 1)}>
        +
      </button>
    </div>
  );
}
