import { createSignal } from "solid-js";

/**
 * First-party hosts for derived-cell admission. A helper allocates its own
 * cell from a folded fallback, writes through that setter inside a deferred
 * opaque-scheduler closure, and returns the getter. Nothing here names a
 * library.
 */

function stringOrUndefined(value: unknown) {
  return typeof value === "string" ? value : void 0;
}

function ownTag(getEl: () => { tagName?: string } | null | undefined, fallback: () => string) {
  const [tag, setTag] = createSignal(stringOrUndefined(fallback?.()));
  queueMicrotask(() => {
    const el = getEl();
    setTag(el && typeof el.tagName === "string" ? el.tagName.toLowerCase() : stringOrUndefined(fallback?.()));
  });
  return tag;
}

function ownMoving(fallback: () => string) {
  const [tag, setTag] = createSignal(stringOrUndefined(fallback?.()));
  queueMicrotask(() => setTag("b"));
  return tag;
}

type HostProps = { extra?: (el: Element) => void };

/** Honest pairing: attribute compute over the returned getter plus array-ref fan-out. */
export function DerivedCellHost(props: HostProps = {}) {
  const [ref, setRef] = createSignal<Element | null>(null);
  const tagName = ownTag(ref, () => "hr");
  return (
    <hr
      class="seen"
      ref={[setRef, props.extra]}
      role={tagName() !== "hr" ? "separator" : undefined}
    />
  );
}

/** Second instantiation: the same shape, class the build did not see first. */
export function DerivedCellUnseen(props: HostProps = {}) {
  const [ref, setRef] = createSignal<Element | null>(null);
  const tagName = ownTag(ref, () => "hr");
  return (
    <hr
      class="unseen"
      ref={[setRef, props.extra]}
      role={tagName() !== "hr" ? "separator" : undefined}
    />
  );
}

/** Injection proof: deferred write moves the output away from the folded initial. */
export function DerivedCellDrift() {
  const [ref, setRef] = createSignal<Element | null>(null);
  const tagName = ownMoving(() => "a");
  return <hr class="drift" ref={[setRef]} data-tag={tagName() === "b" ? "moved" : "init"} />;
}
