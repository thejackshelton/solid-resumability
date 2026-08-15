// Near-miss: jsx-root-not-element — the component returns an array of elements rather than one JSX element.
import { createSignal } from "solid-js";

export function ArrayRootCounter() {
  const [count, setCount] = createSignal(0);

  return [
    <span data-testid="array-root-label">{"count: " + count()}</span>,
    <button data-testid="array-root-inc" onClick={() => setCount(count() + 1)}>
      +
    </button>
  ];
}
