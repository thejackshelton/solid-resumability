import { createSignal } from "solid-js";

/**
 * S2 — THE SPREAD THAT FOLLOWS AN ATTRIBUTE, on an ordinary intrinsic element.
 *
 * `id="a"` is in the AST and it is still not what the element carries: a later
 * spread wins, and what keys this one supplies is a property of a VALUE rather
 * than of any node. `annotate` is here to make that concrete instead of
 * rhetorical — one call from anywhere puts an `id` in the record, and the
 * literal above becomes a default that lost.
 *
 * This is S1's third requirement with the indirection taken away: the same
 * question about a key set, with nothing else in the way. The pass has no spread
 * machinery at all, so the attribute list is refused whole rather than reasoned
 * about in the part of it that is literal.
 */
const attributes: Record<string, string> = { class: "hot" };

export function annotate(key: string, value: string): void {
  attributes[key] = value;
}

function decorations(): Record<string, string> {
  return attributes;
}

export function SpreadAfterAttribute() {
  const [count, setCount] = createSignal(0);
  return (
    <div id="a" {...decorations()}>
      <button class="bump" onClick={() => setCount(count() + 1)}>
        {count()}
      </button>
    </div>
  );
}
