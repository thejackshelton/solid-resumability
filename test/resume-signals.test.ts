import { vi } from "vitest";

import { signalsBackend } from "./cells-oracle.ts";
import { resumeSuite } from "./resume-suite.ts";

/**
 * The resume path over `@solidjs/signals` — the oracle.
 *
 * Byte-for-byte the same suite as `resume.test.ts` runs, with the same probe
 * and the same loader hooks, over Solid's signals rather than the cell
 * kernel. It is the control: every claim the resume path makes — zero
 * component execution, one delegated listener, lazy handler imports, the
 * shared cell, the patched text, the refusals — has to hold on both backends,
 * or the two runs are not comparable and the equivalence argument is empty.
 *
 * If this file fails and `resume.test.ts` passes, the finding is about Solid
 * (or about the harness), not about the kernel. If both fail, it is about the
 * resumer. If only `resume.test.ts` fails, it is the kernel — which is the
 * whole point of running both.
 *
 * The duplicated `vi.mock` block is not shareable: it is hoisted to the top
 * of the file that calls it, and the load-order evidence it produces is a
 * property of this file's own module registry.
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

await resumeSuite({ backend: signalsBackend, backendName: "@solidjs/signals", probe });
