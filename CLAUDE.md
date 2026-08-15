# solid-resumability

## Structural claims about JavaScript/TypeScript

Do not assert that you have found *all* call sites, *every* reference, or that a symbol is safe to
delete, unless you can show a guessless receipt for that exact claim. `grep` cannot see re-exports,
aliased imports, `export * from`, or property access through a namespace object, so "all" derived
from a text search is a guess.

Guessless is a devDependency here (`guessless` and `@guessless/engine`, both pinned exact at 1.0.0),
so the CLI is on `PATH` through the package manager. To price a completeness claim:

    pnpm exec guessless query envelope.json

where `envelope.json` is `{"inputs": [{"path": "...", "source": "..."}], "request": {...}}`. The
answer is a receipt whose `state` is one of:

- `complete` — the result set is exhaustive. This is the only state that licenses the word "all".
- `partial` — plus a named `unresolved` site for every place the engine could not classify. Say the
  answer is partial and name the gaps.
- `refused` — the question was not answered. It supports no claim at all.

If you have no receipt, say which sites you checked instead of saying "all". A qualified answer is
always acceptable; an unpriced "all" is not.

The `guessless` skill carries the envelope shapes and request kinds; load it rather than
reconstructing them.

### Why this repo in particular

This codebase's recurring defect is not broken code — it is *unverifiable exhaustiveness*. The
finish-line goal's own audits kept finding it: a set of "seven frozen anchor sites" that was not
seven, "six witness boxes" asserted against a suite of seven, three surviving citations to
`demo/build/prerender.mjs` after that file was deleted (one of them inside served markup), and a
final audit that had to resolve path citations across 397 files by hand to be sure. Every one of
those shipped as a confident sentence. The gate exists so the next one has to be priced.

## Claim gate

A `Stop` hook (`.claude/settings.json`) refuses to end a turn on an unhedged completeness claim with
no receipt behind it. It fails open by design — an unreadable transcript or a bug inside the gate
allows the stop — and it never blocks twice in a row, so it cannot trap a session. If it blocks you,
the fix is either a receipt or an honest qualification, never a reworded claim that dodges the
pattern.
