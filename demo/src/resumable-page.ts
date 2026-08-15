/**
 * The resumable variant of the fixtures page.
 *
 * The page arrives with the markup already in it. This module walks the same
 * `.mount` divs the classic variant renders into and hands each one to the
 * resumer, which installs one delegated listener per wired event type and
 * then stops. No component body runs — not now, not after the first click,
 * not ever on this page.
 *
 * The fallback branch is the mixed-page path, spelled out rather than
 * hypothesised: a component the comptime pass refused has no artifacts, so
 * `resume` returns `null` and the page needs the ordinary Solid runtime for
 * it. That runtime is reached through a dynamic `import()`, which is what
 * keeps it off the wire when — as here — every component on the page is
 * provable. On this page the branch is never taken, and the classic renderer
 * sits in the build as a chunk nobody fetches. The measurement lists it.
 *
 * ── The one store on this page, and when it arrives ───────────────────────
 * `RosterList` reads its list from a store its own provider creates, and the
 * provider is a component this page never runs. So the store is UNPROVIDED at
 * load — deliberately, because a store provided at load is a store whose bytes
 * were on the wire before anything asked for them. `onMissing` below is the
 * page's standing answer: the first dispatch from inside the list asks the
 * registry for `s0`, the registry reports the miss here, one dynamic `import()`
 * fetches the store partition, and the dispatch — still in its arrival position
 * in the resumed component's queue — runs against the store that import
 * produced.
 *
 * Everything behind that import is framework-free: the demo's seed and the
 * corpus's own `createRoster()`, which imports nothing. That is claim 7a of
 * `scripts/check-zero-eager.mjs`, and it is the reason this page can fetch a
 * store without fetching a renderer.
 */

import { createStoreRegistry } from "../../src/resume/stores.ts";
import { resume } from "./resume.ts";
import type { IdentityRegistry } from "../../src/resume/identities.ts";
import type { ResumedApp } from "../../src/resume/resumer.ts";

/**
 * One registry per page: the live stores this page's components dispatch to.
 *
 * Exported so a test can read what was provided and when. The page itself never
 * touches it after the wiring below — a resumed component asks it for a store,
 * and a store arrives.
 */
export const stores = createStoreRegistry();

/**
 * The store partition, behind the page's one store `import()`.
 *
 * Idempotent by construction, which `onMissing` requires: the module system
 * answers a second call from the first call's record, and `provide` treats a
 * re-registration of the same value as a no-op. Two dispatches racing for a
 * store that does not exist yet therefore produce one fetch and one store.
 */
let arriving: Promise<void> | null = null;

function provideRoster(id: string): Promise<void> {
  return (arriving ??= import("./roster-store.ts").then((module) => {
    stores.provide(id, module.createSeededRoster());
  }));
}

// The page's standing answer to "a dispatch wants a store that does not exist
// yet". Registered before anything can be resumed, so no event can arrive in
// front of it: `whenProvided` enters its wait BEFORE it notifies, and the
// dispatch resolves its slots only once this promise has landed.
stores.onMissing((id) => void provideRoster(id));

export interface MountedPage {
  /** One entry per resumed component, in document order. */
  resumed: ResumedApp[];
  /** Components with no artifacts — rendered the ordinary way. */
  fellBack: string[];
  dispose(): void;
}

export async function resumeAll(
  root: ParentNode = document,
  options?: { identities?: IdentityRegistry },
): Promise<MountedPage> {
  const resumed: ResumedApp[] = [];
  const fellBack: string[] = [];
  const pending: Array<{ host: HTMLElement; name: string }> = [];

  for (const host of root.querySelectorAll<HTMLElement>("[data-component]")) {
    // `data-resume` is the artifact id the build stamped into the markup;
    // `data-component` is the name the ordinary path knows the component by.
    // They differ whenever the component's file is not named after it.
    const app = host.dataset.resume
      ? resume(host, host.dataset.resume, { stores, identities: options?.identities })
      : null;
    if (app) resumed.push(app);
    else pending.push({ host, name: host.dataset.component! });
  }

  const disposers: Array<() => void> = resumed.map((app) => () => app.dispose());

  if (pending.length > 0) {
    // The ordinary path, and everything it drags with it (`solid-js`,
    // `@solidjs/web`, the component modules), behind one `import()`.
    const { renderFallback } = await import("./fallback.ts");
    for (const { host, name } of pending) {
      fellBack.push(name);
      disposers.push(renderFallback(host, name));
    }
  }

  return {
    resumed,
    fellBack,
    dispose() {
      while (disposers.length) disposers.pop()!();
    },
  };
}
