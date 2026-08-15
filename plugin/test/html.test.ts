/**
 * The page rewrites, and the reason every one of them is a test about failure.
 *
 * A rewrite that lands is easy to check and easy to believe. The case worth
 * the test is the one where the target moved: a swap that quietly does nothing
 * leaves a page that still loads — the classic one — and every measurement
 * taken of it afterwards is a measurement of the wrong page. So each edit gets
 * one test that it works and two or three that it refuses, by name.
 *
 * The trigger is tested through the plugin object it is served from rather
 * than through a Vite dev server, because what belongs to this package is the
 * handler: which page a request is for, which edits that page's declaration
 * implies, and what the pure core is handed. Vite's own delivery of the result
 * is Vite's.
 */

import { readFileSync } from 'node:fs';
import { join, resolve } from 'pathe';
import { describe, expect, it } from 'vitest';

import {
  assertPageFeaturesSupported,
  HtmlRewriteError,
  pageEdits,
  pageForRequest,
  pageHtmlPlugin,
  pageTemplates,
  RESUME_ATTRIBUTE,
  rewritePageHtml,
  type EmittedPageTemplate,
  type HtmlEdit,
  type PageRequest,
  type PageTemplateReader,
} from '../src/html.ts';
import { unpluginFactory } from '../src/index.ts';
import { resolveOptions, ResumabilityConfigError } from '../src/options.ts';
import type { ResolvedOptions, ResumabilityOptions } from '../src/types.ts';

const PLUGIN_ROOT = resolve(import.meta.dirname, '..');
const PAGE = join(PLUGIN_ROOT, 'test/fixtures/html/shelf.html');
const SOURCE = readFileSync(PAGE, 'utf8');

const ARTIFACT = 'shelf-page.ShelfToolbar';
const MARKUP = '<div class="shelf-toolbar"><button class="shelve">Shelve</button></div>';

/** Asserts the rewriter refused, and refused under the name the caller expected. */
function refusalFrom(run: () => unknown): HtmlRewriteError {
  let thrown: unknown;
  try {
    run();
  } catch (error) {
    thrown = error;
  }
  expect(thrown, 'expected a refusal, got none').toBeInstanceOf(HtmlRewriteError);
  return thrown as HtmlRewriteError;
}

/** The demo-shaped declaration, as a consumer writes it. */
function options(overrides: Partial<ResumabilityOptions> = {}): ResolvedOptions {
  return resolveOptions({
    root: PLUGIN_ROOT,
    artifactDir: 'test/fixtures/html/artifacts',
    mounts: [
      {
        component: 'ShelfToolbar',
        source: 'test/fixtures/corpus/features/shelf/shelf-page.tsx',
        page: 'shelf',
      },
    ],
    pages: [
      {
        id: 'shelf',
        html: 'test/fixtures/html/shelf.html',
        entry: { from: '/src/pages/shelf-classic.ts', to: '/src/pages/shelf-resumable.ts' },
        inlineTemplates: true,
      },
    ],
    ...overrides,
  });
}

describe('the entry swap', () => {
  it('points the page at the module the declaration names', () => {
    const out = rewritePageHtml(SOURCE, [
      { kind: 'swap-entry', from: '/src/pages/shelf-classic.ts', to: '/src/pages/shelf-resumable.ts' },
    ]);

    expect(out).toContain('src="/src/pages/shelf-resumable.ts"');
    expect(out).not.toContain('shelf-classic.ts');
    // One edit, one difference: nothing else in the document moved.
    expect(out.length).toBe(SOURCE.length + '-resumable'.length - '-classic'.length);
  });

  it('refuses a page that no longer references the module it was told to swap', () => {
    const error = refusalFrom(() =>
      rewritePageHtml(SOURCE, [{ kind: 'swap-entry', from: '/src/pages/moved.ts', to: '/src/pages/x.ts' }]),
    );
    expect(error.name).toBe('EntryReferenceMissing');
    expect(error.message).toContain('would still load');
  });

  it('refuses a page that references it twice', () => {
    const twice = SOURCE.replace('</body>', '  <link href="/src/pages/shelf-classic.ts" />\n  </body>');
    const error = refusalFrom(() =>
      rewritePageHtml(twice, [
        { kind: 'swap-entry', from: '/src/pages/shelf-classic.ts', to: '/src/pages/shelf-resumable.ts' },
      ]),
    );
    expect(error.name).toBe('EntryReferenceAmbiguous');
    expect(error.message).toContain('2 times');
  });
});

describe('template inlining into a declared mount point', () => {
  it('fills the mount the pass stamped its artifact into', () => {
    const out = rewritePageHtml(SOURCE, [
      { kind: 'inline-template', artifact: ARTIFACT, html: MARKUP },
    ]);

    expect(out).toContain(`${RESUME_ATTRIBUTE}="${ARTIFACT}">${MARKUP}</div>`);
    // The mount's own attributes are the author's and are untouched.
    expect(out).toContain('data-component="ShelfToolbar"');
  });

  it('refuses a page with no mount for the artifact', () => {
    const error = refusalFrom(() =>
      rewritePageHtml(SOURCE, [{ kind: 'inline-template', artifact: 'shelf-page.Missing', html: MARKUP }]),
    );
    expect(error.name).toBe('MountMissing');
    expect(error.message).toContain('shelf-page.Missing');
    expect(error.message).toContain('left blank');
  });

  it('refuses a mount that already has content in it', () => {
    const filled = rewritePageHtml(SOURCE, [
      { kind: 'inline-template', artifact: ARTIFACT, html: MARKUP },
    ]);
    const error = refusalFrom(() =>
      rewritePageHtml(filled, [{ kind: 'inline-template', artifact: ARTIFACT, html: MARKUP }]),
    );
    expect(error.name).toBe('MountNotEmpty');
    expect(error.message).toContain('twice');
  });

  it('refuses a page carrying the same mount twice', () => {
    const doubled = SOURCE.replace(
      '</main>',
      `  <div ${RESUME_ATTRIBUTE}="${ARTIFACT}"></div>\n    </main>`,
    );
    const error = refusalFrom(() =>
      rewritePageHtml(doubled, [{ kind: 'inline-template', artifact: ARTIFACT, html: MARKUP }]),
    );
    expect(error.name).toBe('MountAmbiguous');
    expect(error.message).toContain('2 elements');
  });
});

describe('shell inlining into the page root', () => {
  const SHELL = '<div class="shelf"><p class="pending">Loading</p></div>';

  it('fills the element the root selector names', () => {
    const out = rewritePageHtml(SOURCE, [
      { kind: 'inline-shell', selector: '#page-root', html: SHELL },
    ]);
    expect(out).toContain(`<div class="shelf" id="page-root">${SHELL}</div>`);
  });

  it('finds the same element by class and by attribute', () => {
    const byClass = rewritePageHtml(SOURCE, [
      { kind: 'inline-shell', selector: 'div.shelf', html: SHELL },
    ]);
    const byAttribute = rewritePageHtml(SOURCE, [
      { kind: 'inline-shell', selector: '[id="page-root"]', html: SHELL },
    ]);
    expect(byClass).toBe(byAttribute);
  });

  it('refuses a page with no such element', () => {
    const error = refusalFrom(() =>
      rewritePageHtml(SOURCE, [{ kind: 'inline-shell', selector: '#nowhere', html: SHELL }]),
    );
    expect(error.name).toBe('ShellTargetMissing');
  });

  it('refuses a root that already has markup in it', () => {
    const filled = rewritePageHtml(SOURCE, [
      { kind: 'inline-shell', selector: '#page-root', html: SHELL },
    ]);
    const error = refusalFrom(() =>
      rewritePageHtml(filled, [{ kind: 'inline-shell', selector: '#page-root', html: SHELL }]),
    );
    expect(error.name).toBe('ShellTargetNotEmpty');
  });

  it('refuses a selector it cannot honour without parsing the document', () => {
    const error = refusalFrom(() =>
      rewritePageHtml(SOURCE, [{ kind: 'inline-shell', selector: 'main > div', html: SHELL }]),
    );
    expect(error.name).toBe('SelectorUnsupported');
    expect(error.message).toContain('reserialize');
  });
});

describe('the edits a page declaration implies', () => {
  it('is the swap plus one inline per mount the page carries', () => {
    const resolved = options();
    const edits = pageEdits(resolved.pages[0]!, [{ artifact: ARTIFACT, html: MARKUP }]);

    expect(edits.map((edit: HtmlEdit) => edit.kind)).toEqual(['swap-entry', 'inline-template']);
    expect(edits[0]).toEqual({
      kind: 'swap-entry',
      from: '/src/pages/shelf-classic.ts',
      to: '/src/pages/shelf-resumable.ts',
    });
  });

  it('is the swap alone when the page fills no mounts', () => {
    const resolved = options({
      pages: [
        {
          id: 'shelf',
          html: 'test/fixtures/html/shelf.html',
          entry: { from: '/src/pages/shelf-classic.ts', to: '/src/pages/shelf-resumable.ts' },
        },
      ],
    });
    expect(pageEdits(resolved.pages[0]!, [{ artifact: ARTIFACT, html: MARKUP }])).toHaveLength(1);
  });
});

describe('which page a request is for', () => {
  const pages = options().pages;

  it('matches the file a build names and the URL a dev server names', () => {
    expect(pageForRequest(pages, { filename: PAGE })?.id).toBe('shelf');
    expect(pageForRequest(pages, { path: '/shelf.html' })?.id).toBe('shelf');
  });

  it('is nobody page when the request is for one this pass was told nothing about', () => {
    expect(pageForRequest(pages, { path: '/other.html' })).toBeUndefined();
  });

  it('refuses two declarations one request cannot be told apart by', () => {
    const twoPages = options({
      pages: [
        { id: 'shelf', html: 'test/fixtures/html/shelf.html', inlineTemplates: true },
        { id: 'shelf-again', html: 'test/fixtures/other/shelf.html', inlineTemplates: true },
      ],
    }).pages;

    const error = refusalFrom(() => pageForRequest(twoPages, { path: '/shelf.html' }));
    expect(error.name).toBe('PageRequestAmbiguous');
  });
});

describe('the Vite trigger', () => {
  /** The stage's reader, stubbed: what the artifact directory holds is the emit stage's test, not this one. */
  function plugin(resolved: ResolvedOptions) {
    return pageHtmlPlugin({
      options: () => resolved,
      readTemplate: async (_root, ref) => ({ html: `<div data-was="${ref.artifact}">${MARKUP}</div>` }),
    });
  }

  function handlerOf(resolved: ResolvedOptions) {
    const vite = plugin(resolved).vite as {
      transformIndexHtml: {
        order: string;
        handler: (html: string, request: PageRequest) => Promise<string>;
      };
    };
    expect(vite.transformIndexHtml.order).toBe('pre');
    return vite.transformIndexHtml.handler;
  }

  it('computes this page edits from its declaration and applies them', async () => {
    const resolved = options();
    const out = await handlerOf(resolved)(SOURCE, { path: '/shelf.html', filename: PAGE });

    expect(out).toContain('src="/src/pages/shelf-resumable.ts"');
    expect(out).toContain(`${RESUME_ATTRIBUTE}="${ARTIFACT}"><div data-was="${ARTIFACT}">`);
  });

  it('leaves a page it was told nothing about exactly as it found it', async () => {
    const resolved = options();
    const out = await handlerOf(resolved)(SOURCE, { path: '/elsewhere.html' });
    expect(out).toBe(SOURCE);
  });

  it('refuses loudly rather than serving a page whose entry moved', async () => {
    const resolved = options({
      pages: [
        {
          id: 'shelf',
          html: 'test/fixtures/html/shelf.html',
          entry: { from: '/src/pages/moved.ts', to: '/src/pages/shelf-resumable.ts' },
        },
      ],
    });

    await expect(handlerOf(resolved)(SOURCE, { path: '/shelf.html' })).rejects.toThrow(
      /does not reference/,
    );
  });
});

describe('a bundler with no hook that serves a page', () => {
  it('refuses at construction time rather than building a page that lies', () => {
    let thrown: unknown;
    try {
      unpluginFactory(
        {
          root: PLUGIN_ROOT,
          mounts: [
            {
              component: 'ShelfToolbar',
              source: 'test/fixtures/corpus/features/shelf/shelf-page.tsx',
              page: 'shelf',
            },
          ],
          pages: [
            {
              id: 'shelf',
              html: 'test/fixtures/html/shelf.html',
              entry: { from: '/src/pages/shelf-classic.ts', to: '/src/pages/shelf-resumable.ts' },
            },
          ],
        },
        { framework: 'webpack' },
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ResumabilityConfigError);
    expect((thrown as Error).name).toBe('PageFeaturesUnsupported');
    expect((thrown as Error).message).toContain('webpack');
    expect((thrown as Error).message).toContain('"shelf"');
  });

  it('accepts the same declaration under Vite', () => {
    expect(() => assertPageFeaturesSupported(options().pages, 'vite')).not.toThrow();
  });

  it('accepts a page that declares no rewrites anywhere', () => {
    const quiet = options({ pages: [{ id: 'shelf', html: 'test/fixtures/html/shelf.html' }] });
    expect(() => assertPageFeaturesSupported(quiet.pages, 'rollup')).not.toThrow();
  });
});

/**
 * The mounts nobody declared.
 *
 * A component that addressed a child emits a template with an element-shaped
 * hole in it, stamped with the child's own artifact directory. Nothing in the
 * consumer's config mentions that hole, and nothing can: which components a
 * component hands work to is what the analysis DERIVES, so the page's template
 * list is derived here too.
 *
 * The tests are about order and about absence, in that proportion, because
 * those are the two ways this goes wrong on a real page. A child edit that runs
 * before its parent's finds no mount at all; a child edit that never runs
 * leaves a stamped element empty, and the page loads, and the resumer throws at
 * it later with nothing to say which component it meant.
 */
describe('the children a mount addressed', () => {
  const PARENT = ARTIFACT;
  const CHILD = 'shelf-page.ShelfCount';
  const GRANDCHILD = 'shelf-page.ShelfBadge';

  /** A hole as a parent's template carries one: stamped with the address, and empty. */
  function hole(artifact: string): string {
    return `<span ${RESUME_ATTRIBUTE}="${artifact}"></span>`;
  }

  /** A reader over a stated corpus, refusing an address the corpus has no directory for. */
  function readerOver(corpus: Record<string, EmittedPageTemplate>): PageTemplateReader {
    return async (_root, ref) => {
      const emitted = corpus[ref.artifact];
      if (emitted === undefined) throw new Error(`no artifact directory for ${ref.artifact}`);
      return emitted;
    };
  }

  /** Toolbar addresses a count, the count addresses a badge: two hops, so order is provable. */
  const TREE: Record<string, EmittedPageTemplate> = {
    [PARENT]: {
      html: `<div class="shelf-toolbar">${hole(CHILD)}</div>`,
      claimed: [{ locator: '/0', artifact: CHILD }],
    },
    [CHILD]: {
      html: `<p class="count">${hole(GRANDCHILD)}</p>`,
      claimed: [{ locator: '/0', artifact: GRANDCHILD }],
    },
    [GRANDCHILD]: { html: '<b class="badge">3</b>' },
  };

  function handlerOf(resolved: ResolvedOptions, read: PageTemplateReader) {
    const vite = pageHtmlPlugin({ options: () => resolved, readTemplate: read }).vite as {
      transformIndexHtml: {
        handler: (html: string, request: PageRequest) => Promise<string>;
      };
    };
    return vite.transformIndexHtml.handler;
  }

  /** Asserts the rewriter refused an awaited call, and refused under the expected name. */
  async function refusalFromAsync(run: () => Promise<unknown>): Promise<HtmlRewriteError> {
    let thrown: unknown;
    try {
      await run();
    } catch (error) {
      thrown = error;
    }
    expect(thrown, 'expected a refusal, got none').toBeInstanceOf(HtmlRewriteError);
    return thrown as HtmlRewriteError;
  }

  it('lists a parent before every child it addressed, and a child before its own', async () => {
    const list = await pageTemplates([{ artifact: PARENT }], 'artifacts', readerOver(TREE));

    expect(list.map((template) => template.artifact)).toEqual([PARENT, CHILD, GRANDCHILD]);
    // The order is the point, so it is asserted as a property rather than as a
    // literal: every template that claims a child sits before that child.
    for (const template of list) {
      for (const child of template.claimed ?? []) {
        expect(list.findIndex((other) => other.artifact === template.artifact)).toBeLessThan(
          list.findIndex((other) => other.artifact === child.artifact),
        );
      }
    }
  });

  it('carries what each artifact says about its own holes through to the edits', async () => {
    const list = await pageTemplates([{ artifact: PARENT }], 'artifacts', readerOver(TREE));

    expect(list[0]?.claimed).toEqual([{ locator: '/0', artifact: CHILD }]);
    expect(pageEdits(options().pages[0]!, list).map((edit) => edit.kind)).toEqual([
      'swap-entry',
      'inline-template',
      'inline-template',
      'inline-template',
    ]);
  });

  it('serves a page whose child mounts arrive inside the markup that carries them', async () => {
    const out = await handlerOf(options(), readerOver(TREE))(SOURCE, {
      path: '/shelf.html',
      filename: PAGE,
    });

    expect(out).toContain(
      `${RESUME_ATTRIBUTE}="${PARENT}"><div class="shelf-toolbar">` +
        `<span ${RESUME_ATTRIBUTE}="${CHILD}"><p class="count">` +
        `<span ${RESUME_ATTRIBUTE}="${GRANDCHILD}"><b class="badge">3</b></span>` +
        '</p></span></div>',
    );
    // Nothing stamped is left blank: an empty hole reaching the wire is the
    // failure this whole path exists to prevent.
    expect(out).not.toContain(`${RESUME_ATTRIBUTE}="${CHILD}"></span>`);
    expect(out).not.toContain(`${RESUME_ATTRIBUTE}="${GRANDCHILD}"></span>`);
  });

  it('refuses a child whose artifact directory has no markup to read', async () => {
    const orphaned = { ...TREE };
    delete orphaned[GRANDCHILD];

    const error = await refusalFromAsync(() =>
      pageTemplates([{ artifact: PARENT }], 'artifacts', readerOver(orphaned)),
    );

    expect(error.name).toBe('ClaimedChildTemplateMissing');
    expect(error.message).toContain(GRANDCHILD);
    expect(error.message).toContain(CHILD);
  });

  it('refuses a child that emitted nothing rather than filling a hole with nothing', async () => {
    const empty = { ...TREE, [GRANDCHILD]: { html: '  \n ' } };

    const error = await refusalFromAsync(() =>
      pageTemplates([{ artifact: PARENT }], 'artifacts', readerOver(empty)),
    );

    expect(error.name).toBe('ClaimedChildTemplateEmpty');
    expect(error.message).toContain(GRANDCHILD);
  });

  it('refuses a page that would stamp one address onto two holes', async () => {
    // The diamond: the toolbar addresses the badge itself AND through the count.
    const diamond = {
      ...TREE,
      [PARENT]: {
        html: `<div class="shelf-toolbar">${hole(CHILD)}${hole(GRANDCHILD)}</div>`,
        claimed: [
          { locator: '/0', artifact: CHILD },
          { locator: '/1', artifact: GRANDCHILD },
        ],
      },
    };

    const error = await refusalFromAsync(() =>
      pageTemplates([{ artifact: PARENT }], 'artifacts', readerOver(diamond)),
    );

    expect(error.name).toBe('ClaimedChildAddressTaken');
    expect(error.message).toContain(GRANDCHILD);
  });

  it('refuses a child that collides with an address the page declaration already owns', async () => {
    const error = await refusalFromAsync(() =>
      pageTemplates([{ artifact: PARENT }, { artifact: CHILD }], 'artifacts', readerOver(TREE)),
    );

    expect(error.name).toBe('ClaimedChildAddressTaken');
    expect(error.message).toContain('the page declaration');
  });

  it('refuses a stamped hole its parent markup never carried, rather than serving it', async () => {
    const lying = {
      ...TREE,
      [PARENT]: { html: '<div class="shelf-toolbar"></div>', claimed: TREE[PARENT]!.claimed },
    };

    const error = await refusalFromAsync(() =>
      handlerOf(options(), readerOver(lying))(SOURCE, { path: '/shelf.html', filename: PAGE }),
    );

    expect(error.name).toBe('MountMissing');
    expect(error.message).toContain(CHILD);
  });

  it('leaves a mount that addressed nobody exactly the one edit it always was', async () => {
    const alone = await pageTemplates(
      [{ artifact: PARENT }],
      'artifacts',
      readerOver({ [PARENT]: { html: MARKUP } }),
    );

    expect(alone).toEqual([
      { artifact: PARENT, html: MARKUP, regions: undefined, measured: undefined, claimed: undefined },
    ]);
  });
});
