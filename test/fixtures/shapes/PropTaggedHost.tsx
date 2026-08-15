import { createSignal } from "solid-js";
import { Dynamic } from "@solidjs/web";

/**
 * S1 — THE HOST TAG THAT ARRIVES AS A PROP, with a literal default the call site
 * writes and a later spread may shadow.
 *
 * `TaggedBox` decides nothing about its own element: `props.tag` becomes the
 * host through `<Dynamic>`, which re-resolves it reactively at runtime. The call
 * site writes `tag="p"` and then spreads a CALL RESULT after it, and in Solid's
 * JSX a later spread wins — so the literal in the AST is a DEFAULT and not the
 * answer.
 *
 * `retag` is what makes that a fact rather than a worry. One call from anywhere
 * puts a `tag` in the record the spread carries, and this section serves a
 * different element with the same source unchanged. Settling the tag at build
 * time therefore means proving a NEGATIVE about the key set of a function's
 * return value.
 */
const overrides: Record<string, string> = {};

export function retag(tag: string): void {
  overrides.tag = tag;
}

function decorate(): Record<string, string> {
  return overrides;
}

function TaggedBox(props: { tag: string; label: string }) {
  return <Dynamic component={props.tag}>{props.label}</Dynamic>;
}

export function PropTaggedHost() {
  const [count, setCount] = createSignal(0);
  return (
    <section class="tagged">
      <TaggedBox tag="p" {...decorate()} label="static" />
      <button class="bump" onClick={() => setCount(count() + 1)}>
        {count()}
      </button>
    </section>
  );
}
