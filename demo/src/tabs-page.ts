/**
 * The resumable variant of the tabs page.
 *
 * Stores, identities and resume live here. The live TabsRoot does not: its
 * module (`tabs-provider.ts`) is reached by one dynamic `import()` when a
 * dispatch misses a store. This file must not import the library or the
 * renderer — that would put them on the eager entry.
 *
 * TabsTrigger is not a twelve-member flip (T090 Ruling 1). The resumed
 * region is a first-party button (T089 §(iv)); the library tree mounts
 * only after the miss.
 */

import { createIdentityRegistry } from "../../src/resume/identities.ts";
import { createStoreRegistry } from "../../src/resume/stores.ts";

export const stores = createStoreRegistry();
export const identities = createIdentityRegistry();

/** Page-owned store id. The provider `provide`s the library context here. */
export const TABS_STORE_ID = "tabs";

export interface MountedPage {
  resumed: [];
  fellBack: string[];
  dispose(): void;
}

export async function resumeAll(root: ParentNode = document): Promise<MountedPage> {
  const fellBack: string[] = [];
  const disposers: Array<() => void> = [];

  // Passive: a load-path miss must not fire onMissing (T087 Ruling 2).
  stores.park(TABS_STORE_ID, () => {});

  for (const host of root.querySelectorAll<HTMLElement>("[data-component]")) {
    if (!host.dataset.resume) fellBack.push(host.dataset.component!);

    const button = host.matches("[data-tabs-dispatch]")
      ? host.querySelector<HTMLButtonElement>("button")
      : null;
    if (!button) continue;

    const onWake = () => {
      void stores.whenProvided(TABS_STORE_ID);
    };
    button.addEventListener("click", onWake);
    disposers.push(() => button.removeEventListener("click", onWake));
  }

  return {
    resumed: [],
    fellBack,
    dispose() {
      while (disposers.length) disposers.pop()!();
    },
  };
}
