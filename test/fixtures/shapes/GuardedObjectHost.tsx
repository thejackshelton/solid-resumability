import { createMemo, createSignal } from "solid-js";

const KINDS = ["button", "color", "file"];

function isKind(element: { tagName: string; type?: string }) {
  const tagName = element.tagName.toLowerCase();
  if (tagName === "button") return true;
  if (tagName === "input" && element.type) return KINDS.indexOf(element.type) !== -1;
  return false;
}

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

type HostProps = { type?: string; disabled?: boolean };

export function GuardedObjectHost(props: HostProps = {}) {
  const [ref, setRef] = createSignal<Element | null>(null);
  const tagName = ownTag(ref, () => "button");
  const isNative = createMemo(() => {
    const elementTagName = tagName();
    if (elementTagName == null) return false;
    return isKind({ tagName: elementTagName, type: props.type });
  });
  const isInput = createMemo(() => {
    return tagName() === "input";
  });
  const isLink = createMemo(() => {
    return tagName() === "a" && ref()?.getAttribute("href") != null;
  });
  return (
    <button
      class="guarded-object"
      ref={[setRef]}
      type={(isNative() || isInput() ? props.type : undefined) as "button" | undefined}
      role={!isNative() && !isLink() ? "button" : undefined}
      tabindex={!isNative() && !isLink() && !props.disabled ? 0 : undefined}
      disabled={isNative() || isInput() ? props.disabled : undefined}
      aria-disabled={!isNative() && !isInput() && props.disabled ? "true" : undefined}
    />
  );
}
