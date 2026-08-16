/**
 * The resumable variant of the click page.
 *
 * The page arrives with the folded intrinsic already in the document. This
 * module is the caller: it owns the live props object and the rest
 * projection, provides them at the mount site, and hands `{ stores, identities }`
 * to resume. No component body runs.
 */

import { createIdentityRegistry } from "../../src/resume/identities.ts";
import { createStoreRegistry } from "../../src/resume/stores.ts";
import type { ResumedApp } from "../../src/resume/resumer.ts";
import { resume } from "./click-resume.ts";

export const stores = createStoreRegistry();
export const identities = createIdentityRegistry();

/**
 * The page's own props, and the rest it would pass as caller.
 *
 * Not a replay of `merge`/`omit` from the component body: the page chooses
 * `type="button"`, a rest id, and a page-owned click handler, and publishes
 * those same references. `mergedProps.ref` is nullish — a caller that passed
 * no ref. `onclick` is the same function under the HTML handler property so
 * the measured rest-spread assign (`Object.assign`) actually listens.
 */
const MERGED_PROPS = { type: "button" as const };

/** Sets `data-clicked="1"` on the page-owned sentinel outside the mount. */
export function onClick(): void {
  document.querySelector("[data-click-sentinel]")?.setAttribute("data-clicked", "1");
}

const OTHERS = { id: "click-root", onClick, onclick: onClick };

export interface MountedPage {
  resumed: ResumedApp[];
  fellBack: string[];
  dispose(): void;
}

export async function resumeAll(root: ParentNode = document): Promise<MountedPage> {
  const resumed: ResumedApp[] = [];
  const fellBack: string[] = [];
  const disposers: Array<() => void> = [];

  for (const host of root.querySelectorAll<HTMLElement>("[data-component]")) {
    identities.provide(host, { name: "mergedProps", path: ["type"] }, MERGED_PROPS);
    identities.provide(host, { name: "mergedProps", path: ["disabled"] }, MERGED_PROPS);
    identities.provide(host, { name: "mergedProps", path: ["ref"] }, undefined);
    identities.provide(host, { name: "others", path: [] }, OTHERS);

    const app = host.dataset.resume
      ? resume(host, host.dataset.resume, { stores, identities })
      : null;
    if (app) {
      resumed.push(app);
      disposers.push(() => app.dispose());
    } else {
      fellBack.push(host.dataset.component!);
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
