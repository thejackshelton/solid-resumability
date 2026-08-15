# Resumability for Solid 2.0 via semantic analysis — feasibility report

**Date:** 2026-08-11
**Audience:** @JackShelton (owner); Ryan Carniato (Solid)
**Studied commit:** solid `next` @ `4879891e09680b026085e1cb70f22f54912244ee`
**Status:** feasibility verdict + one working CSR-only spike (`src/`, 46 tests green)

Citation notation: `solid:<path>` = the Solid repo at the pinned commit above (read via
`git show 4879891e…:<path>`); `vendor:<path>` = dom-expressions @
`d1f20ac0146be3267a7afdfbcd472d10918972db` (runtime `0.50.0-next.41`, exactly what solid@next
resolves), no longer a checkout — each such path is cited as the pinned URL
`https://github.com/ryansolid/dom-expressions/blob/d1f20ac0146be3267a7afdfbcd472d10918972db/<path>`,
so the commit is the pin and the line ranges below still resolve; `markless:` / `frameless:` / `yuku:` =
the local repos under `~/dev/open-source/`; `src:` = the toolchain sources at `src/` (the manifest,
`test/` and `artifacts/` sit outside it and are cited as `local:`); `local:` = this
project root. Every
file named below is listed in [`docs/feasibility-citations.txt`](./feasibility-citations.txt), which
is checked mechanically — a citation to a file that does not exist fails the build.

---

## 1. Verdict

**Yes, for a statically provable subset — with an analysis-determined, per-component fallback to
unchanged Solid.** Ordinary, unannotated Solid 2.0 TSX can be split at compile time into (a) static
markup, (b) a description of its source cells and their DOM bindings, and (c) per-handler modules
that load only when their event fires; a bootstrap that never imports the component can make that
markup interactive. Components the analysis cannot prove are *refused with reasons* and take the
normal `render()` / `hydrate()` path, unmodified.

The thing that makes this proposal safe is not a marker and not a new API. It is the refusal. The
compiler only emits resume artifacts for components whose entire interactive surface it can
reconstruct; everything else is left exactly as Solid renders it today. That is why the design costs
zero public API surface and zero behavioural change to existing code — the escape hatch is the
default.

**What the spike proves, mechanically:**

| Claim | Evidence |
| --- | --- |
| Unannotated Solid TSX yields template + cells + bindings + handler modules + wiring at build time | `src:comptime/classify.ts`, `local:artifacts/CounterA/` (all five modules + manifest) |
| The emitted template is byte-identical to `render()`'s output, with **zero** normalization — for a plain component *and* for a see-through parent, whose spliced template reproduces the `<!---->` placeholders Solid writes after a component child | `local:test/parity.test.tsx:58-62` (plain), `local:test/parity.test.tsx:128-136` (see-through) |
| The component's module is never imported — before or after interaction | `local:test/resume.test.ts:184-197` (loader-hook transcript with a positive control) |
| Two independently, lazily imported handler modules bind to **one** cell instance | `local:test/resume.test.ts:313-326` (function identity, not behaviour) |
| An unprovable component is refused by analysis and still works under unmodified `solid-js` | `local:test/resume.test.ts:369-389`, `local:test/classic-baseline.test.tsx:43-102` |
| The verdict is analysis-driven, not name- or marker-driven | `local:test/comptime-pass.test.ts:256-311` |

**What is argued from source reading, not proven:** every claim in §8 about how this mechanism would
eventually meet Solid's real hydration path — `_hk` registry claiming, the delegated-event replay
queue, frames — is analysis of `solid@4879891e` and `vendor/dom-expressions@d1f20ac0` sources. The
spike is CSR-only and integrates with none of it. That boundary is stated plainly and is not
narrowed anywhere in this report.

**What is not proven and is not claimed:** the breadth of the provable subset (§10.1), composition
across a provable/refused boundary (§10.2), cross-island or `shared()`-equivalent state (§5.4),
bootstrap size (§10.3), and any SSR path at all.

---

## 2. The architecture: comptime static derivation

The decision (`local:docs/goals/solid-resumability/state.yaml`): **yuku-analyzer collects ALL
structure at compile time — template, cells, bindings, marker-free handler captures, wiring —
emitted as static, cacheable modules. The runtime supplies values only.**

```
  CounterA.tsx  ──parse──▶  yuku-parser  ──analyze──▶  yuku-analyzer
  (plain TSX,                                          (scopes, symbols, resolved
   zero markers)                                        references, closures,
                                                        cross-file definitions)
                                    │
                                    ▼
                          classify()  ──▶  provable ──┐      ──▶ fallback
                                                      │              │
                                                      ▼              ▼
                                   template.js   (static HTML)   unchanged
                                   structure.js  (cells + bindings + compute)
                                   wiring.js     (locator → handler id + slots)   Solid
                                   handlers/s*.js (lazy, capture-slot manifests)  render()/
                                   manifest.json                                  hydrate()
                                    │
                                    ▼
                          resume(container, "CounterA")
                          1 cell per structure.cells   ──▶ one instance, ever
                          locators resolved            ──▶ no behaviour loaded
                          ONE delegated listener       ──▶ page is live but inert
                          first event → import()       ──▶ slots filled from the cell table
                          run handler, flush(), patch  ──▶ static edge list, no tracker
```

Sources: `src:comptime/index.ts` (pipeline), `src:comptime/classify.ts` (the verdict and
the extraction), `src:comptime/emit.ts` (artifact emission), `src:resume/index.ts` (the
whole runtime), `src:resume/artifacts.ts` (bundle discovery), `src:resume/locate.ts`
(child-index locators).

Two properties of the resumer are worth stating outright because they are what make it small:

- **No owner, no scheduler, no render effects.** The comptime pass already resolved the dependency
  graph — each binding carries the list of cells it reads (`local:artifacts/CounterA/structure.js`,
  `captures`) — so the patch step diffs cell values against that static edge list instead of
  discovering dependencies at runtime (`src:resume/index.ts:152-171`). The only framework code
  on the path is `@solidjs/signals` for the cells themselves, and that is asserted statically, not
  observed: a guard test reads every file in `src/resume/` and requires that its only bare
  import specifier is `@solidjs/signals` — no `solid-js`, no `@solidjs/web`, no `render`, no
  `hydrate` (`local:test/resume.test.ts:222-244`).
- **One delegated listener per wired event type, on the container**
  (`src:resume/index.ts:215-216`), asserted by spying `EventTarget.prototype.addEventListener`
  across the entire bootstrap: exactly one call, and its target is the container, not a button
  (`local:test/resume.test.ts:246-254`). This mirrors what dom-expressions already does — handlers
  live as `$$type` node properties dispatched by a container-level walker
  (`vendor:packages/runtime/src/client.js:351-361`, `1563-1648`) — except that the wiring comes from
  a static record instead of from executed component code.

### 2.1 Byte-neutrality: the currency is bytes vs. static provability

The obvious objection to any resumability scheme is that you pay for it in HTML. Qwik-style designs
serialize per-node attributes into the response; that is a per-request cost on every byte of markup,
and markless explicitly rejects it (`markless:specs/framework/05-resumability-payload.md:118`).

This design ships **nothing** in the HTML. The structure — cells, bindings, wiring, capture slots,
handler bodies — is emitted as static JavaScript modules
(`local:artifacts/CounterA/structure.js`, `local:artifacts/CounterA/wiring.js`,
`local:artifacts/CounterA/handlers/s0.js`) that **replace** the component code that would otherwise
have been shipped and eagerly executed. They are cacheable, content-addressable build output. The
served markup is unchanged, and that is proven rather than asserted: `render(CounterA)`'s
`innerHTML` equals the emitted `template.html` with **no normalization at all** — no whitespace
collapsing, no attribute reordering, no comment stripping, a raw string comparison
(`local:test/parity.test.tsx:48-52`). The same test drives the real component forward and back
through its own handlers and requires the DOM to land on those exact bytes again
(`local:test/parity.test.tsx:86-103`), so the template is a genuine fixed point of Solid's rendering
rather than a lucky first paint.

That parity matters for more than aesthetics. Locators are child indices from the component root
(`src:resume/locate.ts`), so if the static template and Solid's own output differed by a
marker comment or a stray text node, every locator would address a different node than the one the
pass reasoned about. Byte parity is the precondition for the whole scheme, which is why the resumer
refuses outright to resume a container whose markup is not the component's template
(`src:resume/index.ts:110-114`, `local:test/resume.test.ts:361-367`).

So the design's real currency is **bytes vs. static provability**: the more of a component the
analysis can prove, the more eager code it deletes, at zero HTML cost. Where it cannot prove, it
pays nothing and changes nothing.

---

## 3. The principle

> **Compute everything ahead of time; what cannot be computed gets lifted/lowered into data.**

The spike implements the coarsest possible version of this: the unit of "cannot be computed" is the
**whole component**. If any part of `CounterA` were unprovable, the entire component would fall back
(`src:comptime/classify.ts:665-667` — any accumulated refusal reason yields `fallback`).

The natural next tranche is to move that granularity from the component to the **expression**.
Today a binding's `compute` and a handler's body are whole printed source
(`local:artifacts/CounterA/structure.js`, `local:artifacts/CounterA/handlers/s0.js`), so a handler
that touches one unprovable name sinks the whole component. Lifting *sub-expressions* into data
records — which is exactly what markless's pass pipeline does with `ExpressionSite`-style records
and what frameless formalizes as `GraphReadRef` / `ExpressionSite` in its enriched IR
(`frameless:packages/compiler/src/schema.ts`) — would turn a per-component verdict into a
per-expression one. That is the difference between a demo and a subset worth shipping.

**This is direction, not result. Expression-level lift/lower is explicitly not spiked.**

---

## 4. Objection (a) — "Deferred hydration is a trap unless handled at the reactive-source level"

This is the correct objection and it is the one that kills most lazy-hydration schemes. If you defer
work per *island*, per *component*, or per *listener*, two deferred units that were supposed to share
one piece of state each materialize their own copy, and the app tears: two counters that were one
counter, a form whose validation reads a value the submit handler already changed. Deferral is only
sound if the thing that is shared is instantiated **once**, at the reactive source, before any
deferred unit can observe it.

**That is precisely where this design puts it.** Deferral here is at the *handler/module* level;
state lives at the *reactive source* and is constructed by the bootstrap, not by the handlers.

### 4.1 The mechanism

The resumer constructs one cell per `structure.cells` entry, up front, before any behaviour exists
to observe them (`src:resume/index.ts:121-126`):

```js
for (const spec of bundle.cells) {
  const [get, set] = createSignal(spec.initial);
  cells.set(spec.id, { id: spec.id, get, set });
}
```

Handler modules are not closures over state. They are **factories over an explicit capture-slot
manifest** (`local:artifacts/CounterA/handlers/s0.js`):

```js
export const captures = [
  { name: "count",    cell: "c0", access: "read"  },
  { name: "setCount", cell: "c0", access: "write" },
];
export function create({ count, setCount }) {
  return () => setCount(count() + 1);
}
```

Slots are filled from the **cell table**, never from anything the handler module says
(`src:resume/index.ts:128-138`): a read slot gets `cell.get`, a write slot `cell.set`, of the
same cell object. There is no code path by which two handlers can receive two cells for one `cell`
id — the map is keyed by id and populated once. The resumer additionally cross-checks each loaded
module's declared `captures` against the wiring record and throws on mismatch
(`src:resume/index.ts:179-182`), so a stale artifact fails loudly rather than binding
something plausible.

### 4.2 The evidence

Behavioural evidence first: the two handler modules are imported **separately, at different times**
— `s0.js` on the first click, `s1.js` only on a later one, asserted by loader-hook transcript
(`local:test/resume.test.ts:207-220`: five clicks, two modules, exactly two imports) — and
inc / inc / dec yields `count: 1` (`local:test/resume.test.ts:308-311`). A read-through of the other
handler's write, across a lazy module boundary.

But behaviour alone is not proof: *two* cells each initialized to `0` would pass every behavioural
assertion until the handlers disagreed. So the test asserts the thing itself — **function identity**
(`local:test/resume.test.ts:313-326`):

```js
const cell = transcript.app.cells.get("c0");
expect(inc.count).toBe(cell.get);      // s0's read slot IS the cell's accessor
expect(dec.count).toBe(cell.get);      // s1's read slot IS the same accessor
expect(inc.setCount).toBe(cell.set);
expect(dec.setCount).toBe(cell.set);
expect(transcript.app.cells.size).toBe(1);
```

Both lazily imported modules hold the *same function objects*, from a cell table of size one. And
the cell is drivable from outside: setting it directly to `41` and then clicking each button gives
`count: 42` then `count: 41` (`local:test/resume.test.ts:328-343`) — the deferred handlers observe a
write neither of them made.

### 4.3 Why this is the reactive-source level, not a workaround

The cell is a real `@solidjs/signals` signal (`src:resume/index.ts:35`, `124`) — the same
primitive `createSignal` produces in a normal Solid component
(`solid:packages/solid-signals/src/signals.ts:342`). Nothing about it is a shim. The comptime pass
identified it *as a source cell* by resolving `createSignal` back to its import from `solid-js` or
`@solidjs/signals` through the symbol table (`src:comptime/classify.ts:747-763`), and the
artifact records its identity and literal initial value
(`local:artifacts/CounterA/structure.js`). What is deferred is the *code that reads and writes* it.
What is not deferred is the source itself.

The resumer also honours Solid 2.0's batching contract rather than routing around it: writes are
batched, so a setter call is not visible to a subsequent read until the graph settles, and the
resumer calls `flush()` after each handler run before recomputing bindings
(`src:resume/index.ts:152-157`). Handlers extracted from real Solid source were written
against that contract and continue to hold under it.

### 4.4 The boundary — honestly stated

**This is single-cell, single-component scope.** One component, one cell, two handlers, one page.
What is *not* proven:

- **Cross-island shared state.** Two resumed components sharing one cell — the equivalent of a
  markless `shared()` (`markless:specs/framework/05-resumability-payload.md`, shared snapshots in
  the state arena) — is untested. The cell table is per-`resume()` call
  (`src:resume/index.ts:122`), so a shared cell would need a table that outlives and spans
  components. Nothing in the mechanism forbids it; nothing in the spike demonstrates it. This is
  carried as an explicit open risk in the board record
  (`local:docs/goals/solid-resumability/state.yaml`, `open_risks`).
- **State crossing a provable/refused boundary.** A resumed component nested inside a fallback one
  (or the reverse), passing state across the seam, is untested — and, as §10.2 says, it is where the
  fallback story actually gets decided.
- **Anything beyond a locally created signal.** Props, context, and stores are all outside the
  proven subset (§10.1). Each is a potential source-level sharing mechanism this analysis has not
  been asked to prove.

So the honest form of the answer to objection (a) is: *the architecture puts sharing at the reactive
source by construction, and that construction is verified by identity at the scale the spike
covers.* Extending it across islands is the obvious next experiment, not a solved problem.

---

## 5. Objection (b) — "Closure extraction without a `$`-style marker"

Qwik requires `$()` because the compiler needs a syntactically obvious extraction boundary and a
promise from the author that what is inside it is serializable. The objection is that without such a
marker you are guessing — and a guessing compiler that guesses wrong produces an app that silently
breaks.

**The answer is that this design does not guess. It proves, and where it cannot prove, it refuses.**
The fixtures carry zero markers, zero annotations, and zero special imports
(`src:fixtures/CounterA.tsx` — it is an utterly ordinary Solid counter, imported and rendered
by classic `solid-js` in `local:test/classic-baseline.test.tsx`).

### 5.1 What replaces the marker: resolved semantics

Every judgement in the classifier rides yuku-analyzer's resolved semantics — symbols, references,
scopes, closures, cross-module definitions (`yuku:README.md`;
`yuku:npm/yuku-analyzer/index.d.ts`, `capturesOf` at :415, `Symbol.definition()` at :198,
`unresolvedReferences` at :376). Nothing is decided by file name, identifier spelling, or source-text
matching (`src:comptime/classify.ts:1-21`, the module's stated contract).

The load-bearing query is `Module.capturesOf(fn)`: the shadowing- and alias-correct free variables of
a closure, computed from the resolved reference table (`src:comptime/classify.ts:584-602`). A
handler is provable only when *every* free variable it captures resolves to a known cell accessor:

```js
for (const capture of m.capturesOf(fn)) {
  const accessor = accessors.get(capture.symbol.id);   // symbol id, not name
  if (accessor === undefined) {
    refuse("handler-captures-unprovable-binding", …);
    continue;
  }
  slots.push({ name: capture.symbol.name, cell: accessor.cellId, access: accessor.access });
}
```

Those slots become the handler module's capture manifest — the explicit, machine-generated
equivalent of what `$()` asks the author to promise, derived instead of declared
(`local:artifacts/CounterA/handlers/s0.js`, `captures`).

Three more gates back it up:

1. **Escape analysis on the accessors.** A cell's getter or setter may appear *only* as the callee of
   a call of the right arity — `count()` or `setCount(x)`. Every other use hands the accessor to code
   the pass cannot see, and the component is refused with the sink named
   (`src:comptime/classify.ts:241-274`). `describeCallee` follows the import chain via
   `Symbol.definition()` to say *which module* the black box lives in
   (`src:comptime/classify.ts:302-317`).
2. **Free names are fatal.** Any unresolved reference inside a handler — a global — is refused
   (`src:comptime/classify.ts:604-612`).
3. **Syntax is a whitelist, not a blacklist.** `HANDLER_SYNTAX` enumerates the node types the pass
   has actually reasoned about; anything else is refused rather than assumed safe
   (`src:comptime/classify.ts:53-74`).

### 5.2 The refusal is the proof: CounterB

`src:fixtures/CounterB.tsx` is the same UI, but the signal tuple escapes into an imported
helper that hands back the handlers (`src:fixtures/counter-helper.ts`). The pass refuses it,
and the refusal is *specific* — which binding left, into which callee, defined in which module:

```
fallback  src/fixtures/CounterB.tsx (CounterB):
          signal-binding-not-destructured @ 12:9
          signal-escapes-to-opaque-callee @ 13:47 — `signal` escapes into `makeHandlers`,
                                                    defined in src/fixtures/counter-helper.ts
          signal-escapes-to-opaque-callee @ 17:48 — `signal` escapes into `formatCount`, …
          jsx-dynamic-child-not-derivable @ 17:35
          handler-not-inline @ 18:35, 21:35
```
(`local:docs/goals/solid-resumability/notes/T004-spike.md`; reproduce with `pnpm comptime`,
`src:comptime/cli.ts`.)

Note *why* the refusal is precise: `Symbol.definition()` follows the import across the module
boundary, so the diagnostic names the real sink instead of shrugging. This is the property a
`$`-marker system gets for free by fiat and that a marker-free system has to earn.

### 5.3 The classifier is not name-driven — asserted, not asserted-at

The suite attacks the obvious failure mode of a marker-free pass, which is that it is secretly
pattern-matching on names (`local:test/comptime-pass.test.ts:256-311`):

- Fixture A's source, with every occurrence of `CounterA` renamed and classified from a **different
  path and export name**, is still provable (`:265-271`).
- A component **called** `CounterA`, at Fixture A's own path, whose handler calls `Math.round(…)`, is
  **refused** with `handler-references-free-name` (`:273-293`). `Math` resolves to no binding in the
  module, so the closure is not self-contained.
- A locally created signal whose setter is handed to an imported `attach(setCount)` is refused with
  `signal-escapes-to-opaque-callee` (`:295-310`).

Name and path are demonstrably not inputs to the verdict. Resolved semantics are.

### 5.4 Why marker-free extraction is *safe* here

The honest position is not "analysis is as good as a marker." It is: **a marker is a promise, and
analysis is a proof obligation the compiler discharges or declines.** Qwik's `$` moves the risk to
the author; refusing moves it nowhere — an unprovable component compiles to exactly the code Solid
compiles today.

That fallback is load-bearing at both ends of the pipeline. At compile time, any accumulated reason
turns the verdict to `fallback` and no artifacts are emitted
(`src:comptime/classify.ts:665-667`). At runtime, `resume()` returns `null` for a component
with no artifacts rather than throwing, so a build simply falls through to `render()`
(`src:resume/index.ts:106-109`, `local:test/resume.test.ts:347-359`). CounterB then renders
and drives correctly through completely unmodified `solid-js`
(`local:test/resume.test.ts:369-389`), and a resumed component and a `render()`ed one run side by
side on one page without disturbing each other (`local:test/resume.test.ts:391-412`).

The upshot: the *cost* of an imprecise analysis is a smaller resumable subset, never a broken app.
That asymmetry is what makes shipping a marker-free extractor defensible, and it is the reason the
analysis can afford to be conservative — as it currently is, aggressively so.

---

## 6. Constraints: zero public API change, no breakage

**Zero public API change.** The mechanism is entirely a build-time and bootstrap-time affair. The
fixtures are ordinary Solid components with no markers, annotations, or special imports
(`src:fixtures/CounterA.tsx`, `src:fixtures/CounterB.tsx`). No file under
`~/dev/open-source/solid` was modified — a clean-tree check on that repo (and on
`vendor/dom-expressions` and `yuku`) is part of every packet's verification and of this unit's own
verify fence. Nothing in `src/resume/` imports `solid-js` or `@solidjs/web` at all; its only
bare import is `@solidjs/signals`, statically asserted
(`local:test/resume.test.ts:222-244`).

**No breakage — at the level the spike can show it.** The classic baseline
(`local:test/classic-baseline.test.tsx`) renders and drives *both* fixtures through unmodified
`solid-js` — `2.0.0-beta.33` when this was written, `2.0.0-rc.0` on today's pins — including the
shared-signal behaviour of Fixture A and the escaped-signal
behaviour of Fixture B, and mounts them together to check independence. That suite is the floor every
later spike packet had to keep green, and it stayed green (46 tests across 5 files at this report's
date; 349 across 18 today).

**What has not run:** Solid's own test suite. The no-breakage check against `solid@next` —
`pnpm test` → `turbo run test test-types typecheck --filter=!test-integration`
(`solid:package.json`, scripts; per-package `vitest run` + two `tsc` project builds at
`solid:packages/solid/package.json`) — is **scheduled as part of the final audit and has not
been run for this report.** No claim in this document depends on it having run. Given that the Solid
tree is byte-for-byte untouched, the expectation is that it passes trivially; that expectation is not
evidence.

---

## 7. Prior art positioning

**Markless — comptime prior art.** Per the owner's correction recorded at
(`local:docs/goals/solid-resumability/notes/T002-markless-frameless-yuku-map.md:50-52`), markless does
**not** capture structure at SSR time. Subscription topology, wiring, locators, and capture slots are
collected entirely at compile time by a typed pass pipeline
(`markless:specs/framework/02-compiler-pipeline.md`;
`markless:packages/compiler/src/passes/state-lowering.ts`,
`markless:packages/compiler/src/passes/capture-analysis.ts`,
`markless:packages/compiler/src/passes/symbol-modules.ts`,
`markless:packages/compiler/src/passes/payload-arena.ts`); the runtime supplies **values** only, and
resume works in a pure CSR environment with no server render pass at all. Its bootstrap decodes
payloads and installs delegated listeners without executing any app symbol; the first event drives
`resumeEventOnlyFromPayloadDocument` (`markless:packages/web/src/event-only-resume.ts`), against a
runtime graph that is explicitly not a VDOM (`markless:specs/framework/06-runtime-resumer.md`). This
design is the same shape, adapted to a language markless does not control: handlers extracted into
lazily loadable symbol modules over capture manifests, structure as static data, values at runtime.
The difference is that markless *owns* its state primitive and can lower every read and write
(`markless:README.md`), whereas Solid signals are first-class runtime values — which is exactly why
this design needs a refusal and markless does not.

**Frameless — semantic-record prior art.** Frameless has no resume runtime. Its single
`enriched-ir` pass (`frameless:packages/compiler/src/pass-registry.ts`) produces a semantic record —
graph bindings, `ExpressionSite`s with structural `GraphReadRef`s, template nodes, event records,
sync policies (`frameless:packages/compiler/src/schema.ts`) — consumed by per-framework emitters; its
Qwik emitter, built on yuku-analyzer and yuku-codegen, emits `$`-wrapped code and delegates
resumability to Qwik's runtime (`frameless:packages/frameworks/qwik/src/emitter/index.ts`). The
record model is the shape the expression-level tranche of §3 should adopt.

**Qwik — the contrast.** Qwik-style per-node serialized attributes put the resumability payload in
the HTML, on every response. Markless rejects that in favour of compact data scripts
(`markless:specs/framework/05-resumability-payload.md:118`), and this design goes one step further:
the structure is not in the response at all, it is static module data replacing eager component code
(§2.1). Byte-neutral, cacheable, and proven byte-identical to classic output
(`local:test/parity.test.tsx`).

**Yuku — the toolchain.** `yuku-parser` (ESTree/TS-ESTree AST + walk), `yuku-analyzer` (scopes,
symbols, resolved references, closures, cross-file linking in one native pass), `yuku-codegen`
(printing handler bodies back out verbatim) all operate on standard TSX — no dialect is needed for
Solid sources (`yuku:README.md`, `yuku:npm/yuku-parser/package.json`,
`yuku:npm/yuku-codegen/package.json`). `yuku-tsrx` and `oxc-tsrx` exist for the `.tsrx` dialect and
are irrelevant here except as prior art.

---

## 8. What this must eventually integrate with in Solid — report-level analysis, untested

The spike is CSR-only and touches none of the following. Each is read from source at the pinned
commits and is stated as analysis, not as result.

1. **Eager component execution in `hydrate`.** `createComponent` runs the body eagerly and
   synchronously — `untrack(() => Comp(props))` (`solid:packages/solid/src/client/component.ts:74-80`,
   dev path `solid:packages/solid/src/client/core.ts`). Hydration does not change this: `hydrate()`
   sweeps the registry and then runs a **full `render()`**
   (`vendor:packages/runtime/src/client.js:1297-1299`), and `insert()` creates live effects during
   the claim pass (`vendor:packages/runtime/src/client.js:553-601`). A resumable component must be
   *excluded from that tree walk*, not merely made cheaper — which is a build-output question (what
   the compiler emits for a provable component) rather than a runtime-API question.

2. **`_hk` registry claiming.** Hydration is registry-claim based, not a pure DOM walk:
   `gatherHydratable` performs one `querySelectorAll('*[_hk]')` sweep, skipping frame regions
   (`vendor:packages/runtime/src/client.js:1828-1852`), and compiled code claims elements by key via
   `getNextElement` (`:1305-1327`), with text/holes positional through comment markers
   (`:1334-1353`, `:534-551`). This is a **ready-made DOM-locator scheme** and is strictly better than
   the spike's child-index locators (`src:resume/locate.ts`), which are safe only because the
   template is proven to contain no whitespace-only text nodes
   (`local:test/parity.test.tsx:64-84`). Real integration should key wiring records to `_hk` values.

3. **Delegated-event replay queue.** dom-expressions already queues pre-hydration events and replays
   them once the node is claimed — `runHydrationEvents` replays `_$HY.events` only after
   `completed.has(el)` (`vendor:packages/runtime/src/client.js:1417-1463`), with dedup during
   hydration. That queue is the natural entry point for a resumed component: today it waits on
   per-node hydration completion; a resumable component would satisfy it by binding from a static
   wiring record instead. Handlers are stored as `$$type` node properties by `addEvent`
   (`vendor:packages/runtime/src/client.js:351-361`) — assigned *only by executed code*, which is the
   gap this design fills.

4. **Frames — the runtime's closest existing primitive.** The frame store is a resident keyed record
   store whose chunks are order-independent writes with in-place morph
   (`vendor:packages/runtime/src/frame-client.js:1-31`, `88-121`), and `serverOwned`/`NoHydration`
   regions emit **no hydration keys** at all — HTML that *is* its own data, with client interactivity
   re-entering only through slots (`vendor:packages/runtime/src/frame-sink.js:59-76`); transport is
   length-prefixed chunk framing shared with server functions
   (`vendor:packages/runtime/src/frame-transport.js:30-76`). This is the one place in the runtime
   where execution is skipped entirely, and it is the most plausible seam for a "resumed region."

5. **What the runtime does *not* have.** `_$HY.r` serializes **data values** only via seroval — not
   the signal graph, not subscriptions, not handlers
   (`vendor:packages/runtime/src/serializer.js:36`, `51-76`, `82-100`). There is no key→lazy-handler
   map. Notably, Solid 2.0's hydration is already *serialized-value-authoritative*: under the default
   `ssrSource: "server"` policy the client uses the serialized value and the compute does **not**
   re-run (`solid:packages/solid/src/client/hydration.ts`, policy block ~L46-77; interception at
   `hydrateSignalLike` ~L814, `hydrateStoreLike` ~L934). So the baseline is already "no recompute" —
   which is precisely why the remaining resumability problem in Solid 2.0 is *graph construction,
   component execution, and listener attachment*, not value recomputation. That is the problem this
   design attacks.

6. **Control flow and the graph.** `<For>`→`mapArray`, `<Repeat>`→`repeat`, `<Show>`/`<Switch>`
   memos are all built eagerly inside component bodies
   (`solid:packages/solid/src/client/flow.ts:84`, `119`, `178-260`), on top of the 2.0 signal core
   (`solid:packages/solid-signals/src/core/core.ts`, `solid:packages/solid-signals/src/core/effect.ts`).
   None of it is in the provable subset today. `solid-web` is a one-line re-export of the runtime
   (`solid:packages/solid-web/src/client.ts`), with `hydrate` installing `sharedConfig` then calling
   `hydrateCore` (`solid:packages/solid-web/src/index.ts:191-193`), so integration work lands in
   dom-expressions, not in Solid core — a point in this design's favour for the no-API-change
   constraint. Server-side entry points (`solid:packages/solid/src/server/hydration.ts` — `NoHydration`
   L261, `Hydration` L274) are entirely out of scope here.

---

## 9. Versions and timing

- **solid `next`**: pinned `4879891e09680b026085e1cb70f22f54912244ee` (2026-08-11). All Solid
  citations were read via `git show 4879891e…:<path>`; the local working tree was stale and was never
  read or modified.
- **dom-expressions**: `vendor/dom-expressions` @ `d1f20ac0146be3267a7afdfbcd472d10918972db`, runtime
  `0.50.0-next.41` (`vendor:packages/runtime/package.json`) — exactly the version solid@next resolves
  (`solid:package.json`, `@dom-expressions/runtime@0.50.0-next.41`, confirmed in its lockfile). An
  earlier reading of "0.50.0-next.4" was a misread of `.41`; the contradiction is closed
  (`local:docs/goals/solid-resumability/notes/T006-dom-expressions-map.md:5`).
- **Spike pins** (`local:package.json`): `solid-js`, `@solidjs/signals`, `@solidjs/web` all
  `2.0.0-rc.0`; `@solidjs/vite-plugin` `3.0.0-next.28`; `vitest` `4.1.10`; `jsdom` `30.0.1`. Read at
  the report's date these were `2.0.0-beta.33` and `vite-plugin-solid` `3.0.0-next.24`; the RC bump
  landed on 2026-08-13 and carried the plugin rename with it, since `vite-plugin-solid`'s peer range
  excludes `2.0.0-rc.0`.
- **The dom-expressions packaging finding:** **no standalone `@dom-expressions/runtime` resolves at
  this pin** — the DOM runtime ships bundled inside `@solidjs/web@2.0.0-rc.0`, as it did at the beta.
  What does resolve is `@dom-expressions/babel-plugin-jsx` (`0.50.0-next.41`, with `0.50.0-next.42`
  alongside it since the plugin rename) and `@dom-expressions/compiler@0.50.0-next.40`
  (`local:docs/goals/solid-resumability/notes/T004-spike.md`). The vendored clone remains the correct
  reading of the runtime's *source*; it is simply not a separately installed package here.
- **Two Solid 2.0 behaviours the spike had to design around**: the client build is reachable only
  under the `browser`/`development` export conditions (forced in `local:vitest.config.ts`, else the
  server build loads); and writes are batched, so `setCount(count() + 1)` is not visible to a
  subsequent read until `flush()` (`src:resume/index.ts:152-157`).
- **RC expected 2026-08-12 — landed, and this repo is on it.** The pins above were read the day
  before the RC; the re-check this bullet asked for was done and the repo now runs on `2.0.0-rc.0`
  with every gate held. One dist-tag detail survives the check: `solid-js@2.0.0-rc.0` is published
  on `next` only — `latest` is still 1.9.x — so a bare `pnpm add solid-js` resolves 1.x here.
  Version drift stays an explicit risk (§10.5).

---

## 10. Risks and open items

Carried from the board record's `open_risks` (`local:docs/goals/solid-resumability/state.yaml`) and
the spike's open items (`local:docs/goals/solid-resumability/notes/T004-spike.md`).

**10.1 Provable-subset breadth — the actual open feasibility question.** One fixture shape is proved:
literal-initialized local signals, inline handlers, static intrinsic markup, one derived text
binding. **Untested:** props, context, stores, `createMemo`, effects, control flow (`<Show>`, `<For>`,
`<Repeat>` — `solid:packages/solid/src/client/flow.ts:84-260`), attribute and class bindings,
non-literal initializers, nested components in markup, multiple components per file. The classifier
refuses all of these today by construction (component elements at
`src:comptime/classify.ts:342-349`, non-literal initializers at `:167-178`, mixed children at
`:416-421`). Realistic coverage of production Solid code under the *current* subset is low; the
question this report cannot answer is how far the subset extends with reasonable effort. That is the
number that decides whether this is interesting or merely true.

*Since this report:* one bounded measurement of that number exists, taken over code nobody here
wrote. Twelve Kobalte component functions, registered before any verdict existed, classify **0 of 12
provable**, with every refusal named by code and by site and read from both Kobalte's own source and
its published dist — [`docs/kobalte/profile.md`](./kobalte/profile.md). That is a result about those
twelve functions and is not a coverage figure for the library; the first-party number stays the one
in `docs/coverage/`.

**10.2 Composition and mixing.** Asserted only at the crudest level — a resumed component and a
`render()`ed one coexist on a page without disturbing each other
(`local:test/resume.test.ts:391-412`). Nesting a provable component inside a refused one (or the
reverse) and passing state across that boundary is **untested**, and it is where the fallback story
actually gets decided. Interop with `_hk` claiming and `_$HY.events` replay (§8.2, §8.3) is report
analysis only.

**10.3 Bootstrap size budget — unenforced.** `src/resume/` is ~15.9 KB of source, ~7.0 KB with
comments stripped, and is never bundled or minified. Nothing measures the shipped bootstrap or gates
a regression on it, so markless's comparison point — a 300-500 B gzip target with a 700 B hard budget
for the code portion (`markless:specs/framework/05-resumability-payload.md:155`) — has no counterpart
here. Only the *zero-execution* property is enforced, not the size property.

**10.4 Dynamic and async initial values.** Out of scope for the spike. A cell whose initial value is
computed or awaited cannot be frozen into a static artifact
(`src:comptime/classify.ts:167-178`). Request-time value serialization — **values only, never
structure**, which is what keeps the design byte-neutral in spirit even when the HTML must carry
data — remains an unexercised report-level fallback. Solid already has the machinery for it
(`vendor:packages/runtime/src/serializer.js` into `_$HY.r`).

**10.5 Version drift.** `2.0.0-rc.0` on npm may lag the pinned commit this report reads from, and
the release train has already moved the pins twice since the report was written — beta.33 to
beta.34 to `2.0.0-rc.0`, the last hop carrying the `vite-plugin-solid` to `@solidjs/vite-plugin`
rename with it, because the old package's peer range excludes the RC. Pins are recorded (§9)
precisely so drift is detectable rather than silent.

**10.6 Toolchain friction — closed.** As written, this risk read: yuku packages are consumed
via pnpm `link:` rather than `file:` (the local checkout's manifests declare `@yuku-toolchain/types`
as `workspace:*`, unresolvable outside yuku's workspace), and `yuku-analyzer` is vendored, with the
native binary copied from `yuku/zig-out`, because the binding directory in that checkout ships only a
stub. Both were packaging work, not design problems, and both are now gone: `yuku-parser`,
`yuku-analyzer` and `yuku-codegen` are exact registry pins at `0.8.5` (`local:package.json`), and
`@yuku-analyzer/binding-darwin-arm64@0.8.5` resolves as an ordinary optional dependency. The full
suite is green on the published packages with no source change, so nothing in §5 depends on the
checkout.

**10.7 Objection (a)'s scope, restated as a risk.** Cross-island shared state and `shared()`
equivalents are not spike-proven (§4.4).

---

## 11. Next steps

1. **Expression-level lift/lower (§3).** Replace whole-source `compute` and handler bodies with
   expression records so a single unprovable sub-expression demotes an expression, not a component.
   Model on `frameless:packages/compiler/src/schema.ts` (`ExpressionSite`, `GraphReadRef`) and
   markless's collectors. This is the single highest-leverage change and turns the per-component
   verdict into a per-expression one.
2. **Widen the provable subset, measured.** In priority order: props (the most common escape today),
   `createMemo` as a derived cell, `<Show>` (a static two-branch template), attribute/class bindings,
   then `<For>` (which needs a keyed-region protocol, not just a binding). Gate each with a coverage
   metric over a real Solid codebase — the answer to §10.1 is a percentage, and it should be measured
   rather than argued.
3. **Composition.** Build the mixed fixture: provable inside refused, refused inside provable, state
   crossing the seam. Decide the boundary contract before widening the subset further, since the
   subset is only useful to the degree it composes.
4. **Cross-island cells.** Lift the cell table above `resume()` so two components can share one
   source, and re-run the identity assertion of §4.2 across that boundary. This is the direct
   extension of objection (a)'s evidence to the case Ryan is actually worried about.
5. **Integration in dom-expressions, not Solid core.** Key wiring records to `_hk` instead of child
   indices; make a resumed region satisfy the `_$HY.events` replay queue without per-node hydration
   completion; investigate `serverOwned`/frames as the "resumed region" seam
   (`vendor:packages/runtime/src/frame-sink.js:59-76`). All of this lands in the runtime, where the
   public API question does not arise.
6. **Size gate.** Bundle and minify the bootstrap, publish the number, and fail the build on
   regression — so the markless comparison becomes a fact rather than an aspiration.
7. **Re-pin after the RC** (2026-08-12) and re-run the spike against the released tags.

---

## 12. Provenance

Evidence receipts behind this report:
`local:docs/goals/solid-resumability/notes/T001-solid-next-map.md` (solid@next internals),
`local:docs/goals/solid-resumability/notes/T002-markless-frameless-yuku-map.md` (markless/frameless/yuku
— including the owner correction at :50-52, which supersedes that note's earlier wording),
`local:docs/goals/solid-resumability/notes/T006-dom-expressions-map.md` (the DOM runtime),
`local:docs/goals/solid-resumability/notes/T004-spike.md` (the spike),
`local:docs/goals/solid-resumability/state.yaml` (the architecture decision and open risks).
Machine-checkable citation index: `local:docs/feasibility-citations.txt`.

Reproduce the spike:

```
pnpm install && pnpm test                 # 46 passed, 0 skipped (5 files) as of this report
pnpm comptime                             # re-emit artifacts/CounterA + print verdicts
pnpm vitest run test/resume.test.ts       # the resume evidence suite alone (17 tests)
```
