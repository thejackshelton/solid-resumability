// Entry point of the dialog page, resumable variant. Substituted for
// `dialog-classic.ts` by the plugin's HTML stage, which also inlines the
// emitted template into the page's `.mount`.
//
// The live DialogRoot is not on this graph. A resumed dispatch that misses
// a store starts exactly one dynamic import of the provider module; that
// module mounts the library's own body and `provide`s the value it created.
import { resumeAll, stores } from "../dialog-page.ts";

/**
 * The provider partition, behind the page's one provider `import()`.
 *
 * Idempotent by construction, which `onMissing` requires: the module system
 * answers a second call from the first call's record, and `mountProvider`
 * treats a second mount as a no-op. Two dispatches racing for a store that
 * does not exist yet therefore produce one fetch and one live DialogRoot.
 */
let arriving: Promise<void> | null = null;

function mountLiveProvider(): Promise<void> {
  return (arriving ??= import("../dialog-provider.ts").then((module) => {
    module.mountProvider();
  }));
}

stores.onMissing(() => void mountLiveProvider());
void resumeAll();
