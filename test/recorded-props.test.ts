import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { analyzeFixture, analyzeWithRecordedProps, runComptime } from "../src/comptime/index.ts";
import type { Analysis } from "../src/comptime/types.ts";

/**
 * Recorded props, compiler-side: a parent that addresses a child with a
 * v1 build-constant leaves the value on the manifest-bound ClaimedChild
 * and bakes it into the child's own html. The hole stays two attributes
 * and empty. Nothing here names a library.
 */

const FIXTURE = "test/fixtures/shapes/RecordedPropHost.tsx";

const scratchDirs: string[] = [];

function scratch(): string {
  const dir = mkdtempSync(join(process.cwd(), ".artifacts-recorded-"));
  scratchDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
});

function codes(analysis: Analysis): string[] {
  return analysis.status === "fallback" ? analysis.reasons.map((reason) => reason.code) : [];
}

describe("recorded props — classify with the record", () => {
  it("the addressed child's analysis carries the recorded value in its html", () => {
    const parent = analyzeFixture(FIXTURE, { write: false, component: "RecordedLiteralHost" });
    expect(parent.status).toBe("provable");
    if (parent.status !== "provable") return;

    expect(parent.claimedChildren).toHaveLength(1);
    expect(parent.claimedChildren[0].recordedProps).toEqual([{ name: "label", value: "hello" }]);

    const host = document.createElement("div");
    host.innerHTML = parent.html;
    const mount = host.querySelector("[data-component='RecordedInner']");
    expect(mount).not.toBeNull();
    expect(mount?.innerHTML).toBe("");
    expect(mount?.attributes).toHaveLength(2);

    const child = analyzeWithRecordedProps(
      FIXTURE,
      parent.claimedChildren[0].recordedProps ?? [],
      { write: false, component: "RecordedInner" },
    );
    expect(child.status).toBe("provable");
    if (child.status !== "provable") return;
    expect(child.html).toBe('<span class="recorded">hello</span>');
  });

  it("recordedProps lands on the manifest-bound ClaimedChild and never in structure.js", () => {
    const outRoot = scratch();
    const { analysis, emitted } = runComptime(FIXTURE, {
      component: "RecordedLiteralHost",
      outRoot,
    });
    expect(analysis.status).toBe("provable");
    if (emitted === null) throw new Error("expected the parent to emit");

    const structure = readFileSync(join(emitted.dir, "structure.js"), "utf8");
    expect(structure).not.toContain("recordedProps");
    expect(structure).not.toContain("claimedChildren");

    const manifest = JSON.parse(readFileSync(join(emitted.dir, "manifest.json"), "utf8")) as {
      claimedChildren?: Array<{ recordedProps?: Array<{ name: string; value: unknown }> }>;
    };
    expect(manifest.claimedChildren?.[0]?.recordedProps).toEqual([{ name: "label", value: "hello" }]);

    const child = runComptime(FIXTURE, {
      component: "RecordedInner",
      recordedProps: [{ name: "label", value: "hello" }],
      outRoot,
    });
    if (child.emitted === null) throw new Error("expected the child to emit");
    expect(readFileSync(join(child.emitted.dir, "structure.js"), "utf8")).not.toContain("recordedProps");
  });

  it("a non-constant prop still refuses", () => {
    const analysis = analyzeFixture(FIXTURE, { write: false, component: "RecordedPropHost" });
    expect(analysis.status).toBe("fallback");
    expect(codes(analysis)).toContain("jsx-component-element");
  });

  it("a props use not covered by the record refuses the address", () => {
    const child = analyzeWithRecordedProps(FIXTURE, [{ name: "other", value: "nope" }], {
      write: false,
      component: "RecordedInner",
    });
    expect(child.status).toBe("fallback");
  });
});
