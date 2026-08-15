/**
 * The deferral loader: everything a deferred group has in the browser before the
 * first interaction pays for it. A group is a set of components sharing a
 * reactive source, drawn so the boundary never crosses one, and its whole
 * implementation sits behind ONE dynamic `import()`. Standing in for it:
 * capture-phase listeners on the group's root, and a promise. Capture phase, on
 * a container rather than the nodes, because the listeners must see an event
 * before anything else can and the served nodes are replaced on render.
 *
 * Two moments, not one. PREFETCH fires on the earliest interaction SIGNAL — a
 * pointerdown or focusin under the root, a keystroke in a subtree already live —
 * so transfer overlaps intent; nothing executes and no DOM is touched. START
 * fires on the event that commits: an interaction with the group's own DOM, or
 * (through `stores.onMissing`) a resumed dispatch needing a store only the group
 * can create. Idle and load-time prefetch stay refused — a page that fetches its
 * framework before the user has done anything has not deferred it — and focus,
 * the one signal a browser produces alone, is refused through
 * `userHasInteracted` for the reason a timer is.
 *
 * Exactly one import: the first `start` stores the promise and every later call
 * returns it, so a burst cannot make two requests and a commit joins a prefetch
 * in flight. Listeners come off SYNCHRONOUSLY inside that first `start`, before
 * the loader is invoked and so before the group can attach a listener of its own
 * — which makes it impossible for one event to be both recorded here and handled
 * live.
 *
 * Events arriving before the group exists are recorded, not swallowed — the
 * record, not the event object, since the nodes it addressed do not survive the
 * first render. The path does, and it resolves against the new tree because that
 * tree renders the same code at the same state as the snapshot. Each record is
 * appended to a FIFO AT ARRIVAL: `options.enqueue` where the page supplies one,
 * so a resumed dispatch waiting on the group's store and a captured event
 * waiting on its DOM sit in ONE queue, in the order the user produced them.
 *
 * A resumed component inside the root is already live, so its events are neither
 * recorded nor prevented here — `signals` / `signalsWithinResumed` excepted, and
 * only in the prefetch direction. `<a href="#…">` is native navigation and the
 * group reads `location.hash` when it runs, so it commits the group but is never
 * recorded: replaying it would navigate twice.
 */

export const DEFAULT_DEFER_EVENTS: readonly string[] = [
  "pointerdown",
  "click",
  "input",
  "change",
  "keydown",
];

/** Intent-only: transfer starts, nothing is recorded, prevented or replayed. */
export const DEFAULT_DEFER_SIGNALS: readonly string[] = ["pointerdown", "focusin"];

/** Focus signals, which a document can raise without a user (`autofocus`). */
const FOCUS_EVENTS: readonly string[] = ["focus", "focusin"];

/** The platform's answer to "has the user done anything yet". Unimplemented
 * means yes: a runtime without user activation has no autofocus flush either, so
 * every focus event it raises came from something calling `focus()`. */
function userHasInteracted(): boolean {
  const activation = (globalThis.navigator as { userActivation?: { hasBeenActive?: boolean } } | undefined)
    ?.userActivation;
  return activation?.hasBeenActive ?? true;
}

/** One event that arrived before the group it addressed existed. */
export interface QueuedEvent {
  index: number;
  type: string;
  /** Child-index path from the observed root: `"/"` is the root, `"/1/0"` the
   * first element child of its second. `null` where the target was not an element
   * under the root — the one case a replay cannot address. */
    path: string | null;
  /** Read at capture time: `key` for keyboard events, `value` for anything
   * carrying one, `checked` only for checkboxes and radios. */
  key?: string;
  value?: string;
  checked?: boolean;
}

/** Observable counters, so a test can see the laziness rather than trust it. */
export interface DeferStats {
  /** Loader and prefetch-thunk calls: one, ever, or none, each. */
  imports: number;
  prefetches: number;
  queued: number;
  /** Recorded events dispatched again against the activated tree. */
  replays: number;
  /** Everything the capture listeners saw, recorded or not. */
  observed: number;
}

export interface DeferOptions {
  root: Element;
  /** At most once; awaited, so a thunk that imports then executes reports both. */
  load: () => unknown;
  /** Once, on the first signal. Omitted, the commit pays for the whole trip. */
  prefetch?: () => unknown;
  events?: readonly string[];
  signals?: readonly string[];
  /** An already-live subtree, resolved at event time: the node may be replaced. */
  resumed?: () => Element | null;
  /** Types inside `resumed` that signal, on top of `signals`. */
  signalsWithinResumed?: readonly string[];
  /** Where a replay is appended, at arrival. A page that also resumed a component
   * passes that component's queue, which makes pre-activation order ONE order. */
  enqueue?: (task: () => unknown) => void;
}

export interface DeferredGroup {
  readonly queue: readonly QueuedEvent[];
  readonly stats: Readonly<DeferStats>;
  /** What committed the load and what started the transfer, `null` until each. */
  readonly trigger: string | null;
  readonly prefetchTrigger: string | null;
  readonly loading: Promise<void> | null;
  /** A page never awaits this — a failed transfer is one the commit makes again
   * — but a measurement can. */
  readonly prefetching: Promise<void> | null;
  /** Starts the group, or returns the load already in flight. */
  start(reason: string): Promise<void>;
  /** Transfer without execution. Idempotent; implied by `start`. */
  prefetch(reason: string): void;
  /** Drained: the load, plus the replays this loader owns. Where the page
   * supplied an `enqueue`, the replays are in THAT queue. */
  settled(): Promise<void>;
  dispose(): void;
}

/** The child-index path from `root` to `node`, in `locate.ts`'s scheme; text
 * nodes report their parent element's path. */
export function pathTo(root: Element, node: Node): string | null {
  let element: Element | null =
    node.nodeType === 1 ? (node as Element) : ((node as { parentElement?: Element | null }).parentElement ?? null);

  const steps: number[] = [];
  while (element && element !== root) {
    const parent: Element | null = element.parentElement;
    if (!parent) return null; // detached from the observed tree.
    steps.unshift([...parent.children].indexOf(element));
    element = parent;
  }
  if (element !== root) return null;
  return `/${steps.join("/")}`;
}

/** The element `path` addresses in the tree the group rendered, or `null`.
 * `locate.ts` throws instead, right for locators proven against markup the build
 * verified; a replay's path was proven against markup since replaced, and a
 * shell node with no counterpart is an event with nowhere to go. */
function nodeAt(root: Element, path: string): Element | null {
  let node: Element = root;
  for (const step of path.split("/").filter(Boolean)) {
    const next = node.children[Number(step)];
    if (!next) return null;
    node = next;
  }
  return node;
}

/** The payload a replay could need, read while the node still exists. */
function captureEventPayload(index: number, event: Event, path: string | null): QueuedEvent {
  const entry: QueuedEvent = { index, type: event.type, path };

  const key = (event as { key?: unknown }).key;
  if (typeof key === "string") entry.key = key;

  const target = event.target as { type?: unknown; value?: unknown; checked?: unknown } | null;
  if (typeof target?.value === "string") entry.value = target.value;
  // Only where checkedness is what the control means: a text field reports
  // `false` here, and carrying it would describe a state it does not have.
  if ((target?.type === "checkbox" || target?.type === "radio") && typeof target.checked === "boolean") {
    entry.checked = target.checked;
  }

  return entry;
}

/** A fresh event for the node the path resolved to. The original is not reused:
 * it carries a node that no longer exists in `target`. What a handler reads is
 * reproduced instead — type, key, and the value the user produced. */
function synthesize(entry: QueuedEvent): Event {
  const init = { bubbles: true, cancelable: true };
  if (entry.key !== undefined) return new KeyboardEvent(entry.type, { ...init, key: entry.key });
  if (entry.type === "click" || entry.type === "pointerdown") return new MouseEvent(entry.type, init);
  return new Event(entry.type, init);
}

/** Installs the standing-in listeners. Nothing about the group is named here —
 * not the module, not the components, not the framework: it is `options.load`. */
export function deferGroup(options: DeferOptions): DeferredGroup {
  const root = options.root;
  const types = options.events ?? DEFAULT_DEFER_EVENTS;
  const signals = options.signals ?? DEFAULT_DEFER_SIGNALS;
  const withinResumed = options.signalsWithinResumed ?? [];
  const listened = [...new Set([...types, ...signals, ...withinResumed])];

  const queue: QueuedEvent[] = [];
  const stats: DeferStats = { imports: 0, prefetches: 0, queued: 0, replays: 0, observed: 0 };
  let trigger: string | null = null;
  let prefetchTrigger: string | null = null;
  let loading: Promise<void> | null = null;
  let prefetching: Promise<void> | null = null;
  let listening = false;

  /** This loader's own FIFO, used only where the page supplied none. */
  let chain: Promise<void> = Promise.resolve();
  let failure: unknown = null;
  const append =
    options.enqueue ??
    ((task: () => unknown) => {
      chain = chain
        .then(async () => {
          await task();
        })
        .catch((error) => void (failure ??= error));
    });

  function removeListeners(): void {
    if (!listening) return;
    listening = false;
    for (const type of listened) root.removeEventListener(type, onEvent, true);
  }

  function prefetch(reason: string): void {
    if (loading || stats.prefetches > 0 || !options.prefetch) return;
    prefetchTrigger = reason;
    stats.prefetches++;
    // Never awaited by the page and never stored as `loading`: a transfer, and
    // nothing runs the group until something commits.
    prefetching = Promise.resolve(options.prefetch())
      .then(() => undefined)
      .catch(() => undefined);
  }

  function start(reason: string): Promise<void> {
    if (loading) return loading; // the one import, already in flight.
    trigger = reason;
    // Before the loader runs: no listener of the group's can exist yet.
    removeListeners();
    stats.imports++;
    loading = Promise.resolve(options.load()).then(() => undefined);
    return loading;
  }

  /** Settled means the group's execution returned and the microtask turn it
   * queued ran. Async work the group starts — a projection, a fetch — is
   * deliberately NOT awaited, as it is not on a page that never deferred. */
    async function settle(): Promise<void> {
    await loading;
    await Promise.resolve();
  }

  async function replay(entry: QueuedEvent): Promise<void> {
    await settle();
    if (entry.path === null) return; // unaddressable when it arrived.

    const node = nodeAt(root, entry.path);
    if (!node) return; // no counterpart in the tree the group rendered.

    // The state the user produced, restored onto the node the group made, so the
    // handler reads what the interaction meant, not what the fresh render says.
    const field = node as { value?: unknown; checked?: unknown };
    if (entry.value !== undefined && typeof field.value === "string") field.value = entry.value;
    if (entry.checked !== undefined && typeof field.checked === "boolean") field.checked = entry.checked;

    stats.replays++;
    node.dispatchEvent(synthesize(entry));
  }

  function onEvent(event: Event): void {
    stats.observed++;
    const target = event.target as Node | null;
    if (!target) return;

    // A focus the document gave itself is not an interaction.
    if (FOCUS_EVENTS.includes(event.type) && !userHasInteracted()) return;

    const live = options.resumed?.() ?? null;
    if (live && (live === target || live.contains(target))) {
      // The resumed path handles its own events; a signal inside it still says the
      // rest of the page is about to be needed.
      if (signals.includes(event.type) || withinResumed.includes(event.type)) {
        prefetch(`${event.type} in the resumed mount`);
      }
      return;
    }

    // Native hash navigation: not ours to record, not ours to prevent.
    const element = target.nodeType === 1 ? (target as Element) : target.parentElement;
    if (element?.closest?.('a[href^="#"]')) {
      if (types.includes(event.type)) void start(`${event.type} on a hash link`);
      else prefetch(`${event.type} on a hash link`);
      return;
    }

    if (!types.includes(event.type)) {
      prefetch(`${event.type} on the deferred group`);
      return;
    }

    // Recorded before the load starts: the queue is complete from the instant
    // the group is asked for.
    const entry = captureEventPayload(queue.length, event, pathTo(root, target));
    queue.push(entry);
    stats.queued++;
    void start(`${event.type} on the deferred group`);
    // Appended after the commit and in arrival order: what runs it is the
    // page's one pre-activation FIFO, not a second drain of this queue.
    append(() => replay(entry));
  }

  listening = true;
  for (const type of listened) root.addEventListener(type, onEvent, true);

  return {
    get queue() {
      return queue;
    },
    stats,
    get trigger() {
      return trigger;
    },
    get prefetchTrigger() {
      return prefetchTrigger;
    },
    get loading() {
      return loading;
    },
    get prefetching() {
      return prefetching;
    },
    start,
    prefetch,
    async settled() {
      await loading;
      await chain;
      if (failure !== null) {
        const error = failure;
        failure = null;
        throw error;
      }
    },
    dispose: removeListeners,
  };
}
