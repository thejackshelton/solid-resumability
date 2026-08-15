// Provable stepper — positive control with two literal cells and arithmetic text derivation.
import { createSignal } from "solid-js";

export function ProvableStepper() {
  const [value, setValue] = createSignal(10);
  const [step, setStep] = createSignal(5);

  return (
    <div>
      <span data-testid="provable-stepper-total">{value() + step()}</span>
      <span data-testid="provable-stepper-step">{step()}</span>
      <button data-testid="provable-stepper-up" onClick={() => setValue(value() + step())}>
        up
      </button>
      <button data-testid="provable-stepper-widen" onClick={() => setStep(step() + 1)}>
        widen
      </button>
    </div>
  );
}
