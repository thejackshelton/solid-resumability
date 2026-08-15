import { createContext, createSignal } from "solid-js";

/**
 * S7 — A COMPONENT WHOSE ROOT IS A PROVIDER ELEMENT.
 *
 * `<ScaleContext value={…}>` renders no host element of its own: it opens a
 * context and hands its children straight through, which is exactly the property
 * that already lets one framework element be templated rather than refused. The
 * pass has no general rule for it, so the element is refused as a nested
 * component and the static markup underneath it never reaches the template.
 *
 * The CONTINGENT row's second half is the interesting one: clearing the element
 * is not clearing the verdict for a tree that actually uses the provided value,
 * and this fixture is built so the difference is visible — the value is real
 * state, and the child below is not the component that reads it.
 */
const ScaleContext = createContext<number>();

export function ProviderElementRoot() {
  const [count, setCount] = createSignal(0);
  return (
    <ScaleContext value={count()}>
      <p class="static">held</p>
      <button class="bump" onClick={() => setCount(count() + 1)}>
        {count()}
      </button>
    </ScaleContext>
  );
}
