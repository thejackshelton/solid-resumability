/**
 * The opaque half of Fixture B. The signal's getter/setter arrive as a tuple and
 * the handlers going back are built by mapping caller-supplied string keys
 * through a mutable registry, so single-file analysis of `CounterB.tsx` cannot
 * see which signal a handler writes, how many exist, or what they do.
 */

export type NumberSignal = readonly [() => number, (value: number) => void];

type Op = (current: number) => number;

const registry = new Map<string, Op>();

registry.set("inc", (current) => current + 1);
registry.set("dec", (current) => current - 1);

/** One handler per key, each resolving its operation at call time. */
export function makeHandlers(signal: NumberSignal, keys: string[]): Array<() => void> {
  const [read, write] = signal;

  return keys.map((key) => () => {
    const op = registry.get(key);
    if (op) write(op(read()));
  });
}

/** Derived text, computed behind a module boundary. */
export function formatCount(read: () => number): string {
  return "count: " + read();
}
