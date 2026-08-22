/**
 * The dialog page's artifact registry: the trigger directory whose stem is
 * the installed defining module, and the record-qualified claimed child.
 *
 * Kept off `src/resume.ts` so the fixtures eager glob cannot pick these
 * directories up. The `~` suffix is the glob fence against `*.ButtonRoot`.
 */

import { createRegistry, type HandlerModule } from "../../src/resume/registry.ts";
import { createResumer } from "../../src/resume/resumer.ts";

const STATIC_MODULES = import.meta.glob<Record<string, unknown>>(
  [
    "../artifacts/*.DialogTrigger/structure.js",
    "../artifacts/*.DialogTrigger/wiring.js",
    "../artifacts/*.ButtonRoot~*/structure.js",
    "../artifacts/*.ButtonRoot~*/wiring.js",
  ],
  { eager: true },
);

const HANDLER_MODULES = import.meta.glob<HandlerModule>([
  "../artifacts/*.DialogTrigger/handlers/*.js",
  "../artifacts/*.ButtonRoot~*/handlers/*.js",
]);

export const registry = createRegistry(STATIC_MODULES, HANDLER_MODULES);

/** Resumes the dialog page's mounts from this build's artifacts. */
export const resume = createResumer(registry);
