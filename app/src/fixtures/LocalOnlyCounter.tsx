// Near-miss: no-exported-component — the component is module-local; the export is a factory that hands back the reference.
import { createSignal } from "solid-js";

function LocalOnlyCounter() {
  const [count, setCount] = createSignal(0);

  return (
    <div>
      <span data-testid="local-only-label">{"count: " + count()}</span>
      <button data-testid="local-only-inc" onClick={() => setCount(count() + 1)}>
        +
      </button>
    </div>
  );
}

export function getLocalOnlyCounter() {
  return LocalOnlyCounter;
}
