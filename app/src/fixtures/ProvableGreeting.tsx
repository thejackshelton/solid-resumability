// Provable greeting — positive control with a string literal cell and a template-literal text child.
import { createSignal } from "solid-js";

export function ProvableGreeting() {
  const [name, setName] = createSignal("world");

  return (
    <p data-testid="provable-greeting">
      <span data-testid="provable-greeting-text">{`hello, ${name()}`}</span>
      <button data-testid="provable-greeting-solid" onClick={() => setName("solid")}>
        solid
      </button>
      <button data-testid="provable-greeting-reset" onClick={() => setName("world")}>
        reset
      </button>
    </p>
  );
}
