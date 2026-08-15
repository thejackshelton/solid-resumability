// Props see-through (T009): a cell accessor and an inline provable handler
// cross exactly one component boundary. The parent is the admission case — the
// pass splices both children's markup into the parent's template and re-homes
// their bindings onto the parent's cell. The children are ordinary components
// in their own right and, judged standalone, declare no cells at all, so they
// stay fallback: the parent's provability is not a claim about them.
import { createSignal } from "solid-js";

function PropsCountLabel(props: { count: () => number }) {
  return <span data-testid="props-pair-label">{props.count()}</span>;
}

function PropsStepButton(props: { onStep: () => void }) {
  return (
    <button data-testid="props-pair-inc" onClick={props.onStep}>
      +
    </button>
  );
}

export function PropsPairParent() {
  const [count, setCount] = createSignal(0);

  return (
    <div>
      <PropsCountLabel count={count} />
      <PropsStepButton onStep={() => setCount(count() + 1)} />
    </div>
  );
}
