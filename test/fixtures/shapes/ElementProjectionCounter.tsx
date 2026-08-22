import { createSignal } from "solid-js";

/**
 * Counters for own-element projection admission. Each satisfies the
 * surrounding shape except one clause. Nothing here names a library.
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

function ownAttr(
  getEl: () => { getAttribute: (name: string) => string | null } | null | undefined,
  name: string,
) {
  const [value, setValue] = createSignal<string | null>(null);
  queueMicrotask(() => {
    setValue(getEl()?.getAttribute(name) ?? null);
  });
  return value;
}

/** Projects a nested element's ref, not the mount's own host. */
export function ElementProjectionOther() {
  const [host, setHost] = createSignal<Element | null>(null);
  const [other, setOther] = createSignal<Element | null>(null);
  const tagName = ownTag(other, () => "button");
  return (
    <div class="other">
      <button ref={[setHost]} data-kind={tagName() === "button" ? "native" : "custom"} />
      <span ref={[setOther]} />
    </div>
  );
}

/** getAttribute whose argument is a parameter, not a string literal. */
export function ElementProjectionNonLiteral() {
  const [ref, setRef] = createSignal<Element | null>(null);
  const href = ownAttr(ref, "href");
  return <a class="nonlit" ref={[setRef]} href="/x" data-href={href() == null ? "no" : "yes"} />;
}

/** Projection cell is also read by a handler. */
export function ElementProjectionHandler() {
  const [ref, setRef] = createSignal<Element | null>(null);
  const tagName = ownTag(ref, () => "div");
  return (
    <button
      class="handler"
      ref={[setRef]}
      data-kind={tagName() === "button" ? "native" : "custom"}
      onClick={() => {
        void tagName();
      }}
    />
  );
}
