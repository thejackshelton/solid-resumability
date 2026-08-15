import { createSignal, merge, omit, untrack } from "solid-js";
import { Dynamic } from "@solidjs/web";

/**
 * First-party hosts for the four-shape conjunction: an element-indirection
 * fold to an intrinsic tag, measured conditionals over identity member
 * reads, a measured identity rest-spread, and an array-literal ref fan-out.
 * The unseen pairing is the same shape under cargo the build did not see.
 * Nothing here names a library component.
 */

function Indirection(props: { as: string; [key: string]: unknown }) {
  const rest = omit(props, "as");
  if (!untrack(() => props.as)) {
    throw new Error("missing tag");
  }
  return <Dynamic {...rest} component={props.as} />;
}

type HostProps = {
  orientation?: string;
  handle?: (el: Element) => void;
  id?: string;
};

/** Honest pairing: the four sub-shapes on one standalone component. */
export function FoldedMeasuredHost(props: HostProps = {}) {
  const [el, setEl] = createSignal(null);
  const orientation = merge({ orientation: "horizontal" } as const, props);
  const others = omit(orientation, "handle", "orientation");
  return (
    <Indirection
      as="hr"
      ref={[setEl, orientation.handle]}
      role={orientation.orientation === "vertical" ? "separator" : undefined}
      aria-orientation={orientation.orientation === "vertical" ? "vertical" : undefined}
      data-orientation={orientation.orientation}
      {...others}
    />
  );
}

/** Second instantiation: the same shape, cargo the build did not see first. */
export function FoldedMeasuredUnseen(props: HostProps = {}) {
  const [el, setEl] = createSignal(null);
  const orientation = merge({ orientation: "horizontal" } as const, props);
  const others = omit(orientation, "handle", "orientation");
  return (
    <Indirection
      as="hr"
      ref={[setEl, orientation.handle]}
      role={orientation.orientation === "vertical" ? "separator" : undefined}
      aria-orientation={orientation.orientation === "vertical" ? "vertical" : undefined}
      data-orientation={orientation.orientation}
      {...others}
    />
  );
}

/** Live pairing the gate mounts. Not a classify target. */
export function FoldedMeasuredUnseenLive() {
  return <FoldedMeasuredHost orientation="vertical" id="unseen-runtime-cargo" />;
}

/** First-instantiation live pairing the lying variant republishes. */
export function FoldedMeasuredSeenLive() {
  return <FoldedMeasuredHost orientation="horizontal" id="seen-runtime-cargo" />;
}
