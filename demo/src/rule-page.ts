/**
 * The resumable variant of the rule page.
 *
 * The page arrives with the folded intrinsic already in the document. This
 * module is the caller: it owns the live props object and the rest
 * projection, provides them at the mount site, and hands `{ stores, identities }`
 * to resume. No component body runs.
 */

import { createIdentityRegistry } from "../../src/resume/identities.ts";
import { createStoreRegistry } from "../../src/resume/stores.ts";
import type { ResumedApp } from "../../src/resume/resumer.ts";
import { resume } from "./rule-resume.ts";

export const stores = createStoreRegistry();
export const identities = createIdentityRegistry();

/**
 * The page's own props, and the rest it would pass as caller.
 *
 * Not a replay of `merge`/`omit` from the component body: the page chooses
 * vertical orientation and one rest attribute, and publishes those same
 * references. `mergedProps.ref` is nullish — a caller that passed no ref.
 */
const MERGED_PROPS = { orientation: "vertical" as const };
const OTHERS = { id: "rule-root" };

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
    identities.provide(host, { name: "mergedProps", path: ["orientation"] }, MERGED_PROPS);
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
