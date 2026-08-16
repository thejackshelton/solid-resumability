import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

import { analyzeFixture, analyzeWithRecordedProps, emit, runComptime } from "../src/comptime/index.ts";
import { claimedArtifactKey, type ProvableAnalysis } from "../src/comptime/types.ts";
import { locate } from "../src/resume/locate.ts";
import { createRegistry, type Bundle, type HandlerModule } from "../src/resume/registry.ts";
import { resumeBundle } from "../src/resume/resumer.ts";

/**
 * COMPONENT ADDRESSING, compiler-side: a parent that renders a child it cannot
 * absorb leaves an ELEMENT-SHAPED HOLE in its own template, and the child keeps
 * its own artifacts, its own cells and its own resume bundle.
 *
 * The proof is not that the analyzer said "provable". It is that two
 * independently emitted artifact sets, filled into one piece of markup, resume
 * as two bundles that do not touch each other: the child's click moves the
 * child's cell, leaves the parent's alone, and the parent's resumer records
 * ZERO dispatches for it.
 *
 * `ComposedInner` is deliberately outside depth-1 inlining's ceiling — it owns a
 * `createSignal`, which a splice has no slot for — so this is a child inlining
 * could not have taken, not a child it happened not to take.
 *
 * NOT tested here: how the verbatim gate measures the hole. `templateSegments`
 * learning the element-hole vocabulary is its own slice; nothing on this page's
 * resume side is new, which is exactly the point.
 */

const FIXTURE = "app/src/fixtures/ComposedCounter.tsx";
const PARENT_ARTIFACT = "ComposedCounter.ComposedOuter";
const SEED_RECORD = [{ name: "kind", value: "seed" }] as const;
const CHILD_ARTIFACT = claimedArtifactKey(FIXTURE, "ComposedInner", SEED_RECORD);

const scratchDirs: string[] = [];

/**
 * A scratch artifact directory INSIDE the repo root, not in `os.tmpdir()`: the
 * resume half `import()`s what it just emitted, and the dev server only serves
 * files under the project root. Removed again in `afterAll`.
 */
function scratch(): string {
  const dir = mkdtempSync(join(process.cwd(), ".artifacts-composed-"));
  scratchDirs.push(dir);
  return dir;
}

const hosts: HTMLElement[] = [];
const disposers: Array<() => void> = [];

afterAll(() => {
  while (disposers.length) disposers.pop()!();
  while (hosts.length) hosts.pop()!.remove();
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
});

function proved(component: string): ProvableAnalysis {
  const analysis = analyzeFixture(FIXTURE, { component, write: false });
  if (analysis.status !== "provable") {
    throw new Error(`${component} refused: ${analysis.reasons.map((reason) => reason.code).join(", ")}`);
  }
  return analysis;
}

/**
 * One emitted artifact directory, read back the way a page reads it: through the
 * real registry, over the real module shapes. Nothing about the bundle is
 * hand-built, so a field the emitter stopped writing would surface here rather
 * than be quietly supplied by the test.
 */
async function bundleOf(outRoot: string, artifact: string): Promise<Bundle> {
  const dir = join(outRoot, artifact);

  const staticModules: Record<string, Record<string, unknown>> = {};
  for (const file of ["template.js", "structure.js", "wiring.js"]) {
    staticModules[`/artifacts/${artifact}/${file}`] = (await import(
      pathToFileURL(join(dir, file)).href
    )) as Record<string, unknown>;
  }

  const handlerModules: Record<string, () => Promise<HandlerModule>> = {};
  for (const file of readdirSync(join(dir, "handlers"))) {
    const href = pathToFileURL(join(dir, "handlers", file)).href;
    handlerModules[`/artifacts/${artifact}/handlers/${file}`] = () =>
      import(href) as Promise<HandlerModule>;
  }

  const bundle = createRegistry(staticModules, handlerModules).get(artifact);
  if (bundle === undefined) throw new Error(`no bundle assembled for ${artifact}`);
  return bundle;
}

// ---------------------------------------------------------------- (1) the child

describe("the claimed child stands on its own", () => {
  const outRoot = scratch();
  const standalone = analyzeFixture(FIXTURE, { component: "ComposedInner", write: false });
  const recorded = analyzeWithRecordedProps(FIXTURE, SEED_RECORD, {
    component: "ComposedInner",
    write: false,
  });
  const classified = runComptime(FIXTURE, {
    component: "ComposedInner",
    outRoot,
    recordedProps: SEED_RECORD,
    write: false,
  });
  if (classified.analysis.status !== "provable") {
    throw new Error("expected the child to classify provable with the record");
  }
  const analysis = classified.analysis;
  const emitted = emit(analysis, join(outRoot, CHILD_ARTIFACT));

  it("refuses standalone classification — a recorded prop is not a default", () => {
    expect(standalone.status).toBe("fallback");
    expect(standalone.reasons.map((reason) => reason.code)).toEqual([
      "jsx-dynamic-child-not-derivable",
    ]);
  });

  it("classifies provable with the record, with cells and a handler of its own", () => {
    expect(recorded.status).toBe("provable");
    expect(recorded.reasons).toEqual([]);
    if (recorded.status !== "provable") throw new Error("expected a provable analysis");

    // The whole reason inlining cannot have this child: it declares a cell.
    expect(recorded.cells.map((cell) => cell.getter)).toEqual(["inner"]);
    expect(recorded.wiring).toHaveLength(1);
    expect(recorded.claimedChildren).toEqual([]);

    // The runComptime record path slice A exposed agrees with analyzeWithRecordedProps.
    expect(analysis.status).toBe("provable");
    expect(analysis.reasons).toEqual([]);
    if (analysis.status !== "provable") throw new Error("expected a provable analysis");
    expect(analysis.cells.map((cell) => cell.getter)).toEqual(["inner"]);
    expect(analysis.wiring).toHaveLength(1);
  });

  it("emits a full artifact set into its own directory", () => {
    if (emitted === null) throw new Error("expected the child to emit");

    expect(emitted.dir).toBe(join(resolve(outRoot), CHILD_ARTIFACT));
    expect(emitted.files).toEqual([
      "handlers/s0.js",
      "manifest.json",
      "structure.js",
      "template.js",
      "wiring.js",
    ]);
  });
});

// --------------------------------------------------------------- (2) the parent

describe("the parent leaves an element-shaped hole", () => {
  const parent = proved("ComposedOuter");

  it("records exactly one claimed child, addressed where the markup holds it", () => {
    expect(parent.claimedChildren).toEqual([
      {
        locator: "/2",
        artifact: CHILD_ARTIFACT,
        component: "ComposedInner",
        module: FIXTURE,
        recordedProps: [{ name: "kind", value: "seed" }],
      },
    ]);
    // Addressed, not absorbed: nothing of the child's is in the parent's lists.
    expect(parent.inlined).toEqual([]);
    expect(parent.cells.map((cell) => cell.getter)).toEqual(["outer"]);
  });

  it("carries exactly one mount element for the child, and it is empty", () => {
    const host = document.createElement("div");
    host.innerHTML = parent.html;
    hosts.push(host);

    const mounts = host.querySelectorAll(`[data-resume="${CHILD_ARTIFACT}"]`);
    expect(mounts).toHaveLength(1);

    const mount = mounts[0];
    expect(mount.tagName).toBe("DIV");
    expect(mount.getAttribute("data-component")).toBe("ComposedInner");
    // THE HOLE. Empty is the claim: the parent says where the child goes and
    // says nothing whatever about what the child paints.
    expect(mount.innerHTML).toBe("");
    expect(mount.attributes).toHaveLength(2);

    // And the recorded address is that element's, resolved by the same walk the
    // resume path uses rather than by re-reading the string.
    expect(locate(host.firstElementChild!, parent.claimedChildren[0].locator)).toBe(mount);
  });
});

// ------------------------------------------------------- (3) the frozen artifacts

describe("byte-stability of every artifact that claims nothing", () => {
  it("re-emits ProvableCounter's structure exactly as the checked tree holds it", () => {
    const { emitted } = runComptime("app/src/fixtures/ProvableCounter.tsx", { outRoot: scratch() });
    if (emitted === null) throw new Error("expected ProvableCounter to emit");

    const fresh = readFileSync(join(emitted.dir, "structure.js"), "utf8");
    const checked = readFileSync(resolve("demo/artifacts/ProvableCounter/structure.js"), "utf8");

    expect(fresh).toBe(checked);
  });
});

// ------------------------------------------------- (3b) where the address lives

/**
 * A CLAIMED CHILD IS BUILD-TIME METADATA, AND `structure.js` IS THE EAGER PATH.
 *
 * `structure.js` is imported by the page's static glob: its bytes are on the
 * wire at first paint, for every visitor, whether or not anyone interacts. And
 * nothing that runs there reads a claimed child — a nested mount is found by the
 * same attribute walk that finds a root one, so the resume path never asks where
 * one is. The readers are all beside the build: the verbatim gate, the page
 * rewriter and the group stage, each of which can open a JSON file for free.
 *
 * So the address lives in `manifest.json` and nowhere else. This is not a
 * condition on components that happen to address nothing — it is an INVARIANT
 * over every artifact this pass emits, which is what makes it worth a test: the
 * eager bytes of a page do not grow when a component composes.
 */
describe("a claimed child rides the manifest, never the eager module", () => {
  it("keeps the address out of the parent's structure and in its manifest", () => {
    const outRoot = scratch();
    const { emitted } = runComptime(FIXTURE, { component: "ComposedOuter", outRoot });
    if (emitted === null) throw new Error("expected ComposedOuter to emit");

    // The parent that DOES address a child — the one component in this corpus
    // that claims anything at all, so the invariant is asserted where it could
    // fail rather than only where it is vacuous.
    const structure = readFileSync(join(emitted.dir, "structure.js"), "utf8");
    expect(structure).not.toContain("claimedChildren");
    expect(structure).not.toContain(CHILD_ARTIFACT);

    const manifest = JSON.parse(readFileSync(join(emitted.dir, "manifest.json"), "utf8")) as {
      claimedChildren?: Array<{ locator: string; artifact: string }>;
    };
    expect(manifest.claimedChildren).toEqual([
      {
        locator: "/2",
        artifact: CHILD_ARTIFACT,
        component: "ComposedInner",
        module: FIXTURE,
        recordedProps: [{ name: "kind", value: "seed" }],
      },
    ]);
  });

  it("writes no such key at all for a component that composes nothing", () => {
    // The other half of the invariant, and the reason `artifacts/` and
    // `demo/artifacts/` came out of this change byte for byte what they were:
    // an artifact that addresses nothing says nothing, in either file.
    const outRoot = scratch();
    const classified = runComptime(FIXTURE, {
      component: "ComposedInner",
      outRoot,
      recordedProps: SEED_RECORD,
      write: false,
    });
    if (classified.analysis.status !== "provable") {
      throw new Error("expected ComposedInner to classify provable");
    }
    const emitted = emit(classified.analysis, join(outRoot, CHILD_ARTIFACT));

    expect(readFileSync(join(emitted.dir, "structure.js"), "utf8")).not.toContain("claimedChildren");
    expect(readFileSync(join(emitted.dir, "manifest.json"), "utf8")).not.toContain("claimedChildren");
  });
});

// -------------------------------------------------------------- (4) the resume

describe("the child resumes inside the parent's hole", () => {
  it("moves the child's cell, leaves the parent's alone, and dispatches once", async () => {
    const outRoot = scratch();
    runComptime(FIXTURE, { component: "ComposedOuter", outRoot });
    const classified = runComptime(FIXTURE, {
      component: "ComposedInner",
      outRoot,
      recordedProps: SEED_RECORD,
      write: false,
    });
    if (classified.analysis.status !== "provable") {
      throw new Error("expected ComposedInner to classify provable");
    }
    emit(classified.analysis, join(outRoot, CHILD_ARTIFACT));

    const parentBundle = await bundleOf(outRoot, PARENT_ARTIFACT);
    const childBundle = await bundleOf(outRoot, CHILD_ARTIFACT);

    // The FILLED markup, assembled the way a build would assemble it: the
    // parent's template, with the child's template written into the hole.
    const host = document.createElement("div");
    host.innerHTML = parentBundle.template!.html;
    document.body.appendChild(host);
    hosts.push(host);

    const mount = locate(host.firstElementChild!, "/2");
    mount.innerHTML = childBundle.template!.html;

    // The parent's container no longer holds the parent's template byte for
    // byte — a filled hole is not a substring of the hole. Teaching the build's
    // verbatim gate to MEASURE that is its own slice; here the check is turned
    // off for the parent only, and left ON for the child, which is what proves
    // the hole was filled by exactly the child's own template and nothing else.
    const parentApp = resumeBundle(host, parentBundle, { verifyTemplate: false });
    const childApp = resumeBundle(mount, childBundle);
    disposers.push(() => parentApp.dispose(), () => childApp.dispose());

    const innerLabel = host.querySelector('[data-testid="composed-inner-label"]')!;
    const outerLabel = host.querySelector('[data-testid="composed-outer-label"]')!;
    const kindLabel = host.querySelector('[data-testid="composed-inner-kind"]')!;
    expect(innerLabel.textContent).toBe("inner: 0");
    expect(outerLabel.textContent).toBe("outer: 0");
    // Recorded value is first-paint markup, baked into the child's template.
    expect(kindLabel.textContent).toBe("seed");

    host
      .querySelector('[data-testid="composed-inner-inc"]')!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await childApp.settled();
    await parentApp.settled();

    // The child owns its own cell, in its own bundle, and it moved.
    expect(innerLabel.textContent).toBe("inner: 1");
    expect(childApp.stats.dispatches).toBe(1);
    expect(childApp.cells.get("c0")!.get()).toBe(1);

    // THE DOUBLE-DISPATCH CHECK. Both containers hear the click — the mount is
    // inside the parent's container, so the event bubbles through both delegated
    // listeners. The parent must find no record for it: `wired()` matches by
    // `element.contains(target)`, and the parent's own button does not contain
    // the child's. A parent that answered here would be running the child's
    // handler a second time against the wrong cells.
    expect(parentApp.stats.dispatches).toBe(0);
    expect(outerLabel.textContent).toBe("outer: 0");
    expect(parentApp.cells.get("c0")!.get()).toBe(0);

    // And the parent still drives its own markup: same page, same click type.
    host
      .querySelector('[data-testid="composed-outer-inc"]')!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await parentApp.settled();

    expect(parentApp.stats.dispatches).toBe(1);
    expect(outerLabel.textContent).toBe("outer: 1");
    expect(innerLabel.textContent).toBe("inner: 1");
    expect(childApp.stats.dispatches).toBe(1);
  });
});
