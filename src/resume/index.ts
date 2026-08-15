/**
 * The resume path bound to this repo's own artifacts: `resume(container,
 * "CounterA")`. The work is elsewhere — `resumer.ts` is the runtime, and
 * `artifacts.ts` the glob over `artifacts/*` the tests resume from. The join
 * sits here so a DIFFERENT build can take the runtime without dragging these
 * artifacts along (`demo/` supplies its own glob and imports `resumer.ts`).
 */

import { artifactRegistry } from "./artifacts.ts";
import { createResumer } from "./resumer.ts";

export { getBundle, listBundles, artifactRegistry } from "./artifacts.ts";
export type { Bundle, Registry } from "./artifacts.ts";
export { createRegistry, isActionSlot, isIdentitySlot } from "./registry.ts";
export type {
  ActionCaptureSlotSpec,
  ActionSpec,
  CaptureSlotSpec,
  CellCaptureSlotSpec,
  IdentityCaptureSlotSpec,
  StoreSpec,
} from "./registry.ts";
export { createStoreRegistry } from "./stores.ts";
export type { SlotPath, StoreRegistry } from "./stores.ts";
export { createIdentityRegistry } from "./identities.ts";
export type { IdentityRegistry, SourceBindingIdentity } from "./identities.ts";
export { createResumer, resumeBundle } from "./resumer.ts";
export type { Cell, ResumeOptions, ResumeStats, ResumedApp } from "./resumer.ts";
export { cellKernel, cellWrite, createSignal, flush, untrack } from "./cells.ts";
export type { Accessor, CellBackend, Setter } from "./cells.ts";

/** Resumes `component` inside `container`; `null` where it has no artifacts. */
export const resume = createResumer(artifactRegistry());
