import { createSignal } from "solid-js";

/**
 * The two new binding kinds, in the shape they were cut for.
 *
 * This is `TodoItem`'s row with its store taken out: the same
 * array-of-string-and-object `class`, the same `checked` on a checkbox, plus one
 * ordinary string attribute and one ordinary boolean attribute so all four
 * attribute endings are exercised by one cell. Nothing here is written for the
 * pass — it is the markup a Solid author writes, and the pass either folds it or
 * refuses it.
 *
 * `checked` is the interesting one: a checkbox's checkedness is a DOM property,
 * not its `checked` attribute, so the markup Solid renders carries no `checked`
 * at all and the resume side has to assign rather than call `setAttribute`.
 */
export function ToggleRow() {
  const [done, setDone] = createSignal(false);
  return (
    <li class={["todo", { completed: done(), pending: !done() }]}>
      <input class="toggle" type="checkbox" checked={done()} onInput={e => setDone(e.currentTarget.checked)} />
      <button class="destroy" title={`done: ${done()}`} disabled={done()} onClick={() => setDone(true)}>
        x
      </button>
    </li>
  );
}
