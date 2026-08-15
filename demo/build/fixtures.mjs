/**
 * What this demo asks the plugin to prove, and where the answers land.
 *
 * One list, read by everything that needs to agree about it: the plugin
 * declaration (`build/resumability.mjs`, which turns these into `mounts`), the
 * measurement script (which names the event that pulls each handler chunk),
 * and the tests. Nothing here does any work any more — the pass, the
 * substitution, the group module and the captured first paint all belong to
 * `unplugin-solid-resumability`, and this file is the demo's half of its
 * configuration plus the three accessors a consumer's tests need.
 *
 * The accessors are the plugin's own (`unplugin-solid-resumability/node`),
 * bound to this project's artifact root. They took a project-specific root out
 * of the signature when they were generalized; binding it back here is what
 * keeps `demo/test/**` reading `readTemplate(fixture)` exactly as it did.
 */

import { resolve, dirname } from "pathe";
import { fileURLToPath } from "node:url";

import {
  artifactDir as artifactDirIn,
  readManifest as readManifestIn,
  readTemplate as readTemplateIn,
} from "unplugin-solid-resumability/node";

export const DEMO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const REPO_ROOT = resolve(DEMO_ROOT, "..");
export const ARTIFACT_ROOT = resolve(DEMO_ROOT, "artifacts");

/**
 * The six mounts this demo declares, and the seven components they resume.
 *
 * Four of them are the ones the coverage baseline reports provable in the
 * `fixtures` segment and this demo bothers to mount; the omitted ones
 * (`LocalOnlyCounter`, `OpaqueCalleeCounter`) are the same shape as
 * `ProvableCounter` and would add nothing to the measurement but noise.
 * `RosterList` is the fifth and the odd one: its mount is CARRIED by the
 * document rather than written by the pass (see `carried` below). Nothing here
 * is provable *because* the demo says so — `docs/coverage/coverage.json` is the
 * verdict, and the pass re-derives it from the sources on every build.
 *
 * `ComposedOuter` is the sixth and the newest, and it is the first entry whose
 * mount holds a component this list does not declare. Its template carries an
 * ADDRESS — an empty element stamped with a second artifact id — and the pass
 * fills that element with the child's own emitted markup. Six declarations,
 * seven addresses on the wire: `addressed` below is where the seventh is
 * written down, so nothing has to infer it from the served page.
 *
 * `source` is read-only: it lives in `app/`, the frozen corpus, and the demo
 * imports it (classic variant) or declares it to the plugin (resumable
 * variant) without touching a byte. It is written relative to `demo/`, which
 * is the plugin's root here, so it climbs out of the demo the way every other
 * reference to the corpus does. `artifact` is the directory name the pass
 * derives from `(module, component)` — qualified by file stem when the two
 * disagree — stated rather than derived because the demo's two artifact globs
 * are split on that prefix and a rename would be a page that ships the wrong
 * markup.
 */
export const FIXTURES = [
  {
    component: "ProvableCounter",
    source: "../app/src/fixtures/ProvableCounter.tsx",
    artifact: "ProvableCounter",
    page: "fixtures",
    blurb: "One literal cell, one text binding, two handlers.",
    componentChildren: 0,
  },
  {
    component: "ProvableStepper",
    source: "../app/src/fixtures/ProvableStepper.tsx",
    artifact: "ProvableStepper",
    page: "fixtures",
    blurb: "Two cells, arithmetic derivations, handlers that read both.",
    componentChildren: 0,
  },
  {
    component: "ProvableGreeting",
    source: "../app/src/fixtures/ProvableGreeting.tsx",
    artifact: "ProvableGreeting",
    page: "fixtures",
    blurb: "A string cell and a template-literal binding.",
    componentChildren: 0,
  },
  {
    component: "PropsPairParent",
    source: "../app/src/fixtures/PropsPair.tsx",
    artifact: "PropsPair.PropsPairParent",
    page: "fixtures",
    blurb: "An accessor and a handler crossing one component boundary.",
    /**
     * The one see-through parent, and the one template that carries Solid's
     * `<!---->` placeholders.
     *
     * `render()` of a component with *component* children emits an empty
     * comment after each one — Solid's marker for a dynamic insert. The
     * comptime pass splices the children's markup into the parent's template
     * and reproduces those placeholders, so byte parity with `render()` holds
     * universally, including for anything that falls back to stock Solid
     * rather than resuming. This count is what `test/fixtures-page.test.ts`
     * checks the placeholders against, so an emitter that wrote too many or too
     * few would fail a test that names the number rather than accepting
     * whatever it saw.
     */
    componentChildren: 2,
  },
  {
    component: "ComposedOuter",
    source: "../app/src/fixtures/ComposedCounter.tsx",
    artifact: "ComposedCounter.ComposedOuter",
    page: "fixtures",
    blurb: "A parent that ADDRESSES its child rather than absorbing it — two components, two addresses, one mount.",
    /**
     * One component child, and NEITHER side of this fixture carries a
     * placeholder for it.
     *
     * Written down after being read off `render()` rather than predicted from
     * `PropsPair`, because the prediction was wrong and the difference is worth
     * keeping: Solid's `<!---->` marks where an inserted range ENDS, and a
     * component child that is its parent's LAST node needs no such mark — the
     * closing tag is already the boundary. `PropsPair`'s two children sit in
     * the middle of their parent and carry one marker each; `<ComposedInner />`
     * is the last thing in `ComposedOuter`'s root and carries none. So this
     * count is 1 component child and 0 placeholders, and the two numbers are
     * not the same number for a reason that has nothing to do with addressing.
     *
     * What addressing changes is the other side. The pass did not splice this
     * child into its parent's template; it left an ELEMENT there and gave the
     * child its own address, so the served mount carries a container where
     * `render()` carries nothing at all. `test/fixtures-page.test.ts` states
     * that as its own byte claim derived one level up — with the marker
     * recovered from actual `render()` output, which is what caught the
     * prediction — rather than exempting this mount from the parity loop.
     */
    componentChildren: 1,
    /**
     * The seventh address, and the reason this mount is neither WRITTEN nor
     * CARRIED.
     *
     * `ComposedInner` owns a `createSignal` and an inline handler, which is
     * precisely what inlining refuses: a spliced child's bindings are re-homed
     * onto its parent's cells and a child declaring its own cell is state the
     * parent has no slot for. So the pass emits it into an artifact directory
     * of its own and leaves `<div data-resume="..." data-component="..."></div>`
     * in the parent's template; `pageTemplates` walks parent-first and the
     * child's own inline edit fills it.
     *
     * Written here rather than read off the built page because the two facts
     * below are the demo's BYTE CLAIM about a container the compiler emits:
     * a test that recovered them from the served markup would agree with
     * whatever it found. Nothing DECLARES this child to the plugin — the
     * analysis derives it from the source, and `build/resumability.mjs` maps
     * `FIXTURES` to mounts without ever seeing this field.
     */
    addressed: {
      component: "ComposedInner",
      artifact: "ComposedCounter.ComposedInner",
    },
  },
  {
    component: "RosterList",
    /**
     * The name the CLASSIC path renders, which is not the name the pass proves.
     *
     * `RosterList` reads a store it does not create; `Roster` is the provider
     * that creates it, and the ordinary Solid path needs the provider or the
     * `useContext` inside the list has nothing to read. So the mount carries
     * both names, exactly as `data-component` and `data-resume` have always
     * carried the two names a mount answers to — this is the first fixture
     * where the classic name is a different COMPONENT rather than a different
     * spelling. `docs/coverage/baseline.md` records the refusal that makes the
     * provider the classic side's job.
     */
    classic: "Roster",
    source: "../app/src/fixtures/KeyedRoster.tsx",
    artifact: "KeyedRoster.RosterList",
    page: "fixtures",
    blurb: "A keyed list the document carries, resumed by key rather than by position.",
    componentChildren: 0,
    /**
     * The document owes this mount its markup, and the build verifies it.
     *
     * Every other fixture's mount is EMPTY in the source document and the pass
     * fills it with the emitted template. This component's template is an empty
     * `<ul>` — its list is a projection of a store that does not exist until the
     * page runs, so there is nothing for a build to fold — and a page served
     * that way would paint its list only once a framework arrived, which is the
     * delay this whole pass exists to remove. So `demo/fixtures.html`
     * hand-authors the items and the plugin's `check-template` edit holds them
     * to the emitted template and to their keys, at build time, every build.
     *
     * Two consequences the tests read off this flag rather than off a name:
     * the served markup is not what `render()` produces (the parity loop is
     * about mounts the pass WROTE), and the classic variant's mount is not
     * empty in the served HTML.
     */
    carried: true,
  },
];

/**
 * The mounts the pass fills out of ONE component's template.
 *
 * The parity loop's subject, and the reason the addressed mount is not in it is
 * not an exemption: this list is where "the served bytes are what `render()`
 * produces" is a comparison between two descriptions of the same act. An
 * addressed parent's served bytes are two components' markup — the pass wrote
 * one template with a hole and a second template into the hole — so the same
 * claim about it has to be derived one level up, and it is, in
 * `test/fixtures-page.test.ts`. Three kinds, three byte claims, no mount
 * without one.
 */
export const WRITTEN = FIXTURES.filter((fixture) => !fixture.carried && !fixture.addressed);

/** The mounts the document carries and the build verifies. */
export const CARRIED = FIXTURES.filter((fixture) => fixture.carried);

/** The mounts the pass fills with a template that has a HOLE in it, plus the
 * child that fills it. Written by the pass like `WRITTEN`, and held to a
 * different byte claim because two templates went into the markup. */
export const ADDRESSED = FIXTURES.filter((fixture) => Boolean(fixture.addressed));

/**
 * The claimed children, as artifact refs.
 *
 * Same shape `artifactDir`, `readManifest` and `readTemplate` take, which is
 * the point: a claimed child has no mount declaration to be read off, but its
 * artifact directory is an ordinary one and every count taken over the page's
 * artifacts has to reach it. The handler-chunk total is the first such count.
 */
export const CLAIMED = ADDRESSED.map((fixture) => fixture.addressed);

/** The name a mount's `data-component` states: the classic path's, which is the
 * pass's own name unless a provider stands between them. */
export function classicName(fixture) {
  return fixture.classic ?? fixture.component;
}

/**
 * The app components the todos page resumes — S4's one entry.
 *
 * Same shape as `FIXTURES` (so `artifactDir`, `readManifest` and `readTemplate`
 * all work on it unchanged) and a separate list because it is a separate
 * claim: these are not purpose-built fixtures but a component of the ported
 * TodoMVC, resumed inside the running app next to four siblings that still
 * render the ordinary way. The same pass proves three of that app's five
 * components (`app 3/5`); this list is the one of the three the demo RESUMES,
 * which is why it holds one entry and not three — `MainSection` and `Footer`
 * are proved with guard-only artifacts and keep their bodies in the group.
 *
 * `artifact` is what `artifactKey("app/src/app.tsx", "Header")` produces — the
 * `app.` qualification is the pass's own, for a module-local component whose
 * file stem is not its name.
 */
export const RESUMED = [
  {
    component: "Header",
    source: "../app/src/app.tsx",
    artifact: "app.Header",
    page: "todos",
    blurb: "One store action, dispatched by identity against the live store.",
    componentChildren: 0,
  },
];

export function artifactDir(fixture) {
  return artifactDirIn(ARTIFACT_ROOT, fixture);
}

/**
 * The emitted manifest, parsed.
 *
 * `any` rather than the reader's `unknown` default: the manifest's shape is the
 * pass's own and the demo's tests read it field by field. A consumer with a
 * schema types the call site; this one reads its own build's output.
 *
 * @returns {any}
 */
export function readManifest(fixture) {
  return readManifestIn(ARTIFACT_ROOT, fixture);
}

/**
 * The emitted template markup, read out of the artifact module itself rather
 * than out of the manifest — it is the module the build inlines, so it is the
 * module the build should read.
 */
export function readTemplate(fixture) {
  return readTemplateIn(ARTIFACT_ROOT, fixture);
}
