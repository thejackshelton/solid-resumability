/**
 * The todos page's bootstrap — everything the browser runs before the user
 * touches anything, and nothing else.
 *
 * The page is served with its first paint already in the document: the
 * Loading shell (`Header`'s markup plus the app's loading paragraph), captured
 * at build time from a real render and inlined into `#root` by the plugin's
 * prerender stage (`plugin/src/stages/prerender.ts`). What this module does at
 * load is take that markup over:
 *
 *   1. resume `Header` against the served mount — one component, live, with
 *      its handler still unfetched;
 *   2. install the deferral listeners for the rest of the page.
 *
 * Everything else — `@solidjs/web`, `@solidjs/signals`, the four fallback
 * components, the store they share, the app's own modules — is one dynamic
 * `import()` of `todos-group.ts`, made on the first interaction and never
 * before. The group is a single chunk because the four components and the
 * store form one deferral group: each pair of them reaches the same reactive
 * source, so a boundary drawn between any two of them would put one consumer
 * of a source behind the boundary and one in front of it.
 *
 * ── What is eager, and what is not ────────────────────────────────────────
 *   structure.js / wiring.js   store + action identity, locator + event
 *   the resume runtime         `resumer.ts` + `locate.ts` + `cells.ts` +
 *                              `registry.ts` + `stores.ts`
 *   `defer.ts`                 the capture listeners and the one promise
 *
 *   regions.ts                 NOT eager — the keyed-region resolver, behind
 *                              one `import()` the resumer takes only for an
 *                              event that came through a region container.
 *                              This page never takes it: its own list belongs
 *                              to a component the group renders, so nothing
 *                              the resumed mount can receive is inside one.
 *   template.js                NOT eager — the document carries the markup,
 *                              so a second copy in a module would be paying
 *                              twice. `registry.ts` accepts a bundle without
 *                              one and says the byte check belongs to the
 *                              build that did the inlining; the build makes
 *                              it, against the template artifact, before it
 *                              writes the page.
 *   handlers/s0.js             NOT eager — one `import()`, on the first
 *                              keydown.
 *   the group                  NOT eager — one `import()`, transferred on the
 *                              first interaction SIGNAL (a pointerdown or
 *                              focusin anywhere in the page, a keystroke in
 *                              the resumed mount) and executed on the first
 *                              event that commits.
 *
 * ── The store, and where it is published ──────────────────────────────────
 * `Header` dispatches `addTodo` by identity: the artifacts name slot
 * `[1, "addTodo"]` of store `s0`, and `stores.ts` joins that name to the live
 * value. The live value is created by `createTodos()` inside `App`, which
 * runs in the group — so `s0` is unregistered at load and registered at the
 * instant the group's `App` reaches the substituted mount point, which stands
 * exactly where `Header`'s own `useContext(TodosContext)` stood. One store,
 * one birth, one registration.
 *
 * That is also what closes the window in which a keystroke lands before the
 * store exists: the resumer asks the registry for `s0` BEFORE it resolves the
 * slot, the registry reports the miss to the hook registered below, the hook
 * commits the group, and the dispatch — the original event, in its arrival
 * position in the queue — runs against the store the commit produced. The
 * function that lands in the slot is still the store's own.
 */

import { deferGroup, type DeferredGroup } from "../../src/resume/defer.ts";
import { createRegistry, type HandlerModule } from "../../src/resume/registry.ts";
import { createResumer, type ResumedApp } from "../../src/resume/resumer.ts";
import { createStoreRegistry } from "../../src/resume/stores.ts";

/**
 * The artifacts this page RESUMES, named one directory at a time.
 *
 * The rule is the whole reason the glob is not `app.*`: what is eager is what
 * the served page can resume at load, which is what it carries a resume mount
 * for — and this document carries exactly one, `HEADER`'s. The pass proves
 * components this page never mounts (a component whose guard is the group's to
 * flip ships an EMPTY mount, so it is the group that renders it, the ordinary
 * way); their structure and wiring would be bytes on the wire for a resume that
 * cannot happen. A mount added to the document is a directory added here.
 *
 * The `app.` prefix is still what keeps this page's artifacts disjoint from the
 * fixtures page's, which excludes it. No `template.js` — the markup is in the
 * document.
 */
const STATIC_MODULES = import.meta.glob<Record<string, unknown>>(
  ["../artifacts/app.Header/structure.js", "../artifacts/app.Header/wiring.js"],
  { eager: true },
);

/** Lazy by construction: a record of `() => import(...)`, none of them called.
 * Wider than the eager pair on purpose: a handler chunk costs nothing until an
 * event asks for it, and a thunk for a component this page does not mount is
 * never called. */
const HANDLER_MODULES = import.meta.glob<HandlerModule>("../artifacts/app.*/handlers/*.js");

export const registry = createRegistry(STATIC_MODULES, HANDLER_MODULES);

/** One registry per page: the live stores this page's components dispatch to. */
export const stores = createStoreRegistry();

const resume = createResumer(registry);

/** The artifact directory the served mount carries and the group claims. */
export const HEADER = "app.Header";

/** How the served mount is found — the attribute the build stamped into it. */
export const MOUNT_SELECTOR = `[data-resume="${HEADER}"]`;

/**
 * Every component this page resumed, in mount order.
 *
 * The page itself never reads it — a resumed component needs no supervision.
 * It is here so a test can await `settled()` and read `stats`.
 */
export const resumed: ResumedApp[] = [];

/**
 * The mount element, in the one shape both halves of the page agree on.
 *
 * The wrapper exists because the resumer installs its delegated listeners on
 * the *container* of a component's markup, and the markup's own root is
 * `<header class="header">`. It carries `display: contents` (see
 * `styles/todos-overlay.css`), so it generates no box and every selector in
 * the app's stylesheet — all of them descendant selectors — resolves exactly
 * as it does on the classic page.
 *
 * Called only by the build-time capture, which has no served mount to take
 * over; the shipped page finds this element already in the document.
 */
export function createMount(html: string): HTMLElement {
  const mount = document.createElement("div");
  mount.className = "resume-mount";
  mount.dataset.resume = HEADER;
  mount.dataset.component = "Header";
  mount.innerHTML = html;
  return mount;
}

/** Resumes `Header` inside a container whose markup is already the template. */
export function resumeMount(mount: Element): ResumedApp {
  const app = resume(mount, HEADER, { stores });
  if (!app) throw new Error(`resume: the todos build shipped no artifacts for ${HEADER}`);
  resumed.push(app);
  return app;
}

/**
 * The node the group's render is to reuse for the resumed component.
 *
 * Set by the group immediately before it renders, read once by the
 * substituted mount point. A field rather than a lookup because by then the
 * node has been detached: the group takes it out of the served tree, clears
 * the root, and hands the same element back to the new tree.
 */
let claimable: HTMLElement | null = null;

export function offerClaim(mount: HTMLElement): void {
  claimable = mount;
}

/**
 * The substituted mount point of `Header` (see `demo/build/substitute.mjs`),
 * standing where the component's own body stood and making the context read
 * the component made.
 *
 * Two things happen here and they are the whole join between the resumed
 * component and the group: the live store is published under the identity the
 * artifacts named, and the element that is already carrying `Header` — served
 * markup, delegated listeners, whatever the user has typed into it — is
 * returned so the group's render inserts that same node instead of a copy.
 */
export function claimHeader(store: unknown): HTMLElement {
  const bundle = registry.get(HEADER);
  if (!bundle) throw new Error(`resume: the todos build shipped no artifacts for ${HEADER}`);

  // Registration, by identity, before anything can be dispatched. One live
  // value per store the artifacts name — the value the provider produced.
  for (const declared of bundle.stores) stores.provide(declared.id, store);

  const mount = claimable;
  claimable = null;
  if (!mount) {
    throw new Error(`resume: the group rendered with no ${HEADER} mount to claim`);
  }
  return mount;
}

export interface DeferredPage {
  /** The resumed `Header`. */
  header: ResumedApp;
  /** The listeners standing in for the rest of the page. */
  group: DeferredGroup;
}

/**
 * Takes over the served page: resumes `Header`, defers everything else.
 *
 * Returns `null` when `#root` is empty, which is not a shipped state — it is
 * the build-time capture, running the group against a document that has no
 * prerendered shell in it yet because producing that shell is what the run is
 * for. A root with markup in it but no mount is a broken build and throws.
 */
export function bootstrap(root: HTMLElement): DeferredPage | null {
  const mount = root.querySelector<HTMLElement>(MOUNT_SELECTOR);
  if (!mount) {
    if (root.firstChild) {
      throw new Error(`resume: the served page has markup in #${root.id} but no ${HEADER} mount in it`);
    }
    return null;
  }

  const header = resumeMount(mount);

  /** The group's one module, behind the page's one import site. */
  const groupModule = () => import("./todos-group.ts");

  const group = deferGroup({
    root,
    // The resumed subtree: live already, so its events are its own. A keydown
    // in it is a signal that the rest of the page is about to be needed, and a
    // signal buys the transfer — not the execution.
    resumed: () => mount,
    signalsWithinResumed: ["keydown"],
    // One order across the boundary. The resumed component's dispatch queue is
    // this page's pre-activation FIFO: a keystroke waiting for the store and a
    // captured shell event waiting for the DOM are two entries in one queue,
    // in the order the user produced them, rather than two drains that would
    // agree only by luck.
    enqueue: (task) => header.enqueue(task),
    // One import site, called from both moments: the module system answers
    // the second call from the first call's record, so the commit joins the
    // transfer instead of making a second request. The signal buys the
    // bytes — `execute` is what runs them, and only the commit calls it.
    prefetch: groupModule,
    load: () => groupModule().then((module) => module.execute(root)),
  });

  // What commits the group for the resumed half of the page: a dispatch that
  // needs a store only the group's `App` can create. The resumer asks the
  // registry for the store before it resolves the slot, the registry reports
  // the miss here, and the dispatch then waits for the provision that this
  // very load produces. `start` is idempotent, so a miss arriving after a
  // first touch joins the load already in flight.
  stores.onMissing((id) => void group.start(`a resumed dispatch needs store ${JSON.stringify(id)}`));

  return { header, group };
}
