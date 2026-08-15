import { createSignal, Show } from "solid-js";

/**
 * Two `<Show>` regions whose guards the pass folds whole, either side of
 * ordinary markup.
 *
 * The point of the shape is the SIBLINGS. A locator is an element index in the
 * served markup, and the absent region puts no element where its JSX child sits
 * — so the button and the span are the parent's second and third elements even
 * though they are its third and fourth JSX children. `test/show-regions.test.tsx`
 * renders this with unmodified Solid and compares byte for byte, which is the
 * only way that claim is worth making.
 *
 * Both guards are literals, which is deliberate: a guard that folds can never be
 * anything else, so there is no state in which either region has to be created.
 * A guard reaching a source cell is refused, and that refusal has its own case.
 */
export function GuardedRow() {
  const [count, setCount] = createSignal(0);
  return (
    <section class="guarded">
      <Show when={true}>
        <p class="always">always</p>
      </Show>
      <Show when={false}>
        <p class="never">never</p>
      </Show>
      <button class="bump" onClick={() => setCount(count() + 1)}>
        bump
      </button>
      <span class="count">{count()}</span>
    </section>
  );
}
