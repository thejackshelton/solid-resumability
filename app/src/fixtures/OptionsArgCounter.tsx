// Near-miss: signal-initializer-not-literal — literal initial value, but a second (options) argument.
import { createSignal } from "solid-js";

export function OptionsArgCounter() {
  const [count, setCount] = createSignal(0, { name: "optionsArgCounter" });

  return (
    <div>
      <span data-testid="options-arg-label">{"count: " + count()}</span>
      <button data-testid="options-arg-inc" onClick={() => setCount(count() + 1)}>
        +
      </button>
    </div>
  );
}
