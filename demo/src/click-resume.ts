/**
 * The click page's artifact registry: the one emitted directory whose stem
 * is the installed defining module.
 *
 * Kept off `src/resume.ts` so the fixtures eager glob cannot pick this
 * directory up — that page's cap has no headroom for a second artifact.
 * The glob is by suffix so a content-hashed stem is never written here.
 */

import { createRegistry, type HandlerModule } from "../../src/resume/registry.ts";
import { createResumer } from "../../src/resume/resumer.ts";

const STATIC_MODULES = import.meta.glob<Record<string, unknown>>(
  ["../artifacts/*.ButtonRoot/structure.js", "../artifacts/*.ButtonRoot/wiring.js"],
  { eager: true },
);

const HANDLER_MODULES = import.meta.glob<HandlerModule>("../artifacts/*.ButtonRoot/handlers/*.js");

export const registry = createRegistry(STATIC_MODULES, HANDLER_MODULES);

/** Resumes the click page's one component from this build's artifacts. */
export const resume = createResumer(registry);
