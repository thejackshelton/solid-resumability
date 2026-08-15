/**
 * The browser half's public surface.
 *
 * Everything reachable from here is zero-dependency and framework-free by
 * standing policy: it reads emitted artifacts, boots a component on first
 * touch, and defers the group until something asks for it. Nothing hydrates —
 * there is no second render of a tree the server already produced, so the
 * vocabulary is group activation, deferred render, first-touch boot.
 *
 * What is deliberately absent is the artifact registry bound to a *particular*
 * project's artifact directory. That binding is a glob over the consumer's own
 * output, so the consumer makes it; this package ships the machinery it feeds.
 */

export { createRegistry, isActionSlot } from '../../../src/resume/registry.ts';
export type {
  ActionCaptureSlotSpec,
  ActionSpec,
  BindingSpec,
  Bundle,
  CaptureSlotSpec,
  CellCaptureSlotSpec,
  CellSpec,
  HandlerModule,
  Registry,
  Slots,
  StoreSpec,
  TemplateArtifact,
  WiringSpec,
} from '../../../src/resume/registry.ts';

export { createStoreRegistry } from '../../../src/resume/stores.ts';
export type { SlotPath, StoreRegistry } from '../../../src/resume/stores.ts';

export { createIdentityRegistry } from '../../../src/resume/identities.ts';
export type { IdentityRegistry, SourceBindingIdentity } from '../../../src/resume/identities.ts';

export { createResumer, resumeBundle } from '../../../src/resume/resumer.ts';
export type { Cell, ResumeOptions, ResumeStats, ResumedApp } from '../../../src/resume/resumer.ts';

export { cellKernel, createSignal, flush, untrack } from '../../../src/resume/cells.ts';
export type { Accessor, CellBackend, Setter } from '../../../src/resume/cells.ts';

export { locate } from '../../../src/resume/locate.ts';

export {
  DEFAULT_DEFER_EVENTS,
  DEFAULT_DEFER_SIGNALS,
  deferGroup,
  pathTo,
} from '../../../src/resume/defer.ts';
export type {
  DeferOptions,
  DeferStats,
  DeferredGroup,
  QueuedEvent,
} from '../../../src/resume/defer.ts';
