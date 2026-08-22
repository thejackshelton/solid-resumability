import { createSignal } from "solid-js";

/**
 * Counter-instantiation for measured rest-spread: every clause holds
 * except the spread argument being an identity-class binding. The
 * argument is a call. Nothing here names a library component.
 */

function decorations(): Record<string, string> {
  return { id: "x" };
}

/** Counter: a call-valued spread is not an identity-class rest. */
export function MeasuredRestCounter() {
  const [n, setN] = createSignal(0);
  return (
    <p class="rest" {...decorations()}>
      counter
    </p>
  );
}
