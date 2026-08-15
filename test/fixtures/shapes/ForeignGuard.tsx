import { createSignal, Show } from "solid-js";

import { gateOpen } from "./gate/index.ts";

/**
 * S6 — A REGION WHOSE GUARD IS SOMEONE ELSE'S ACCESSOR.
 *
 * The guard is a call, and the callee comes in through a re-export barrel, so
 * the definition the pass would need to read is outside the analyzed set. A
 * region is not a toggle here: an absent one has no DOM and nothing on the
 * resume side builds it, so a guard the build cannot settle is a region the
 * build cannot serve either way.
 *
 * The cell and the readout are the same control as everywhere else in this
 * corpus — the component has state it can prove, so the refusal is about the
 * guard and nothing else.
 */
export function ForeignGuard() {
  const [count, setCount] = createSignal(0);
  return (
    <section class="foreign-guard">
      <Show when={gateOpen()}>
        <p class="on">on</p>
      </Show>
      <button class="bump" onClick={() => setCount(count() + 1)}>
        {count()}
      </button>
    </section>
  );
}
