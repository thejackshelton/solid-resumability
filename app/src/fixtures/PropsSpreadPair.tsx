// Near-miss: jsx-spread at a component boundary. `{...wiring}` is exactly the
// construct that makes the child's props unnameable — the call site cannot say
// which prop receives the accessor and which receives the handler — so the
// splice is refused before any of the child's markup is looked at.
import { createSignal } from "solid-js";

function PropsSpreadChild(props: { count: () => number; onStep: () => void }) {
  return (
    <button data-testid="props-spread-inc" onClick={props.onStep}>
      {props.count()}
    </button>
  );
}

export function PropsSpreadParent() {
  const [count, setCount] = createSignal(0);
  const wiring = { count, onStep: () => setCount(count() + 1) };

  return (
    <div>
      <PropsSpreadChild {...wiring} />
    </div>
  );
}
