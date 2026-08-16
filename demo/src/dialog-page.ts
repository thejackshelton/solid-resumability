/**
 * The resumable variant of the dialog page.
 *
 * Stores, identities and resume live here. The live DialogRoot does not: its
 * module (`dialog-provider.ts`) is reached by one dynamic `import()` when a
 * resumed dispatch misses a store. This file must not import the library or
 * the renderer — that would put them on the eager entry.
 */

import { createIdentityRegistry } from "../../src/resume/identities.ts";
import { createStoreRegistry } from "../../src/resume/stores.ts";
import type { ResumedApp } from "../../src/resume/resumer.ts";
import { resume } from "./dialog-resume.ts";

export const stores = createStoreRegistry();
export const identities = createIdentityRegistry();

const MERGED_PROPS = { type: "button" as const };
const OTHERS = { id: "dialog-trigger" };

/** Page-owned stand-in for the imported callee the proven-handler body names.
 * Same contract as the library helper: call a function handler, ignore a miss. */
function callHandler(event: Event, handler?: ((event: Event) => void) | undefined): void {
  if (typeof handler === "function") handler(event);
}

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
    identities.provide(host, { name: "p", path: ["ref"] }, undefined);
    identities.provide(host, { name: "p", path: ["onClick"] }, undefined);
    identities.provide(host, { name: "callHandler", path: [] }, callHandler);

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
