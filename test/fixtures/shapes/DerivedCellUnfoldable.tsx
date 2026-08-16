import { createSignal } from "solid-js";

/**
 * Counter A: the factory initializer reads a getter parameter, so the
 * initial does not fold to a literal. The getter's setter is only in an
 * array-ref, so the mount-stable clause still holds. Nothing here names a
 * library.
 */

function ownFromGetter(get: () => string | null | undefined) {
  const [tag, setTag] = createSignal(get());
  queueMicrotask(() => {
    setTag("hr");
  });
  return tag;
}

export function DerivedCellUnfoldable() {
  const [ref, setRef] = createSignal<string | null>("x");
  const tagName = ownFromGetter(ref);
  return <hr class="unfoldable" ref={[setRef]} data-tag={tagName() === "hr" ? "ok" : "no"} />;
}
