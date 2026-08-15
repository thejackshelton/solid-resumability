import { createSignal } from "solid-js";

/**
 * First-party hosts for the measured identity rest-spread admission.
 *
 * An own-frame intrinsic whose opening carries an identifier rest-spread
 * of a derived/rest-props result. The unseen pairing carries different
 * static text. Nothing here names a library component.
 */

/** Honest pairing: rest of the own-props parameter, baked nothing. */
export function MeasuredRestHost(props: { extra?: string } = {}) {
  const [n, setN] = createSignal(0);
  const { extra, ...rest } = props;
  return (
    <p class="rest" {...rest}>
      seen
    </p>
  );
}

/** Second instantiation: the same shape, text the build did not see first. */
export function MeasuredRestUnseen(props: { extra?: string } = {}) {
  const [n, setN] = createSignal(0);
  const { extra, ...rest } = props;
  return (
    <p class="rest" {...rest}>
      unseen
    </p>
  );
}
