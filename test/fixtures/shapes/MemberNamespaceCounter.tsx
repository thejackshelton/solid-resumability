import { createSignal } from "solid-js";

import * as ns from "./member-leaf";

/**
 * Counter-instantiation for member-expression resolution: the object is a
 * namespace, the member does not resolve into the analyzed set.
 */
export function MemberUnresolvable() {
  const [n, setN] = createSignal(0);
  return (
    <p class="host">
      <ns.Missing class="seen" />
      <button class="bump" onClick={() => setN(n() + 1)}>
        {n()}
      </button>
    </p>
  );
}
