import { createSignal } from "solid-js";

/**
 * First-party hosts for the derived-accessor callee summary.
 *
 * A helper that owns a cell, reads a getter argument only as a zero-argument
 * call, writes only its own setter, and returns that local getter. Nothing
 * here names a library.
 */

function ownCell(get: () => number) {
  const [value, setValue] = createSignal(0);
  get();
  return value;
}

/** Counter-instantiation: writes through the passed setter. */
function leakWrite(get: () => number, set: (n: number) => void) {
  const [value, setValue] = createSignal(0);
  set(get());
  return value;
}

/** Counter-instantiation: the helper writes through a passed setter. */
export function AccessorSummaryHost() {
  const [n, setN] = createSignal(0);
  const derived = leakWrite(n, setN);
  return (
    <p class="seen">
      <button class="bump" onClick={() => setN(n() + 1)}>
        {n()}
      </button>
    </p>
  );
}

/** Honest pairing the build could record. Fallback cargo is unused in bytes. */
export function AccessorSummarySeen() {
  const [n, setN] = createSignal(0);
  const derived = ownCell(n);
  return (
    <p class="seen">
      <button class="bump" onClick={() => setN(n() + 1)}>
        {n()}
      </button>
    </p>
  );
}

/** Second instantiation: same helper, cargo the build did not see. */
export function AccessorSummaryUnseen() {
  const [n, setN] = createSignal(0);
  const derived = ownCell(n);
  return (
    <p class="unseen">
      <button class="bump" onClick={() => setN(n() + 1)}>
        {n()}
      </button>
    </p>
  );
}
