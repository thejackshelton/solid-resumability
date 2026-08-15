import { vi } from "vitest";

import { cellKernel } from "../src/resume/cells.ts";
import { resumeSuite } from "./resume-suite.ts";

/**
 * The resume path over the cell kernel — the backend that ships.
 *
 * The suite itself is `resume-suite.ts`, which documents what it asserts and
 * why it is a module rather than a `describe.each`. What cannot be shared
 * lives here: `vi.mock` is hoisted to the top of the *file* that calls it and
 * its factories run once per module registry, and vitest gives one registry
 * per test file. So the probe and the loader hooks live here,
 * `resume-signals.test.ts` has an identical pair for the oracle, and the two
 * runs are genuinely independent readings rather than one reading and one
 * echo of it.
 *
 * Nothing is relaxed on either side. If the kernel and `@solidjs/signals`
 * disagreed about batching, updaters, sharing or flush ordering, one of these
 * two files would fail on the assertion the disagreement reached — and the
 * clause-level comparison of the two backends, on inputs the artifacts do not
 * happen to produce, is `cells.test.ts`.
 */

const probe = vi.hoisted(() => ({
  /** Module ids, in evaluation order. */
  loads: [] as string[],
  /** The capture slots each handler module was created with. */
  slots: new Map<string, Record<string, unknown>>(),
}));

vi.mock("../src/fixtures/CounterA.tsx", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  probe.loads.push("src/fixtures/CounterA.tsx");
  return original;
});

vi.mock("../src/fixtures/CounterB.tsx", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  probe.loads.push("src/fixtures/CounterB.tsx");
  return original;
});

/** Wraps a handler module: records its load, and the slots it was bound to. */
function handlerHook(id: string) {
  return async (importOriginal: () => Promise<Record<string, unknown>>) => {
    const original = await importOriginal();
    probe.loads.push(`artifacts/CounterA/handlers/${id}.js`);
    const create = original.create as (slots: Record<string, unknown>) => (event: Event) => void;
    return {
      ...original,
      create(slots: Record<string, unknown>) {
        probe.slots.set(id, slots);
        return create(slots);
      },
    };
  };
}

vi.mock("../artifacts/CounterA/handlers/s0.js", handlerHook("s0"));
vi.mock("../artifacts/CounterA/handlers/s1.js", handlerHook("s1"));

await resumeSuite({ backend: cellKernel, backendName: "cells.ts kernel", probe });
