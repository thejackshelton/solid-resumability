/**
 * The oracle: `@solidjs/signals`, wrapped as a `CellBackend`.
 *
 * It lives in `test/` because that is all it is for: the equivalence
 * argument for the kernel is that the
 * whole resume path, run over this backend and over `cells.ts`, produces the
 * same observable outcomes from the same inputs. Nothing under `src/resume/`
 * imports it, and `test/resume-suite.ts` asserts that by reading the sources.
 *
 * The casts are the price of the subset. Solid's `createSignal` has three
 * overloads, one of which turns a *function* argument into a computed; the
 * kernel's `CellBackend` describes only the `createSignal(value)` one, which
 * is the only shape a cell spec can produce (initial values are literals the
 * comptime pass folded). The runtime object is Solid's own functions,
 * untouched.
 */

import { createSignal, flush, untrack } from "@solidjs/signals";

import { cellKernel, type Accessor, type CellBackend, type Setter } from "../src/resume/cells.ts";

export const signalsBackend: CellBackend = {
  createSignal: <T>(initial: T) =>
    createSignal(initial as Exclude<T, Function>) as unknown as [Accessor<T>, Setter<T>],
  flush,
  untrack: <T>(fn: () => T) => untrack(fn),
};

/**
 * The two backends, named.
 *
 * `test/cells.test.ts` runs both over the same scripted operation sequences
 * and compares transcripts. The resume path itself is run over both by
 * `test/resume.test.ts` and `test/resume-signals.test.ts` — two *files*,
 * because "this module was never imported" is a claim about a module
 * registry, and vitest gives one registry per file.
 */
export const KERNEL = { name: "cells.ts kernel", backend: cellKernel };
export const ORACLE = { name: "@solidjs/signals", backend: signalsBackend };
export const BACKENDS = [KERNEL, ORACLE];
