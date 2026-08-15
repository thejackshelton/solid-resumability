import { createSignal } from "solid-js";

/**
 * First-party hosts for the array-ref wiring admission.
 *
 * An own-frame intrinsic whose `ref` is an array of a component-local
 * setter and an identity-class member path. Parents pass either that
 * shape or, in the unseen pairing, different text. Nothing here names
 * a library component.
 */

/** Honest pairing: a local setter plus an own-props member path. */
export function RefFanoutHost(props: { handle?: (el: Element) => void } = {}) {
  const [el, setEl] = createSignal(null);
  return (
    <p class="fanout" ref={[setEl, props.handle]}>
      seen
    </p>
  );
}

/** Second instantiation: the same shape, text the build did not see first. */
export function RefFanoutUnseen(props: { handle?: (el: Element) => void } = {}) {
  const [el, setEl] = createSignal(null);
  return (
    <p class="fanout" ref={[setEl, props.handle]}>
      unseen
    </p>
  );
}
