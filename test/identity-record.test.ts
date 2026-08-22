import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import {
  analyzeFixture,
  analyzeWithIdentityProps,
  analyzeWithRecordedProps,
  runComptime,
} from "../src/comptime/index.ts";
import { isIdentitySlot, isStoreReadSlot, type Analysis, type IdentityProp } from "../src/comptime/types.ts";

/**
 * Identity-shaped record, compiler-side: a parent that addresses a child
 * with identity-class cargo leaves the identity on the ClaimedChild list
 * and a capture slot on the child's structure. No frozen value of that
 * cargo appears in any artifact. Nothing here names a library.
 */

const FIXTURE = "test/fixtures/shapes/IdentityPropHost.tsx";

const scratchDirs: string[] = [];

function scratch(): string {
  const dir = mkdtempSync(join(process.cwd(), ".artifacts-identity-"));
  scratchDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
});

function codes(analysis: Analysis): string[] {
  return analysis.status === "fallback" ? analysis.reasons.map((reason) => reason.code) : [];
}

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(full);
    }
  };
  walk(dir);
  return out.sort();
}

const CARGO_BYTES = ["unseen-runtime-cargo", "seen-runtime-cargo", "nope"];

describe("identity record — classify with the record", () => {
  it("the identity lands on the ClaimedChild list and the child's capture slot", () => {
    const parent = analyzeFixture(FIXTURE, { write: false, component: "IdentityForwardHost" });
    expect(parent.status).toBe("provable");
    if (parent.status !== "provable") return;

    expect(parent.claimedChildren).toHaveLength(1);
    expect(parent.claimedChildren[0].recordedProps).toBeUndefined();
    expect(parent.claimedChildren[0].identityProps).toEqual([
      {
        name: "cargo",
        role: "attribute",
        bindingClass: "own-props-parameter",
        source: { name: "props", path: ["cargo"] },
      },
    ]);

    const host = document.createElement("div");
    host.innerHTML = parent.html;
    const mount = host.querySelector("[data-component='IdentityInner']");
    expect(mount).not.toBeNull();
    expect(mount?.innerHTML).toBe("");
    expect(mount?.attributes).toHaveLength(2);

    const child = analyzeWithIdentityProps(FIXTURE, parent.claimedChildren[0].identityProps ?? [], {
      write: false,
      component: "IdentityInner",
    });
    expect(child.status).toBe("provable");
    if (child.status !== "provable") return;
    expect(child.html).toBe('<span class="identity"></span>');
    const identitySlots = child.bindings.flatMap((binding) => binding.captures.filter(isIdentitySlot));
    expect(identitySlots).toEqual([
      {
        name: "cargo",
        kind: "identity",
        bindingClass: "own-props-parameter",
        source: { name: "props", path: ["cargo"] },
      },
    ]);
  });

  it("no frozen value of identity-class cargo appears in any artifact byte", () => {
    const outRoot = scratch();
    const parent = runComptime(FIXTURE, { component: "IdentityForwardHost", outRoot });
    expect(parent.analysis.status).toBe("provable");
    if (parent.emitted === null) throw new Error("expected the parent to emit");
    if (parent.analysis.status !== "provable") return;

    const identityProps = parent.analysis.claimedChildren[0]?.identityProps;
    expect(identityProps).toBeDefined();
    expect(JSON.stringify(identityProps)).not.toMatch(/value/);

    const child = runComptime(FIXTURE, {
      component: "IdentityInner",
      identityProps: identityProps as IdentityProp[],
      outRoot,
    });
    if (child.emitted === null) throw new Error("expected the child to emit");
    if (child.analysis.status !== "provable") throw new Error("expected the child to prove");

    const structure = readFileSync(join(child.emitted.dir, "structure.js"), "utf8");
    expect(structure).toContain('kind: "identity"');
    expect(structure).not.toContain("recordedProps");

    const parentStructure = readFileSync(join(parent.emitted.dir, "structure.js"), "utf8");
    expect(parentStructure).not.toContain("identityProps");
    expect(parentStructure).not.toContain("recordedProps");

    for (const file of [...walkFiles(parent.emitted.dir), ...walkFiles(child.emitted.dir)]) {
      const bytes = readFileSync(file, "utf8");
      for (const cargo of CARGO_BYTES) {
        expect(bytes, file).not.toContain(cargo);
      }
    }
    expect(child.analysis.html).toBe('<span class="identity"></span>');
  });

  it("a template-byte-reaching use refuses the address", () => {
    const analysis = analyzeFixture(FIXTURE, { write: false, component: "IdentityClassHost" });
    expect(analysis.status).toBe("fallback");
    expect(codes(analysis)).toContain("jsx-component-element");
  });

  it("a second address with a different identity record is declined", () => {
    const once = analyzeFixture(FIXTURE, { write: false, component: "IdentityForwardHost" });
    expect(once.status).toBe("provable");

    const twice = analyzeFixture(FIXTURE, { write: false, component: "IdentityTwiceHost" });
    expect(twice.status).toBe("fallback");
    expect(codes(twice)).toContain("jsx-component-element");
  });

  it("a signal-getter opening is refused", () => {
    const analysis = analyzeFixture(FIXTURE, { write: false, component: "IdentityPropHost" });
    expect(analysis.status).toBe("fallback");
    expect(codes(analysis)).toContain("jsx-component-element");
  });

  it("an identifier rest-spread of derived/rest-props is recorded as identity", () => {
    const parent = analyzeFixture(FIXTURE, { write: false, component: "IdentityRestHost" });
    expect(parent.status).toBe("provable");
    if (parent.status !== "provable") return;
    expect(parent.claimedChildren[0].recordedProps).toBeUndefined();
    expect(parent.claimedChildren[0].identityProps).toEqual([
      {
        name: "rest",
        role: "spread-of-identifier",
        bindingClass: "derived-rest-props-result",
        source: { name: "rest", path: [] },
      },
    ]);
  });

  it("value-recording of the same identity-class cargo stays refused", () => {
    const parent = analyzeFixture(FIXTURE, { write: false, component: "IdentityForwardHost" });
    expect(parent.status).toBe("provable");
    if (parent.status !== "provable") return;
    expect(parent.claimedChildren[0].recordedProps).toBeUndefined();

    const folded = analyzeWithRecordedProps(FIXTURE, [{ name: "cargo", value: "unseen-runtime-cargo" }], {
      write: false,
      component: "IdentityForwardHost",
    });
    expect(folded.status).toBe("provable");
    if (folded.status !== "provable") return;
    expect(folded.claimedChildren[0].recordedProps).toBeUndefined();
    expect(JSON.stringify(folded.claimedChildren[0].identityProps)).not.toContain("unseen-runtime-cargo");
    expect(folded.html).not.toContain("unseen-runtime-cargo");
  });
});

const SLOT_FIXTURE = "test/fixtures/shapes/ClaimedSlotHost.tsx";

describe("claimed-child slot-valued / proven-handler / ref-array records", () => {
  it("records a slot-valued attribute and the child carries store-read captures", () => {
    const parent = analyzeFixture(SLOT_FIXTURE, { write: false, component: "SlotValuedHost" });
    expect(parent.status).toBe("provable");
    if (parent.status !== "provable") return;
    const record = parent.claimedChildren[0]?.identityProps?.find((prop) => prop.role === "slot-valued");
    expect(record).toBeDefined();
    if (record?.role !== "slot-valued") return;
    expect(record.expression).toContain("isOpen");
    expect(JSON.stringify(record)).not.toMatch(/"value":/);
    expect(parent.html).toMatch(/data-component="SlotInner"/);
    expect(parent.html).not.toContain("aria-expanded");

    const child = analyzeWithIdentityProps(SLOT_FIXTURE, parent.claimedChildren[0].identityProps ?? [], {
      write: false,
      component: "SlotInner",
    });
    expect(child.status).toBe("provable");
    if (child.status !== "provable") return;
    const storeReads = child.bindings.flatMap((binding) => binding.captures.filter(isStoreReadSlot));
    expect(storeReads.length).toBeGreaterThan(0);
    expect(child.stores.some((store) => store.id === record.store.id)).toBe(true);
  });

  it("records a proven-handler and the child wires it", () => {
    const parent = analyzeFixture(SLOT_FIXTURE, { write: false, component: "ProvenHandlerHost" });
    expect(parent.status).toBe("provable");
    if (parent.status !== "provable") return;
    const record = parent.claimedChildren[0]?.identityProps?.find((prop) => prop.role === "proven-handler");
    expect(record).toBeDefined();
    if (record?.role !== "proven-handler") return;
    expect(record.source).toContain("toggle");

    const child = analyzeWithIdentityProps(SLOT_FIXTURE, parent.claimedChildren[0].identityProps ?? [], {
      write: false,
      component: "SlotInner",
    });
    expect(child.status).toBe("provable");
    if (child.status !== "provable") return;
    expect(child.handlers.length).toBeGreaterThan(0);
    expect(child.wiring.length).toBeGreaterThan(0);
  });

  it("records a ref-array of store member plus identity path", () => {
    const parent = analyzeFixture(SLOT_FIXTURE, { write: false, component: "RefArrayHost" });
    expect(parent.status).toBe("provable");
    if (parent.status !== "provable") return;
    const record = parent.claimedChildren[0]?.identityProps?.find((prop) => prop.role === "ref-array");
    expect(record).toBeDefined();
    if (record?.role !== "ref-array") return;
    expect(record.elements).toHaveLength(2);
    expect(record.elements[0]).toMatchObject({ kind: "store", path: ["setAnchor"] });
    expect(record.elements[1]).toMatchObject({ kind: "identity" });
  });

  it("declines a second address with a different slot-valued record", () => {
    const analysis = analyzeFixture(SLOT_FIXTURE, { write: false, component: "SlotValuedTwiceHost" });
    expect(analysis.status).toBe("fallback");
    expect(codes(analysis)).toContain("jsx-component-element");
  });

  it("refuses a ternary that mixes an admitted slot with a free name", () => {
    const analysis = analyzeFixture(SLOT_FIXTURE, { write: false, component: "SlotValuedMixedFree" });
    expect(analysis.status).toBe("fallback");
    expect(codes(analysis)).toContain("jsx-component-element");
  });

  it("refuses a ternary over a store that did not admit", () => {
    const analysis = analyzeFixture(SLOT_FIXTURE, { write: false, component: "SlotValuedRefusedStore" });
    expect(analysis.status).toBe("fallback");
    expect(codes(analysis)).toContain("store-binding-not-provable");
  });

  it("refuses a closure with an extra free call", () => {
    const analysis = analyzeFixture(SLOT_FIXTURE, { write: false, component: "ProvenHandlerExtra" });
    expect(analysis.status).toBe("fallback");
    expect(codes(analysis)).toContain("jsx-component-element");
  });

  it("refuses a closure with a free reference outside the admitted set", () => {
    const analysis = analyzeFixture(SLOT_FIXTURE, { write: false, component: "ProvenHandlerFree" });
    expect(analysis.status).toBe("fallback");
    expect(codes(analysis)).toContain("jsx-component-element");
  });

  it("refuses a closure whose callee does not resolve", () => {
    const analysis = analyzeFixture(SLOT_FIXTURE, { write: false, component: "ProvenHandlerUnresolvedCallee" });
    expect(analysis.status).toBe("fallback");
    expect(codes(analysis)).toContain("jsx-component-element");
  });

  it("refuses a ref array with a computed member, a non-slot element, or a spread", () => {
    expect(codes(analyzeFixture(SLOT_FIXTURE, { write: false, component: "RefArrayComputed" }))).toContain(
      "jsx-component-element",
    );
    expect(codes(analyzeFixture(SLOT_FIXTURE, { write: false, component: "RefArrayNonSlot" }))).toContain(
      "jsx-component-element",
    );
    expect(codes(analyzeFixture(SLOT_FIXTURE, { write: false, component: "RefArraySpread" }))).toContain(
      "jsx-component-element",
    );
  });
});
