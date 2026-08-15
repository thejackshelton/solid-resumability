import { onCleanup } from "solid-js";

import { usePanel } from "./panel-context.ts";

/**
 * S5 — A LEAF WHOSE ONLY STATE ARRIVES FROM A PROVIDER, read through a local
 * wrapper.
 *
 * There is no `createSignal` here and there is no `useContext` here either: the
 * leaf calls `usePanel()`, which is where the context read lives. So the pass's
 * search for a declared source comes back empty on BOTH counts, and the
 * component is refused for having nothing to resume — before anything about
 * providers, instances or slots is ever reached.
 *
 * The markup is static on purpose. The refusal below is about the SOURCE, and a
 * fixture whose markup also refused would not isolate it.
 */
export function ContextOnlyLeaf() {
  const panel = usePanel();
  onCleanup(() => panel.release());

  return <p class="leaf">idle</p>;
}
