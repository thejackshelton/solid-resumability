// Near-miss: the handler handed across the boundary came back from a factory
// this pass will not summarize — `makeNoisyIncrement` logs, so it names a
// global. The call site can name the prop but cannot prove its value, so the
// splice is refused and the accessors it was built from escape as well.
import { createSignal } from "solid-js";

import { makeNoisyIncrement } from "./impure-helpers";

function PropsOpaqueChild(props: { onStep: () => void }) {
  return (
    <button data-testid="props-opaque-inc" onClick={props.onStep}>
      +
    </button>
  );
}

export function PropsOpaqueParent() {
  const [count, setCount] = createSignal(0);
  const bump = makeNoisyIncrement(count, setCount);

  return (
    <div>
      <span data-testid="props-opaque-label">{"count: " + count()}</span>
      <PropsOpaqueChild onStep={bump} />
    </div>
  );
}
