import { createSignal, omit, untrack } from "solid-js";
import { Dynamic } from "@solidjs/web";

/**
 * Counter-instantiation for the element-indirection fold: every clause
 * holds except the call-site tag being a build-constant intrinsic string.
 * The tag is a caller-local variable. Nothing here names a library
 * component.
 */

function Indirection(props: { as: string; class?: string }) {
  const rest = omit(props, "as");
  if (!untrack(() => props.as)) {
    throw new Error("missing tag");
  }
  return <Dynamic {...rest} component={props.as} />;
}

/** Counter: a function-scope tag is not a v1 build-constant. */
export function ElementIndirectionCounter() {
  const [n, setN] = createSignal(0);
  const tag = "hr";
  return (
    <p class="host">
      <Indirection as={tag} class="folded" />
      <button class="bump" onClick={() => setN(n() + 1)}>
        {n()}
      </button>
    </p>
  );
}
