/**
 * The artifact module map: what the resume path may know about a component
 * before anything happens on the page. Three modules per component load eagerly
 * — `template.js` (the served markup), `structure.js` (cells and cell -> DOM
 * bindings), `wiring.js` (locator + event -> handler module) — all plain data
 * and pure functions, with no framework import and no line of the component's
 * behaviour. Handler modules load LAZILY, one `import()` each, only when an
 * event needs one. That split is the spike's whole claim, so it is two globs
 * rather than a hand-written list: the eager glob cannot reach into `handlers/`,
 * and the lazy glob cannot resolve without a wiring record asking. Keeping them
 * out of `registry.ts` is the point — an eager glob makes those artifacts a
 * static dependency of every importer, and the resumer must not be one.
 */

export type {
  BindingSpec,
  Bundle,
  CaptureSlotSpec,
  CellSpec,
  HandlerModule,
  Registry,
  Slots,
  TemplateArtifact,
  WiringSpec,
} from "./registry.ts";

import { createRegistry, type Bundle, type HandlerModule } from "./registry.ts";

/** `*` never crosses a `/` in a Vite glob: exactly the three top-level artifact modules per component, never `handlers/*`. */
const STATIC_MODULES = import.meta.glob<Record<string, unknown>>("../../artifacts/*/*.js", {
  eager: true,
});

/** Vite compiles this to `() => import(...)` thunks; none is called here. */
const HANDLER_MODULES = import.meta.glob<HandlerModule>("../../artifacts/*/handlers/*.js");

const REGISTRY = createRegistry(STATIC_MODULES, HANDLER_MODULES);

/** The registry over this repo's own emitted artifacts. */
export function artifactRegistry() {
  return REGISTRY;
}

/** Every component the comptime pass proved, in stable order. */
export function listBundles(): string[] {
  return REGISTRY.list();
}

/** The artifacts for one component, or `undefined` when it has none. */
export function getBundle(component: string): Bundle | undefined {
  return REGISTRY.get(component);
}
