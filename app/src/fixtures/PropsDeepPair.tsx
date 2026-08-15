// Near-miss: the depth-1 ban. The accessor is passed parent -> middle -> leaf,
// which is one hop more than this pass will trace. `PropsMiddle` names
// `PropsLeaf`, so it is not inlinable into the parent; the parent's accessor
// therefore escapes into a prop nothing proved, and all three components stay
// fallback.
import { createSignal } from "solid-js";

function PropsLeaf(props: { count: () => number }) {
  return <span data-testid="props-deep-label">{props.count()}</span>;
}

function PropsMiddle(props: { count: () => number }) {
  return (
    <div>
      <PropsLeaf count={props.count} />
    </div>
  );
}

export function PropsDeepParent() {
  const [count, setCount] = createSignal(0);

  return (
    <div>
      <PropsMiddle count={count} />
      <button data-testid="props-deep-inc" onClick={() => setCount(count() + 1)}>
        +
      </button>
    </div>
  );
}
