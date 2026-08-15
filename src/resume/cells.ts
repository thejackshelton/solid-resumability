/**
 * The resume path's reactive storage: signal pair, flush, untrack. Solid's
 * signals package cost 9.17 kB gzipped for those three, 83.9% of the eager
 * payload; it is named in prose only, never as a specifier, under `src/resume/`
 * — the zero-framework gate greps these sources for the specifier.
 *
 * The contract handlers were written against. BATCHING: a write is invisible to
 * every read until `flush()` settles. SHARING: the pair closes over one record,
 * so a second view of the same storage is unconstructible. UNTRACK: no observer
 * is ever installed, so suppression is the identity. UPDATERS: a value or a
 * function of the latest pending value (`typeof v === "function"` decides, as in
 * Solid); last write wins per cell per flush. FLUSH: pending writes settle in
 * write order across every cell, so no reader sees half a batch, plus Solid's
 * microtask drain. Change detection is Solid's `===` at write time, not
 * `Object.is`; they disagree on `-0` over `+0`, pinned by `test/cells.test.ts`.
 */

export type Accessor<T> = () => T;
export type Setter<T> = (value: T | ((previous: T) => T)) => T;

/** An interface so the suites can drive this same path over Solid's signals —
 * same inputs, same outcomes — which is the safety argument for shipping the
 * kernel at all. The oracle adapter is `test/cells-oracle.ts`. */
export interface CellBackend {
  createSignal<T>(initial: T): [Accessor<T>, Setter<T>];
  flush(): void;
  untrack<T>(fn: () => T): T;
}

interface CellState {
  /** Committed. Every read returns this; only `flush` moves it. */
  value: unknown;
  /** Latest write; equal to `value` whenever nothing is pending. */
  next: unknown;
  /** Already in `queued` — Solid queues a cell once. */
  dirty: boolean;
}

/** Cells with an uncommitted write, in the order they were first written. */
const queued: CellState[] = [];

let scheduled = false;

/** Solid's `schedule()`. The drain clears the flag rather than `flush()`, so an
 * explicit flush then another write stays covered by the microtask in flight. */
function schedule(): void {
  if (!scheduled) {
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      flush();
    });
  }
}

/** One cell: `[read, write]` over one record, batched until `flush()`. */
export function createSignal<T>(initial: T): [Accessor<T>, Setter<T>] {
  const cell: CellState = { value: initial, next: initial, dirty: false };

  return [
    () => cell.value as T,
    (value) => {
      // Measured against the pending value where there is one, as Solid does at
      // the top of `setSignal`.
      const previous = cell.next as T;
      const next = typeof value === "function" ? (value as (previous: T) => T)(previous) : value;
      // Unchanged: not stored, not queued, still returned. `NaN` counts as a
      // change and commits the same NaN, so it is unobservable; `-0` over `+0`
      // does not count, which is.
      if (next !== previous) {
        if (!cell.dirty) {
          cell.dirty = true;
          queued.push(cell);
        }
        cell.next = next;
        schedule();
      }
      return next;
    },
  ];
}

/** The loop re-reads `queued.length`, so a write made during the drain settles
 * here too: the queue is empty on return, which is what lets the resumer diff. */
export function flush(): void {
  for (let i = 0; i < queued.length; i++) {
    const cell = queued[i];
    cell.dirty = false;
    cell.value = cell.next;
  }
  queued.length = 0;
}

/** Reads without tracking. There is no tracking, so it is `fn()`. */
export function untrack<T>(fn: () => T): T {
  return fn();
}

/**
 * Write `value` into a cell through its setter. A function value is wrapped
 * so Solid's updater rule cannot eat it; every other value is stored as-is.
 * Resume hands the located element over this function rather than calling
 * `set` itself.
 */
export function cellWrite<T>(set: Setter<T>, value: T): T {
  return set(typeof value === "function" ? (() => value as T) : value);
}

/** The default backend: this module, as a `CellBackend`. */
export const cellKernel: CellBackend = { createSignal, flush, untrack };
