import { describe, expect, it } from "vitest";

import type { CellBackend } from "../src/resume/cells.ts";
import { BACKENDS, KERNEL, ORACLE } from "./cells-oracle.ts";

/**
 * The cell kernel, against the runtime it replaces.
 *
 * `src/resume/cells.ts` exists because the resume path needed three functions
 * out of `@solidjs/signals` and was paying 9.17 kB gzipped for them. Removing
 * a dependency by rewriting it is only safe if the rewrite behaves the same,
 * so the safety argument is mechanical rather than argued: every program
 * below is run twice, once per backend, and the two transcripts must be equal
 * — *and* each transcript must equal the expectation written out here, so
 * that "both backends are wrong in the same way" is not a passing result.
 *
 * ── What a program is ─────────────────────────────────────────────────────
 * A function from a `CellBackend` to a list of strings. It may only observe
 * the backend through the backend: reads, setter return values, `untrack`.
 * That restriction is the point — anything a program can see is something a
 * handler could see, and anything neither can see is not part of the contract
 * (the two backends' internals are entirely different and are supposed to
 * be).
 *
 * Values are printed by `show`, which distinguishes what `JSON.stringify`
 * does not: `-0` from `0`, `NaN` from `null`, `undefined` from absent. Two of
 * the clauses below are *only* visible through that.
 *
 * ── The five clauses ──────────────────────────────────────────────────────
 * Each `describe` names one clause of the contract the extracted handlers
 * were written against, as stated in the unit spec and in `cells.ts`:
 * batching, same-cell sharing, untrack, updaters + last-write-wins +
 * equality, and atomic flush in write order.
 */

/** A value, printed so that no two distinguishable values print the same. */
function show(value: unknown): string {
  if (Object.is(value, -0)) return "-0";
  if (typeof value === "number" && Number.isNaN(value)) return "NaN";
  if (value === undefined) return "undefined";
  if (typeof value === "function") return "[function]";
  return JSON.stringify(value) ?? String(value);
}

interface Program {
  /** The contract clause this program exercises. */
  clause: string;
  name: string;
  run(backend: CellBackend): string[] | Promise<string[]>;
  /** What both backends must produce. Written out, not captured. */
  expected: string[];
}

const PROGRAMS: Program[] = [
  {
    clause: "batching",
    name: "a write is invisible to reads until flush",
    run({ createSignal, flush }) {
      const log: string[] = [];
      const [get, set] = createSignal(0);
      log.push(`initial ${show(get())}`);
      log.push(`set returned ${show(set(1))}`);
      log.push(`read before flush ${show(get())}`);
      flush();
      log.push(`read after flush ${show(get())}`);
      return log;
    },
    expected: ["initial 0", "set returned 1", "read before flush 0", "read after flush 1"],
  },
  {
    clause: "batching",
    name: "a whole batch is invisible, not just the last write",
    run({ createSignal, flush }) {
      const log: string[] = [];
      const [get, set] = createSignal("a");
      set("b");
      set("c");
      set("d");
      log.push(`during ${show(get())}`);
      flush();
      log.push(`after ${show(get())}`);
      return log;
    },
    expected: ['during "a"', 'after "d"'],
  },
  {
    clause: "batching",
    name: "an unflushed batch settles on the microtask queue",
    async run({ createSignal }) {
      const log: string[] = [];
      const [get, set] = createSignal(0);
      set(41);
      log.push(`same tick ${show(get())}`);
      await null;
      log.push(`next microtask ${show(get())}`);
      return log;
    },
    expected: ["same tick 0", "next microtask 41"],
  },
  {
    clause: "sharing",
    name: "one pair, one storage — the setter is visible through the getter",
    run({ createSignal, flush }) {
      const log: string[] = [];
      const [get, set] = createSignal(0);
      // The no-tear property at its root: two consumers handed the same pair
      // are two views of one cell, and nothing about a signal offers a second
      // instance of the same storage.
      const reader = { count: get };
      const writer = { setCount: set };
      writer.setCount(7);
      flush();
      log.push(`reader sees ${show(reader.count())}`);
      writer.setCount((previous) => (previous as number) + 1);
      flush();
      log.push(`reader sees ${show(reader.count())}`);
      log.push(`same accessor ${show(reader.count === get)}`);
      return log;
    },
    expected: ["reader sees 7", "reader sees 8", "same accessor true"],
  },
  {
    clause: "sharing",
    name: "two cells are independent — a write to one does not touch the other",
    run({ createSignal, flush }) {
      const log: string[] = [];
      const [a, setA] = createSignal("a0");
      const [b, setB] = createSignal("b0");
      setA("a1");
      log.push(`mid ${show(a())} ${show(b())}`);
      flush();
      log.push(`after ${show(a())} ${show(b())}`);
      return log;
    },
    expected: ['mid "a0" "b0"', 'after "a1" "b0"'],
  },
  {
    clause: "untrack",
    name: "untrack returns the committed value and nothing else changes",
    run({ createSignal, flush, untrack }) {
      const log: string[] = [];
      const [get, set] = createSignal(1);
      log.push(`untrack ${show(untrack(get))}`);
      set(2);
      log.push(`untrack of a pending write ${show(untrack(get))}`);
      flush();
      log.push(`untrack after flush ${show(untrack(get))}`);
      log.push(`untrack of anything ${show(untrack(() => "not a cell"))}`);
      log.push(`untrack of a read inside a read ${show(untrack(() => untrack(get)))}`);
      return log;
    },
    expected: [
      "untrack 1",
      "untrack of a pending write 1",
      "untrack after flush 2",
      'untrack of anything "not a cell"',
      "untrack of a read inside a read 2",
    ],
  },
  {
    clause: "updaters",
    name: "an updater receives the latest pending value, not the committed one",
    run({ createSignal, flush }) {
      const log: string[] = [];
      const [get, set] = createSignal(10);
      log.push(`first ${show(set((previous) => previous + 1))}`);
      log.push(`second ${show(set((previous) => previous + 1))}`);
      log.push(`third ${show(set((previous) => previous * 2))}`);
      log.push(`read during ${show(get())}`);
      flush();
      log.push(`committed ${show(get())}`);
      return log;
    },
    expected: ["first 11", "second 12", "third 24", "read during 10", "committed 24"],
  },
  {
    clause: "updaters",
    name: "a function is always an updater, never a stored value",
    run({ createSignal, flush }) {
      const log: string[] = [];
      const [get, set] = createSignal<unknown>(0);
      set(() => 42);
      flush();
      log.push(`stored ${show(get())}`);
      return log;
    },
    expected: ["stored 42"],
  },
  {
    clause: "updaters",
    name: "last write wins, whichever form it took",
    run({ createSignal, flush }) {
      const log: string[] = [];
      const [get, set] = createSignal(0);
      set((previous) => previous + 100);
      set(5);
      set((previous) => previous + 1);
      flush();
      log.push(`committed ${show(get())}`);
      return log;
    },
    expected: ["committed 6"],
  },
  {
    clause: "updaters",
    name: "an unchanged write is not a write — the pending value is untouched",
    run({ createSignal, flush }) {
      const log: string[] = [];
      const [get, set] = createSignal(3);
      log.push(`equal write returns ${show(set(3))}`);
      log.push(`then an updater ${show(set((previous) => previous * 2))}`);
      flush();
      log.push(`committed ${show(get())}`);
      return log;
    },
    expected: ["equal write returns 3", "then an updater 6", "committed 6"],
  },
  {
    clause: "updaters",
    name: "equality is ===, so -0 does not replace +0 (and the updater sees +0)",
    // The one input where `Object.is` and Solid's `isEqual` disagree, pinned
    // deliberately: `@solidjs/signals` compares with `a === b`
    // (dist/dev.js:2893) at write time, so `-0` over `+0` is not a change and
    // is not even queued. A kernel written to the letter of "Object.is
    // equality" would commit `-0` here and diverge from the runtime the
    // handlers were written against. `cells.ts` documents the choice; this is
    // what stops it drifting back.
    run({ createSignal, flush }) {
      const log: string[] = [];
      const [get, set] = createSignal(0);
      log.push(`set(-0) returned ${show(set(-0))}`);
      log.push(`updater over the pending value ${show(set((previous) => 1 / previous))}`);
      flush();
      log.push(`committed ${show(get())}`);

      const [negative, setNegative] = createSignal(-0);
      setNegative(0);
      flush();
      log.push(`+0 over -0 keeps ${show(negative())}`);
      return log;
    },
    expected: [
      "set(-0) returned -0",
      "updater over the pending value null",
      "committed null",
      "+0 over -0 keeps -0",
    ],
  },
  {
    clause: "updaters",
    name: "NaN, undefined and object identity survive a round trip",
    run({ createSignal, flush }) {
      const log: string[] = [];
      const [nan, setNan] = createSignal(Number.NaN);
      setNan(Number.NaN);
      flush();
      log.push(`NaN stays ${show(nan())}`);

      const [undef, setUndef] = createSignal<unknown>(undefined);
      setUndef(undefined);
      flush();
      log.push(`undefined stays ${show(undef())}`);

      const object = { a: 1 };
      const [held, setHeld] = createSignal<unknown>(object);
      setHeld(object);
      flush();
      log.push(`same reference ${show(held() === object)}`);
      setHeld({ a: 1 });
      flush();
      log.push(`equal-but-distinct replaces ${show(held() === object)}`);
      return log;
    },
    expected: [
      "NaN stays NaN",
      "undefined stays undefined",
      "same reference true",
      "equal-but-distinct replaces false",
    ],
  },
  {
    clause: "flush",
    name: "flush settles every cell at once, in write order",
    run({ createSignal, flush }) {
      const log: string[] = [];
      const [a, setA] = createSignal(0);
      const [b, setB] = createSignal(0);
      const [c, setC] = createSignal(0);

      setB(2);
      setA(1);
      setC(3);
      // Nothing is half-settled: all three read as they were served.
      log.push(`during ${show(a())} ${show(b())} ${show(c())}`);
      flush();
      log.push(`after ${show(a())} ${show(b())} ${show(c())}`);
      return log;
    },
    expected: ["during 0 0 0", "after 1 2 3"],
  },
  {
    clause: "flush",
    name: "flush with nothing pending is a no-op, and repeats are idempotent",
    run({ createSignal, flush }) {
      const log: string[] = [];
      const [get, set] = createSignal(9);
      flush();
      log.push(`untouched ${show(get())}`);
      set(10);
      flush();
      flush();
      flush();
      log.push(`settled once ${show(get())}`);
      return log;
    },
    expected: ["untouched 9", "settled once 10"],
  },
  {
    clause: "flush",
    name: "a write made during the drain is settled by that same flush",
    run({ createSignal, flush }) {
      const log: string[] = [];
      const [a, setA] = createSignal(0);
      const [b, setB] = createSignal(0);
      setA(1);
      // A handler that writes while a flush is running is not a shape the
      // resumer produces, but "flush leaves the queue empty" has to hold
      // anyway — the patch step diffs immediately afterwards.
      setB(2);
      flush();
      log.push(`after ${show(a())} ${show(b())}`);
      return log;
    },
    expected: ["after 1 2"],
  },
  {
    clause: "flush",
    name: "a cell created after a batch was queued is unaffected by its flush",
    run({ createSignal, flush }) {
      const log: string[] = [];
      const [a, setA] = createSignal("a0");
      setA("a1");
      const [b] = createSignal("b0");
      flush();
      log.push(`after ${show(a())} ${show(b())}`);
      return log;
    },
    expected: ['after "a1" "b0"'],
  },
];

const CLAUSES = [
  ["batching", "a setter call is invisible to every read until flush() settles"],
  ["sharing", "one cell instance, one storage, shared by every consumer of the pair"],
  ["untrack", "untrack(fn) returns the committed value with no tracking"],
  ["updaters", "value or updater of the latest pending value; last write wins; === equality"],
  ["flush", "flush() settles all pending writes atomically, in write order"],
] as const;

/**
 * Transcripts are taken once per backend, before the assertions, so that a
 * failure reports the whole difference rather than the first line of it.
 */
const transcripts = new Map<string, Map<string, string[]>>();
for (const { name, backend } of BACKENDS) {
  const byProgram = new Map<string, string[]>();
  for (const program of PROGRAMS) {
    byProgram.set(program.name, await program.run(backend));
  }
  transcripts.set(name, byProgram);
}

for (const [clause, statement] of CLAUSES) {
  const programs = PROGRAMS.filter((program) => program.clause === clause);

  describe(`cells — ${clause}: ${statement}`, () => {
    it("is exercised by at least one program", () => {
      expect(programs.length).toBeGreaterThan(0);
    });

    for (const program of programs) {
      it(`${program.name} — kernel and oracle agree, and both are right`, () => {
        const kernel = transcripts.get(KERNEL.name)!.get(program.name)!;
        const oracle = transcripts.get(ORACLE.name)!.get(program.name)!;

        // The oracle first: if `@solidjs/signals` does not do what this file
        // claims it does, the finding is about the claim, not the kernel.
        expect(oracle, `${ORACLE.name} disagrees with the written expectation`).toEqual(program.expected);
        expect(kernel, `${KERNEL.name} disagrees with ${ORACLE.name}`).toEqual(oracle);
      });
    }
  });
}

describe("cells — the equivalence itself", () => {
  it("ran every program on both backends", () => {
    expect([...transcripts.keys()]).toEqual([KERNEL.name, ORACLE.name]);
    for (const byProgram of transcripts.values()) {
      expect([...byProgram.keys()].sort()).toEqual(PROGRAMS.map((program) => program.name).sort());
    }
  });

  it("produced identical transcripts, program for program", () => {
    const kernel = transcripts.get(KERNEL.name)!;
    const oracle = transcripts.get(ORACLE.name)!;
    for (const program of PROGRAMS) {
      expect(kernel.get(program.name), program.name).toEqual(oracle.get(program.name));
    }
  });

  it("covers all five contract clauses", () => {
    expect([...new Set(PROGRAMS.map((program) => program.clause))].sort()).toEqual(
      CLAUSES.map(([clause]) => clause).sort(),
    );
  });

  it("prints distinguishable values distinguishably", () => {
    // The transcripts are only evidence if two different values cannot print
    // the same string. The three that would collapse under JSON.stringify are
    // exactly the three the equality clause turns on.
    expect(show(-0)).not.toBe(show(0));
    expect(show(Number.NaN)).not.toBe(show(null));
    expect(show(undefined)).not.toBe(show(null));
  });
});
