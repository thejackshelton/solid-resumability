// Near-miss: signal-escapes-to-opaque-callee — the getter is handed straight to
// a helper that logs. The call is *direct*, which is the shape T007's
// see-through admits, and the refusal here is entirely about the callee: a
// helper that does IO names a global, so `summaries.ts` refuses to summarize it
// and the pass cannot say what happens to the accessor inside.
//
// This restores the corpus's carrier for that code, which T007 lost when
// `OpaqueCalleeCounter` flipped provable against the summarizable helpers.
import { createSignal } from "solid-js";

import { logCount } from "./impure-helpers";

export function ImpureEscapeCounter() {
  const [count, setCount] = createSignal(0);
  logCount(count);

  return (
    <div>
      <span data-testid="impure-escape-label">{"count: " + count()}</span>
      <button data-testid="impure-escape-inc" onClick={() => setCount(count() + 1)}>
        +
      </button>
    </div>
  );
}
