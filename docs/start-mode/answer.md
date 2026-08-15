# Does `unplugin-solid-resumability` compose with `@solidjs/vite-plugin`'s `start: true`?

**No — and the way it fails is worse than a conflict.** Under `start: true` the
resumability plugin is loaded, its analyze pass runs, its artifacts are emitted,
its HTML plugin is registered and visible in Vite's plugin list — and its
`transformIndexHtml` hook is never called. The build exits 0. Nothing warns. The
document that ships carries none of the plugin's work.

Without `start: true` the two compose completely, on the same component, the
same options and the same page declaration. So this is a bounded negative rather
than a bare one: **these two plugins compose; this third mode does not; here is
the line.**

The composition is out of scope as implementation for this tranche. What follows
is the answer, the evidence, and the named seam.

---

## How this was established

Two halves, neither sufficient alone.

**The source half** — the published `@solidjs/vite-plugin@3.0.0-next.28` tarball
read hook by hook, plus Vite 7.3.6's own `config.js`, plus this repository's
`plugin/src/**`. Nothing here is cited from the release announcement.

**The build half** — a self-contained reproduction at
[`tools/start-mode-repro/`](../../tools/start-mode-repro/), with its own
`package.json`, its own lockfile and its own `node_modules`, run twice: once with
`solid()` and once with `solid({ start: true })`, and everything both arms
printed captured verbatim.

```
node tools/start-mode-repro/run.mjs
```

It reads no pin, config or source file of the surrounding repository and writes
none. The plugin under test is reached through `link:../../plugin`, the same way
`demo/` reaches it.

---

## The source evidence

`@solidjs/vite-plugin@3.0.0-next.28` registers `transformIndexHtml` **zero
times, in any mode**. `grep -n transformIndexHtml dist/esm/index.mjs` over its
3,386-line unminified ESM returns nothing. The fear this tranche started with —
that both plugins would want the same hook and would have to be ordered against
each other — was false as written, and the truth is worse: there is no ordering
problem because there is no second claimant. There is only a hook that stops
being called.

Its start-mode hook map, by line in `dist/esm/index.mjs`:
`solid:boundary-modules` :463, `solid` (main) :2845, `solid:server-functions`
:937-1084, `solid:ssr/setup` :1588, `solid:start/prerender` :1853,
`solid:start-env` :2279, `solid:client-build-first` :3344.

### Collision point 1 — config removes every HTML entry

`solid:ssr/setup`'s `config` hook computes the client input at :1631 as either a
virtual module id or an `entry-client.tsx` path — **never an `.html` file** — and
returns it as `environments.client.build.rollupOptions.input` (:1647 in the
`start.external` branch, :1659 in the standard one). This repository's demo does
exactly the opposite at `demo/build/config.mjs:103-104`: two pages as two HTML
entries.

### Collision point 2 — `appType: 'custom'` un-registers the dev hook

:1640, with the plugin's own comment two lines above it (:1638-1639) saying dev
must not SPA-fall-back to an `index.html`. Verified against Vite 7.3.6's own
source:
`node_modules/vite/dist/node/chunks/config.js:25699-25703` gates
`indexHtmlMiddleware` on `appType` being `spa` or `mpa`; `indexHtmlMiddleware` is
the sole caller of `createDevHtmlTransformFn` (`config.js:24702`); and
`createDevHtmlTransformFn` is the sole thing that runs `transformIndexHtml` hooks
in dev, by way of `resolveHtmlTransforms(config.plugins)` at `config.js:24703`.
So `plugin/src/html.ts:883`'s hook never fires under `pnpm dev`. In build, `vite:build-html` filters on `id` matching `/\.html$/`
(`config.js:23940`), so with no `.html` input it has nothing to attach to
either.

### Collision point 3 — production HTML bypasses Vite's HTML pipeline entirely

`solid:start/prerender` (:1853, `apply: 'build'`, `buildApp` `order: 'post'`) at
:1880 does `writeFileSync(dist/client/index.html, await response.text())` from a
`renderToStream`'d JSX `Document` component. That file is not a Rollup asset. No
plugin sees it.

### Collision point 4 — build ordering inverts

This repository's prerender stage is `apply: 'build'` plus `closeBundle`
(`plugin/src/stages/prerender.ts:848-877`) and needs a built document on disk —
`prerender.ts:354-363` throws `PageDocumentMissing` when there is none. Under
start mode `closeBundle` fires **inside** `await builder.build(client)` at
`index.mjs:1873`, strictly before :1880 writes `index.html`. And when the
document does appear it is named `index.html`, not `todos.html` or
`fixtures.html`.

### There is no HTML seam in the official plugin

The complete `StartOptions` surface (`dist/types/src/ssr/index.d.ts`) is `app`,
`entryServer`, `entryClient`, `document`, `middleware`, `setup`, `env`,
`external`. Every "bring your own" option is a JS/JSX module; none is an HTML
file. `README.md:158-159` states the intent plainly: *the plugin owns entries,
dev serving, and the build — no entry files, no `index.html`, no dev server
script*. No `enforce` value and no plugin order re-opens the pipeline, because the hook is never called. `start.external` hands over the
server environment and is ignored in client mode.

---

## The reproduction

One provable component (`src/Counter.tsx`), one page, one resumability
declaration, two arms. Both arms get the identical declaration — the entry swap
and the template inlining, which are the two `transformIndexHtml` features the
plugin performs on a page. The only difference between them is `solid()` versus
`solid({ start: true })`.

Three things in `repro.config.mjs` are instrumentation, and all three are
readers: a wrapper that prints and then delegates to the plugin's own hooks
unchanged, a `configResolved` observer that writes nothing back, and a probe that
computes the same path `prerender.ts:354` computes at the same moment
`closeBundle` fires. None of them can make the start arm fail.

### ARM 1, the control: `solid()`, production build

```
$ /Users/jacksm5pro/.local/share/fnm/node-versions/v24.15.0/installation/bin/node /Users/jacksm5pro/dev/open-source/solid-resumability/tools/start-mode-repro/node_modules/vite/bin/vite.js build --config vite.plain.config.mjs

[repro] arm=plain command=build
[repro] resolved appType = "spa"
[repro] resolved client input = {"index":"/Users/jacksm5pro/dev/open-source/solid-resumability/tools/start-mode-repro/index.html"}
[repro] resolved client outDir = "dist/plain"
[repro] resolved build.outDir = "dist/plain"
[repro] plugins carrying transformIndexHtml: ["unplugin-solid-resumability:html"]
vite v7.3.6 building client environment for production...
provable  src/Counter.tsx (Counter): 1 cell(s), 1 binding(s), 1 handler(s) -> artifacts/Counter/
[repro] HOOK FIRED  unplugin-solid-resumability:html.transformIndexHtml  path="/index.html" filename="/Users/jacksm5pro/dev/open-source/solid-resumability/tools/start-mode-repro/index.html"
transforming...
✓ 3 modules transformed.
rendering chunks...
computing gzip size...
dist/plain/.vite/manifest.json       0.13 kB │ gzip: 0.11 kB
dist/plain/index.html                0.67 kB │ gzip: 0.40 kB
dist/plain/assets/index-DdcwVDqO.js  1.27 kB │ gzip: 0.55 kB
✓ built in 39ms
[repro] closeBundle  arm=plain  distDir=/Users/jacksm5pro/dev/open-source/solid-resumability/tools/start-mode-repro/dist/plain
[repro]   the prerender stage would look for /Users/jacksm5pro/dev/open-source/solid-resumability/tools/start-mode-repro/dist/plain/index.html
[repro]   exists at closeBundle: true
[repro] at process exit  /Users/jacksm5pro/dev/open-source/solid-resumability/tools/start-mode-repro/dist/plain/index.html exists: true
[repro] at process exit  /Users/jacksm5pro/dev/open-source/solid-resumability/tools/start-mode-repro/dist/client/index.html exists: false

[repro] plain build exited with code 0
```

The document it produced, `dist/plain/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>start-mode reproduction</title>
    <script type="module" crossorigin src="/assets/index-DdcwVDqO.js"></script>
  </head>
  <body>
    <div id="root">
      <!--
        Empty in the source, and filled by the resumability plugin's HTML stage
        with `Counter`'s emitted template. A served page whose mount is still
        empty is a page the hook never reached.
      -->
      <div class="mount" data-component="Counter" data-resume="Counter"><div><span data-testid="counter-label">count: 0</span><button data-testid="counter-inc">+</button></div></div>
    </div>
  </body>
</html>
```

The mount that was empty in the source carries `Counter`'s emitted markup. The
entry swap landed too: the built chunk `dist/plain/assets/index-DdcwVDqO.js` ends
with `console.log("[repro] resumable entry loaded — the entry swap happened");`,
which only `src/resumable-entry.ts` contains.

### ARM 1, the control: `solid()`, dev server

```
[repro] arm=plain command=serve
[repro] resolved appType = "spa"
[repro] resolved client input = {"index":"/Users/jacksm5pro/dev/open-source/solid-resumability/tools/start-mode-repro/index.html"}
[repro] plugins carrying transformIndexHtml: ["unplugin-solid-resumability:html"]
provable  src/Counter.tsx (Counter): 1 cell(s), 1 binding(s), 1 handler(s) -> artifacts/Counter/
[repro] dev server listening at http://localhost:5398/
[repro] HOOK FIRED  unplugin-solid-resumability:html.transformIndexHtml  path="/index.html" filename="/Users/jacksm5pro/dev/open-source/solid-resumability/tools/start-mode-repro/index.html"
[repro] GET http://localhost:5398/ -> 200 text/html
[repro] ---- served document begins ----
<!doctype html>
<html lang="en">
  <head>
    <script type="module" src="/@vite/client"></script>

    <meta charset="utf-8" />
    <title>start-mode reproduction</title>
  </head>
  <body>
    <div id="root">
      <!--
        Empty in the source, and filled by the resumability plugin's HTML stage
        with `Counter`'s emitted template. A served page whose mount is still
        empty is a page the hook never reached.
      -->
      <div class="mount" data-component="Counter" data-resume="Counter"><div><span data-testid="counter-label">count: 0</span><button data-testid="counter-inc">+</button></div></div>
    </div>
    <script type="module" src="/src/resumable-entry.ts"></script>
  </body>
</html>

[repro] ---- served document ends ----
[repro] served carries classic entry: false; resumable entry: true; inlined template: true
```

### ARM 2: `solid({ start: true })`, production build

```
$ /Users/jacksm5pro/.local/share/fnm/node-versions/v24.15.0/installation/bin/node /Users/jacksm5pro/dev/open-source/solid-resumability/tools/start-mode-repro/node_modules/vite/bin/vite.js build --config vite.start.config.mjs

[repro] arm=start command=build
[repro] resolved appType = "custom"
[repro] resolved client input = "virtual:solid-ssr-entry-client.tsx"
[repro] resolved client outDir = "dist/client"
[repro] resolved build.outDir = "dist/start"
[repro] plugins carrying transformIndexHtml: ["unplugin-solid-resumability:html"]
[repro] arm=start command=build
[repro] resolved appType = "custom"
[repro] resolved client input = "virtual:solid-ssr-entry-client.tsx"
[repro] resolved client outDir = "dist/client"
[repro] resolved build.outDir = "dist/client"
[repro] plugins carrying transformIndexHtml: ["unplugin-solid-resumability:html"]
[repro] arm=start command=build
[repro] resolved appType = "custom"
[repro] resolved client input = "virtual:solid-ssr-entry-client.tsx"
[repro] resolved client outDir = "dist/client"
[repro] resolved build.outDir = "dist/server"
[repro] plugins carrying transformIndexHtml: ["unplugin-solid-resumability:html"]
vite v7.3.6 building client environment for production...
provable  src/Counter.tsx (Counter): 1 cell(s), 1 binding(s), 1 handler(s) -> artifacts/Counter/
transforming...
✓ 33 modules transformed.
rendering chunks...
computing gzip size...
dist/client/.vite/manifest.json                                 0.23 kB │ gzip:  0.14 kB
dist/client/assets/virtual_solid-ssr-entry-client-BZbiTec5.js  63.92 kB │ gzip: 15.86 kB
✓ built in 147ms
[repro] closeBundle  arm=start  distDir=/Users/jacksm5pro/dev/open-source/solid-resumability/tools/start-mode-repro/dist/client
[repro]   the prerender stage would look for /Users/jacksm5pro/dev/open-source/solid-resumability/tools/start-mode-repro/dist/client/index.html
[repro]   exists at closeBundle: false
vite v7.3.6 building ssr environment for production...
provable  src/Counter.tsx (Counter): 1 cell(s), 1 binding(s), 1 handler(s) -> artifacts/Counter/
transforming...
✓ 4 modules transformed.
rendering chunks...
dist/server/.vite/manifest.json  0.15 kB
dist/server/server.js            2.98 kB
✓ built in 9ms
[repro] closeBundle  arm=start  distDir=/Users/jacksm5pro/dev/open-source/solid-resumability/tools/start-mode-repro/dist/server
[repro]   the prerender stage would look for /Users/jacksm5pro/dev/open-source/solid-resumability/tools/start-mode-repro/dist/server/index.html
[repro]   exists at closeBundle: false
[repro] at process exit  /Users/jacksm5pro/dev/open-source/solid-resumability/tools/start-mode-repro/dist/client/index.html exists: true
[repro] at process exit  /Users/jacksm5pro/dev/open-source/solid-resumability/tools/start-mode-repro/dist/client/index.html exists: true
[repro] at process exit  /Users/jacksm5pro/dev/open-source/solid-resumability/tools/start-mode-repro/dist/server/index.html exists: false
[repro] at process exit  /Users/jacksm5pro/dev/open-source/solid-resumability/tools/start-mode-repro/dist/client/index.html exists: true

[repro] start build exited with code 0
```

Not one `HOOK FIRED` line. The document it shipped,
`dist/client/index.html`:

```html
<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><script type="module" src="/assets/virtual_solid-ssr-entry-client-BZbiTec5.js"></script></head><body></body></html>
```

No `#root`. No mount. No template. No swapped entry. The reproduction's authored
`index.html` did not participate in the build at all.

### ARM 2: `solid({ start: true })`, dev server

```
[repro] arm=start command=serve
[repro] resolved appType = "custom"
[repro] resolved client input = null
[repro] resolved client outDir = "dist/start"
[repro] resolved build.outDir = "dist/start"
[repro] plugins carrying transformIndexHtml: ["unplugin-solid-resumability:html"]
provable  src/Counter.tsx (Counter): 1 cell(s), 1 binding(s), 1 handler(s) -> artifacts/Counter/
[repro] dev server listening at http://localhost:5399/
[repro] GET http://localhost:5399/ -> 200 text/html; charset=utf-8
[repro] ---- served document begins ----
```

and the served document (a `text/html` request, which start's dev middleware
requires — `dist/esm/index.mjs:1816-1823` — so the probe sends a browser's own
`Accept` header rather than `*/*`):

```html
<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><script>…the dev style-dedup shim…</script><script type="module" src="/@vite/client"></script><script type="module" src="/@id/virtual:solid-ssr-entry-client.tsx"></script></head><body></body></html>
```

```
[repro] served carries classic entry: false; resumable entry: false; inlined template: false
```

`/index.html` returns the same document. Again, not one `HOOK FIRED` line.

### The tallies

```
  plainBuildHookCalls = 1
  plainBuildDocumentAtCloseBundle = true
  plainBuildTemplateInlined = true
  plainBuildEntrySwapped = true
  plainDevHookCalls = 2
  plainDevTemplateInlined = true
  plainDevEntrySwapped = true
  startBuildHookCalls = 0
  startBuildDocumentAtCloseBundle = false
  startBuildDocumentAfterBuild = true
  startBuildTemplateInlined = false
  startBuildEntryPresent = false
  startDevHookCalls = 0
  startDevTemplateInlined = false
  startDevEntrySwapped = false
```

The full transcript, including the install, is written to
`tools/start-mode-repro/transcript.txt` on every run.

---

## What the run added that the source reading did not have

The prediction held. It also came back with three facts a source read could not
have produced, and the first of them is the one that matters most to anybody
deciding whether to adopt this plugin.

**1. The failure is silent.** This was the open question and now it is answered:
the start-mode build exits 0. No error, no warning, no diagnostic. The
resumability plugin loads, its `assertPageFeaturesSupported` honesty guard passes
(the framework *is* Vite — `plugin/src/html.ts:792-808` refuses only bundlers
with no HTML hook at all), and Vite's own resolved plugin list still reports
`["unplugin-solid-resumability:html"]` as carrying `transformIndexHtml`. Every
check a consumer knows to run comes back green, and the page ships without its
first paint, without its template and pointing at the wrong entry module. That is
precisely the outcome `assertPageFeaturesSupported`'s own comment was written to
prevent — *a build that would come up, serve the classic page, and pass every
check the consumer knows to run* — arriving through a door that guard does not
watch.

**2. The comptime pass is untouched; only the two document-facing stages are
severed.** `provable src/Counter.tsx (Counter): 1 cell(s), 1 binding(s), 1
handler(s) -> artifacts/Counter/` prints identically on both arms, and under
start mode it prints once per environment. The analysis runs, the artifacts are
emitted, and the pass's verdicts are correct. What start mode takes away is not
the proving — it is the delivery. (The substitution, group and fallback-omission
stages are `buildStart`/`transform` work like the pass and have the same shape,
but this reproduction does not declare them, so it does not speak for them.)

**3. Start mode resolves the config three times, and `build.outDir` is a
different string each time** — `dist/start`, then `dist/client`, then
`dist/server`. `prerenderPlugin`'s `configResolved`
(`prerender.ts:858-862`) derives `distDir` from exactly that field, so the
prerender stage does not resolve one output directory under start mode; it
resolves a different one per environment, and its `closeBundle` fires in each.
The probe measured both: `dist/client/index.html` is absent when the client
build's `closeBundle` fires and only appears afterwards, and
`dist/server/index.html` never appears at all.

### One honest limit on the reproduction

It confirms the **cause** of `PageDocumentMissing` and does not exhibit the throw
itself. The reproduction's page declares `prerender: false`, because reaching the
throw at `prerender.ts:354-363` means declaring a group, a group means declaring
a substitution, and a substitution means carrying the whole capture machine — a
lot of apparatus for a question that turns on one file's existence at one moment.
So what was measured is that one file's existence at that one moment, on both
arms, with the path computed the same way `prerender.ts:354` computes it:
`join(input.htmlDir ?? input.distDir, basename(page.html))`. On the control arm
it exists. Under start mode it does not, in either environment. That is the
condition `PageDocumentMissing` is thrown on.

---

## The seam — named, not built

The seam is in **this** repository, not in the official plugin, and it already
exists. Nothing below is being proposed as work.

**`rewritePageHtml` and `prerenderPages` are already exported as pure post-build
functions** from `plugin/src/node.ts` — `rewritePageHtml` at
`plugin/src/node.ts:33` and `prerenderPages` at `plugin/src/node.ts:72`, both
re-exported from `plugin/src/index.ts:124` and `:149`. Neither takes a bundler,
a config or a hook context. `prerenderPages(input)` takes a `PrerenderInput` and
returns a `PrerenderReport`; `rewritePageHtml(html, edits)` takes a string and a
list of edits and returns a string. Anyone whose bundler has no hook to hang a
stage on can call them directly — which is what `plugin/src/index.ts:5-9` says
the whole plugin is designed for.

**`PrerenderInput.htmlDir` at `plugin/src/stages/prerender.ts:128` is declared
and unplumbed.** Its own doc comment states the case exactly:

> Where the built documents are read from and written back to. Defaults to
> `distDir`, and exists so a caller can prove the capture against a shipped
> build without writing into it.

`prerenderPage` honours it at `prerender.ts:354`. What does not supply it is
`prerenderPlugin`'s own `closeBundle` (`prerender.ts:864-876`), which passes
`distDir` and nothing else. That gap is the seam: a post-build caller that ran
*after* start's `buildApp` hook had written `dist/client/index.html` could hand
`htmlDir` the directory the document actually landed in, and the ordering
inversion of collision point 4 would stop mattering.

**It is named here and left alone.** Ruling 6 ruled plumbing `htmlDir` now
speculative, and the reproduction agrees with that ruling rather than arguing
against it: nothing in this tranche consumes `htmlDir`, no integration has been
run against it, and — the point collision point 2 makes and this run confirms —
`htmlDir` addresses the prerender half only. It does nothing whatsoever for the
`transformIndexHtml` half, which is the entry swap, the template inlining and the
whole dev-server story. Half a seam plumbed against no consumer is a design
decision made with no evidence, which is the one thing this tranche has been
built to avoid.

---

## What would have to change

Two columns, and they never merge.

| | what would have to change |
|---|---|
| **`@solidjs/vite-plugin` side** | Either a `start` option that names an HTML document as the shell rather than a JSX `Document` component, or a call to Vite's `transformIndexHtml` pipeline over the string it `writeFileSync`s at `index.mjs:1880` before it writes it. The first re-opens the entry story; the second re-opens only the HTML one, and is the smaller ask. Today's `StartOptions` surface offers neither. |
| **`unplugin-solid-resumability` side** | The plugin would stop delivering through `transformIndexHtml` under start mode and deliver through a post-build pass instead: `prerenderPages` with `htmlDir` pointed at `dist/client`, and `rewritePageHtml` over the document start wrote. Both functions exist. What does not exist is a trigger that fires after `buildApp`'s post hook, and a page identity that survives start naming every document `index.html`. |

Neither column is authorized by this tranche. They are recorded so the next
person to ask does not have to re-derive them.

---

## Provenance

| | |
|---|---|
| `@solidjs/vite-plugin` | 3.0.0-next.28 |
| `solid-js`, `@solidjs/web`, `@solidjs/signals` | 2.0.0-rc.0 |
| `vite` | 7.3.6 |
| `unplugin-solid-resumability` | `link:../../plugin` (this repository, built `dist`) |
| reproduction | `tools/start-mode-repro/`, own `package.json` + `pnpm-lock.yaml` + `node_modules` |
| re-run | `node tools/start-mode-repro/run.mjs` |

`run.mjs` exits non-zero if the start arm ever shows composition working — if the
hook fires, if a start-mode document carries the inlined template or the swapped
entry, or if the built document is already on disk when `closeBundle` fires. A
refutation would overturn a finding three units have built on, so it is wired to
fail loudly rather than to be read out of a log.
