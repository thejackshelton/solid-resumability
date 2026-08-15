// Near-miss: signal-binding-not-destructured — the signal tuple is bound whole instead of as [get, set].
import { createSignal } from "solid-js";

export function TupleSignalCounter() {
  const counter = createSignal(0);

  return (
    <div>
      <span data-testid="tuple-label">{"count: " + counter[0]()}</span>
      <button data-testid="tuple-inc" onClick={() => counter[1](counter[0]() + 1)}>
        +
      </button>
      <button data-testid="tuple-dec" onClick={() => counter[1](counter[0]() - 1)}>
        -
      </button>
    </div>
  );
}
