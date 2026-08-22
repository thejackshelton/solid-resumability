import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

import {
  ADDRESSED,
  CARRIED,
  CLAIMED,
  DEMO_ROOT,
  FIXTURES,
  WRITTEN,
  classicName,
  readManifest,
  readTemplate,
} from "../build/fixtures.mjs";
import { resumableHtml, variantLabel } from "../build/plugins.mjs";
import { resumeAll, stores } from "../src/resumable-page.ts";

/**
 * The fixtures page, under evidence — and the source of the one number in
 * `docs/measurements/demo-baseline.json` that no static analysis of `dist/`
 * could produce: how many component bodies the resumable page executes.
 *
 * ── The instrument ────────────────────────────────────────────────────────
 * Each `vi.mock` below installs a loader hook on one module. The factory runs
 * exactly once, the first time anything in this file's registry evaluates
 * that module, and it records the fact before handing back the original —
 * with the component functions wrapped so that *calling* one is recorded too.
 * Two different claims, two different counters: a module that never loads
 * cannot have run, and a module that loads but is never called did not run
 * either. The measurement reports both.
 *
 * Absence is only evidence if the instrument fires, so this file carries its
 * own positive control, and it is sharper than a static import would be: the
 * classic page is imported *after* the resumable transcript is taken, through
 * a dynamic `import()`. Before that line, no fixture module has been
 * evaluated in this registry. After it, all four have — same hooks, same
 * registry, same page. What separates the two is which variant asked.
 *
 * ── The transcript ────────────────────────────────────────────────────────
 * The whole resumable run happens once, at module scope, before any `it()`
 * body: a "not loaded yet" claim is about a moment in time, and reading it
 * out of a shared module registry inside a test would make the result depend
 * on which test ran first. Nothing below depends on test ordering.
 */

const probe = vi.hoisted(() => ({
  /** Fixture module ids, in evaluation order. */
  moduleLoads: [] as string[],
  /** Component functions actually invoked, in call order. */
  executions: [] as string[],
  /** Handler artifact modules imported, in load order. */
  handlerLoads: [] as string[],
}));

/** Records a fixture module's evaluation, and every call of its components. */
function componentHook(module: string, names: string[]) {
  return async (importOriginal: () => Promise<Record<string, unknown>>) => {
    const original = await importOriginal();
    probe.moduleLoads.push(module);
    const wrapped: Record<string, unknown> = { ...original };
    for (const name of names) {
      const component = original[name] as (...args: unknown[]) => unknown;
      wrapped[name] = (...args: unknown[]) => {
        probe.executions.push(name);
        return component(...args);
      };
    }
    return wrapped;
  };
}

vi.mock("../../app/src/fixtures/ProvableCounter.tsx", componentHook("ProvableCounter.tsx", ["ProvableCounter"]));
vi.mock("../../app/src/fixtures/ProvableStepper.tsx", componentHook("ProvableStepper.tsx", ["ProvableStepper"]));
vi.mock("../../app/src/fixtures/ProvableGreeting.tsx", componentHook("ProvableGreeting.tsx", ["ProvableGreeting"]));
vi.mock(
  "../../app/src/fixtures/PropsPair.tsx",
  componentHook("PropsPair.tsx", ["PropsPairParent", "PropsCountLabel", "PropsStepButton"]),
);
// The addressed pair, and BOTH names are hooked for the same reason the
// carrier's are: "the resumable page runs no component body" is a claim about
// every component the page serves, and this module holds two of them. Only
// `ComposedOuter` is declared as a mount — `ComposedInner` arrives through its
// parent's template with an address of its own — so an instrument that watched
// the declaration alone would be blind to the very component this fixture
// exists to test.
vi.mock(
  "../../app/src/fixtures/ComposedCounter.tsx",
  componentHook("ComposedCounter.tsx", ["ComposedOuter", "ComposedInner"]),
);
// The carrier's module holds both halves of the mount: the provider the classic
// path renders and the list the resume path takes over. Both are named, because
// "no component body ran" has to cover the one that creates the store as well as
// the one that reads it.
vi.mock("../../app/src/fixtures/KeyedRoster.tsx", componentHook("KeyedRoster.tsx", ["Roster", "RosterList"]));

/** Records a handler artifact module's lazy import. */
function handlerHook(id: string) {
  return async (importOriginal: () => Promise<Record<string, unknown>>) => {
    const original = await importOriginal();
    probe.handlerLoads.push(id);
    return original;
  };
}

vi.mock("../artifacts/ProvableCounter/handlers/s0.js", handlerHook("ProvableCounter/s0"));
vi.mock("../artifacts/ProvableCounter/handlers/s1.js", handlerHook("ProvableCounter/s1"));
vi.mock("../artifacts/ProvableStepper/handlers/s0.js", handlerHook("ProvableStepper/s0"));
vi.mock("../artifacts/ProvableStepper/handlers/s1.js", handlerHook("ProvableStepper/s1"));
vi.mock("../artifacts/ProvableGreeting/handlers/s0.js", handlerHook("ProvableGreeting/s0"));
vi.mock("../artifacts/ProvableGreeting/handlers/s1.js", handlerHook("ProvableGreeting/s1"));
vi.mock("../artifacts/PropsPair.PropsPairParent/handlers/s0.js", handlerHook("PropsPairParent/s0"));
// Two artifact directories, one mount. The claimed child's handler chunk is
// hooked exactly like a declared mount's, because it is one: an addressed child
// keeps its own cell and its own wiring, and the only thing it does not have is
// a line in `FIXTURES`.
vi.mock("../artifacts/ComposedCounter.ComposedOuter/handlers/s0.js", handlerHook("ComposedOuter/s0"));
vi.mock("../artifacts/ComposedCounter.ComposedInner~65b38574/handlers/s0.js", handlerHook("ComposedInner/s0"));
vi.mock("../artifacts/KeyedRoster.RosterList/handlers/s0.js", handlerHook("RosterList/s0"));

/** Every handler module the build emitted for this page, across all SEVEN
 * addresses — the six declared mounts and the one claimed child. */
const HANDLER_MODULE_COUNT = 10;

/**
 * Solid's marker for a dynamic insert — the one string in this file that
 * belongs to the framework rather than to this project.
 *
 * It follows a component child that has a following sibling, and it does NOT
 * follow one that is its parent's last node: the closing tag already ends the
 * inserted range, so there is nothing for a marker to say. The see-through
 * parent has two children in the middle of its root and carries two; the
 * addressed parent's one child is last and carries none. Both readings are
 * taken off `render()` below rather than declared here.
 */
const PLACEHOLDER = "<!---->";

/** The carried mount, addressed the way the document stamps it. */
const ROSTER = '[data-resume="KeyedRoster.RosterList"]';

/**
 * The order `demo/fixtures.html` serves the roster in, and the order
 * `demo/src/roster-store.ts` seeds it in. They are reverses of each other on
 * purpose: the assertions below are only evidence about IDENTITY because
 * position gives a different answer.
 */
const SERVED_KEYS = ["alan", "grace", "ada"];
const SEEDED_KEYS = ["ada", "grace", "alan"];

/** The interaction each fixture is driven through, and what it must produce. */
const INTERACTIONS = [
  {
    component: "ProvableCounter",
    click: "provable-counter-inc",
    read: "provable-counter-label",
    before: "count: 0",
    after: "count: 1",
  },
  {
    component: "ProvableStepper",
    click: "provable-stepper-up",
    read: "provable-stepper-total",
    before: "15",
    after: "20",
  },
  {
    component: "ProvableGreeting",
    click: "provable-greeting-solid",
    read: "provable-greeting-text",
    before: "hello, world",
    after: "hello, solid",
  },
  {
    component: "PropsPairParent",
    click: "props-pair-inc",
    read: "props-pair-label",
    before: "0",
    after: "1",
  },
  /**
   * The addressed pair, driven as two — which is the whole point of addressing
   * a child rather than absorbing one.
   *
   * `PropsPairParent` above is the see-through case: its children's bindings
   * were re-homed onto the parent's cells, so ONE address answers for the whole
   * subtree. These two are the opposite. `ComposedInner` owns a cell the parent
   * has no slot for, so it kept its own address, its own wiring and its own
   * handler chunk — and the evidence for that is two numbers moving
   * independently, each from a chunk fetched by its own click.
   */
  {
    component: "ComposedOuter",
    click: "composed-outer-inc",
    read: "composed-outer-label",
    before: "outer: 0",
    after: "outer: 1",
  },
  {
    component: "ComposedInner",
    click: "composed-inner-inc",
    read: "composed-inner-label",
    before: "inner: 0",
    after: "inner: 1",
  },
  {
    component: "RosterList",
    /**
     * Addressed structurally rather than by `data-testid`, because the corpus
     * is frozen and this component has none — and because addressing the item
     * by its KEY is the assertion. `alan` is the store's THIRD member and the
     * document's FIRST item: a dispatch resolved by position would answer with
     * `ada`, which is what makes "dropped alan" evidence rather than a
     * coincidence.
     */
    clickSelector: `${ROSTER} li[data-key="alan"] .drop`,
    readSelector: `${ROSTER} .last`,
    before: "none",
    after: "dropped alan",
  },
];

/** Where an interaction reads its answer, and where it clicks. */
const target = (step: { click?: string; read?: string; clickSelector?: string; readSelector?: string }, which: "click" | "read") =>
  which === "click"
    ? (step.clickSelector ?? `[data-testid="${step.click}"]`)
    : (step.readSelector ?? `[data-testid="${step.read}"]`);

const PAGE_HTML = readFileSync(join(DEMO_ROOT, "fixtures.html"), "utf8");

type HtmlTransform = (html: string, ctx?: { path: string }) => string | Promise<string>;

/** A plugin's `transformIndexHtml`, whichever of its two shapes it uses. */
function htmlHook(plugin: { transformIndexHtml?: unknown }): HtmlTransform {
  const transform = plugin.transformIndexHtml as
    | HtmlTransform
    | { handler: HtmlTransform }
    | undefined;
  const handler = typeof transform === "function" ? transform : transform?.handler;
  if (!handler) throw new Error("demo: plugin has no transformIndexHtml hook");
  return handler;
}

/**
 * Runs the real build plugins over the real page — no second copy of either.
 *
 * `source` is a parameter so the refusal tests below can serve a DOCTORED page
 * through the same pipeline the shipped one goes through. A test that reached
 * for its own copy of the rewrite would be a test of itself; this one hands the
 * plugin a page with a key missing and reads what it says.
 */
async function servePage(variant: "classic" | "resumable", source = PAGE_HTML): Promise<Document> {
  let html = (await htmlHook(variantLabel(variant))(source)) as string;
  if (variant === "resumable") {
    html = (await htmlHook(resumableHtml())(html, { path: "/fixtures.html" })) as string;
  }
  return new DOMParser().parseFromString(html, "text/html");
}

/** The mount element of one fixture, found by the name its `data-component`
 * states — the classic path's name, which is the provider's on a carried mount. */
function mount(document_: Document, fixture: { component: string; classic?: string }): HTMLElement {
  const name = classicName(fixture);
  const host = document_.querySelector<HTMLElement>(`[data-component="${name}"]`);
  expect(host, `no mount for ${name}`).toBeTruthy();
  return host!;
}

/**
 * The claimed child of an addressed fixture.
 *
 * `ADDRESSED` is a filter over a list whose entries do not all carry the field,
 * so this is the one boundary where the declaration's shape has to be named —
 * the same job `mount`'s parameter type does for `classic`. The filter is the
 * narrowing; this states it in a way the checker can read.
 */
function claimedOf(fixture: { addressed?: { component: string; artifact: string } }) {
  const claimed = fixture.addressed;
  expect(claimed, "an ADDRESSED fixture with no claimed child").toBeTruthy();
  return claimed!;
}

/** Every fixture's served markup, keyed by the name the PASS knows it by. */
function markupOf(document_: Document): Record<string, string> {
  return Object.fromEntries(FIXTURES.map(fixture => [fixture.component, mount(document_, fixture).innerHTML]));
}

function read(document_: Document, selector: string): string {
  return document_.querySelector(selector)?.textContent ?? "";
}

function click(document_: Document, selector: string): void {
  const element = document_.querySelector(selector);
  expect(element, `missing element ${selector}`).toBeTruthy();
  element!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

/**
 * The one run whose timing is the evidence. Everything here happens before
 * the first `it()` body, using a top-level await.
 */
const transcript = await (async () => {
  const beforeAnything = {
    moduleLoads: [...probe.moduleLoads],
    executions: [...probe.executions],
    handlerLoads: [...probe.handlerLoads],
  };

  const served = await servePage("resumable");
  const servedMarkup = markupOf(served);

  const page = await resumeAll(served);

  /** The region's markup, and whether the store exists yet — the two halves of
   * the carrier's claim, read at each stage. */
  const rosterList = () => served.querySelector(`${ROSTER} ul.roster`)!.innerHTML;
  const rosterKeys = () =>
    [...served.querySelectorAll(`${ROSTER} li[data-key]`)].map(item => item.getAttribute("data-key"));

  const afterBootstrap = {
    moduleLoads: [...probe.moduleLoads],
    executions: [...probe.executions],
    handlerLoads: [...probe.handlerLoads],
    text: Object.fromEntries(INTERACTIONS.map(step => [step.component, read(served, target(step, "read"))])),
    handlerLoadsCounted: page.resumed.reduce((total, app) => total + app.stats.handlerLoads, 0),
    storeProvided: stores.has("s0"),
    rosterList: rosterList(),
    rosterKeys: rosterKeys(),
  };

  for (const step of INTERACTIONS) click(served, target(step, "click"));
  for (const app of page.resumed) await app.settled();

  const afterFirstInteraction = {
    moduleLoads: [...probe.moduleLoads],
    executions: [...probe.executions],
    handlerLoads: [...probe.handlerLoads],
    text: Object.fromEntries(INTERACTIONS.map(step => [step.component, read(served, target(step, "read"))])),
    handlerLoadsCounted: page.resumed.reduce((total, app) => total + app.stats.handlerLoads, 0),
    storeProvided: stores.has("s0"),
    rosterList: rosterList(),
    rosterKeys: rosterKeys(),
  };

  // Click every button a second time: an already-bound handler must not
  // re-import its module.
  for (const step of INTERACTIONS) click(served, target(step, "click"));
  for (const app of page.resumed) await app.settled();

  const afterSecondInteraction = {
    handlerLoads: [...probe.handlerLoads],
    handlerLoadsCounted: page.resumed.reduce((total, app) => total + app.stats.handlerLoads, 0),
  };

  return {
    page,
    served,
    servedMarkup,
    beforeAnything,
    afterBootstrap,
    afterFirstInteraction,
    afterSecondInteraction,
  };
})();

/**
 * The positive control, taken after the transcript: importing the classic
 * page is what loads the four component modules, and mounting it is what runs
 * them.
 */
const classic = await (async () => {
  const beforeImport = { moduleLoads: [...probe.moduleLoads], executions: [...probe.executions] };

  const { mountAll } = await import("../src/classic-page.ts");
  const afterImport = { moduleLoads: [...probe.moduleLoads], executions: [...probe.executions] };

  const page = await servePage("classic");
  // `render()` creates nodes with the global document's factory, so the
  // classic variant is mounted into the real one rather than into a parsed
  // copy. The markup under test is the parsed page's, verbatim.
  document.body.innerHTML = page.body.innerHTML;
  const dispose = mountAll(document);

  const markup = markupOf(document);
  const afterMount = { moduleLoads: [...probe.moduleLoads], executions: [...probe.executions] };

  return { beforeImport, afterImport, afterMount, markup, emptyMounts: page, dispose };
})();

afterAll(() => {
  transcript.page.dispose();
  classic.dispose();

  // The measurement's `componentExecutionsBeforeInteraction` comes from here
  // and nowhere else: `pnpm measure` reads this file and refuses to run
  // without it. A hardcoded zero in the report would be an assertion; this is
  // a reading.
  const path = join(DEMO_ROOT, ".measure/executions.json");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify(
      {
        source: "demo/test/fixtures-page.test.ts",
        page: "fixtures.html",
        variant: "resumable",
        components: FIXTURES.map(fixture => fixture.component),
        /** Component *modules* evaluated by the resumable page, ever. */
        componentModuleLoadsBeforeInteraction: transcript.afterBootstrap.moduleLoads.length,
        componentModuleLoadsAfterInteraction: transcript.afterFirstInteraction.moduleLoads.length,
        /** Component *bodies* run by the resumable page, ever. */
        componentExecutionsBeforeInteraction: transcript.afterBootstrap.executions.length,
        componentExecutionsAfterInteraction: transcript.afterFirstInteraction.executions.length,
        /** Handler artifact modules imported, by stage. */
        handlerChunkLoadsBeforeInteraction: transcript.afterBootstrap.handlerLoads.length,
        handlerChunkLoadsAfterInteraction: transcript.afterFirstInteraction.handlerLoads.length,
        handlerChunkLoadsAfterSecondInteraction: transcript.afterSecondInteraction.handlerLoads.length,
        handlerChunksTotal: HANDLER_MODULE_COUNT,
        /** The same instrument, on the classic variant of the same page. */
        classicComponentModuleLoads: classic.afterMount.moduleLoads.length,
        classicComponentExecutions: classic.afterMount.executions.length,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
});

describe("the instrument", () => {
  it("does not fire until something asks for a component module", () => {
    expect(transcript.beforeAnything.moduleLoads).toEqual([]);
    expect(classic.beforeImport.moduleLoads).toEqual([]);
  });

  it("fires on the classic page, which really does import all six (positive control)", () => {
    expect(classic.afterImport.moduleLoads.sort()).toEqual([
      "ComposedCounter.tsx",
      "KeyedRoster.tsx",
      "PropsPair.tsx",
      "ProvableCounter.tsx",
      "ProvableGreeting.tsx",
      "ProvableStepper.tsx",
    ]);
    // And mounting it runs them: six parents, plus PropsPair's two children,
    // the composed parent's one, and the roster's list inside its provider.
    expect(classic.afterMount.executions).toContain("ProvableCounter");
    expect(classic.afterMount.executions).toContain("Roster");
    expect(classic.afterMount.executions.length).toBeGreaterThanOrEqual(5);
  });
});

describe("the resumable page executes no component", () => {
  it("imports no component module, before or after interaction", () => {
    expect(transcript.afterBootstrap.moduleLoads).toEqual([]);
    expect(transcript.afterFirstInteraction.moduleLoads).toEqual([]);
  });

  it("runs no component body, before or after interaction", () => {
    expect(transcript.afterBootstrap.executions).toEqual([]);
    expect(transcript.afterFirstInteraction.executions).toEqual([]);
  });

  it("resumed all seven components and fell back for none", () => {
    // SIX declarations, SEVEN resumptions — the count the addressed mount
    // moved, restated rather than loosened. `resumeAll` walks the served
    // document's `[data-resume]` elements, and the seventh is not in
    // `FIXTURES` because nothing declared it: the analysis derived it from
    // `ComposedCounter.tsx` and the pass stamped its address into the parent's
    // template. `CLAIMED` is where the demo writes that down, so this stays an
    // arithmetic statement about what the page holds rather than a number
    // somebody read off a failure.
    expect(transcript.page.resumed).toHaveLength(FIXTURES.length + CLAIMED.length);
    expect(transcript.page.fellBack).toEqual([]);
  });
});

describe("handler chunks load on the first event and not before", () => {
  it("imports no handler module at bootstrap — the page is live but inert", () => {
    expect(transcript.afterBootstrap.handlerLoads).toEqual([]);
    expect(transcript.afterBootstrap.handlerLoadsCounted).toBe(0);
    for (const step of INTERACTIONS) {
      expect(transcript.afterBootstrap.text[step.component]).toBe(step.before);
    }
  });

  it("imports exactly the handler the event needed, one per interaction", () => {
    expect(transcript.afterFirstInteraction.handlerLoads.sort()).toEqual([
      "ComposedInner/s0",
      "ComposedOuter/s0",
      "PropsPairParent/s0",
      "ProvableCounter/s0",
      "ProvableGreeting/s0",
      "ProvableStepper/s0",
      "RosterList/s0",
    ]);
    expect(transcript.afterFirstInteraction.handlerLoadsCounted).toBe(INTERACTIONS.length);
    // Seven of the ten handler modules the build emitted; the other three
    // belong to buttons nobody pressed. The roster's is ONE for a list of
    // three: a region's wiring is per item TEMPLATE, not per item, so the
    // second and third members would dispatch through the module the first
    // one fetched.
    //
    // Two of the seven come out of ONE mount, and that is the addressed
    // fixture's evidence: the parent and the child each fetched their own
    // chunk on their own click. A child the parent had absorbed would have
    // dispatched through its parent's.
    expect(transcript.afterFirstInteraction.handlerLoads).toHaveLength(7);
    // The total, restated over every ADDRESS on the page rather than over
    // every declaration. `FIXTURES` is six manifests; the claimed child's is
    // the seventh, and it holds a handler nothing would have counted if this
    // sum had stayed a sum over mounts.
    expect(HANDLER_MODULE_COUNT).toBe(
      [...FIXTURES, ...CLAIMED].reduce(
        (total, artifact) => total + readManifest(artifact).handlers.length,
        0,
      ),
    );
  });

  it("does not re-import a handler it has already bound", () => {
    expect(transcript.afterSecondInteraction.handlerLoads).toHaveLength(7);
    expect(transcript.afterSecondInteraction.handlerLoadsCounted).toBe(INTERACTIONS.length);
  });

  it("patched the DOM from the handler that arrived", () => {
    for (const step of INTERACTIONS) {
      expect(transcript.afterFirstInteraction.text[step.component]).toBe(step.after);
    }
  });
});

describe("the two variants serve the same page", () => {
  it("mounts the same components, in the same order, from one HTML file", () => {
    const served = [...transcript.served.querySelectorAll("[data-component]")].map(
      element => (element as HTMLElement).dataset.component,
    );
    // Six names in the file, SEVEN in the served document, and the extra one is
    // not a mount this page declared — it is the address the pass wrote into
    // its parent's template. So the expectation splices it in where the pass
    // puts it (inside the parent, therefore immediately after it in document
    // order) rather than being relaxed into a subset or a length.
    expect(served).toEqual(
      FIXTURES.flatMap(fixture =>
        fixture.addressed
          ? [classicName(fixture), fixture.addressed.component]
          : [classicName(fixture)],
      ),
    );

    // And "after" is the weaker half of the fact: the child is INSIDE its
    // parent's mount, which is what makes it one mount holding two components
    // rather than two mounts the document happens to list in a row.
    for (const fixture of ADDRESSED) {
      const claimed = claimedOf(fixture);
      const parent = mount(transcript.served, fixture);
      const child = parent.querySelector(`[data-resume="${claimed.artifact}"]`);
      expect(child, `no claimed child inside ${fixture.component}`).toBeTruthy();
      expect(child!.getAttribute("data-component")).toBe(claimed.component);
    }
  });

  it("serves markup byte-identical to what render() produces — every WRITTEN mount, no exemption", () => {
    // The resumable page's markup is inlined at build time from the template
    // artifact; the classic page's is produced at runtime by Solid. This is
    // the check the resumer would otherwise make against a template module it
    // no longer ships — moved to where it costs the browser nothing.
    //
    // The loop is unnormalized — a raw string comparison, per fixture — and
    // unfiltered within its subject: the see-through parent's template carries
    // Solid's component placeholders and is compared with them in it.
    //
    // What the loop is NOT is a claim about the carried mount, and the reason
    // is not an exemption granted to it. This equality is between two things
    // that describe the same act: bytes the pass WROTE into the mount, and the
    // bytes `render()` writes into the same mount. The carrier's emitted
    // template is the empty container — its list is a store projection, so the
    // pass folds no items — while the document serves three. The two are
    // supposed to differ, and the comparison that holds them together is the
    // build's own `check-template` edit: parsed nodes, region emptied. That
    // one is asserted below, on the same served page, and it is the check with
    // teeth here rather than a weakened version of this one.
    for (const fixture of WRITTEN) {
      expect(transcript.servedMarkup[fixture.component]).toBe(classic.markup[fixture.component]);
    }
  });

  it("serves the addressed parent as render() with its child re-wrapped — the third byte claim", async () => {
    // The loop above is about mounts the pass filled from ONE template. This
    // mount's bytes are two templates: the parent's, with a hole in it, and the
    // child's, in the hole. So the same claim — "the served bytes are what
    // `render()` produces" — is derived ONE LEVEL UP rather than dropped. No
    // mount on this page is without a byte claim; there are three kinds and
    // three claims.
    //
    // What the difference IS, stated exactly: where `render()` closes the
    // child's markup and writes whatever marker it writes for an insert, the
    // pass gave the child an ADDRESS instead — so the served page wraps the
    // SAME child bytes in the element that carries that address. One
    // substitution, nothing normalized, nothing skipped.
    for (const fixture of ADDRESSED) {
      const claimed = claimedOf(fixture);
      const renderOuter = classic.markup[fixture.component];
      const { html: renderInner } = await readTemplate(claimed);

      // The child's emitted template is what `render()` puts inside the parent.
      // The pass emitted it separately because the parent could not absorb its
      // cell — not because it renders differently.
      expect(renderOuter).toContain(renderInner);

      // The marker, READ OFF `render()`'s output rather than assumed of it:
      // whatever Solid wrote between the end of the child's markup and the
      // close of the parent's root element. Writing `<!---->` in here would be
      // this test asserting Solid's behaviour instead of measuring it — and
      // the measurement disagrees with the assumption, which is the whole
      // reason it is taken this way.
      const marker = renderOuter.slice(
        renderOuter.indexOf(renderInner) + renderInner.length,
        renderOuter.lastIndexOf("</div>"),
      );

      // It is EMPTY, and that is a fact about POSITION rather than about
      // components. Solid marks an insert with a trailing comment so a later
      // update knows where the inserted range ends; a child that is its
      // parent's LAST node needs no such mark, because the parent's closing tag
      // is already the boundary. `ComposedInner` is last, so `render()` writes
      // nothing after it. The see-through parent's two children sit in the
      // middle of their parent and carry one marker each — same Solid, same
      // build, different position — so PLACEHOLDER below is asserted where it
      // is real and this fixture is held to the absence.
      expect(marker).toBe("");
      expect(renderOuter.endsWith(renderInner + "</div>")).toBe(true);

      const seeThrough = WRITTEN.find(written => written.componentChildren > 0)!;
      expect(classic.markup[seeThrough.component].split(PLACEHOLDER).length - 1).toBe(
        seeThrough.componentChildren,
      );

      // The claim. `renderInner + marker` is the packet's substitution written
      // with the marker this build actually produced, which for a trailing
      // child is the child's markup alone.
      const wrapper = `<div data-resume="${claimed.artifact}" data-component="${claimed.component}">`;
      const expected = renderOuter.replace(renderInner + marker, wrapper + renderInner + "</div>");

      // The substitution has to have happened, or the line below would be the
      // parity loop again under another name.
      expect(expected).not.toBe(renderOuter);
      expect(transcript.servedMarkup[fixture.component]).toBe(expected);

      // And the served mount carries no marker either: an addressed child is an
      // ELEMENT, and an element needs no comment to be found. The two sides
      // differ by the container and by nothing else.
      expect(transcript.servedMarkup[fixture.component]).not.toContain(PLACEHOLDER);
    }
  });

  it("reproduces Solid's component placeholders, one per component child", () => {
    // The teeth behind the loop above. Byte-equality alone would also pass if
    // *both* sides lost their placeholders — so the count is asserted against
    // the fixture's declared component-child count on the classic side, where
    // it is Solid's own output, and the served markup is required to carry the
    // same number.
    for (const fixture of WRITTEN) {
      const placeholders = (markup: string) => markup.split(PLACEHOLDER).length - 1;

      expect(placeholders(classic.markup[fixture.component])).toBe(fixture.componentChildren);
      expect(placeholders(transcript.servedMarkup[fixture.component])).toBe(fixture.componentChildren);
    }

    // Locators are element-child indices, which comment nodes cannot shift —
    // the reason emitting the placeholders needed no change to `locate()`.
    const parent = WRITTEN.find(fixture => fixture.componentChildren > 0)!;
    const root = mount(transcript.served, parent).firstElementChild!;

    expect(root.childNodes.length).toBe(root.children.length + parent.componentChildren);
  });

  it("inlines exactly the emitted template into each written mount", async () => {
    for (const fixture of WRITTEN) {
      const { html } = await readTemplate(fixture);
      expect(transcript.servedMarkup[fixture.component]).toBe(html);
    }
  });

  it("inlines the addressed mount parent-first — the parent's template, hole filled with the child's", async () => {
    // The same bytes the claim above derived from `render()`, derived again
    // from the ARTIFACTS instead. Two independent descriptions meeting on one
    // string is what makes this a measurement of the pass rather than a
    // restatement of it: `render()` never saw an artifact, and the pass never
    // ran Solid.
    for (const fixture of ADDRESSED) {
      const claimed = claimedOf(fixture);
      const { html: parentTemplate } = await readTemplate(fixture);
      const { html: childTemplate } = await readTemplate(claimed);

      // The parent's own template carries the HOLE — an empty element stamped
      // with the child's address — and carries it emptily, which is the whole
      // reason a second walk had to fill it.
      const hole = `<div data-resume="${claimed.artifact}" data-component="${claimed.component}"></div>`;
      expect(parentTemplate).toContain(hole);

      const filled = hole.replace("></div>", `>${childTemplate}</div>`);
      expect(transcript.servedMarkup[fixture.component]).toBe(parentTemplate.replace(hole, filled));
    }
  });

  it("leaves the classic page's written mounts empty, and its carried one carried", async () => {
    const page = await servePage("classic");
    // Written and ADDRESSED both: the addressed mount is empty in the source
    // document exactly like the four above it — what differs is what the pass
    // puts in it, never what the file carries. Restated over both lists so the
    // claim did not quietly shrink when `WRITTEN` narrowed.
    for (const fixture of [...WRITTEN, ...ADDRESSED]) {
      expect(mount(page, fixture).innerHTML).toBe("");
    }
    // The carried mount is the document's own markup, so it is in BOTH
    // variants — the classic page throws it away and renders, which is the
    // work the resumable page does not do rather than a difference between
    // the two documents.
    for (const fixture of CARRIED) {
      const keys = [...mount(page, fixture).querySelectorAll("li[data-key]")].map(item =>
        item.getAttribute("data-key"),
      );
      expect(keys).toEqual(SERVED_KEYS);
    }
  });

  it("loads no handler chunk on the classic page — it has none to load", () => {
    // The classic variant's behaviour is in the component bodies, which is
    // why it had to ship all of them up front.
    expect(transcript.afterSecondInteraction.handlerLoads.length).toBe(7);
    expect(classic.afterMount.executions.length).toBeGreaterThan(0);
  });
});

/**
 * The carried mount, which is the only one on this page whose markup nothing in
 * the build wrote — and therefore the only one where "the document is the
 * template" is a claim about a person's typing rather than about a generator.
 */
describe("the carrier resumes from the markup the document carried", () => {
  it("takes over the served list without building one", () => {
    // Nothing here was rendered: the same `<li>` elements the document shipped
    // are the ones the resumed page is dispatching through, and the list is
    // byte-for-byte what the file says after five interactions.
    expect(transcript.afterBootstrap.rosterKeys).toEqual(SERVED_KEYS);
    expect(transcript.afterFirstInteraction.rosterKeys).toEqual(SERVED_KEYS);
    expect(transcript.afterFirstInteraction.rosterList).toBe(transcript.afterBootstrap.rosterList);
  });

  it("serves the store's order reversed, so position and identity disagree", () => {
    // The premise of every assertion below it. If these two were the same
    // order, resolving by position and resolving by key would produce the same
    // answer and neither test would be evidence for either.
    expect([...SERVED_KEYS].reverse()).toEqual(SEEDED_KEYS);
    expect(new Set(SERVED_KEYS)).toEqual(new Set(SEEDED_KEYS));
  });

  it("resolves the dispatch by key — the store's THIRD member, the document's first", () => {
    const step = INTERACTIONS.find(interaction => interaction.component === "RosterList")!;

    // `alan` is served first and seeded third. The readout is the store
    // action's own return value, so this string is the store naming the member
    // the click reached: by position it would be `ada`.
    expect(transcript.afterBootstrap.text.RosterList).toBe("none");
    expect(transcript.afterFirstInteraction.text.RosterList).toBe("dropped alan");
    expect(step.after).toBe(`dropped ${SEEDED_KEYS[2]}`);
    expect(SERVED_KEYS[0]).toBe(SEEDED_KEYS[2]);
  });

  it("fetches the store on the dispatch that needed it, and not at load", () => {
    // The whole shape of the third witness: a page that carries a keyed list,
    // resumes it, and still has no store until something asks. The `onMissing`
    // hook in `resumable-page.ts` is what turns the miss into one import.
    expect(transcript.afterBootstrap.storeProvided).toBe(false);
    expect(transcript.afterFirstInteraction.storeProvided).toBe(true);
  });

  it("runs neither half of the carrier's module — provider or list", () => {
    // The provider is the component the classic path renders to create the
    // store; the resumable page created the same store out of the same factory
    // without running either component body. The instrument would have said so:
    // both names are wrapped.
    expect(transcript.afterFirstInteraction.moduleLoads).not.toContain("KeyedRoster.tsx");
    expect(transcript.afterFirstInteraction.executions).toEqual([]);
  });
});

/**
 * The build's own check on that markup, driven the only way it can be believed:
 * by handing the real plugin a page somebody got wrong.
 *
 * The shipped page passing proves the edit RUNS. These prove it has teeth —
 * that the edit is verifying rather than decorative, which is exactly the
 * difference between a carried mount and an unchecked one.
 */
describe("check-template refuses a document that carries the wrong markup", () => {
  /** The one page, with one thing done to it. */
  const doctored = (from: string, to: string) => {
    expect(PAGE_HTML).toContain(from);
    return PAGE_HTML.replace(from, to);
  };

  const refusal = async (page: string): Promise<Error> => {
    const error = await servePage("resumable", page).then(
      () => null,
      (thrown: Error) => thrown,
    );
    expect(error, "the page was served").toBeTruthy();
    return error!;
  };

  it("serves the shipped page — the positive control, indentation and all", async () => {
    // Hand-authored markup is indented and an emitted template is not, so this
    // passing is the whitespace rule doing its job as much as it is the page
    // being right.
    const page = await servePage("resumable");
    expect(mount(page, CARRIED[0]).querySelectorAll("li[data-key]")).toHaveLength(SERVED_KEYS.length);
  });

  it("refuses an empty carried mount (MountMarkupMissing)", async () => {
    const emptied = PAGE_HTML.replace(
      /(<div class="mount" data-component="Roster"[^>]*>)[\s\S]*?(<\/div>\s*<\/section>)/,
      "$1$2",
    );
    expect(emptied).not.toBe(PAGE_HTML);
    expect((await refusal(emptied)).name).toBe("MountMarkupMissing");
  });

  it("refuses markup that drifted from the emitted template (MountMarkupMismatch)", async () => {
    const error = await refusal(doctored('<p class="last">none</p>', '<p class="last">nobody</p>'));
    expect(error.name).toBe("MountMarkupMismatch");
  });

  it("refuses an item with no key (RegionItemKeyMissing)", async () => {
    const error = await refusal(doctored('<li class="member" data-key="grace">', '<li class="member">'));
    expect(error.name).toBe("RegionItemKeyMissing");
  });

  it("refuses two items answering to one key (RegionItemKeyDuplicate)", async () => {
    const error = await refusal(doctored('data-key="ada"', 'data-key="alan"'));
    expect(error.name).toBe("RegionItemKeyDuplicate");
  });
});
