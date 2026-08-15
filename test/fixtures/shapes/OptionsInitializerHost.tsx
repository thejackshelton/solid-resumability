import { createSignal } from "solid-js";

/**
 * First-party hosts for the options-object initializer seat.
 *
 * A source cell whose second argument is a statically-known object of
 * literal values, or a counter that puts a computed value in that object.
 * Nothing here names a library. Option keys are intentionally not drawn
 * from SignalOptions — the classifier only cares that values are literals —
 * so the options objects are cast at the call site.
 */

/** Counter-instantiation: the options object carries a computed value. */
export function OptionsInitializerHost() {
  const [n, setN] = createSignal(0, { flag: 1 + 1 } as object);
  return (
    <p class="seen">
      <button class="bump" onClick={() => setN(n() + 1)}>
        {n()}
      </button>
    </p>
  );
}

/** Honest pairing the build could record. */
export function OptionsInitializerSeen() {
  const [n, setN] = createSignal<number | undefined>(void 0, { flag: true } as object);
  return (
    <p class="seen">
      <button class="bump" onClick={() => setN(1)}>
        ok
      </button>
    </p>
  );
}

/** Second instantiation: same seat, cargo the build did not see. */
export function OptionsInitializerUnseen() {
  const [n, setN] = createSignal<number | undefined>(void 0, { flag: false } as object);
  return (
    <p class="unseen">
      <button class="bump" onClick={() => setN(1)}>
        ok
      </button>
    </p>
  );
}
