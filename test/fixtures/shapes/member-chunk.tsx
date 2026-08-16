/**
 * Named export of a namespace object whose member is a zero-arg thunk to
 * an inlinable leaf — the hashed-chunk shape, without a library name.
 */
function Leaf(props: { class?: string }) {
  return <span class={props.class}>ok</span>;
}

const parts = Object.assign({
  Leaf: () => Leaf,
});

export { parts as n };
