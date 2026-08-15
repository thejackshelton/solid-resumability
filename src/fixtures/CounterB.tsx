import { createSignal } from "solid-js";
import { formatCount, makeHandlers, type NumberSignal } from "./counter-helper";

/**
 * Fixture B — the unprovable component. Same UI shape as A, but the signal's
 * getter/setter escape into an opaque imported helper that hands back the
 * handlers. Still ordinary Solid, and it renders fine under classic `render()`.
 */
export function CounterB() {
  const signal = createSignal(0) as unknown as NumberSignal;
  const [increment, decrement] = makeHandlers(signal, ["inc", "dec"]);

  return (
    <div>
      <span data-testid="b-label">{formatCount(signal[0])}</span>
      <button data-testid="b-inc" onClick={increment}>
        +
      </button>
      <button data-testid="b-dec" onClick={decrement}>
        -
      </button>
    </div>
  );
}
