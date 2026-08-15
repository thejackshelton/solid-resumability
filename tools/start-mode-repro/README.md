# `start: true` reproduction

The runnable half of the start-mode answer. The written answer, with the source
citations and the named seam, is [`docs/start-mode/answer.md`](../../docs/start-mode/answer.md).

```
node tools/start-mode-repro/run.mjs
```

That installs this directory's own dependency tree, builds and serves two arms,
prints every byte of both verbatim, and exits non-zero if the start arm ever
shows composition working.

## Self-contained on purpose

Its own `package.json`, its own `pnpm-lock.yaml`, its own `node_modules`. It
reads no pin, config or source file of the surrounding repository and writes
none — the RC bump landed one slice before this was written, and contaminating
it would have cost the tranche its before/after. The plugin under test is
reached through `link:../../plugin`, the same way `demo/` reaches it, so what
runs here is the same built `plugin/dist` the demo builds against and nothing
was published to get it.

## The two arms

Both are handed the same component, the same resumability options and the same
page declaration. The only difference is one boolean:

| | plugin call | what it is for |
|---|---|---|
| ARM 1 | `solid()` | the control — composition on the non-start path |
| ARM 2 | `solid({ start: true })` | the question |

The control is not decoration. Without it, a failure in the start arm could just
as easily mean the reproduction is wrong; with it, the difference is
attributable to the flag and to nothing else.

## What is instrumentation, and why it is not shaping

Three things in `repro.config.mjs` exist to make the result audible rather than
to produce it, and all three are readers:

- `announceHooks` wraps the resumability plugin's own `transformIndexHtml` and
  `closeBundle` in a function that prints and then delegates to the original. No
  argument, return value or ordering changes.
- `observeResolvedConfig` is a `configResolved` hook that prints `appType`, the
  client input, the out directories and which plugins carry an HTML hook. It
  writes nothing back.
- `probeDocumentAtCloseBundle` computes the path `prerender.ts:354` computes —
  `join(distDir, basename(page.html))` — at the moment `closeBundle` fires, and
  reports whether it is on disk yet.

Nothing here makes the start arm fail. What makes it fail is the flag.
