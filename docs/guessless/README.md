# Guessless receipts

A worked example, kept here so the integration is something you can run rather than something the
docs assert.

`guessless` and `@guessless/engine` are devDependencies here, both pinned exact at 1.0.0, so queries
run as `pnpm exec guessless query envelope.json` from the repo root. The npm package ships `dist`
only, so `claim-gate.mjs` and `reproduce-check.mjs` are invoked from the sibling checkout.

`fallback-exports.receipt.json` answers `exportedNames` for `plugin/src/stages/fallback.ts` — the
auto-omit stage W6 added — over all 19 files of `plugin/src`. It was produced by the checkout build
and re-verified byte-identical against the published 1.0.0 CLI. `fallback-exports.reproduction.json`
carries the same inputs alongside the receipt, which is what makes the answer checkable later:

```sh
node /Users/jacksm5pro/dev/open-source/guessless/scripts/reproduce-check.mjs docs/guessless
# reproduce-check: 1 reproduced, 0 failed, 0 unverifiable
```

## Read the state before you read the results

The receipt's state is **`partial`**, not `complete`, and that is the honest answer rather than a
shortcoming. It found eight exports — `FallbackOmissionError`, `fallbackPlugin`,
`FallbackRefusalName`, `FallbackReport`, `omitFallbackImport`, `OmittedFallback`, `omittedFallbacks`,
`runFallbackStage` — and named ten places where the module graph leaves the file set it was given:

| Count | Reason | What it is |
| ---: | --- | --- |
| 4 | `external-module-boundary` | `unplugin`, `pathe`, the `yuku-*` packages |
| 3 | `builtin-module-boundary` | `node:fs` and friends |
| 3 | `unresolved-specifier` | the `../../src/comptime/*` imports that live outside `plugin/src` |

Two of those three classes can never be closed — you cannot hand guessless the inside of `node:fs` —
so `complete` is not reachable for this query no matter how many files you add. **That means the
eight names above must not be cited as "all the exports".** They are the exports guessless saw, over
the file set it was given, with the gaps named. Citing the list is fine; citing it as exhaustive is
the exact move the gate exists to stop.

Widening the envelope to include `src/comptime/**` would retire the third row and nothing else.

## Why this repo has a folder for this

The finish-line goal's audits kept turning up the same defect, and it was never broken code — it was
a confident sentence that had quietly stopped being true. A set of "seven frozen anchor sites" that
was not seven. "Six witness boxes" asserted against a suite of seven. Three live citations to
`demo/build/prerender.mjs` after that file was deleted, one of them inside served markup. A final
audit that had to resolve path citations across 397 files by hand before it would sign.

Guessless prices the JavaScript/TypeScript half of that problem. It does not price the other half: a
stale path inside a markdown table or an HTML comment is still yours to read. And it has nothing to
say about the artifact gates — `check-zero-eager.mjs`, the witness boxes and the coverage report ask
what a *built bundle* contains and what a *real browser* fetched, which is a different kind of
evidence that happens to share vocabulary. Do not cite one for the other.
