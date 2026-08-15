/**
 * The classic variant of the fixtures page.
 *
 * Ordinary Solid 2.0: `render()` per mount point, exactly as `app/src/main.tsx`
 * does it. The page's HTML arrives with four empty `.mount` divs and the
 * browser fills them by running four component bodies, which means the
 * renderer and the components have to be on the wire before anything is on
 * the screen.
 *
 * Kept out of `pages/` so a test can drive it without the page's side effect,
 * and — more importantly — so a test can decide *when* these five component
 * modules first evaluate. Importing this module is what loads them.
 *
 * ── The two things the roster added, both of them costs ───────────────────
 * The document carries the roster's items (see `demo/fixtures.html`), and this
 * path throws them away: `render()` builds its own nodes, so the mount is
 * cleared before the component runs. That is not a workaround, it is the
 * comparison — the classic variant pays to produce markup the browser was
 * already holding.
 *
 * And the store is seeded before anything mounts, because the classic path
 * creates it inside `Roster` the moment the component runs. Same members, same
 * factory, same module the resumable page fetches later; the difference the
 * measurement is about is that this side has them before it can paint.
 */

import { render } from "@solidjs/web";

import { COMPONENTS } from "./components.ts";
import { seedRosterStore } from "./roster-store.ts";

export function mountAll(root: ParentNode = document): () => void {
  const disposers: Array<() => void> = [];

  seedRosterStore();

  for (const host of root.querySelectorAll<HTMLElement>("[data-component]")) {
    const name = host.dataset.component!;
    const component = COMPONENTS[name];
    if (!component) throw new Error(`demo: no component named ${name}`);
    // Whatever the document carried here is the resumable variant's payload,
    // and this variant has no use for it: `render()` inserts beside existing
    // children rather than replacing them, so a mount left as served would show
    // the served list AND the rendered one.
    host.replaceChildren();
    disposers.push(render(component as never, host));
  }

  return () => {
    while (disposers.length) disposers.pop()!();
  };
}
