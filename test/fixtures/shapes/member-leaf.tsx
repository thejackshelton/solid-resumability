/**
 * Inlinable leaf for the member-expression resolution hosts. One intrinsic
 * return, no cells. Nothing here names a library component.
 */
export function Leaf(props: { class?: string }) {
  return <span class={props.class}>ok</span>;
}

/** Exported, but not a component — the unresolvable-member counter. */
export function Missing(_props: { class?: string }): any {
  return 0;
}
