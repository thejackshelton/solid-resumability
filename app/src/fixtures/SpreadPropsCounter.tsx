// Near-miss: jsx-spread — the button's props arrive through a spread attribute.
import { createSignal } from "solid-js";

const buttonProps = { class: "spread-button", title: "increment" };

export function SpreadPropsCounter() {
  const [count, setCount] = createSignal(0);

  return (
    <div>
      <span data-testid="spread-props-label">{"count: " + count()}</span>
      <button {...buttonProps} data-testid="spread-props-inc" onClick={() => setCount(count() + 1)}>
        +
      </button>
    </div>
  );
}
