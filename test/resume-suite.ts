import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { flush as solidFlush } from "@solidjs/signals";
import { render } from "@solidjs/web";

// @ts-expect-error Generated plain-JS artifact; its shape is the emitter's contract.
import * as template from "../artifacts/CounterA/template.js";
import { listBundles, resume, type ResumedApp } from "../src/resume/index.ts";
import type { CellBackend } from "../src/resume/cells.ts";
import { CounterB } from "../src/fixtures/CounterB.tsx";

/**
 * The resume path, under evidence — over one cell backend.
 *
 * The claim: a page served as static HTML becomes interactive without the
 * component ever running. Not "runs late", not "runs cheaply" — never runs.
 * So the suite is built around one mechanical question: which modules were
 * evaluated, and when.
 *
 * ── Why this is a module and not a test file ──────────────────────────────
 * The resume path runs on `cells.ts` rather than `@solidjs/signals`, and the
 * safety argument for that is equivalence: this entire suite, unweakened, over
 * both backends. It could not be a `describe.each` inside one file,
 * because half of what it asserts is *which modules a registry evaluated* —
 * a second pass in the same file would find the handler modules already
 * loaded and the load-order evidence spent. Vitest gives one module registry
 * per test file, so the suite is a function and there are two files:
 * `resume.test.ts` (the kernel, the default, what ships) and
 * `resume-signals.test.ts` (the oracle). Each installs its own probe and
 * calls this once. Nothing here is relaxed for either backend; the only
 * argument is which `CellBackend` the resumer is handed.
 *
 * ── The instrument ────────────────────────────────────────────────────────
 * The `vi.mock` calls in the *caller* install a loader hook on one module
 * each: the factory runs exactly once, the first time anything in that file's
 * module registry evaluates the module, and it records the fact before
 * handing back the unmodified original (`importOriginal()`), so nothing about
 * behaviour changes. Absence from `probe.loads` is therefore proof the module
 * was never imported, not merely that it produced no output.
 *
 * That argument only holds if the instrument actually fires, so the suite
 * carries its own positive control: `CounterB` is imported statically at the
 * top of this module — which each test file imports before doing anything —
 * and its hook fires. Same mechanism, same registry, which is what makes
 * `CounterA.tsx`'s permanent absence from the log mean something.
 *
 * ── The transcript ────────────────────────────────────────────────────────
 * The load timings are captured once, before any test body runs. Tests then
 * assert over that record. This is deliberate: a "not loaded yet" claim is
 * about a moment in time, and reading it out of a shared module registry from
 * inside a test would make the result depend on which tests ran first.
 * Nothing below depends on test ordering.
 */

export interface Probe {
  /** Module ids, in evaluation order. */
  loads: string[];
  /** The capture slots each handler module was created with. */
  slots: Map<string, Record<string, unknown>>;
}

export interface SuiteOptions {
  /** The cell backend the resumer is handed. */
  backend: CellBackend;
  /** How failures name it. */
  backendName: string;
  /** The caller's hoisted probe, written by its own `vi.mock` factories. */
  probe: Probe;
}

const fixtureLoads = (loads: string[]) => loads.filter((id) => id.startsWith("src/fixtures/"));
const handlerLoads = (loads: string[]) => loads.filter((id) => id.startsWith("artifacts/"));

/** Records every `addEventListener` call made while `fn` runs, and on what. */
function recordingListeners<T>(fn: () => T): { result: T; calls: Array<{ target: EventTarget; type: string }> } {
  const calls: Array<{ target: EventTarget; type: string }> = [];
  const original = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (this: EventTarget, type: string, ...rest: unknown[]) {
    calls.push({ target: this, type });
    return (original as (...args: unknown[]) => void).call(this, type, ...rest);
  } as typeof EventTarget.prototype.addEventListener;
  try {
    return { result: fn(), calls };
  } finally {
    EventTarget.prototype.addEventListener = original;
  }
}

export async function resumeSuite({ backend, backendName, probe }: SuiteOptions): Promise<void> {
  const hosts: HTMLElement[] = [];
  const disposers: Array<() => void> = [];

  /** Mounts markup the way a page receives it from the network: as raw HTML. */
  function mount(html: string): HTMLElement {
    const host = document.createElement("div");
    host.innerHTML = html;
    document.body.appendChild(host);
    hosts.push(host);
    return host;
  }

  function click(host: HTMLElement, testId: string) {
    const element = host.querySelector(`[data-testid="${testId}"]`);
    expect(element, `missing element ${testId}`).toBeTruthy();
    element!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }

  function label(host: HTMLElement, testId: string) {
    return host.querySelector(`[data-testid="${testId}"]`)?.textContent;
  }

  /** The resume path, always over the backend under test. */
  const resumeWith = (host: HTMLElement, component: string) => resume(host, component, { cells: backend });

  afterAll(() => {
    while (disposers.length) disposers.pop()!();
    while (hosts.length) hosts.pop()!.remove();
  });

  /**
   * The one run whose timing is the evidence. Everything here happens before
   * the first `it()` body, using the caller's top-level await.
   */
  const transcript = await (async () => {
    const beforeMount = [...probe.loads];

    const host = mount(template.html);
    const servedHtml = host.innerHTML;

    const bootstrap = recordingListeners(() => resumeWith(host, "CounterA"));
    const app = bootstrap.result!;
    disposers.push(() => app.dispose());

    const afterBootstrap = { loads: [...probe.loads], text: label(host, "a-label"), stats: { ...app.stats } };

    click(host, "a-inc");
    await app.settled();
    const afterFirstClick = { loads: [...probe.loads], text: label(host, "a-label"), stats: { ...app.stats } };

    click(host, "a-inc");
    await app.settled();
    click(host, "a-dec");
    await app.settled();
    const afterIncIncDec = { loads: [...probe.loads], text: label(host, "a-label"), stats: { ...app.stats } };
    // Both modules are bound now. Take the slots they were created with here:
    // later tests resume further apps, and `probe.slots` keeps only the latest.
    const slots = { s0: probe.slots.get("s0")!, s1: probe.slots.get("s1")! };

    // Two more clicks on already-bound handlers: the import must not repeat.
    click(host, "a-dec");
    await app.settled();
    click(host, "a-inc");
    await app.settled();
    const afterReuse = { loads: [...probe.loads], text: label(host, "a-label"), stats: { ...app.stats } };

    return {
      app,
      host,
      servedHtml,
      beforeMount,
      listeners: bootstrap.calls,
      slots,
      afterBootstrap,
      afterFirstClick,
      afterIncIncDec,
      afterReuse,
    };
  })();

  describe(`resume [${backendName}] — the instrument`, () => {
    it("fires on a fixture module that really is imported (positive control)", () => {
      // CounterB is imported statically at the top of this module, which the
      // test file imports before anything else runs. Its hook fired then,
      // which is what licenses the absence claims.
      expect(transcript.beforeMount).toContain("src/fixtures/CounterB.tsx");
    });
  });

  describe(`resume [${backendName}] — zero component execution`, () => {
    it("never imports the component's own module, before or after interaction", () => {
      for (const stage of [
        transcript.beforeMount,
        transcript.afterBootstrap.loads,
        transcript.afterFirstClick.loads,
        transcript.afterIncIncDec.loads,
        transcript.afterReuse.loads,
      ]) {
        expect(stage).not.toContain("src/fixtures/CounterA.tsx");
        // And no other fixture sneaks in on the resume path either: the only
        // fixture load in this registry is the positive control's own import.
        expect(fixtureLoads(stage)).toEqual(["src/fixtures/CounterB.tsx"]);
      }
    });

    it("imports no handler module at bootstrap — the page is live but inert", () => {
      expect(handlerLoads(transcript.afterBootstrap.loads)).toEqual([]);
      expect(transcript.afterBootstrap.stats.handlerLoads).toBe(0);
      // Bootstrap is pure setup: markup, cells, locators, one listener.
      expect(transcript.afterBootstrap.text).toBe("count: 0");
      expect(transcript.servedHtml).toBe(template.html);
    });

    it("imports exactly the wired handler module, and only once the event fires", () => {
      expect(handlerLoads(transcript.afterFirstClick.loads)).toEqual(["artifacts/CounterA/handlers/s0.js"]);
      expect(transcript.afterFirstClick.stats.handlerLoads).toBe(1);
    });

    it("does not re-import a handler it has already bound", () => {
      // Five clicks across the transcript, two handler modules, two imports.
      expect(handlerLoads(transcript.afterReuse.loads)).toEqual([
        "artifacts/CounterA/handlers/s0.js",
        "artifacts/CounterA/handlers/s1.js",
      ]);
      expect(transcript.afterReuse.stats.dispatches).toBe(5);
      expect(transcript.afterReuse.stats.handlerLoads).toBe(2);
    });

    it("depends on nothing at all — statically, not by observation", () => {
      // The runtime evidence above says the component never ran. This says it
      // *cannot*: no module on the resume path so much as imports the
      // renderer, so neither of Solid's two DOM entry points is reachable from
      // it. Bare specifiers are read straight out of the sources.
      //
      // The permitted set is empty: `cells.ts` supplies the three functions
      // a signals-backed path would import, so the resume path imports
      // nothing outside itself. That is the byte claim, stated as a source
      // property rather than as a measurement.
      const dir = resolve(process.cwd(), "src/resume");
      const specifiers = new Set<string>();
      for (const file of readdirSync(dir)) {
        const source = readFileSync(join(dir, file), "utf8");
        for (const match of source.matchAll(/\bfrom\s+"([^"]+)"|\bimport\s*\(\s*"([^"]+)"/g)) {
          specifiers.add(match[1] ?? match[2]);
        }
      }

      const bare = [...specifiers].filter((specifier) => !specifier.startsWith(".")).sort();
      expect(bare).toEqual([]);
      for (const specifier of specifiers) {
        expect(specifier).not.toMatch(/fixtures/);
      }
      // Handler modules are reached only through `import.meta.glob`'s lazy
      // thunks: no static import and no literal `import()` names one.
      expect([...specifiers].some((specifier) => specifier.includes("handlers/"))).toBe(false);
    });

    it("installs one delegated listener, on the container itself", () => {
      expect(transcript.listeners).toHaveLength(1);
      expect(transcript.listeners[0].type).toBe("click");
      expect(transcript.listeners[0].target).toBe(transcript.host);
      // Which is to say: nothing was attached to the buttons themselves.
      for (const call of transcript.listeners) {
        expect(call.target).not.toBe(transcript.host.querySelector('[data-testid="a-inc"]'));
      }
    });
  });

  describe(`resume [${backendName}] — the DOM updates`, () => {
    function fresh(): { host: HTMLElement; app: ResumedApp } {
      const host = mount(template.html);
      const app = resumeWith(host, "CounterA")!;
      expect(app).not.toBeNull();
      disposers.push(() => app.dispose());
      return { host, app };
    }

    it("starts at the served text and patches the bound span on each click", async () => {
      const { host, app } = fresh();

      expect(label(host, "a-label")).toBe("count: 0");

      click(host, "a-inc");
      await app.settled();
      expect(label(host, "a-label")).toBe("count: 1");

      click(host, "a-dec");
      await app.settled();
      expect(label(host, "a-label")).toBe("count: 0");

      // Back to the served bytes exactly — the resumed page is still the page.
      expect(host.innerHTML).toBe(template.html);
      expect(app.stats.patches).toBe(2);
    });

    it("ignores events on elements no wiring record claims", async () => {
      const { host, app } = fresh();

      click(host, "a-label");
      await app.settled();

      expect(app.stats.dispatches).toBe(0);
      expect(app.stats.handlerLoads).toBe(0);
      expect(label(host, "a-label")).toBe("count: 0");
    });

    it("stops responding once disposed", async () => {
      const { host, app } = fresh();
      app.dispose();

      click(host, "a-inc");
      await app.settled();

      expect(app.stats.dispatches).toBe(0);
      expect(label(host, "a-label")).toBe("count: 0");
    });
  });

  describe(`resume [${backendName}] — no tear: both handlers share one cell`, () => {
    it("reads through what the other handler wrote (inc, inc, dec)", () => {
      expect(transcript.afterIncIncDec.text).toBe("count: 1");
      expect(transcript.afterIncIncDec.stats.handlerLoads).toBe(2);
    });

    it("bound both lazily-imported modules to the very same cell object", () => {
      const cell = transcript.app.cells.get("c0")!;
      const { s0: inc, s1: dec } = transcript.slots;

      // Identity, not equality: one accessor and one setter, handed to both
      // modules. Two cells each initialized to 0 would pass every behavioural
      // assertion above until the two handlers disagreed — so assert the thing
      // itself.
      expect(inc.count).toBe(cell.get);
      expect(dec.count).toBe(cell.get);
      expect(inc.setCount).toBe(cell.set);
      expect(dec.setCount).toBe(cell.set);
      expect(transcript.app.cells.size).toBe(1);
    });

    it("lets the cell be driven from outside and both handlers see it", async () => {
      const { app, host } = transcript;
      const cell = app.cells.get("c0")!;

      cell.set(41);
      // Writes are batched on both backends; settle before reading back. This
      // is the backend's own `flush`, which is the clause under test.
      backend.flush();
      expect(cell.get()).toBe(41);

      click(host, "a-inc");
      await app.settled();
      expect(label(host, "a-label")).toBe("count: 42");

      click(host, "a-dec");
      await app.settled();
      expect(label(host, "a-label")).toBe("count: 41");
    });
  });

  describe(`resume [${backendName}] — the fallback path is untouched`, () => {
    it("refuses a component with no artifacts, without loading anything", () => {
      const before = [...probe.loads];
      const host = mount("<div><span data-testid=\"b-label\">count: 0</span></div>");

      // CounterB was refused by the comptime pass, so it has no artifacts and
      // the resumer has nothing to say about it. It declines by returning null
      // rather than throwing, so a build can fall through to render().
      expect(resumeWith(host, "CounterB")).toBeNull();

      // Every component this repo has emitted artifacts for, and no other. The
      // two guard-only bundles are `MainSection` and `Footer`: a store, a read
      // slot and one region recorded absent, with no template, no binding and
      // no wiring in them. They are here because the registry takes a bundle
      // that installs nothing exactly as it takes any other — and CounterB is
      // still not, which is the claim.
      //
      // `KeyedRoster.RosterList` is T015's carrier, added as a declared move
      // rather than as drift: it is a checked-in golden like the other three,
      // and `artifacts.ts` globs `artifacts/*/*.js` STATICALLY, so a bundle in
      // this tree is a bundle in the eager registry. That is what this list is
      // for — the tree and the registry are the same fact, and a bundle that
      // appeared in one without being declared in the other is exactly the
      // thing worth failing over.
      expect(listBundles()).toEqual([
        "CounterA",
        "KeyedRoster.RosterList",
        "app.Footer",
        "app.MainSection",
      ]);

      expect(host.innerHTML).toBe("<div><span data-testid=\"b-label\">count: 0</span></div>");
      expect(probe.loads).toEqual(before);
    });

    it("refuses markup that is not the component's template", () => {
      const host = mount("<div><span>something else entirely</span></div>");

      // Locators are child indices: resuming foreign markup would silently
      // bind the wrong nodes, so it is a refusal rather than a best effort.
      expect(() => resumeWith(host, "CounterA")).toThrow(/not CounterA's template/);
    });

    it("still renders and drives Fixture B through unmodified solid-js", () => {
      const host = document.createElement("div");
      document.body.appendChild(host);
      hosts.push(host);
      const dispose = render(CounterB as never, host);
      disposers.push(dispose);

      expect(label(host, "b-label")).toBe("count: 0");

      // One flush per click: Solid 2 batches writes, and Fixture B's handlers
      // read-then-write, exactly as `test/classic-baseline.test.tsx` does it.
      // Solid's own `flush`, unconditionally: the fallback path is the
      // *unmodified* framework, and the cell backend has nothing to do with
      // it on either run.
      click(host, "b-inc");
      solidFlush();
      expect(label(host, "b-label")).toBe("count: 1");

      click(host, "b-dec");
      solidFlush();
      click(host, "b-dec");
      solidFlush();
      expect(label(host, "b-label")).toBe("count: -1");
    });

    it("runs a resumed component and a rendered one side by side", async () => {
      const resumedHost = mount(template.html);
      const app = resumeWith(resumedHost, "CounterA")!;
      disposers.push(() => app.dispose());

      const renderedHost = document.createElement("div");
      document.body.appendChild(renderedHost);
      hosts.push(renderedHost);
      const dispose = render(CounterB as never, renderedHost);
      disposers.push(dispose);

      click(resumedHost, "a-inc");
      await app.settled();
      click(renderedHost, "b-dec");
      solidFlush();

      // Two entirely different mechanisms on one page, neither disturbing the
      // other: A never ran its component, B never left the ordinary path. On
      // the kernel run they are not even the same reactive runtime.
      expect(label(resumedHost, "a-label")).toBe("count: 1");
      expect(label(renderedHost, "b-label")).toBe("count: -1");
      expect(fixtureLoads(probe.loads)).toEqual(["src/fixtures/CounterB.tsx"]);
    });
  });
}
