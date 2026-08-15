// The one component this reproduction proves.
//
// Shaped after the repository's own positive control (`app/src/fixtures/
// ProvableCounter.tsx`): one literal cell, one text binding, one handler that
// reads and writes it. Nothing here is start-mode specific — the point of the
// reproduction is that the SAME provable component, the SAME plugin options and
// the SAME page declaration behave differently depending on whether
// `@solidjs/vite-plugin` is asked for `start: true`.
import { createSignal } from "solid-js";

export function Counter() {
  const [count, setCount] = createSignal(0);

  return (
    <div>
      <span data-testid="counter-label">{"count: " + count()}</span>
      <button data-testid="counter-inc" onClick={() => setCount(count() + 1)}>
        +
      </button>
    </div>
  );
}
