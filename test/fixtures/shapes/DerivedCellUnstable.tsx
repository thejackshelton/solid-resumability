import { createSignal } from "solid-js";

/**
 * Counter B: the factory initializer folds, but a call-site getter's setter
 * is also handler-wired, so the input is not mount-stable. Nothing here
 * names a library.
 */

function stringOrUndefined(value: unknown) {
  return typeof value === "string" ? value : void 0;
}

function ownTag(get: () => unknown, fallback: () => string) {
  const [tag, setTag] = createSignal(stringOrUndefined(fallback?.()));
  queueMicrotask(() => {
    void get();
    setTag(stringOrUndefined(fallback?.()));
  });
  return tag;
}

export function DerivedCellUnstable() {
  const [n, setN] = createSignal(0);
  const tagName = ownTag(n, () => "hr");
  return (
    <p class="unstable">
      <hr data-tag={tagName() !== "hr" ? "sep" : undefined} />
      <button class="bump" onClick={() => setN(1)}>
        +
      </button>
    </p>
  );
}
