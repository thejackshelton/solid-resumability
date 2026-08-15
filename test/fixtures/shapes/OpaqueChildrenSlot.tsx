import { createSignal } from "solid-js";
import type { JSX } from "@solidjs/web";

/**
 * S4 — CALLER-SUPPLIED MARKUP IN A LONE TEXT POSITION.
 *
 * `{props.children}` owns the `<p>`'s text, and what that text IS was authored
 * by whoever renders this component. The pass is not being asked for a value it
 * could look up and declined to: the fact is not in this module at all, and the
 * artifact vocabulary has no arm that could state it if it were — every binding
 * kind owns a SCALAR, and the only subtree-shaped record names markup the build
 * itself emitted.
 *
 * The button beside it is deliberate. It gives the component a real source cell
 * and a real derivable text binding, so the refusal below cannot be read as "the
 * component had nothing to prove".
 */
export function OpaqueChildrenSlot(props: { children?: JSX.Element }) {
  const [count, setCount] = createSignal(0);
  return (
    <section class="slot-host">
      <p class="slot">{props.children}</p>
      <button class="bump" onClick={() => setCount(count() + 1)}>
        {count()}
      </button>
    </section>
  );
}
