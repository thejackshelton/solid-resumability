import { createSignal, merge, omit, untrack } from "solid-js";
import { Dynamic } from "@solidjs/web";

/**
 * Counter-instantiation for the four-shape conjunction: every clause holds
 * except the rest-spread argument being an identity-class binding. The
 * argument is a call. Nothing here names a library component.
 */

function Indirection(props: { as: string; [key: string]: unknown }) {
  const rest = omit(props, "as");
  if (!untrack(() => props.as)) {
    throw new Error("missing tag");
  }
  return <Dynamic {...rest} component={props.as} />;
}

function decorations(): Record<string, string> {
  return { id: "x" };
}

/** Counter: a call-valued spread is not an identity-class rest. */
export function FoldedMeasuredCounter(
  props: { orientation?: string; handle?: (el: Element) => void } = {},
) {
  const [el, setEl] = createSignal(null);
  const orientation = merge({ orientation: "horizontal" } as const, props);
  return (
    <Indirection
      as="hr"
      ref={[setEl, orientation.handle]}
      role={orientation.orientation === "vertical" ? "separator" : undefined}
      aria-orientation={orientation.orientation === "vertical" ? "vertical" : undefined}
      data-orientation={orientation.orientation}
      {...decorations()}
    />
  );
}
