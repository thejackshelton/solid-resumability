import { createSignal } from "solid-js";

/**
 * First-party hosts for the adversarial instantiation gate.
 *
 * Three instantiations of one shape: a lowercase intrinsic, a literal class,
 * a source cell, and a derivable text child. Nothing here names a library.
 *
 * `SeenHost` is the instantiation a hypothetical build would record.
 * `UnseenHost` is the same shape under a class that build never saw.
 * `SpreadHost` satisfies every clause of that shape except "no spread".
 */

export function SeenHost() {
  const [n, setN] = createSignal(0);
  return (
    <p class="seen">
      <button class="bump" onClick={() => setN(n() + 1)}>
        {n()}
      </button>
    </p>
  );
}

export function UnseenHost() {
  const [n, setN] = createSignal(0);
  return (
    <p class="unseen">
      <button class="bump" onClick={() => setN(n() + 1)}>
        {n()}
      </button>
    </p>
  );
}

const extra: Record<string, string> = { "data-x": "1" };

export function SpreadHost() {
  const [n, setN] = createSignal(0);
  return (
    <p class="seen" {...extra}>
      <button class="bump" onClick={() => setN(n() + 1)}>
        {n()}
      </button>
    </p>
  );
}
