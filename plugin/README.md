# unplugin-solid-resumability

Comptime resumability for Solid, as a bundler plugin.

The pass reads your components at build time and decides, per component,
whether it can prove what the thing does. When it can, it emits static
artifacts — the markup, the cells and their DOM bindings, the wiring, and one
module per handler — and the page serves those instead of running the
component. Nothing hydrates: there is no second render of a tree the build
already produced. A component boots on first touch, and the rest of the
application arrives as a deferred group when something asks for it.

Components it cannot prove fall back to ordinary Solid, in the same page,
beside the ones it could.

## Install

```sh
pnpm add -D unplugin-solid-resumability
```

## Use

```ts
// vite.config.ts
import resumability from 'unplugin-solid-resumability/vite';

export default {
  plugins: [
    resumability({
      mounts: [
        { component: 'Counter', source: 'src/Counter.tsx' },
      ],
    }),
  ],
};
```

The same factory is published for Rollup, Rolldown, webpack, Rspack and
esbuild under their own subpaths. Analyze-and-emit runs on every one of them.
The page transforms are Vite-only, because a dev server is the workflow they
exist to serve and only Vite's hooks reach one. The captured first paint is
*triggered* on Vite only — its body is a plain function, and every other
bundler runs it as a documented post-build step.

## What you declare, and what it derives

You declare what only you know: which components to prove, which HTML entries
participate, and the policies you want enforced. Everything the analysis can
reach it derives — verdicts, group membership, removal spans, template bytes,
chunk constraints. See `ResumabilityOptions` in `unplugin-solid-resumability/types`.

Two policies are refusals rather than settings. `prefetch: 'idle'` is declined
by name: spending a user's network on a group they may never open is the cost
this pipeline exists to remove. `fallback: 'auto-omit'` is declared, its
derivation settled, and not yet implemented — it is declined too rather than
accepted and ignored.

## Substitution

A component the pass proved does not need to ship. Declare where the rewritten
module goes and what glue claims it, and the stage emits a copy of your module
with that component gone:

```ts
mounts: [
  {
    component: 'Counter',
    source: 'src/Counter.tsx',
    substitute: {
      out: 'counter-page.tsx',              // under `generatedDir`
      claim: { module: 'src/page-resume.ts' }, // exports `claimCounter`
    },
  },
],
```

Three edits, none of them a text search. The component's function node is the
removal span. Its unique `<Counter />` mount point — unique because one set of
artifacts describes one element — becomes `{claimCounter(useContext(Ctx))}`,
where the argument is the component's own context read reprinted from its own
AST, so the mount point inherits the read the component was proven to make and
reaches the live store. Every relative specifier is recomputed from the
generated directory to the file it already named.

The helper's name defaults to `claim` followed by the component's name, and
`claim.module` is re-rooted the same way your imports are — a bare specifier is
left as written. `substitute.banner` replaces the provenance note the generated
module opens with.

What it will not do, it refuses by name rather than guessing at:
`MountElementNotBare` (a mount point carrying props or children, which the
artifacts model neither), `MultipleMountSites`, `ContextBindingUnreachable` (the
context imported under a local alias, so the name the analysis knows is not a
name that module binds), `ComponentNotModuleLocal` (the component and its mount
point in different files) and `UnprovableSubstitution` (a fallback verdict has
no artifacts to substitute to).

For a shape it refuses, `substitute.transform` is the way out — not the road
most travelled:

```ts
substitute: {
  transform: (context) => rewrite(context.source, context.analysis, context.edits),
},
```

It is handed the unmodified source, the pass's verdict, the edits the stage
computed and, when the stage refused, the refusal itself. What it returns is
written verbatim.

## The deferred group

Everything on a page that is not resumed — the framework, the store, the
components that share it — is one connected component of the shared-source
graph, and one connected component is one module. Declare where that module
goes and which component it renders, and the stage writes it:

```ts
pages: [
  {
    id: 'shelf',
    html: 'shelf.html',
    group: { moduleId: 'src/shelf-group.ts', entryComponent: 'ShelfPage' },
  },
],
```

The generated module has one job, and it is not hydration: render-and-replace.
The served page is a captured first paint that no framework claims, so the
shell is discarded and the same code that produced it runs again at the same
state. Two things do not survive that swap on their own and the module carries
both across it — the live mount elements, detached before the root is cleared
and handed to their substituted mount points so the render inserts *those*
nodes rather than copies, and the document's focus and selection.

Everything in the emitted text is derived. The entry component comes from a
rewritten module on the same page; the mounts are found by the `data-resume`
attribute the inlining stage stamps into them; the eager template glob
addresses the artifact directories from wherever you put the module.

| Field | What it is |
|---|---|
| `moduleId` | where the module is written, relative to the root |
| `entryComponent` | the component it renders; a rewritten module on this page has to export it |
| `carryFocus` | defaults true; `false` emits no focus machinery at all |
| `rootSelector` | the default root for the generated `execute`; defaults to the page's `prerender.rootSelector`, and with neither the root becomes a required argument |
| `glue` | the two functions it calls — `createMount(html)` for the capture path and `offerClaim(element)` for the live one. `module` defaults to the module your substitution already names |
| `render` | the framework call it renders through; defaults to Solid's `render` from `@solidjs/web` |

Refusals, all named: `GroupEntryModuleMissing` (a group on a page with nothing
rewritten has nothing to render), `GroupEntryComponentMissing`,
`GroupEntryComponentNotExported` and `GroupEntryComponentAmbiguous`.

## Page rewrites

Three edits, and between them they are the whole difference a served page
shows: the entry script points at a different module, each declared mount is
served with its component's emitted markup already in it, and the root element
is served with the captured first paint.

```ts
pages: [
  {
    id: 'shelf',
    html: 'shelf.html',
    entry: { from: '/src/pages/shelf.ts', to: '/src/pages/shelf-resumable.ts' },
    inlineTemplates: true,
  },
],
```

Every miss is a build failure rather than a page served unchanged. A swap whose
target moved leaves the classic entry in place: the page still loads, boots the
whole framework, and every measurement taken of it afterwards is a measurement
of the wrong page. So `EntryReferenceMissing`, `MountMissing`, `MountNotEmpty`
and their siblings throw, by name.

The rewriter itself — `rewritePageHtml(html, edits)` from `./node` — is pure:
markup in, markup out, no filesystem and no bundler. What is Vite-only is the
*trigger*, `transformIndexHtml`, because it is the only hook that reaches a dev
server and a dev server is the workflow these rewrites exist to serve. Rewriting
built output is the same core under a different trigger, and a bundler with no
such hook plus a page that declares rewrites is refused at construction time
(`PageFeaturesUnsupported`) rather than built into a page that lies.

## The captured first paint

A resumable page serves markup nothing is asked to claim. There is no hydration
pass to feed and no framework in the eager bundle to feed it, so the markup has
to be the same bytes the group will produce when it finally runs, at the same
state. The only thing that can produce those bytes is the group itself — so the
stage runs it: the built chunk, in a headless document, snapshotted at the
synchronous first paint, and inlined into the page's root element.

```ts
pages: [
  {
    id: 'shelf',
    html: 'shelf.html',
    group: { moduleId: 'src/shelf-group.ts', entryComponent: 'ShelfList' },
    prerender: {
      rootSelector: '#shelf-root',
      expectMarkup: ['class="loading"'],
    },
  },
],
```

`rootSelector` is the only required field: which element the paint is rendered
into and inlined back into is a fact about your document, and guessing one would
either capture nothing or fill the wrong element. `captures` defaults to 2,
`requireTemplateVerbatim` to true, `execute` to the export the generated group
module carries.

Three things are proved before a byte is written:

| | |
|---|---|
| determinism | every capture runs in a process of its own — fresh module registry, fresh document, fresh store — and they must be byte-identical. Separate processes rather than repeated calls, because a page's store registry is entitled to refuse two live stores under one identity, and the capture does not get an exemption from the invariant that makes the swap sound. |
| templates | each resumed mount's emitted markup appears in the snapshot verbatim. A page whose eager bundle ships no template module carries that markup in the document instead, so the byte check for it belongs to the build that did the inlining. |
| shape | the substrings the page says its first paint contains. Stated by you, because what a first paint looks like is a fact about your application and a guess here would be a check that passes for the wrong reason. |

The group must be exactly one dynamic-entry chunk in the build manifest.
`GroupChunkAmbiguous` when the bundler split it or lost it, and
`GroupChunkNotDeferred` when it is in the build but eager — a captured paint on
top of an eagerly-loaded group would hide that regression rather than report it.

The trigger is Vite's `closeBundle`, because the capture runs the built chunk
and that is the first moment every chunk is on disk. The body is
`prerenderPages({ distDir, root, pages, mounts, artifactDir })` from `./node`,
so a bundler with no such hook runs it as a post-build step:

```js
import { prerenderPages } from 'unplugin-solid-resumability/node';

await prerenderPages({
  distDir: 'dist',
  root: process.cwd(),
  pages: options.pages,
  mounts: options.mounts,
  artifactDir: 'artifacts',
});
```

## Subpaths

| Subpath | What it is |
|---|---|
| `.` | the factory, and every stage body |
| `./vite`, `./rollup`, `./rolldown`, `./webpack`, `./rspack`, `./esbuild` | the plugin for one bundler |
| `./node` | the stage bodies and artifact readers, for scripts and tests |
| `./runtime/*` | the browser half, one module per module |
| `./types` | the configuration types alone |

Every stage body is a plain function of explicit inputs, exported from
`./node`. A bundler with no suitable hook loses the automation, never the
capability — the stage is still a call you can make.

`./runtime/artifacts` and `./runtime/index` are this repository's own binding
of the registry to its own emitted artifacts, kept for reference; a consumer
builds theirs with `createRegistry` over their own artifact directory.

## Build

```sh
pnpm install && pnpm build && pnpm test
```

The build does two different things on purpose. The build-time half is
bundled, so the tarball carries the pass without carrying a dependency edge
back to the repository it was written in. The browser half is *not* bundled:
one output module per source module, because its module granularity decides
which bytes a page pulls eagerly and which arrive on first touch, and fusing
it would quietly change the measurement.

## Status

0.1.0. Option normalization, the analyze-and-emit pass, the chunking
constraints, substitution, group generation, the page rewrites and the captured
first paint are wired.

Every one of them is proved against bytes rather than against a shape: the
emitted artifacts by hash, the rewritten module by hash, and the captured paint
against the markup a shipped build already serves.
