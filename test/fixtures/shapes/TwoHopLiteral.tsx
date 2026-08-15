import { createSignal } from "solid-js";

/**
 * S3 — A LITERAL THAT WOULD FOLD, TWO PROPS HOPS DOWN.
 *
 * Nothing here is undecidable. `"settled"` is a literal in the AST; `Middle`
 * carries it through one props boundary unchanged and `Leaf` puts it in a text
 * position the derivation walk folds. The value is knowable at build time by
 * inspection, and the whole distance between here and a provable component is
 * the pass's own one-hop rule: `Middle` names `Leaf`, and naming a component
 * captures its binding.
 *
 * This is the CONTINGENT row. The evidence a second hop needs is present; what
 * is absent is machinery, not knowledge.
 */
function Leaf(props: { text: string }) {
  return <span class="leaf">{props.text}</span>;
}

function Middle(props: { text: string }) {
  return (
    <em class="middle">
      <Leaf text={props.text} />
    </em>
  );
}

export function TwoHopLiteral() {
  const [count, setCount] = createSignal(0);
  return (
    <section class="two-hop">
      <Middle text="settled" />
      <button class="bump" onClick={() => setCount(count() + 1)}>
        {count()}
      </button>
    </section>
  );
}
