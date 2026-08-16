/**
 * The live DialogRoot, behind the dialog page's one provider `import()`.
 *
 * A miss on the store registry starts that import. This module mounts the
 * library's own body into the page-owned live region and publishes the
 * context value that body created — by identity, under every id
 * `bundle.stores` names. The page never constructs a context object.
 */

import { render } from "@solidjs/web";
import { Content as DialogContent, Root as DialogRoot, useDialogContext } from "@kobalte/core/dialog";

import { stores } from "./dialog-page.ts";
import { registry } from "./dialog-resume.ts";

let provided = false;
let mounted = false;

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
  if (mounted) return;
  const live = root.querySelector<HTMLElement>("[data-dialog-live]");
  if (!live) throw new Error("dialog: the served page has no [data-dialog-live] region");
  render(
    () =>
      DialogRoot({
        children: () => DialogGlue(),
      }),
    live,
  );
  mounted = true;
  if (!provided) {
    throw new Error("dialog: the live DialogRoot did not run the page-owned glue");
  }
}
