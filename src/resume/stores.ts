/**
 * The action registry: how a resumed handler reaches a live store action.
 *
 * S3 (`src/comptime/stores.ts`) admitted one fact about a store binding, and it
 * is a fact about identity — this local name is slot `path` of the value THIS
 * provider supplies for THIS context, fixed at build time. The artifacts name
 * `{ store: "s0", path: [1, "addTodo"] }` and stop; the value behind it is
 * runtime state only the running page has. What lives here is the join.
 *
 *   registry.provide("s0", useContext(TodosContext))   // at the mount point
 *   registry.action("s0", [1, "addTodo"])              // at first dispatch
 *   registry.read("s0", [0])                           // when a binding recomputes
 *
 * `read` is the same join against the store's other slot. A binding whose text
 * derives through the store's data — `state.todos.length` — carries `{ store,
 * path }` in its capture manifest and its own expression on top, so the value
 * this returns is the store's own object and the expression above it is the
 * component's own source. The first paint's text came from neither: it was
 * MEASURED out of the page's capture, because a build has no store to read.
 *
 * Three properties carry the soundness argument, each of them something this
 * module deliberately does NOT do. No serialization: `provide` keeps a reference
 * to a live value created in this same page moments earlier, so nothing is
 * stringified, snapshotted or sent, and nothing can go stale. No introspection:
 * `action()` indexes along the proven path and returns what it finds — the path
 * is an input, never a discovery. No wrapping: the function returned IS the one
 * the store built, so `Object.is` holds against it and
 * `test/resume-store.test.ts` asserts exactly that. A wrapper would mean the
 * resume path had an opinion about a body it never read.
 *
 * An action slot whose store was never provided, or whose path does not reach a
 * function, throws at dispatch with the store id and path named — never a silent
 * no-op, because the one thing worse than a broken page is a broken page that
 * looks like it worked. Resume itself still succeeds; nothing resolves until the
 * first event, which is what keeps the handler import lazy.
 *
 * The exception is a store still on its way behind a deferred import — a wait,
 * not a fault. `whenProvided(id)` resolves when `provide` lands, and the caller
 * awaits it BEFORE resolving a slot, so the wait sits in front of resolution and
 * never wraps what it resolves. `onMissing(fn)` is the page's standing answer to
 * "a dispatch wants a store that does not exist yet": the deferral loader
 * registers the group's activation trigger there, so the miss starts the import.
 * A miss with NO listener is the old failure verbatim — nothing would ever
 * provide the store, so `whenProvided` rejects rather than parking forever.
 */

/** A slot path from the provider's value: `[1, "addTodo"]`. */
export type SlotPath = readonly (string | number)[];

export interface StoreRegistry {
  /** Publishes the live value a provider produced, at the substitution point —
   * where the component's own `useContext` call stood. Re-registering the same
   * value is a no-op; a DIFFERENT value for a provided id is an error, since two
   * live stores under one identity is the ambiguity clause 4 refuses. */
  provide(id: string, value: unknown): void;

  /** Whether `id` has a live value yet. */
  has(id: string): boolean;

  ids(): string[];

  /** The store's own function at `path` of `id`'s live value, unwrapped. Throws
   * when the store is unknown, the path does not resolve, or what it reaches is
   * not callable. */
  action(id: string, path: SlotPath): (...args: never[]) => unknown;

  /** The store's own VALUE at `path` of `id`'s live value, unwrapped. The same
   * indexed walk `action` does, without the callability check — a read may reach
   * anything a store holds, including `undefined` at a slot that exists. Throws
   * when the store is unknown or the path stops before its last step. */
  read(id: string, path: SlotPath): unknown;

  /** A miss NOTIFIES every `onMissing` listener, which is how a page holding the
   * store's code behind a deferred import learns a dispatch is waiting; with no
   * listener the promise rejects, a hang being worse than a failure. */
  whenProvided(id: string): Promise<void>;

  /** Returns the unregistering function. Listeners must be idempotent: a miss
   * fires them once per waiting dispatch, and what they typically start (a group
   * import) is idempotent anyway. */
  onMissing(listener: (id: string) => void): () => void;
}

function show(path: SlotPath): string {
  return `[${path.map((step) => (typeof step === "number" ? String(step) : JSON.stringify(step))).join(", ")}]`;
}

function unregistered(id: string, tail: string): Error {
  return new Error(
    `resume: no live store is registered as ${JSON.stringify(id)}, so ${tail} — the page must call ` +
      `provide(${JSON.stringify(id)}, <the context value>) before the first event`,
  );
}

export function createStoreRegistry(): StoreRegistry {
  const live = new Map<string, unknown>();

  /** The proven path and only that: one indexed read per step, no search. Shared
   * by `action` and `read`, because indexing to a slot is the same act either
   * way — what differs is only what the caller expects to find there. */
  const walk = (id: string, path: SlotPath): unknown => {
    let current = live.get(id);
    for (const step of path) {
      if (current === null || current === undefined) {
        throw new Error(
          `resume: store ${JSON.stringify(id)} has no slot ${show(path)} — the live value stops before ` +
            `${JSON.stringify(step)}`,
        );
      }
      current = (current as Record<string | number, unknown>)[step as string | number];
    }
    return current;
  };

  /** One pending promise per awaited id, resolved by `provide`. Never rejects. */
  const waiting = new Map<string, { promise: Promise<void>; provided: () => void }>();
  const listeners = new Set<(id: string) => void>();

  return {
    provide(id, value) {
      if (live.has(id)) {
        if (Object.is(live.get(id), value)) return;
        throw new Error(
          `resume: store ${JSON.stringify(id)} is already registered with a different live value — ` +
            `one identity cannot name two stores`,
        );
      }
      if (value === null || value === undefined) {
        throw new Error(`resume: store ${JSON.stringify(id)} was registered with ${String(value)}`);
      }
      live.set(id, value);

      const pending = waiting.get(id);
      if (pending) {
        waiting.delete(id);
        pending.provided();
      }
    },

    has(id) {
      return live.has(id);
    },

    ids() {
      return [...live.keys()];
    },

    whenProvided(id) {
      if (live.has(id)) return Promise.resolve();
      if (listeners.size === 0) {
        return Promise.reject(unregistered(id, "there is nothing to wait for and no hook that would provide it"));
      }

      // Entered before the listeners run, so a listener that provides
      // synchronously resolves this promise rather than racing it.
      let pending = waiting.get(id);
      if (!pending) {
        let provided!: () => void;
        const promise = new Promise<void>((resolve) => (provided = resolve));
        pending = { promise, provided };
        waiting.set(id, pending);
      }
      for (const listener of [...listeners]) listener(id);
      return pending.promise;
    },

    onMissing(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },

    read(id, path) {
      if (!live.has(id)) {
        throw unregistered(id, `the data at ${show(path)} cannot be read`);
      }
      // The store's own value at the proven slot, handed back as it is. No copy
      // and no wrapper: a binding's expression reads through this exactly as the
      // component's own source did, and `Object.is` holds against the store.
      return walk(id, path);
    },

    action(id, path) {
      if (!live.has(id)) {
        // Reached only where the caller did not wait: a caller that awaited
        // `whenProvided` has a live store by the time it asks for the function.
        throw unregistered(id, `the action at ${show(path)} cannot be dispatched`);
      }

      const current = walk(id, path);
      if (typeof current !== "function") {
        throw new Error(
          `resume: slot ${show(path)} of store ${JSON.stringify(id)} is not callable (got ${typeof current}), ` +
            `so it is not the action the artifact named`,
        );
      }

      return current as (...args: never[]) => unknown;
    },
  };
}
