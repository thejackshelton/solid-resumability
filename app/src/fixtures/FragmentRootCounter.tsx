// Near-miss: jsx-root-not-element — the component returns a fragment rather than one JSX element.
import { createSignal } from "solid-js";

export function FragmentRootCounter() {
  const [count, setCount] = createSignal(0);

  return (
    <>
      <span data-testid="fragment-root-label">{"count: " + count()}</span>
      <button data-testid="fragment-root-inc" onClick={() => setCount(count() + 1)}>
        +
      </button>
    </>
  );
}
