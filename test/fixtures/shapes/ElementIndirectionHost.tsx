import { createSignal, omit, untrack } from "solid-js";
import { Dynamic } from "@solidjs/web";

/**
 * First-party hosts for the element-indirection fold.
 *
 * A child whose body is omit + optional untrack guard + a framework Dynamic
 * return. Parents pass either a build-constant intrinsic tag or, in the
 * unseen pairing, a different literal. Nothing here names a library
 * component.
 */

function Indirection(props: { as: string; class?: string }) {
  const rest = omit(props, "as");
  if (!untrack(() => props.as)) {
    throw new Error("missing tag");
  }
  return <Dynamic {...rest} component={props.as} />;
}

/** Honest pairing: a per-call-site literal tag the fold can splice. */
export function ElementIndirectionHost() {
  const [n, setN] = createSignal(0);
  return (
    <p class="host">
      <Indirection as="hr" class="folded" />
      <button class="bump" onClick={() => setN(n() + 1)}>
        {n()}
      </button>
    </p>
  );
}

/** Second instantiation: a different literal tag the build did not see first. */
export function ElementIndirectionUnseen() {
  const [n, setN] = createSignal(0);
  return (
    <p class="host">
      <Indirection as="br" class="folded" />
      <button class="bump" onClick={() => setN(n() + 1)}>
        {n()}
      </button>
    </p>
  );
}
