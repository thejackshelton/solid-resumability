# The exploration — from Markless to a resumable Solid

## What this is

A compile-time pass that makes *ordinary* Solid 2.0 components resumable — interactive without ever
running their bodies — with no marker, no new API, and no patch to solid-js. On the demo's fixtures
page the eager JavaScript is **5.50 kB gzip against classic Solid's 12.60 kB** for the same page;
on the ported TodoMVC it is **14,665 B**, with four component bodies — two the pass cannot prove,
two it proves but may not substitute — plus the framework, the store and the API in a
**62,331 B group that no byte of travels until the user touches the page**. Both pages run **zero
component bodies before the first interaction** — read live through a loader hook, and the byte and
request halves re-asserted in a real Chrome against what the browser actually fetched.

## Inspiration: Markless

Markless is the framework I have been working on, and this design is its shape carried into a
language it does not own. What carried over:

- **All structure is collected at compile time** — subscription topology, wiring, locators, capture
  slots. The runtime supplies values only.
- **Handlers are lazy symbol modules over capture manifests.** The first event pulls the one module
  that event needs, never the component.
- **Resume without re-execution.** The bootstrap claims served markup and installs delegated
  listeners; no application symbol runs to make the page live.

What differs is the thing that shaped everything else. Markless owns its state primitive and lowers
every read and write, so nothing is opaque to it. Solid's signals are first-class runtime values and
its components are not compiler-owned, so this pass has to *prove* each component with an analyzer
and *refuse* the ones it cannot. Markless needs no refusal. Here the refusal is the whole safety
argument.

## What Solid gains

- **Zero eager component execution, at any coverage level.** Not a fraction of the boot cost —
  none of it. The todos page proves 3 of its 5 components, resumes exactly one of them, and still
  runs 0 bodies before the first interaction — because everything it does not resume is deferred
  rather than shipped, whether the pass proved it or refused it.
- **Per-interaction code loading.** A handler arrives on the event that needs it: seven handler
  modules on the fixtures page, 0.16–0.19 kB gzip each, none fetched at load.
- **A fallback decided by analysis, not by annotation.** Components the pass cannot prove are
  refused by name and code and take the unmodified `render()` path. Imprecision in the analyzer
  costs coverage, never correctness — the escape hatch is the default, so no user-visible behaviour
  rides on the analyzer being clever.
- **Zero public API changes, no framework fork.** solid-js, `@solidjs/web` and `@solidjs/signals`
  are the published `2.0.0-rc.0` packages, unpatched; `app/src/**` is Ryan's own TodoMVC example
  ported unedited.
- **The measured deltas.** Fixtures eager JS -56.4% gzip (12.60 → 5.50 kB) and the whole initial
  transfer -6.93 kB gzip with the larger served markup already counted; todos eager JS -74.4% gzip
  (22.55 → 5.78 kB).

## Why CSR

No hydration conflicts with Solid here, and also to show that this model works across multiple
rendering strategies. The pass produces static data — a template, a cell table, a wiring list, a
capture manifest — and CSR is the environment where that data is the only thing the browser gets, so
nothing about a server render pass can be doing the work by accident. It also keeps the vocabulary
exact:

**Resumed components never render; deferred components render late; nothing hydrates.**

That is a claim about the model, not a claim about every toolchain mode it might be dropped into.
The plugin composes with `@solidjs/vite-plugin` on that plugin's ordinary path, and it does *not*
compose under `start: true` — there the resumability plugin loads, emits its artifacts, registers
its `transformIndexHtml` hook, and the hook is never called, with a build that exits 0 and warns
about nothing. The line is drawn from the published source read hook by hook and from a build that
was actually run, in [`docs/start-mode/answer.md`](./start-mode/answer.md).

## How it works

One pass, four stages, no annotation anywhere in the source:

1. **Analyzer verdicts over unannotated TSX.** yuku-analyzer resolves scopes, symbols, references
   and closures; a component is proved only when its entire interactive surface can be
   reconstructed — `createSignal` destructuring, accessor escape analysis, `capturesOf` on inline
   handlers, static-JSX checks. Fixture A (a local signal, two handlers sharing it) is proved;
   Fixture B (that signal escaping into an opaque helper) is refused. Neither carries a marker.
2. **Static artifacts.** Each proved component emits a template — byte-identical to `render()`'s
   output, with zero normalization — plus its cells, its wiring, and one lazily loadable module per
   handler.
3. **The resume runtime.** It claims the DOM the build already painted, wires one delegated
   listener, and pulls a handler module on the event that needs it. Its reactive core is a
   **294 B gzip cell kernel** (514 B raw), where an earlier signals-backed resume path carried
   8.96 kB gzip of `@solidjs/signals`. Store actions are joined to the resumed component by
   identity, so a dispatch from resumed code and the deferred store's own writes land on one store.
4. **Group activation on first touch.** The four bodies that stay in the group — two unproved, two
   proved but not safe to substitute — with the framework, the store and the API, sit behind one
   dynamic import. Transfer starts on the first interaction signal; execution happens on the event
   that commits.

**The group is one chunk on purpose.** Activation is atomic — every module of the group runs before
any member handler does — so a boundary drawn inside it can never remove a byte from the first
touch; it only adds gzip-boundary overhead. All three chunkings were built and weighed: three-way
costs **+1,450 B gzip**, two-way +337 B, against 23,096 B for the single chunk. What shrinks the
group is provable coverage, not chunk surgery — coverage is the lever that empties it, but proving
alone is not the whole condition. A proved component leaves only if it is also safe to substitute:
`MainSection` and `Footer` are proved and stay, because what flips their guard is a store write, the
store is the group's, and a substituted mount would ship empty. Every component that clears both
*leaves* it — the body becomes artifacts plus a handler chunk, and the framework leaves with the
last one out. The fixtures page is that end state today: five of five proved, and its entry carries
no framework at all.

## Pushing further

When you get to a unified render environment from the compiler, that allows for even cooler things
like Rust, Go, Kotlin SSR etc. or even rendering native in the same application.

The opening for that is already in the artifact shape. What a proved component leaves behind is
data, not JavaScript: markup, a cell table, a binding list, a capture manifest, and handler bodies
printed back out verbatim. Data has no host language. The producer does not have to be a JavaScript
server, and the consumer does not have to be a DOM — the same structure describes a native tree as
readily as an HTML one, because the framework code was never what carried the structure.

## Where to look

- `docs/feasibility-report.md` — the long-form verdict, with §1 stating exactly what is proven
  mechanically, what is argued from source reading, and what is not claimed at all. That boundary is
  not narrowed anywhere later in the report.
- `docs/measurements/` — every number above, regenerated by `cd demo && pnpm measure`, including the
  group anatomy module for module and the three chunkings side by side.
- `verify/` — seven witness boxes driving a real Chrome over CDP against the built pages, asserting
  what the browser actually requested, uncompressed, so every total over-counts rather than flatters.
- `demo/` — the instrument: two variants (classic, resumable) across two pages, built per page so
  one page's graph cannot move the other's bytes.
- `docs/kobalte/profile.md` — what this pass says about a third-party component library: twelve
  Kobalte component functions, registered before any verdict existed, of which **0 of 12 are
  provable**, each refusal named by code and site and read from both Kobalte's own source and its
  published dist. Every claim there is bounded to those twelve functions.
- `docs/start-mode/answer.md` — whether this plugin composes with `@solidjs/vite-plugin`'s
  `start: true`. It does not, and it fails silently; without `start: true` the two compose
  completely. Source, a reproduction build, and the seam that would have to be opened.
- `docs/coverage/` — the unflattered coverage number over `app/src/**` (3 / 5 in the `app` segment),
  classified by the analyzer rather than by name, with the refusal codes counted. An analyzer
  verdict is not a wire fact: one of those three is resumed on the wire, the other two carry
  guard-only artifacts and keep their bodies in the deferred group.
