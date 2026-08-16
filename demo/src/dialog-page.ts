/**
 * The resumable variant of the dialog page.
 *
 * A live DialogRoot (the library's own body) paints into the page-owned live
 * region. Page-owned glue inside its children reads the public hook and
 * publishes that value by identity under every id `bundle.stores` names,
 * then the served trigger and claimed-child mounts resume. No component
 * body of the trigger runs; the page never constructs a context object.
 */

import { render } from "@solidjs/web";
import { Content as DialogContent, Root as DialogRoot, useDialogContext } from "@kobalte/core/dialog";

import { createIdentityRegistry } from "../../src/resume/identities.ts";
import { createStoreRegistry } from "../../src/resume/stores.ts";
import type { ResumedApp } from "../../src/resume/resumer.ts";
import { registry, resume } from "./dialog-resume.ts";

export const stores = createStoreRegistry();
export const identities = createIdentityRegistry();

const MERGED_PROPS = { type: "button" as const };
const OTHERS = { id: "dialog-trigger" };

/** Page-owned stand-in for the imported callee the proven-handler body names.
 * Same contract as the library helper: call a function handler, ignore a miss. */
function callHandler(event: Event, handler?: ((event: Event) => void) | undefined): void {
  if (typeof handler === "function") handler(event);
}

let provided = false;

function DialogGlue() {
  const context = useDialogContext();
  for (const artifact of registry.list()) {
    const bundle = registry.get(artifact);
    if (!bundle) continue;
    for (const declared of bundle.stores) stores.provide(declared.id, context);
  }
  provided = true;
  return DialogContent({ children: () => "Dialog content" });
}

export function mountProvider(root: ParentNode = document): void {
  const live = root.querySelector<HTMLElement>("[data-dialog-live]");
  if (!live) throw new Error("dialog: the served page has no [data-dialog-live] region");
  render(
    () =>
      DialogRoot({
        children: () => DialogGlue(),
      }),
    live,
  );
  if (!provided) {
    throw new Error("dialog: the live DialogRoot did not run the page-owned glue");
  }
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
