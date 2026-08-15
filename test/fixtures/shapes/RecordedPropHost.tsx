import { createSignal } from "solid-js";

/**
 * First-party hosts for the recorded-const-prop admission.
 *
 * A child that owns a cell (so inlining cannot take it) and reads one
 * props-parameter member. Parents pass either a build-constant or a
 * signal getter. Nothing here names a library.
 */

function RecordedInner(props: { label: string }) {
  const [n, setN] = createSignal(0);
  return <span class="recorded">{props.label}</span>;
}

/** Counter-instantiation: a signal getter is not a build-constant. */
export function RecordedPropHost() {
  const [label, setLabel] = createSignal("nope");
  return <RecordedInner label={label as never} />;
}

/** Second instantiation: a parent + literal-prop pairing, render()'d live. */
export function RecordedLiteralHost() {
  const [n, setN] = createSignal(0);
  return <RecordedInner label="hello" />;
}
