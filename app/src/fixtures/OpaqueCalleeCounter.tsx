// Near-miss: signal-escapes-to-opaque-callee — the accessors are handed to helpers imported from another module.
import { createSignal } from "solid-js";
import { formatCount, makeIncrement } from "./signal-helpers";

export function OpaqueCalleeCounter() {
  const [count, setCount] = createSignal(0);
  const increment = makeIncrement(count, setCount);

  return (
    <div>
      <span data-testid="opaque-callee-label">{formatCount(count)}</span>
      <button data-testid="opaque-callee-inc" onClick={increment}>
        +
      </button>
    </div>
  );
}
