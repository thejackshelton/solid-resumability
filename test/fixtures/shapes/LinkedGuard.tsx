import { createSignal, Show } from "solid-js";

import { gateOpen } from "./gate/ambient.ts";

/**
 * S6's CONTROL — the same guard with the barrel taken out of the way.
 *
 * This one imports the accessor's module directly, so the project walk queues it
 * and `gateOpen` resolves to a real definition inside the analyzed set. The
 * verdict does not move, and that is the whole reason this file exists: it
 * separates the file-set edge, which a re-export rule would close, from the
 * reason a foreign guard is refused, which no file-set change reaches.
 */
export function LinkedGuard() {
  const [count, setCount] = createSignal(0);
  return (
    <section class="linked-guard">
      <Show when={gateOpen()}>
        <p class="on">on</p>
      </Show>
      <button class="bump" onClick={() => setCount(count() + 1)}>
        {count()}
      </button>
    </section>
  );
}
