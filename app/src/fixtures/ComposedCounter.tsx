// Composed counter — the addressing arm's target, and the case depth-1 inlining
// cannot reach.
//
// `ComposedInner` owns a `createSignal` and an inline handler, which is exactly
// what inlining refuses: a spliced child's bindings are re-homed onto its
// parent's cells, and a child declaring its own cell is state the parent has no
// slot for. So this is not a component inlining happens not to have gotten to —
// it is outside inlining's ceiling by construction, and the only way the parent
// composes it is by leaving a hole and letting the child keep its own address.
//
// `ComposedOuter` declares a cell of its own on purpose. A parent that only
// composes would be refused `no-signal-source` for a reason that has nothing to
// do with composition, and a fixture refused for the wrong reason proves
// nothing about the right one.
import { createSignal } from "solid-js";

// One v1 recorded literal (`kind="seed"` at the call site). The value is
// first-paint markup: classify-with-record bakes it into this component's
// own template. The hole in the parent stays two attributes and empty.
export function ComposedInner(props: { kind: string }) {
  const [inner, setInner] = createSignal(0);

  return (
    <div>
      <span data-testid="composed-inner-label">{"inner: " + inner()}</span>
      <button data-testid="composed-inner-inc" onClick={() => setInner(inner() + 1)}>
        +
      </button>
      <span data-testid="composed-inner-kind">{props.kind}</span>
    </div>
  );
}

export function ComposedOuter() {
  const [outer, setOuter] = createSignal(0);

  return (
    <div>
      <span data-testid="composed-outer-label">{"outer: " + outer()}</span>
      <button data-testid="composed-outer-inc" onClick={() => setOuter(outer() + 1)}>
        +
      </button>
      <ComposedInner kind="seed" />
    </div>
  );
}
