import { createSignal } from "solid-js";

/**
 * First-party hosts for mount-time own-element projection cells.
 * The helper's deferred write is a property chain or getAttribute of a
 * string literal on the getter argument. Nothing here names a library.
 */

function stringOrUndefined(value: unknown) {
  return typeof value === "string" ? value : void 0;
}

function ownTag(getEl: () => { tagName: string } | null | undefined, fallback: () => string) {
  const [tag, setTag] = createSignal(stringOrUndefined(fallback()));
  queueMicrotask(() => {
    setTag(getEl()?.tagName.toLowerCase() || stringOrUndefined(fallback()));
  });
  return tag;
}

function ownHref(getEl: () => { getAttribute: (name: string) => string | null } | null | undefined) {
  const [href, setHref] = createSignal<string | null>(null);
  queueMicrotask(() => {
    setHref(getEl()?.getAttribute("href") || null);
  });
  return href;
}

type HostProps = { extra?: (el: Element) => void };

/** Honest pairing: fallback differs from the live host tag. */
export function ElementProjectionHost(props: HostProps = {}) {
  const [ref, setRef] = createSignal<Element | null>(null);
  const tagName = ownTag(ref, () => "div");
  return (
    <button
      class="seen"
      ref={[setRef, props.extra]}
      data-kind={tagName() === "button" ? "native" : undefined}
    />
  );
}

/** Second instantiation: the same shape, class the build did not see first. */
export function ElementProjectionUnseen(props: HostProps = {}) {
  const [ref, setRef] = createSignal<Element | null>(null);
  const tagName = ownTag(ref, () => "div");
  return (
    <button
      class="unseen"
      ref={[setRef, props.extra]}
      data-kind={tagName() === "button" ? "native" : undefined}
    />
  );
}

/** getAttribute of a string literal on the own host. */
export function ElementProjectionAttrHost() {
  const [ref, setRef] = createSignal<Element | null>(null);
  const href = ownHref(ref);
  return <a class="attr" ref={[setRef]} href="/x" data-href={href() == null ? "no" : "yes"} />;
}
