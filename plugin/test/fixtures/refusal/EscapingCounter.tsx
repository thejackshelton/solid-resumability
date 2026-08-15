// A component the pass must refuse, kept here so the refusal path is exercised
// against corpus this package owns rather than against someone else's app.
//
// The getter is handed straight to a helper that does IO. The call is direct,
// which the see-through rule admits; the refusal is entirely about the callee,
// which cannot be summarized, so the pass cannot say what happens to the
// accessor inside it.
import { createSignal } from "solid-js";

import { reportCount } from "./noisy-helpers";

export function EscapingCounter() {
  const [count, setCount] = createSignal(0);
  reportCount(count);

  return (
    <div>
      <span data-testid="escaping-label">{"count: " + count()}</span>
      <button data-testid="escaping-inc" onClick={() => setCount(count() + 1)}>
        +
      </button>
    </div>
  );
}
