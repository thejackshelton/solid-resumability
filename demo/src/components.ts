/**
 * The fixture components the page's markup calls for, by the name it calls them.
 *
 * Six entries for six mounts. `ComposedInner` is deliberately absent: the
 * classic path reaches it the way Solid reaches any child — `ComposedOuter`'s
 * own JSX renders it — so registering it here would be a second mount for a
 * component this page mounts once. The resumable path is where the child has an
 * address of its own, and that address is the compiler's, not this map's.
 *
 * These imports are the *ordinary* Solid path: they are what the classic
 * variant ships, and what the resumable variant's fallback chunk would ship
 * if one of these components stopped being provable. Nothing here is demo
 * code — the sources live in `app/src/fixtures/`, the frozen corpus, and are
 * imported read-only.
 *
 * Anything that imports this module has, by that fact, put five component
 * bodies into its bundle. The resumable page reaches it only through a
 * dynamic `import()` it never makes.
 *
 * ── What the roster costs this map, stated rather than engineered around ──
 * `Roster` is registered here the ordinary way, and it is the first entry that
 * makes this module reach a STORE: it creates one, so it drags in the context
 * and store machinery every other component on this page leaves behind. The
 * fallback graph honestly grows, and the gate grew with it rather than around
 * it — `scripts/check-zero-eager.mjs` claim 7 used to say the fallback graph
 * reached no store-partition module at all, and now says the two things that
 * are actually true: nothing the resumable page can fetch WITHOUT falling back
 * carries one (7a), and the ones the fallback graph does reach are a frozen,
 * itemized list (7b). A carrier registered anywhere but here would have kept
 * the old claim green by emptying it.
 */

import { ProvableCounter } from "../../app/src/fixtures/ProvableCounter";
import { ProvableGreeting } from "../../app/src/fixtures/ProvableGreeting";
import { ProvableStepper } from "../../app/src/fixtures/ProvableStepper";
import { PropsPairParent } from "../../app/src/fixtures/PropsPair";
import { Roster } from "../../app/src/fixtures/KeyedRoster";
import { ComposedOuter } from "../../app/src/fixtures/ComposedCounter";

export const COMPONENTS: Record<string, () => unknown> = {
  ProvableCounter,
  ProvableStepper,
  ProvableGreeting,
  PropsPairParent,
  /** The PARENT only. Rendering it runs its child too — that is what a
   * component child is on the ordinary path, and it is the thing the resumable
   * variant replaces with an address. */
  ComposedOuter,
  /** The PROVIDER, not the list: the classic path needs the store created
   * before `RosterList` can read it, and creating it is what the provider is.
   * The resume path takes over the list inside it and never runs either. */
  Roster,
};
