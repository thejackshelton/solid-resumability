import { createMemo, createSignal } from "solid-js";

/**
 * Counter-instantiation for memo-callback cargo: every clause holds
 * except the memo callback being derivable. The callback returns a
 * module-scope binding this pass does not fold. Nothing here names a
 * library component.
 */

let extra = "nope";

/** Counter: the memo callback is not a derivation this pass can fold or measure. */
export function MemoConditionalCounter() {
  const [n, setN] = createSignal(1);
  const isOn = createMemo(() => extra);
  return (
    <p class="memo" title={isOn() ? "on" : "off"}>
      counter
    </p>
  );
}
