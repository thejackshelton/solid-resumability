/**
 * The mount the document carries, and why every one of these is a test about
 * refusing.
 *
 * A mount the pass fills is proved by what it wrote. A mount the DOCUMENT
 * carries is proved by what it refused to serve: the whole value of the
 * verifying edit is that a page whose list drifted from the markup the resumer
 * addresses stops the build instead of coming up and binding a listener to the
 * wrong element. So one test says it passes, and the rest doctor the document
 * one way each and name the refusal.
 *
 * The markup under test is the landed golden's — `artifacts/KeyedRoster.RosterList/`
 * — written out here rather than read from that directory, because what this
 * file is testing is the rule, and a rule tested against a directory the repo
 * may prune is a rule that stops being tested quietly. The strings below are
 * that artifact's `template.js` and the `itemTemplate` of its one region.
 */

import { readFileSync } from 'node:fs';
import { join, resolve } from 'pathe';
import { describe, expect, it } from 'vitest';

import {
  HtmlRewriteError,
  pageEdits,
  pageHtmlPlugin,
  rewritePageHtml,
  type CarriedRegion,
  type HtmlEdit,
  type PageRequest,
  type TemplateCheckEdit,
} from '../src/html.ts';
import { resolveOptions } from '../src/options.ts';
import type { ResolvedOptions, ResumabilityOptions } from '../src/types.ts';

const PLUGIN_ROOT = resolve(import.meta.dirname, '..');
const PAGE = join(PLUGIN_ROOT, 'test/fixtures/html/roster.html');
const SOURCE = readFileSync(PAGE, 'utf8');

/** The golden's artifact directory, its emitted template, and its one region. */
const ARTIFACT = 'KeyedRoster.RosterList';
const TEMPLATE =
  '<div class="roster-panel"><p class="last">none</p><ul class="roster"></ul></div>';
const REGION: CarriedRegion = { id: 'k0', container: '/1', keyAttribute: 'data-key' };

/** The verifying edit, as the trigger computes it for that artifact. */
function check(overrides: Partial<TemplateCheckEdit> = {}): TemplateCheckEdit {
  return { kind: 'check-template', artifact: ARTIFACT, html: TEMPLATE, regions: [REGION], ...overrides };
}

/** Asserts the rewriter refused, and hands back the refusal so its name can be read. */
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

/** The document with its two carried items replaced by whatever the case needs. */
function carrying(items: string): string {
  return SOURCE.replace(
    /<li class="member"[\s\S]*<\/li>/,
    items,
  );
}

const ITEMS = SOURCE.match(/<li class="member"[\s\S]*<\/li>/)![0];

describe('a mount the document carries', () => {
  it('serves the page it was handed, byte for byte, when the document carries the emitted markup', () => {
    expect(rewritePageHtml(SOURCE, [check()])).toBe(SOURCE);
  });

  it('is indifferent to the indentation a person writes between items', () => {
    const onOneLine = carrying(ITEMS.replace(/\s*\n\s*/g, ''));
    const generouslySpaced = carrying(ITEMS.replace(/></g, '>\n              <'));

    expect(rewritePageHtml(onOneLine, [check()])).toBe(onOneLine);
    expect(rewritePageHtml(generouslySpaced, [check()])).toBe(generouslySpaced);
  });

  it('refuses a mount carrying nothing at all', () => {
    const empty = SOURCE.replace(/(data-resume="KeyedRoster.RosterList">)[\s\S]*?(<\/div>\s*<\/main>)/, '$1$2');
    const error = refusalFrom(() => rewritePageHtml(empty, [check()]));

    expect(error.name).toBe('MountMarkupMissing');
    expect(error.message).toContain('carries no markup');
  });

  it('refuses markup with no container for the region in it', () => {
    const listless = SOURCE.replace(/<ul class="roster">[\s\S]*?<\/ul>/, '');
    const error = refusalFrom(() => rewritePageHtml(listless, [check()]));

    expect(error.name).toBe('MountMarkupMissing');
    expect(error.message).toContain('addressing none of region "/1"');
  });

  it('refuses a served subtree that drifted from the markup the pass emitted', () => {
    const drifted = SOURCE.replace('class="roster-panel"', 'class="roster-shelf"');
    const error = refusalFrom(() => rewritePageHtml(drifted, [check()]));

    expect(error.name).toBe('MountMarkupMismatch');
    expect(error.message).toContain('roster-shelf');
  });

  it('refuses a bound element whose own text drifted, whitespace rule or no whitespace rule', () => {
    const drifted = SOURCE.replace('<p class="last">none</p>', '<p class="last">nothing</p>');
    const error = refusalFrom(() => rewritePageHtml(drifted, [check()]));

    expect(error.name).toBe('MountMarkupMismatch');
  });

  it('excuses exactly the text the build declined to write, and nothing else', () => {
    // A measured binding's template carries an empty text where the build had
    // no build-time answer, and the document carries the real one. Same
    // element, same document: excused when the artifacts say the text is
    // measured, refused when they say the build folded it.
    const measuredTemplate = '<div class="roster-panel"><p class="last"></p><ul class="roster"></ul></div>';
    const served = SOURCE.replace('<p class="last">none</p>', '<p class="last">Ada</p>');

    expect(
      rewritePageHtml(served, [check({ html: measuredTemplate, measured: ['/0'] })]),
    ).toBe(served);
    expect(
      refusalFrom(() => rewritePageHtml(served, [check({ html: measuredTemplate })])).name,
    ).toBe('MountMarkupMismatch');
    expect(refusalFrom(() => rewritePageHtml(served, [check()])).name).toBe('MountMarkupMismatch');
  });

  it('refuses an item carrying no key', () => {
    const unkeyed = carrying(ITEMS.replace(' data-key="m2"', ''));
    const error = refusalFrom(() => rewritePageHtml(unkeyed, [check()]));

    expect(error.name).toBe('RegionItemKeyMissing');
    expect(error.message).toContain('by its POSITION');
    expect(error.message).toContain('data-key');
  });

  it('refuses two items answering to one key', () => {
    const doubled = carrying(ITEMS.replace('data-key="m2"', 'data-key="m1"'));
    const error = refusalFrom(() => rewritePageHtml(doubled, [check()]));

    expect(error.name).toBe('RegionItemKeyDuplicate');
    expect(error.message).toContain('"m1"');
  });

  it('refuses a page with no mount for the artifact, and a page carrying two', () => {
    const gone = SOURCE.replace(`data-resume="${ARTIFACT}"`, 'data-resume="KeyedRoster.Elsewhere"');
    expect(refusalFrom(() => rewritePageHtml(gone, [check()])).name).toBe('MountMissing');

    const twice = SOURCE.replace(
      '</main>',
      `  <div data-resume="${ARTIFACT}">${TEMPLATE}</div>\n    </main>`,
    );
    expect(refusalFrom(() => rewritePageHtml(twice, [check()])).name).toBe('MountAmbiguous');
  });
});

describe('the mounts the pass fills', () => {
  const SHELF = join(PLUGIN_ROOT, 'test/fixtures/html/shelf.html');
  const SHELF_SOURCE = readFileSync(SHELF, 'utf8');
  const SHELF_ARTIFACT = 'shelf-page.ShelfToolbar';
  const SHELF_MARKUP = '<div class="shelf-toolbar"><button class="shelve">Shelve</button></div>';

  it('still refuse a target that already has content in it', () => {
    const filled = rewritePageHtml(SHELF_SOURCE, [
      { kind: 'inline-template', artifact: SHELF_ARTIFACT, html: SHELF_MARKUP },
    ]);
    const error = refusalFrom(() =>
      rewritePageHtml(filled, [{ kind: 'inline-template', artifact: SHELF_ARTIFACT, html: SHELF_MARKUP }]),
    );

    expect(error.name).toBe('MountNotEmpty');
    expect(error.message).toContain('twice');
  });

  it('and a carried mount is held to the opposite rule by the opposite name', () => {
    // The same non-empty mount: a refusal under the edit that fills, a pass
    // under the edit that verifies. Which rule applies is the artifact's to
    // say, never the document's.
    const asFilled = refusalFrom(() =>
      rewritePageHtml(SOURCE, [{ kind: 'inline-template', artifact: ARTIFACT, html: TEMPLATE }]),
    );

    expect(asFilled.name).toBe('MountNotEmpty');
    expect(rewritePageHtml(SOURCE, [check()])).toBe(SOURCE);
  });
});

/** The page as a consumer declares it: one mount, on a page whose mounts the pass owns. */
function options(overrides: Partial<ResumabilityOptions> = {}): ResolvedOptions {
  return resolveOptions({
    root: PLUGIN_ROOT,
    artifactDir: 'test/fixtures/html/artifacts',
    mounts: [
      {
        component: 'RosterList',
        source: 'test/fixtures/corpus/features/shelf/shelf-page.tsx',
        artifact: ARTIFACT,
        page: 'roster',
      },
    ],
    pages: [{ id: 'roster', html: 'test/fixtures/html/roster.html', inlineTemplates: true }],
    ...overrides,
  });
}

describe('the edits a page declaration implies', () => {
  const page = options().pages[0]!;

  it('is the verifying edit for a mount whose artifacts declare a region', () => {
    const edits = pageEdits(page, [
      { artifact: ARTIFACT, html: TEMPLATE, regions: [REGION], measured: [] },
    ]);

    expect(edits.map((edit: HtmlEdit) => edit.kind)).toEqual(['check-template']);
    expect(edits[0]).toEqual({
      kind: 'check-template',
      artifact: ARTIFACT,
      html: TEMPLATE,
      regions: [REGION],
      measured: [],
      // The third kind of byte the build can decline to write, empty here: this
      // component addresses no child. The edit states all three or it states a
      // subset, and a subset is the shape where "nothing to say" and "never
      // asked" look alike.
      claimed: [],
    });
  });

  it('is the filling edit for the same mount when it declares none', () => {
    expect(pageEdits(page, [{ artifact: ARTIFACT, html: TEMPLATE }]).map((edit) => edit.kind)).toEqual([
      'inline-template',
    ]);
    expect(
      pageEdits(page, [{ artifact: ARTIFACT, html: TEMPLATE, regions: [] }]).map((edit) => edit.kind),
    ).toEqual(['inline-template']);
  });

  it('is exactly one edit per mount, whichever kind each of them earns', () => {
    const edits = pageEdits(page, [
      { artifact: ARTIFACT, html: TEMPLATE, regions: [REGION] },
      { artifact: 'shelf-page.ShelfToolbar', html: '<div class="shelf-toolbar"></div>' },
    ]);

    expect(edits).toHaveLength(2);
    expect(edits.map((edit) => edit.kind)).toEqual(['check-template', 'inline-template']);
  });
});

describe('the Vite trigger, which is what a dev server serves a page through', () => {
  /** The stage's reader, stubbed: what an artifact directory holds is the emit stage's test. */
  function handlerOf(
    resolved: ResolvedOptions,
    emitted: { html: string; regions?: CarriedRegion[]; measured?: string[] },
  ) {
    const vite = pageHtmlPlugin({
      options: () => resolved,
      readTemplate: async () => emitted,
    }).vite as {
      transformIndexHtml: {
        handler: (html: string, request: PageRequest) => Promise<string>;
      };
    };
    return vite.transformIndexHtml.handler;
  }

  it('serves a correctly carried page unchanged', async () => {
    const handler = handlerOf(options(), { html: TEMPLATE, regions: [REGION], measured: [] });
    expect(await handler(SOURCE, { path: '/roster.html', filename: PAGE })).toBe(SOURCE);
  });

  it('refuses a page whose carried list lost a key, in development rather than in CI', async () => {
    const handler = handlerOf(options(), { html: TEMPLATE, regions: [REGION], measured: [] });
    const unkeyed = carrying(ITEMS.replace(' data-key="m1"', ''));

    await expect(handler(unkeyed, { path: '/roster.html', filename: PAGE })).rejects.toThrow(
      /by its POSITION/,
    );
  });

  it('fills the same mount when the artifacts declare no region', async () => {
    const handler = handlerOf(options(), { html: TEMPLATE });
    const empty = SOURCE.replace(/(data-resume="KeyedRoster.RosterList">)[\s\S]*?(<\/div>\s*<\/main>)/, '$1$2');

    expect(await handler(empty, { path: '/roster.html', filename: PAGE })).toContain(
      `data-resume="${ARTIFACT}">${TEMPLATE}</div>`,
    );
  });
});

/**
 * The third address kind, on the path that checks a mount the DOCUMENT carries.
 *
 * This exists in the same slice as the capture stage's element hole, and not
 * out of tidiness. "Which of these elements is that component" has ONE
 * implementation, shared by the capture stage and this one — a second would be
 * two answers waiting to disagree. So a page carrying an addressed component
 * would otherwise pass the capture stage's verbatim check and then be refused
 * here for having no element that is the component: the gate rejecting for the
 * right reason and naming the wrong defect.
 *
 * The hole gets the region's treatment and one thing more. Emptying is the same
 * move; but a region's container is the component's own element, while a
 * child's hole NAMES the artifact standing in it, and emptying an element that
 * merely sits at the same index would manufacture agreement out of two subtrees
 * that do not agree at all.
 */
const CHILD = 'KeyedRoster.RosterBadge';
const CHILD_MARKUP = '<p class="badge">new</p>';

/** The same golden, if it had also addressed a child at `/2`. */
const ADDRESSED_TEMPLATE =
  '<div class="roster-panel"><p class="last">none</p><ul class="roster"></ul>' +
  `<div data-resume="${CHILD}" data-component="RosterBadge"></div></div>`;

function addressed(overrides: Partial<TemplateCheckEdit> = {}): TemplateCheckEdit {
  return {
    kind: 'check-template',
    artifact: ARTIFACT,
    html: ADDRESSED_TEMPLATE,
    regions: [REGION],
    claimed: [{ locator: '/2', artifact: CHILD }],
    ...overrides,
  };
}

/** A document carrying that component, with its list populated and its hole filled. */
function addressedDocument(hole: string): string {
  const served =
    '<div class="roster-panel"><p class="last">none</p>' +
    `<ul class="roster">${ITEMS}</ul>${hole}</div>`;
  return SOURCE.replace(
    /(data-resume="KeyedRoster.RosterList">)[\s\S]*?(<\/div>\s*<\/main>)/,
    `$1${served}$2`,
  );
}

const FILLED = `<div data-resume="${CHILD}" data-component="RosterBadge">${CHILD_MARKUP}</div>`;

describe('a carried mount whose component addressed a child', () => {
  it('serves the page byte for byte when the hole carries the child', () => {
    // The emitted template is not a substring of the served subtree twice over
    // — the list is populated and the hole is filled — and the comparison holds
    // because both are emptied through the artifacts' own addresses.
    const document = addressedDocument(FILLED);
    expect(rewritePageHtml(document, [addressed()])).toBe(document);
  });

  it('refuses a served hole naming an artifact the build did not address there', () => {
    // The bytes inside would have been emptied either way. What is refused is
    // emptying THE WRONG ELEMENT: an element at the same index carrying another
    // component's name is not this component's hole, and a comparison that
    // cleared it would agree with a template that describes something else.
    const wrong = FILLED.replace(CHILD, 'KeyedRoster.SomethingElse');
    const error = refusalFrom(() => rewritePageHtml(addressedDocument(wrong), [addressed()]));

    expect(error.name).toBe('MountMarkupMissing');
    expect(error.message).toContain(`the mount of "${CHILD}" at "/2"`);
  });

  it('refuses a served subtree whose bytes OUTSIDE the hole drifted', () => {
    // The hole excuses what is inside it and not one byte more. Same filled
    // hole, same populated list, one attribute moved on the component's own
    // root — and the check is exactly as hard as it was before holes existed.
    const document = addressedDocument(FILLED).replace('class="roster-panel"', 'class="roster-shelf"');
    const error = refusalFrom(() => rewritePageHtml(document, [addressed()]));

    expect(error.name).toBe('MountMarkupMismatch');
  });

  it('still refuses a document carrying no such hole at all', () => {
    const error = refusalFrom(() => rewritePageHtml(addressedDocument(''), [addressed()]));

    expect(error.name).toBe('MountMarkupMissing');
    expect(error.message).toContain(`the mount of "${CHILD}" at "/2"`);
  });
});
