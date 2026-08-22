import { createSignal } from "solid-js";

import { n as parts } from "./member-chunk";
import { Leaf } from "./member-leaf";
import * as ns from "./member-leaf";

/**
 * First-party hosts for JSXMemberExpression resolution through a
 * namespace/module binding. Nothing here names a library component.
 */

/** Honest pairing: `import * as` namespace, literal class on the member. */
export function MemberNamespaceHost() {
  const [n, setN] = createSignal(0);
  return (
    <p class="host">
      <ns.Leaf class="seen" />
      <button class="bump" onClick={() => setN(n() + 1)}>
        {n()}
      </button>
    </p>
  );
}

/** Second instantiation: the same shape, class the build did not see first. */
export function MemberNamespaceUnseen() {
  const [n, setN] = createSignal(0);
  return (
    <p class="host">
      <ns.Leaf class="unseen" />
      <button class="bump" onClick={() => setN(n() + 1)}>
        {n()}
      </button>
    </p>
  );
}

/** Named import of a namespace object whose member is a thunk to the leaf. */
export function MemberObjectHost() {
  const [n, setN] = createSignal(0);
  return (
    <p class="host">
      <parts.Leaf class="seen" />
      <button class="bump" onClick={() => setN(n() + 1)}>
        {n()}
      </button>
    </p>
  );
}

/** Local object is not a namespace/module binding. */
export function MemberLocalObjectHost() {
  const [n, setN] = createSignal(0);
  const box = { Leaf };
  return (
    <p class="host">
      <box.Leaf class="seen" />
      <button class="bump" onClick={() => setN(n() + 1)}>
        {n()}
      </button>
    </p>
  );
}
