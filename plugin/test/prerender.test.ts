/**
 * The prerender stage, proved against a build that shipped.
 *
 * The gate that matters is the first one: run the stage over the demonstration
 * application's existing `dist` tree and require the markup it captures to be
 * the markup already inlined in that tree's document, byte for byte. That build
 * was produced by the hand-written pass this stage generalizes, so agreement is
 * not a plausibility check — it is the same rewrite, on the same inputs,
 * reaching the same bytes. Nothing is rebuilt: the shipped tree is read-only
 * input here, and the document the stage writes into is a copy of it under
 * `.verify-out`.
 *
 * Everything else is proved on a synthetic build in the same directory: a
 * manifest, a chunk with an `execute` export, and a document. That corpus is
 * what shows the stage is shaped to a configuration rather than to one
 * application — the selector, the export name, the group's module id and the
 * markup expectations are all stated by the page, and a second page states
 * different ones.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join, resolve } from 'pathe';
import { beforeAll, describe, expect, it } from 'vitest';

import { resolveOptions } from '../src/options.ts';
import { prerenderPages, type PrerenderedPage } from '../src/stages/prerender.ts';
import type { PrerenderPolicy, ResolvedOptions } from '../src/types.ts';

const PLUGIN_ROOT = resolve(import.meta.dirname, '..');
const REPO_ROOT = resolve(PLUGIN_ROOT, '..');
const DEMO_ROOT = join(REPO_ROOT, 'demo');

/** The shipped build. Read, never written. */
const SHIPPED = join(DEMO_ROOT, 'dist/resumable/todos');
const SHIPPED_DOCUMENT = join(SHIPPED, 'todos.html');

/** Everything this suite writes goes here, and nowhere else. */
const WORK = join(PLUGIN_ROOT, '.verify-out/prerender');

/** A module that exists, so a synthetic page's mount declaration resolves. */
const A_REAL_MODULE = join(PLUGIN_ROOT, 'test/fixtures/corpus/features/shelf/shelf-page.tsx');

/** An artifact directory whose emitted markup no capture here ever paints. */
const WRONG_ARTIFACTS = join(PLUGIN_ROOT, 'test/fixtures/prerender/artifacts');

/**
 * How the shipped document carries its first paint — the same expression the
 * demonstration application's own zero-eager gate reads it back with, so the
 * reference bytes are the bytes that project checks rather than a second
 * reading of the same file.
 */
const SHELL_IN_DOCUMENT = /<div id="root">([\s\S]*?)<\/div>\s*\n/;

const shippedDocument = readFileSync(SHIPPED_DOCUMENT, 'utf8');
const shippedShell = SHELL_IN_DOCUMENT.exec(shippedDocument)?.[1] ?? '';

/**
 * The demonstration application's own declaration, written as a consumer would
 * write it: nothing derived, nothing this package knows in advance.
 *
 * Every application-specific name in this file lives here, in configuration.
 * That is the property the generality suite enforces from the other side.
 */
function shippedPageOptions(): ResolvedOptions {
  return resolveOptions({
    root: DEMO_ROOT,
    corpusRoot: REPO_ROOT,
    artifactDir: 'artifacts',
    mounts: [
      {
        component: 'Header',
        source: '../app/src/app.tsx',
        artifact: 'app.Header',
        page: 'todos',
      },
    ],
    pages: [
      {
        id: 'todos',
        html: 'todos.html',
        prerender: {
          rootSelector: '#root',
          expectMarkup: ['class="loading"', 'class="new-todo"'],
        },
        group: { moduleId: 'src/todos-group.ts', entryComponent: 'Header' },
      },
    ],
  });
}

/** A synthetic page, declared the same way and agreeing about nothing with the one above. */
function syntheticOptions(root: string, prerender: PrerenderPolicy): ResolvedOptions {
  return resolveOptions({
    root,
    mounts: [
      {
        component: 'ShelfList',
        source: A_REAL_MODULE,
        artifact: 'shelf.ShelfList',
        page: 'shelf',
      },
    ],
    pages: [
      {
        id: 'shelf',
        html: 'shelf.html',
        prerender,
        group: { moduleId: 'src/shelf-group.ts', entryComponent: 'ShelfList' },
      },
    ],
  });
}

/** A chunk that paints the same markup every time it is run. */
const STEADY_CHUNK = `export function execute(root) {
  root.innerHTML = '<p class="paint">steady</p>';
  return () => { root.innerHTML = ''; };
}
`;

/** A chunk whose paint depends on something other than the code. */
const WOBBLY_CHUNK = `export function execute(root) {
  root.innerHTML = '<p class="paint">' + Math.random() + '</p>';
  return () => { root.innerHTML = ''; };
}
`;

const SYNTHETIC_DOCUMENT = `<!doctype html>
<html lang="en">
  <body>
    <div id="shelf-root"></div>
  </body>
</html>
`;

/** The manifest a build writes when the group survived as exactly one deferred chunk. */
function oneDeferredChunk(): Record<string, unknown> {
  return {
    'shelf.html': { file: 'assets/shelf.js', src: 'shelf.html', isEntry: true },
    'src/shelf-group.ts': {
      file: 'assets/shelf-group.js',
      src: 'src/shelf-group.ts',
      isDynamicEntry: true,
    },
  };
}

interface SyntheticBuild {
  distDir: string;
  documentPath: string;
}

/** Writes one synthetic build under `.verify-out`: a manifest, a chunk, a document. */
function buildSynthetic(
  name: string,
  manifest: Record<string, unknown>,
  chunk = STEADY_CHUNK,
): SyntheticBuild {
  const distDir = join(WORK, name);
  const documentPath = join(distDir, 'shelf.html');

  mkdirSync(join(distDir, '.vite'), { recursive: true });
  mkdirSync(join(distDir, 'assets'), { recursive: true });
  writeFileSync(join(distDir, '.vite/manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  writeFileSync(join(distDir, 'assets/shelf-group.js'), chunk, 'utf8');
  writeFileSync(documentPath, SYNTHETIC_DOCUMENT, 'utf8');

  return { distDir, documentPath };
}

/** Runs the stage over one synthetic build, with its own page declaration. */
async function prerenderSynthetic(build: SyntheticBuild, prerender: PrerenderPolicy) {
  const options = syntheticOptions(build.distDir, prerender);
  return prerenderPages({
    distDir: build.distDir,
    root: build.distDir,
    pages: options.pages,
    mounts: options.mounts,
    artifactDir: WRONG_ARTIFACTS,
    log: () => {},
  });
}

/** What the stage says it refused, by name, whatever the prose says. */
async function refusalOf(run: Promise<unknown>): Promise<Error> {
  try {
    await run;
  } catch (thrown) {
    return thrown as Error;
  }
  throw new Error('expected a refusal, and the stage proceeded');
}

beforeAll(() => {
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });
});

describe('the shipped build', () => {
  it('has a document with a first paint already in it', () => {
    expect(existsSync(SHIPPED_DOCUMENT), `${SHIPPED_DOCUMENT} is missing`).toBe(true);
    expect(shippedShell.trim().length).toBeGreaterThan(0);
  });
});

describe('the captured paint of a shipped build', () => {
  const stagedDir = join(WORK, 'parity');
  const stagedDocument = join(stagedDir, 'todos.html');
  let captured: PrerenderedPage;

  beforeAll(async () => {
    // The shipped document with its root emptied again — what the bundler left
    // behind, before the capture had anything to say about it.
    mkdirSync(stagedDir, { recursive: true });
    writeFileSync(
      stagedDocument,
      shippedDocument.replace(`<div id="root">${shippedShell}</div>`, '<div id="root"></div>'),
      'utf8',
    );

    const options = shippedPageOptions();
    const report = await prerenderPages({
      distDir: SHIPPED,
      root: DEMO_ROOT,
      pages: options.pages,
      mounts: options.mounts,
      artifactDir: options.artifactDir,
      // The shipped tree is input. The document the stage writes into is a copy
      // of it, so what the stage is proved against cannot be disturbed by it.
      htmlDir: stagedDir,
      log: () => {},
    });
    captured = report.pages[0]!;
  });

  it('is the markup that build already serves, byte for byte', () => {
    expect(captured.html).toBe(shippedShell);
    expect(captured.bytes).toBe(Buffer.byteLength(shippedShell));
  });

  it('came out of that build’s own deferred chunk', () => {
    expect(captured.chunkPath.startsWith(SHIPPED)).toBe(true);
  });

  it('agreed across two independent captures, because that is the default', () => {
    expect(captured.captures).toBe(2);
  });

  it('rewrites the document into the one that shipped', () => {
    expect(readFileSync(stagedDocument, 'utf8')).toBe(shippedDocument);
  });

  it('left the shipped tree exactly as it found it', () => {
    expect(readFileSync(SHIPPED_DOCUMENT, 'utf8')).toBe(shippedDocument);
  });
});

describe('determinism', () => {
  it('accepts a paint that two processes agree on', async () => {
    const build = buildSynthetic('steady', oneDeferredChunk());

    const report = await prerenderSynthetic(build, {
      rootSelector: '#shelf-root',
      requireTemplateVerbatim: false,
      expectMarkup: ['class="paint"'],
    });

    expect(report.pages[0]!.html).toBe('<p class="paint">steady</p>');
    expect(readFileSync(build.documentPath, 'utf8')).toContain(
      '<div id="shelf-root"><p class="paint">steady</p></div>',
    );
  });

  it('refuses a paint that depends on something other than the code', async () => {
    const build = buildSynthetic('wobbly', oneDeferredChunk(), WOBBLY_CHUNK);

    const refusal = await refusalOf(
      prerenderSynthetic(build, { rootSelector: '#shelf-root', requireTemplateVerbatim: false }),
    );

    expect(refusal.name).toBe('CaptureNotDeterministic');
    expect(refusal.message).toContain('at byte');
    // Nothing was written: a document whose paint is not decidable keeps the
    // empty root the bundler gave it.
    expect(readFileSync(build.documentPath, 'utf8')).toBe(SYNTHETIC_DOCUMENT);
  });
});

describe('the build manifest', () => {
  it('refuses a build with no chunk for the group', async () => {
    const build = buildSynthetic('no-chunk', {
      'shelf.html': { file: 'assets/shelf.js', src: 'shelf.html', isEntry: true },
    });

    const refusal = await refusalOf(
      prerenderSynthetic(build, { rootSelector: '#shelf-root', requireTemplateVerbatim: false }),
    );

    expect(refusal.name).toBe('GroupChunkAmbiguous');
    expect(refusal.message).toContain('0 chunks');
    expect(refusal.message).toContain('src/shelf-group.ts');
  });

  it('refuses a build that split the group in two', async () => {
    const build = buildSynthetic('two-chunks', {
      'src/shelf-group.ts': {
        file: 'assets/shelf-group.js',
        src: 'src/shelf-group.ts',
        isDynamicEntry: true,
      },
      '_shelf-group-part.js': {
        file: 'assets/shelf-group-part.js',
        src: 'src/shelf-group.ts',
        isDynamicEntry: true,
      },
    });

    const refusal = await refusalOf(
      prerenderSynthetic(build, { rootSelector: '#shelf-root', requireTemplateVerbatim: false }),
    );

    expect(refusal.name).toBe('GroupChunkAmbiguous');
    expect(refusal.message).toContain('2 chunks');
  });

  it('refuses a group the build put on the wire eagerly', async () => {
    const build = buildSynthetic('eager-group', {
      'src/shelf-group.ts': { file: 'assets/shelf-group.js', src: 'src/shelf-group.ts' },
    });

    const refusal = await refusalOf(
      prerenderSynthetic(build, { rootSelector: '#shelf-root', requireTemplateVerbatim: false }),
    );

    expect(refusal.name).toBe('GroupChunkNotDeferred');
  });

  it('refuses a build that wrote no manifest at all', async () => {
    const build = buildSynthetic('no-manifest', oneDeferredChunk());
    rmSync(join(build.distDir, '.vite/manifest.json'));

    const refusal = await refusalOf(
      prerenderSynthetic(build, { rootSelector: '#shelf-root', requireTemplateVerbatim: false }),
    );

    expect(refusal.name).toBe('BuildManifestMissing');
  });
});

describe('the assertions a page states', () => {
  it('requires each resumed mount to be in the paint verbatim', async () => {
    const build = buildSynthetic('no-template', oneDeferredChunk());

    // The default. The synthetic chunk paints its own markup, and the artifact
    // directory this page is pointed at emitted something else entirely.
    const refusal = await refusalOf(
      prerenderSynthetic(build, { rootSelector: '#shelf-root', captures: 1 }),
    );

    expect(refusal.name).toBe('TemplateNotVerbatim');
    expect(refusal.message).toContain('shelf.ShelfList');
    expect(refusal.message).toContain('class="shelf"');
  });

  it('requires the substrings the page says its first paint carries', async () => {
    const build = buildSynthetic('wrong-shape', oneDeferredChunk());

    const refusal = await refusalOf(
      prerenderSynthetic(build, {
        rootSelector: '#shelf-root',
        requireTemplateVerbatim: false,
        captures: 1,
        expectMarkup: ['class="paint"', 'class="loaded"'],
      }),
    );

    expect(refusal.name).toBe('ExpectedMarkupMissing');
    expect(refusal.message).toContain(JSON.stringify('class="loaded"'));
  });

  it('refuses a paint that came out empty', async () => {
    const build = buildSynthetic(
      'empty-paint',
      oneDeferredChunk(),
      'export function execute(root) {\n  return () => {};\n}\n',
    );

    const refusal = await refusalOf(
      prerenderSynthetic(build, {
        rootSelector: '#shelf-root',
        requireTemplateVerbatim: false,
        captures: 1,
      }),
    );

    expect(refusal.name).toBe('CaptureEmpty');
  });

  // The refusal is decided in the child process, and this is what proves it
  // arrives as one: the sentence the capture wrote is quoted in the refusal the
  // parent raises, so the case is asserted by what it says and not only by the
  // fact that a child exited badly. Nothing is printed while this passes.
  it('refuses a chunk with no export to render through', async () => {
    const build = buildSynthetic(
      'no-export',
      oneDeferredChunk(),
      'export const nothing = 1;\n',
    );

    const refusal = await refusalOf(
      prerenderSynthetic(build, {
        rootSelector: '#shelf-root',
        requireTemplateVerbatim: false,
        captures: 1,
      }),
    );

    expect(refusal.name).toBe('CaptureFailed');
    expect(refusal.message).toContain('exports no `execute` function');
  });

  it('renders through the export the page names', async () => {
    const build = buildSynthetic(
      'named-export',
      oneDeferredChunk(),
      'export function paintTheShelf(root) {\n' +
        "  root.innerHTML = '<p class=\"paint\">named</p>';\n" +
        '  return () => {};\n}\n',
    );

    const report = await prerenderSynthetic(build, {
      rootSelector: '#shelf-root',
      requireTemplateVerbatim: false,
      execute: 'paintTheShelf',
      captures: 1,
    });

    expect(report.pages[0]!.html).toBe('<p class="paint">named</p>');
  });
});

describe('what it refuses to guess', () => {
  it('refuses a page that says where nothing goes', async () => {
    const build = buildSynthetic('no-selector', oneDeferredChunk());

    const refusal = await refusalOf(prerenderSynthetic(build, { requireTemplateVerbatim: false }));

    expect(refusal.name).toBe('RootSelectorUndeclared');
  });

  it('refuses a capture count that proves nothing', async () => {
    const build = buildSynthetic('no-captures', oneDeferredChunk());

    const refusal = await refusalOf(
      prerenderSynthetic(build, {
        rootSelector: '#shelf-root',
        requireTemplateVerbatim: false,
        captures: 0,
      }),
    );

    expect(refusal.name).toBe('CaptureCountInvalid');
  });

  it('refuses a page whose built document is not there', async () => {
    const build = buildSynthetic('no-document', oneDeferredChunk());
    rmSync(build.documentPath);

    const refusal = await refusalOf(
      prerenderSynthetic(build, {
        rootSelector: '#shelf-root',
        requireTemplateVerbatim: false,
        captures: 1,
      }),
    );

    expect(refusal.name).toBe('PageDocumentMissing');
  });
});

describe('the story for a bundler with no hook for this', () => {
  it('is the exported function, and nothing else', async () => {
    const node = (await import('../src/node.ts')) as Record<string, unknown>;
    expect(typeof node.prerenderPages).toBe('function');
    expect(typeof node.captureShell).toBe('function');
    expect(typeof node.prerenderPlugin).toBe('function');
  });

  /**
   * And it has to work from the published shape, not only from these sources.
   *
   * A capture spends a child process on a file this package points at, and
   * after bundling that file is an entry bundle rather than the module written
   * here. Whether the branch inside it still fires is exactly the kind of thing
   * that is true in a source tree and false in a tarball, so it is asked here.
   *
   * Requires `pnpm build` to have run, as the exports suite does.
   */
  it('runs a capture out of the built package', async () => {
    const build = buildSynthetic('published', oneDeferredChunk());

    // By a computed specifier, so this suite still typechecks in a tree that
    // has not been built yet.
    const built = pathToFileURL(join(PLUGIN_ROOT, 'dist/node.mjs')).href;
    const published = (await import(built)) as {
      prerenderPages: typeof prerenderPages;
    };

    const options = syntheticOptions(build.distDir, {
      rootSelector: '#shelf-root',
      requireTemplateVerbatim: false,
    });

    const report = await published.prerenderPages({
      distDir: build.distDir,
      root: build.distDir,
      pages: options.pages,
      mounts: options.mounts,
      artifactDir: WRONG_ARTIFACTS,
      log: () => {},
    });

    expect(report.pages[0]!.html).toBe('<p class="paint">steady</p>');
    expect(report.pages[0]!.captures).toBe(2);
  });
});

// -------------------------------------------------- measured binding texts

/**
 * A store read has no build-time answer: the store does not exist until the page
 * runs, so the pass emits an empty text and marks the binding as the capture's
 * to fill. This is where it gets filled — after the captures agreed, which is
 * what makes the measured text a property of the code rather than of one paint.
 *
 * The template these artifacts state is the markup with exactly that text taken
 * out, which is how the stage identifies the component inside a whole page — and
 * also what the verbatim check now has to know about. A template with a hole in
 * it is NOT a substring of the paint that fills the hole, so the check cuts the
 * template at its holes and requires each piece, in order. Every byte the build
 * wrote is still verified; the only bytes excused are the ones it openly
 * declined to write. Both arms are proved below.
 */
/** Artifacts as the pass emits them for a component with one measured binding. */
function writeMeasuredArtifacts(dir: string, templateHtml: string): string {
  const artifacts = join(dir, 'artifacts');
  mkdirSync(join(artifacts, 'shelf.ShelfList'), { recursive: true });
  writeFileSync(
    join(artifacts, 'shelf.ShelfList/template.js'),
    `export const html = ${JSON.stringify(templateHtml)};\nexport const root = "/";\n`,
    'utf8',
  );
  writeFileSync(
    join(artifacts, 'shelf.ShelfList/structure.js'),
    `export const cells = [];
export const bindings = [
  {
    id: "b0",
    kind: "text",
    locator: "/0",
    initialText: "",
    // Measured from the page's captured first paint, not derived.
    initialTextFrom: "capture",
    captures: [
      { name: "data", kind: "store-read", store: "s0", path: [0] },
    ],
    compute({ data }) {
      return data.items.length + " items";
    },
  },
];
export const wiring = [];
`,
    'utf8',
  );
  return artifacts;
}

function prepareMeasured(
  name: string,
  paint: string,
  templateHtml: string,
  requireTemplateVerbatim = false,
) {
  const build = buildSynthetic(
    name,
    { 'src/shelf-group.ts': { file: 'assets/shelf-group.js', src: 'src/shelf-group.ts', isDynamicEntry: true } },
    `export function execute(root) {\n  root.innerHTML = ${JSON.stringify(paint)};\n  return () => { root.innerHTML = ''; };\n}\n`,
  );
  const artifacts = writeMeasuredArtifacts(build.distDir, templateHtml);
  const options = syntheticOptions(build.distDir, {
    rootSelector: '#shelf-root',
    requireTemplateVerbatim,
  });
  const prepare = () =>
    prerenderPages({
      distDir: build.distDir,
      root: build.distDir,
      pages: options.pages,
      mounts: options.mounts,
      artifactDir: artifacts,
      log: () => {},
    });
  return { artifacts, prepare };
}

describe('a binding whose text is measured from the capture', () => {
  const PAINT = '<section class="shelf"><span>2 items</span></section>';
  const TEMPLATE = '<section class="shelf"><span></span></section>';

  it('writes the captured text into the artifact, and nothing else', async () => {
    const { artifacts, prepare } = prepareMeasured('measured', PAINT, TEMPLATE);
    await prepare();

    const structure = readFileSync(join(artifacts, 'shelf.ShelfList/structure.js'), 'utf8');
    expect(structure).toContain('initialText: "2 items"');
    // Still measured, and still the same binding: the stage fills a value in, it
    // does not decide the text was derivable after all.
    expect(structure).toContain('initialTextFrom: "capture"');
    expect(structure).toContain('{ name: "data", kind: "store-read", store: "s0", path: [0] },');
  });

  it('refuses when no element of the paint is that component', async () => {
    const { prepare } = prepareMeasured('measured-missing', '<p class="other">2 items</p>', TEMPLATE);
    const refusal = await refusalOf(prepare());
    expect(refusal.name).toBe('CaptureBindingLocatorMissing');
  });

  it('leaves an artifact with no measured binding alone', async () => {
    // The ordinary artifact, emitted before store reads existed: no marker, so
    // the stage has nothing to measure and reads no DOM at all.
    const derived = '<section class="shelf"><span>fixed</span></section>';
    const { artifacts, prepare } = prepareMeasured('measured-none', derived, derived);
    const structurePath = join(artifacts, 'shelf.ShelfList/structure.js');
    const before = readFileSync(structurePath, 'utf8')
      .replace("    // Measured from the page's captured first paint, not derived.\n", '')
      .replace('    initialTextFrom: "capture",\n', '')
      .replace('initialText: ""', 'initialText: "fixed"');
    writeFileSync(structurePath, before, 'utf8');

    await prepare();
    expect(readFileSync(structurePath, 'utf8')).toBe(before);
  });
});

// ------------------------------------------- the verbatim check, with holes

/**
 * `requireTemplateVerbatim` over a template the build could not finish writing.
 *
 * The check exists because the resumer's locators are child indices: markup that
 * is not this component's addresses other nodes. A measured binding does not
 * weaken that — the STRUCTURE is still the build's, byte for byte, and only the
 * text inside one element was left to the capture. So the template is cut at
 * exactly those texts and each piece is required, in the order the build wrote
 * them. A missing piece is the same hard refusal it has always been.
 */
describe('the verbatim check over a template with measured holes', () => {
  const TEMPLATE = '<section class="shelf"><span></span></section>';

  it('accepts a paint that carries the template around its hole', async () => {
    const { artifacts, prepare } = prepareMeasured(
      'verbatim-hole',
      '<div class="page"><section class="shelf"><span>2 items</span></section></div>',
      TEMPLATE,
      true,
    );

    // The template is not a substring of that paint — the hole is filled — and
    // the stage runs anyway, then measures the text it just proved was there.
    await prepare();
    expect(readFileSync(join(artifacts, 'shelf.ShelfList/structure.js'), 'utf8')).toContain(
      'initialText: "2 items"',
    );
  });

  it('still refuses a paint whose structure around the hole is not the template', async () => {
    // One attribute different, on the element the hole is inside. The text was
    // excused; the tag that carries it was not.
    const { prepare } = prepareMeasured(
      'verbatim-hole-wrong',
      '<section class="shelf"><span class="count">2 items</span></section>',
      TEMPLATE,
      true,
    );

    const refusal = await refusalOf(prepare());
    expect(refusal.name).toBe('TemplateNotVerbatim');
    expect(refusal.message).toContain('measured binding(s)');
    expect(refusal.message).toContain('first piece missing');
  });

  it('refuses a paint that carries the piece before the hole and not the one after', async () => {
    // Segments are looked for IN ORDER, each one after the last one matched, so
    // a paint that opens the component and never closes it the way the template
    // does is caught on the second piece rather than passing on the first.
    const { prepare } = prepareMeasured(
      'verbatim-hole-truncated',
      '<section class="shelf"><span>2 items</span></section><section class="shelf"><span>x</span></div>',
      '<section class="shelf"><span></span><b>after</b></section>',
      true,
    );

    const refusal = await refusalOf(prepare());
    expect(refusal.name).toBe('TemplateNotVerbatim');
    expect(refusal.message).toContain('first piece missing');
  });

  it('keeps the byte-exact check for a template with no hole in it', async () => {
    // The strongest statement is still made where it can be: no measured
    // binding, no segments — the template is a substring of the paint or the
    // build stops.
    const derived = '<section class="shelf"><span>fixed</span></section>';
    const { artifacts, prepare } = prepareMeasured('verbatim-derived', derived, derived, true);
    const structurePath = join(artifacts, 'shelf.ShelfList/structure.js');
    writeFileSync(
      structurePath,
      readFileSync(structurePath, 'utf8')
        .replace("    // Measured from the page's captured first paint, not derived.\n", '')
        .replace('    initialTextFrom: "capture",\n', '')
        .replace('initialText: ""', 'initialText: "fixed"'),
      'utf8',
    );

    await prepare();

    const { prepare: mismatched } = prepareMeasured(
      'verbatim-derived-wrong',
      '<section class="shelf"><span>moved</span></section>',
      derived,
      true,
    );
    const mismatchedStructure = join(
      WORK,
      'verbatim-derived-wrong/artifacts/shelf.ShelfList/structure.js',
    );
    writeFileSync(
      mismatchedStructure,
      readFileSync(mismatchedStructure, 'utf8')
        .replace("    // Measured from the page's captured first paint, not derived.\n", '')
        .replace('    initialTextFrom: "capture",\n', '')
        .replace('initialText: ""', 'initialText: "fixed"'),
      'utf8',
    );

    const refusal = await refusalOf(mismatched());
    expect(refusal.name).toBe('TemplateNotVerbatim');
    // The hole-free arm, word for word what it always said.
    expect(refusal.message).toContain('emitted markup verbatim');
  });
});

// ------------------------------------------------- the keys a paint owes

/**
 * A keyed region is the one thing the emitted template says nothing about: the
 * list is a store projection, so the build templates the container EMPTY and the
 * items in the served bytes are the page's own first paint. That is exactly why
 * the key has to be checked HERE. The resume path addresses an item by the key
 * its element carries and by nothing else; an item painted without one could
 * only be reached by counting siblings, which is the failure the key exists to
 * prevent — and by the time the page is served it is too late to say so.
 *
 * The demonstration application captures its region absent, so the check is
 * vacuous there. These cases are the populated capture it exists for.
 */
function writeRegionArtifacts(dir: string, templateHtml: string): string {
  const artifacts = join(dir, 'artifacts');
  mkdirSync(join(artifacts, 'shelf.ShelfList'), { recursive: true });
  writeFileSync(
    join(artifacts, 'shelf.ShelfList/template.js'),
    `export const html = ${JSON.stringify(templateHtml)};\nexport const root = "/";\n`,
    'utf8',
  );
  writeFileSync(
    join(artifacts, 'shelf.ShelfList/structure.js'),
    `export const cells = [];
export const bindings = [];
export const wiring = [];
export const keyedRegions = [
  {
    id: "k0",
    container: "/0",
    item: "book",
    keyAttribute: "data-key",
    keyPath: ["id"],
    itemTemplate: '<li class="book" data-key=""></li>',
    captures: [{ name: "shelf", kind: "store-read", store: "s0", path: [0] }],
    each({ shelf }) {
      return shelf.books;
    },
    bindings: [],
    wiring: [],
  },
];
`,
    'utf8',
  );
  return artifacts;
}

function prepareRegion(name: string, paint: string, requireTemplateVerbatim = false) {
  const build = buildSynthetic(
    name,
    { 'src/shelf-group.ts': { file: 'assets/shelf-group.js', src: 'src/shelf-group.ts', isDynamicEntry: true } },
    `export function execute(root) {\n  root.innerHTML = ${JSON.stringify(paint)};\n  return () => { root.innerHTML = ''; };\n}\n`,
  );
  const artifacts = writeRegionArtifacts(build.distDir, REGION_TEMPLATE);
  const options = syntheticOptions(build.distDir, {
    rootSelector: '#shelf-root',
    requireTemplateVerbatim,
  });
  return () =>
    prerenderPages({
      distDir: build.distDir,
      root: build.distDir,
      pages: options.pages,
      mounts: options.mounts,
      artifactDir: artifacts,
      log: () => {},
    });
}

/** An empty container, which is the whole of what a build writes for a list. */
const REGION_TEMPLATE = '<section class="shelf"><ul class="books"></ul></section>';

const KEYED_PAINT =
  '<section class="shelf"><ul class="books"><li data-key="a">Ada</li><li data-key="b">Bob</li></ul></section>';

describe('every item of a captured keyed region states its key', () => {
  it('accepts a paint whose items all carry one', async () => {
    const report = await prepareRegion('region-keyed', KEYED_PAINT)();
    expect(report.pages[0]!.html).toBe(KEYED_PAINT);
  });

  it('refuses a paint that painted an item without one', async () => {
    // The middle of the list, so nothing about the refusal depends on an item
    // being first or last: what is missing is the identity, wherever it sits.
    const refusal = await refusalOf(
      prepareRegion('region-unkeyed', KEYED_PAINT.replace(' data-key="b"', ''))(),
    );

    expect(refusal.name).toBe('RegionItemKeyMissing');
    expect(refusal.message).toContain('1 item(s) of region "k0"');
    expect(refusal.message).toContain('no data-key attribute');
    expect(refusal.message).toContain('POSITION');
  });

  it('says nothing about a region the paint carries empty', async () => {
    // The shipped case: a list whose store has nothing in it yet paints an
    // empty container, which is byte for byte the emitted template — so the
    // strongest check in this stage still applies to it, and this one is
    // vacuous rather than lenient.
    const report = await prepareRegion('region-empty', REGION_TEMPLATE, true)();
    expect(report.pages[0]!.html).toBe(REGION_TEMPLATE);
  });

  it('is asked beside the captures, before anything is said about the template', async () => {
    // A populated region is never a substring of the emitted template, so this
    // paint fails the verbatim check too. The key refusal is the one that
    // fires, because an unkeyed list is a fact about the markup rather than a
    // disagreement with it.
    const refusal = await refusalOf(
      prepareRegion('region-unkeyed-verbatim', KEYED_PAINT.replace(' data-key="b"', ''), true)(),
    );
    expect(refusal.name).toBe('RegionItemKeyMissing');
  });
});

// -------------------------------------- the verbatim check, with element holes

/**
 * `requireTemplateVerbatim` over a template that ADDRESSED a child.
 *
 * The second kind of hole, and the harder one. A measured binding leaves a hole
 * the CAPTURE fills, and the bytes either side of it are still the build's. A
 * claimed child leaves a hole ANOTHER COMPONENT'S ARTIFACTS fill, and the bytes
 * inside it are not merely unwritten — they are written somewhere else, by a
 * build that can be held to them.
 *
 * So the check does not stop at excusing them. Three properties, and the third
 * is what makes this stronger than what it replaced rather than weaker:
 *
 *   P1  The BUILD declared the hole. Read off the emitted template, not the
 *       paint: the address resolves, the element there is empty, and it names
 *       the child. An artifact set that disagrees with itself is refused before
 *       any paint is consulted.
 *   P2  Verbatim outside the holes, in order. The same cut, the same mark, the
 *       same ordered search — both kinds of hole punch one mark, so a template
 *       carrying one of each is cut into pieces in document order by
 *       construction.
 *   P3  The check RECURSES. The parent's root is found in the paint, each hole
 *       is opened, and what is inside it is handed to the child's own artifacts
 *       as ITS paint — which owes P1 and P2 in turn, all the way down.
 *
 * The net property, and the one line to audit against: every byte of a
 * component's painted subtree is asserted by exactly one artifact. The parent
 * excuses bytes precisely at the hole; the child asserts precisely those bytes.
 * Not a byte excused twice, and not a byte excused by nobody.
 */

const CHILD = 'shelf.ShelfBadge';
const GRANDCHILD = 'shelf.ShelfDot';

/** One artifact directory, as the pass emits it for a component that addresses children. */
interface AddressedArtifact {
  artifact: string;
  html: string;
  /** The children it addressed. Written to the MANIFEST — never to `structure.js`. */
  claimed?: Array<{ locator: string; artifact: string; component: string; module: string }>;
  /** A capture-measured binding, when this component is to carry a hole of the other kind too. */
  measured?: string;
}

function writeAddressedArtifacts(dir: string, artifacts: AddressedArtifact[]): string {
  const root = join(dir, 'artifacts');

  for (const one of artifacts) {
    const directory = join(root, one.artifact);
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, 'template.js'),
      `export const html = ${JSON.stringify(one.html)};\nexport const root = "/";\n`,
      'utf8',
    );

    if (one.measured !== undefined) {
      writeFileSync(
        join(directory, 'structure.js'),
        `export const cells = [];
export const bindings = [
  {
    id: "b0",
    kind: "text",
    locator: ${JSON.stringify(one.measured)},
    initialText: "",
    // Measured from the page's captured first paint, not derived.
    initialTextFrom: "capture",
    captures: [],
    compute() {
      return "";
    },
  },
];
export const wiring = [];
`,
        'utf8',
      );
    }

    // The manifest is where a claimed child lives, and the ONLY place. Nothing
    // on the resume path reads one, so nothing puts it on the eager wire — and
    // a reader looking in `structure.js` for it would find nothing, which is
    // what the emitter test on the other side of this repo states as an
    // invariant rather than as a condition.
    writeFileSync(
      join(directory, 'manifest.json'),
      `${JSON.stringify(
        {
          artifact: one.artifact,
          ...(one.claimed === undefined ? {} : { claimedChildren: one.claimed }),
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
  }

  return root;
}

/** The stage over a synthetic build whose page paints `paint` and whose artifacts address children. */
function prepareAddressed(name: string, paint: string, artifacts: AddressedArtifact[]) {
  const build = buildSynthetic(
    name,
    {
      'src/shelf-group.ts': {
        file: 'assets/shelf-group.js',
        src: 'src/shelf-group.ts',
        isDynamicEntry: true,
      },
    },
    `export function execute(root) {\n  root.innerHTML = ${JSON.stringify(paint)};\n  return () => { root.innerHTML = ''; };\n}\n`,
  );
  const artifactDir = writeAddressedArtifacts(build.distDir, artifacts);
  const options = syntheticOptions(build.distDir, {
    rootSelector: '#shelf-root',
    requireTemplateVerbatim: true,
  });

  return {
    artifactDir,
    run: () =>
      prerenderPages({
        distDir: build.distDir,
        root: build.distDir,
        pages: options.pages,
        mounts: options.mounts,
        artifactDir,
        log: () => {},
      }),
  };
}

/** The parent's markup, with an element-shaped hole for `CHILD` at `/1`. */
const HOLE = `<div data-resume="${CHILD}" data-component="ShelfBadge"></div>`;
const ADDRESSED_TEMPLATE = `<section class="shelf"><h2>Shelf</h2>${HOLE}</section>`;
const CHILD_TEMPLATE = '<p class="badge">new</p>';
const ADDRESSED_PAINT = ADDRESSED_TEMPLATE.replace('></div>', `>${CHILD_TEMPLATE}</div>`);

/** The parent and the child as the pass emits them, with the parent's claim recorded. */
function addressedPair(): AddressedArtifact[] {
  return [
    {
      artifact: 'shelf.ShelfList',
      html: ADDRESSED_TEMPLATE,
      claimed: [
        {
          locator: '/1',
          artifact: CHILD,
          component: 'ShelfBadge',
          module: 'src/shelf-badge.tsx',
        },
      ],
    },
    { artifact: CHILD, html: CHILD_TEMPLATE },
  ];
}

describe('the verbatim check over a template that addressed a child', () => {
  it('accepts a paint that carries the parent around the hole and the child inside it', async () => {
    const report = await prepareAddressed('addressed', ADDRESSED_PAINT, addressedPair()).run();

    // The parent's template is NOT a substring of that paint — the hole is
    // filled — and the stage proceeds, having checked two templates rather than
    // waiving one.
    expect(report.pages[0]!.html).toBe(ADDRESSED_PAINT);
    expect(ADDRESSED_PAINT.includes(ADDRESSED_TEMPLATE)).toBe(false);
  });

  it('refuses a paint whose structure around the hole is not the parent template', async () => {
    // One attribute different, on the element the hole is inside. The child's
    // subtree was excused; the mount that carries it was not.
    const refusal = await refusalOf(
      prepareAddressed(
        'addressed-outside',
        ADDRESSED_PAINT.replace('<h2>Shelf</h2>', '<h2 class="title">Shelf</h2>'),
        addressedPair(),
      ).run(),
    );

    expect(refusal.name).toBe('TemplateNotVerbatim');
    expect(refusal.message).toContain('1 addressed child(ren)');
    expect(refusal.message).toContain('first piece missing');
  });

  it('refuses a paint whose hole is filled with markup the child never emitted', async () => {
    // P3, and the property that separates this from waiving the subtree: the
    // parent stopped describing those bytes, and the CHILD's own emitted
    // template describes them instead. Nothing is excused by nobody.
    const refusal = await refusalOf(
      prepareAddressed(
        'addressed-inside',
        ADDRESSED_PAINT.replace(CHILD_TEMPLATE, '<p class="badge">old</p>'),
        addressedPair(),
      ).run(),
    );

    expect(refusal.name).toBe('TemplateNotVerbatim');
    // Named as a composition rather than as an orphan: an artifact no mount on
    // this page declares is one a reader has no way back from.
    expect(refusal.message).toContain(`"${CHILD}"'s — the child "shelf.ShelfList" addressed —`);
    expect(refusal.message).toContain('emitted markup verbatim');
  });

  it('recurses past one hop, holding a grandchild to its own template', async () => {
    // The recursion has no depth limit and needs none: it terminates on the
    // artifact that addresses nothing, and the pass refuses a claim that would
    // close a loop before any of these directories exist.
    const childHtml = `<p class="badge"><span data-resume="${GRANDCHILD}" data-component="ShelfDot"></span></p>`;
    const grandchildHtml = '<i class="dot">*</i>';
    const artifacts: AddressedArtifact[] = [
      {
        artifact: 'shelf.ShelfList',
        html: ADDRESSED_TEMPLATE,
        claimed: [
          { locator: '/1', artifact: CHILD, component: 'ShelfBadge', module: 'src/badge.tsx' },
        ],
      },
      {
        artifact: CHILD,
        html: childHtml,
        claimed: [
          { locator: '/0', artifact: GRANDCHILD, component: 'ShelfDot', module: 'src/dot.tsx' },
        ],
      },
      { artifact: GRANDCHILD, html: grandchildHtml },
    ];

    const filledChild = childHtml.replace('></span>', `>${grandchildHtml}</span>`);
    const paint = ADDRESSED_TEMPLATE.replace('></div>', `>${filledChild}</div>`);
    const report = await prepareAddressed('addressed-deep', paint, artifacts).run();
    expect(report.pages[0]!.html).toBe(paint);

    const wrong = await refusalOf(
      prepareAddressed(
        'addressed-deep-wrong',
        paint.replace('<i class="dot">*</i>', '<i class="dot">+</i>'),
        artifacts,
      ).run(),
    );
    expect(wrong.name).toBe('TemplateNotVerbatim');
    expect(wrong.message).toContain(`"${GRANDCHILD}"'s — the child "${CHILD}" addressed —`);
  });

  it('cuts a template carrying one hole of each kind, in document order', async () => {
    // The ordering claim, and it holds by construction rather than by sorting:
    // both kinds punch ONE mark into the tree and the cut is made on the
    // serialized root, which is in document order whatever order they were
    // punched in. The measured text comes FIRST here, so a cut that put the
    // element hole first would look for the pieces in the wrong order.
    const template = `<section class="shelf"><span></span>${HOLE}</section>`;
    const paint = `<section class="shelf"><span>2 items</span><div data-resume="${CHILD}" data-component="ShelfBadge">${CHILD_TEMPLATE}</div></section>`;
    const { artifactDir, run } = prepareAddressed('addressed-mixed', paint, [
      {
        artifact: 'shelf.ShelfList',
        html: template,
        measured: '/0',
        claimed: [
          { locator: '/1', artifact: CHILD, component: 'ShelfBadge', module: 'src/badge.tsx' },
        ],
      },
      { artifact: CHILD, html: CHILD_TEMPLATE },
    ]);

    await run();

    // And the measurement that follows the check found the component too, which
    // is the same-slice condition made visible: the page rewriter's answer to
    // "which of these elements is that component" empties a claimed child's
    // hole exactly as this check punches it, so an addressed parent is located
    // rather than refused for the wrong reason.
    expect(readFileSync(join(artifactDir, 'shelf.ShelfList/structure.js'), 'utf8')).toContain(
      'initialText: "2 items"',
    );
  });
});

/**
 * P1, which is a question about the BUILD and is answered without looking at a
 * paint at all: the emitted template has to carry the hole the manifest says it
 * carries. All three failures are one refusal, because all three are the same
 * defect — an artifact set that disagrees with itself — and a build that has
 * disagreed with itself has nothing to say about any page.
 */
describe('the emitted template has to declare the hole the manifest claims', () => {
  const paints = ADDRESSED_PAINT;

  async function refusedFor(name: string, artifacts: AddressedArtifact[]): Promise<Error> {
    const refusal = await refusalOf(prepareAddressed(name, paints, artifacts).run());
    expect(refusal.name).toBe('TemplateNotVerbatim');
    expect(refusal.message).toContain('could not be cut at its holes');
    return refusal;
  }

  it('refuses a claim whose locator addresses nothing in the parent', async () => {
    const artifacts = addressedPair();
    artifacts[0]!.claimed![0]!.locator = '/9';
    await refusedFor('addressed-p1-locator', artifacts);
  });

  it('refuses a claim whose element the build already filled', async () => {
    // Empty is the whole claim. A parent that painted something into its
    // child's mount is a parent describing bytes it does not own, and the two
    // artifacts would both assert them.
    const artifacts = addressedPair();
    artifacts[0]!.html = ADDRESSED_TEMPLATE.replace('></div>', '><b>mine</b></div>');
    await refusedFor('addressed-p1-filled', artifacts);
  });

  it('refuses a claim whose element names a different artifact', async () => {
    // The hole is a mount point, and a mount point names what stands in it.
    // Emptying an element that merely sits at the same index would manufacture
    // agreement between markup and a template that do not agree.
    const artifacts = addressedPair();
    artifacts[0]!.claimed![0]!.artifact = 'shelf.SomethingElse';
    await refusedFor('addressed-p1-named', artifacts);
  });
});
