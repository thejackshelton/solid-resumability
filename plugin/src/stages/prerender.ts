/**
 * The prerender stage: a page's first paint, captured from the build's own
 * output and inlined into the document it belongs to.
 *
 * What a resumable page serves is markup nothing is asked to claim. There is no
 * hydration pass to feed and no framework in the eager bundle to feed it, so
 * the markup has to be *right* — the same bytes the group will produce when it
 * finally runs, at the same state. The only thing that can produce those bytes
 * is the group itself, so this stage runs it: the built chunk, in a headless
 * document, snapshotted at the synchronous first paint.
 *
 * ── Why this runs after the build and not inside it ───────────────────────
 * The chunk has to exist on disk first. That is the whole reason the trigger is
 * `closeBundle` rather than anything earlier: what is captured must be the code
 * a browser will run, minified and chunked exactly as shipped, not the source it
 * was built from. A capture of the pre-build code would agree with the served
 * page right up until the day a bundler transform changed one byte of markup.
 *
 * ── What is proved before a byte is written ───────────────────────────────
 *   determinism   Every capture runs in a process of its own — fresh module
 *                 registry, fresh document, fresh store — and they must be
 *                 byte-identical. Separate processes rather than repeated calls
 *                 because a page's store registry is entitled to refuse two
 *                 live stores under one identity, and that refusal is the same
 *                 invariant that makes the swap sound; the capture does not get
 *                 an exemption from it.
 *   keys          Every item of every keyed region the paint carries states its
 *                 key. A resumed dispatch from inside a list is resolved by the
 *                 key its item's element carries and by nothing else, so an
 *                 unkeyed item is markup the resume path can only address by
 *                 POSITION — the one failure a key exists to prevent. The build
 *                 that paints the items is the build that owes them, which is
 *                 why the obligation is discharged here rather than left to a
 *                 refusal on the served page.
 *   templates     Each resumed mount's emitted markup must appear in the
 *                 snapshot verbatim. A page whose eager bundle ships no
 *                 template module carries that markup in the document instead,
 *                 and the byte check for it therefore belongs to the build that
 *                 did the inlining. This is that check.
 *   shape         The substrings the page says its first paint contains. Stated
 *                 by the consumer, because what a first paint looks like is a
 *                 fact about their application and a guess here would be a
 *                 check that passes for the wrong reason.
 *
 * ── Pure body, bundler-specific trigger ───────────────────────────────────
 * `prerenderPages` reads its inputs from an object and touches only the
 * directories it is handed. It is exported from `./node`, so a bundler with no
 * hook to hang it on loses the automation and keeps the capability: the same
 * call, run as a documented post-build step.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { basename, join, relative } from 'pathe';
import type { UnpluginOptions } from 'unplugin';

import { locate } from '../../../src/resume/locate.ts';
import {
  componentRootIn,
  emptyElementHtml,
  RESUME_ATTRIBUTE,
  rewritePageHtml,
  type CarriedChild,
} from '../html.ts';
import { artifactDir, claimedChildrenIn, readTemplate as readEmittedTemplate } from '../node.ts';
import { resolveUnder } from '../options.ts';
import type { ResolvedMount, ResolvedOptions, ResolvedPage } from '../types.ts';
import {
  CAPTURE_FLAG,
  CAPTURE_MODULE_PATH,
  CAPTURE_PAYLOAD_MARK,
  parseCapturedMarkup,
  type CapturePayload,
  type CaptureRequest,
} from './capture.ts';

/** Every shape this stage declines to capture, or declines to trust. */
export type PrerenderRefusalName =
  | 'PrerenderNotDeclared'
  | 'PrerenderGroupUndeclared'
  | 'RootSelectorUndeclared'
  | 'CaptureCountInvalid'
  | 'BuildManifestMissing'
  | 'GroupChunkAmbiguous'
  | 'GroupChunkNotDeferred'
  | 'CaptureFailed'
  | 'CaptureNotDeterministic'
  | 'CaptureEmpty'
  | 'RegionItemKeyMissing'
  | 'TemplateNotVerbatim'
  | 'ExpectedMarkupMissing'
  | 'CaptureBindingLocatorMissing'
  | 'PageDocumentMissing';

/**
 * A page this stage will not serve a captured paint for.
 *
 * `name` is the refusal's own name rather than the class's, so a caller can
 * branch on which rule fired without matching on prose that may be reworded.
 */
export class PrerenderError extends Error {
  readonly page: ResolvedPage;

  constructor(name: PrerenderRefusalName, message: string, page: ResolvedPage) {
    super(message);
    this.name = name;
    this.page = page;
  }
}

/** One component's emitted markup, however the caller gets hold of it. */
export type TemplateReader = (
  artifactRoot: string,
  ref: { artifact: string },
) => Promise<{ html: string }>;

/** Everything the stage is handed. Absolute paths in, no discovery, no guessing. */
export interface PrerenderInput {
  /** The build output directory: where the built chunks and the build manifest are. */
  distDir: string;
  /** Project root. What the build manifest's keys — and a page's declared paths — are relative to. */
  root: string;
  /** The pages. Only those declaring a prerender policy are captured. */
  pages: ResolvedPage[];
  /** The declared mounts. The ones on a captured page supply the template check. */
  mounts: ResolvedMount[];
  /** Where the pass emitted its artifacts. */
  artifactDir: string;
  /**
   * Where the built documents are read from and written back to. Defaults to
   * `distDir`, and exists so a caller can prove the capture against a shipped
   * build without writing into it.
   */
  htmlDir?: string;
  /** The build manifest, relative to `distDir`. Defaults to Vite's location. */
  manifest?: string;
  /** How a component's emitted markup is read. Defaults to this package's own reader. */
  readTemplate?: TemplateReader;
  /** Where the per-page lines go. Defaults to stdout. */
  log?: (line: string) => void;
}

/** One captured page: what was captured, from what, and where it went. */
export interface PrerenderedPage {
  page: ResolvedPage;
  /** The captured markup, exactly as inlined. */
  html: string;
  bytes: number;
  /** The built chunk the capture ran. */
  chunkPath: string;
  /** The document the shell was written into. */
  documentPath: string;
  /** How many independent captures agreed on these bytes. */
  captures: number;
}

export interface PrerenderReport {
  pages: PrerenderedPage[];
}

/** Where a Vite build writes its manifest, which is the one convention worth a default. */
const DEFAULT_MANIFEST = '.vite/manifest.json';

/** The export the generated group module renders through, when a page names no other. */
const DEFAULT_EXECUTE_EXPORT = 'execute';

/** How many independent captures have to agree, when a page asks for no number. */
const DEFAULT_CAPTURES = 2;

/** One chunk, as a build manifest describes it. Structural: no bundler's types are imported. */
interface ManifestChunk {
  file: string;
  src?: string;
  isDynamicEntry?: boolean;
}

/**
 * Captures every page that declared a prerender policy, and inlines each one.
 *
 * Sequential on purpose. Captures are child processes running a whole
 * application's chunk, and a page that fails should fail while the log still
 * reads as the story of one page.
 */
export async function prerenderPages(input: PrerenderInput): Promise<PrerenderReport> {
  const log = input.log ?? ((line: string) => console.log(line));
  const pages: PrerenderedPage[] = [];

  for (const page of input.pages) {
    if (page.prerender === false) continue;

    const captured = await prerenderPage(input, page);
    pages.push(captured);

    log(
      `prerender    ${page.id} (${captured.bytes} B, ${captured.captures} captures agreed) -> ` +
        `${relative(input.root, captured.documentPath)}`,
    );
  }

  return { pages };
}

/**
 * One page, start to finish, in the order the failures matter in.
 *
 * Written as one function rather than split by step because the steps only make
 * sense as a sequence: find the chunk, run it twice, prove what came out, and
 * only then touch a file. Nothing is written until every check has passed, so a
 * failed capture leaves the build's output exactly as the bundler left it.
 */
async function prerenderPage(input: PrerenderInput, page: ResolvedPage): Promise<PrerenderedPage> {
  const policy = page.prerender;
  if (policy === false) {
    throw new PrerenderError(
      'PrerenderNotDeclared',
      `page ${JSON.stringify(page.id)} declares no prerender policy, so there is nothing to ` +
        'capture. A page served without a first paint in it is a page that paints when its ' +
        'group arrives, which is a different design rather than a broken one.',
      page,
    );
  }

  if (page.group === false) {
    throw new PrerenderError(
      'PrerenderGroupUndeclared',
      `page ${JSON.stringify(page.id)} declares a prerender policy but no group. Capturing a ` +
        "page means running its group module; with no group there is nothing to run, and the " +
        'capture would report an empty shell as a success.',
      page,
    );
  }

  const rootSelector = policy.rootSelector;
  if (rootSelector === undefined) {
    throw new PrerenderError(
      'RootSelectorUndeclared',
      `page ${JSON.stringify(page.id)} declares a prerender policy with no \`rootSelector\`. ` +
        'Which element the captured paint is rendered into and inlined back into is a fact about ' +
        'your document; guessing one would either capture nothing or fill the wrong element.',
      page,
    );
  }

  const captures = policy.captures ?? DEFAULT_CAPTURES;
  if (!Number.isInteger(captures) || captures < 1) {
    throw new PrerenderError(
      'CaptureCountInvalid',
      `page ${JSON.stringify(page.id)} asks for ${captures} captures. It takes at least one ` +
        'capture to have markup at all, and at least two for the agreement between them to mean ' +
        'the render is deterministic.',
      page,
    );
  }

  const chunkPath = groupChunkPath(input, page, page.group.moduleId);

  const request: CaptureRequest = {
    chunkPath,
    documentHtml: captureDocument(rootSelector),
    rootSelector,
    execute: policy.execute ?? DEFAULT_EXECUTE_EXPORT,
  };

  const taken: string[] = [];
  for (let attempt = 0; attempt < captures; attempt += 1) {
    taken.push(captureInChildProcess(request, page));
  }

  const shell = taken[0]!;
  for (const [index, other] of taken.entries()) {
    if (other === shell) continue;
    throw new PrerenderError(
      'CaptureNotDeterministic',
      `captures 1 and ${index + 1} of page ${JSON.stringify(page.id)} differ, so what the page ` +
        'renders at first paint depends on something other than the code. The served shell would ' +
        `be one of two paints and the swap would show.\n${firstDifference(shell, other)}`,
      page,
    );
  }

  if (shell.trim() === '') {
    throw new PrerenderError(
      'CaptureEmpty',
      `page ${JSON.stringify(page.id)} captured empty: its group rendered nothing at first ` +
        'paint. Inlining that would ship a document whose root is as blank as the one the ' +
        'bundler produced, with a build that claimed otherwise.',
      page,
    );
  }

  // Beside the agreement, and before anything is said about the template: these
  // bytes are the page's paint rather than one of two paints, and the first
  // thing asked of them is whether the lists in them can be addressed at all.
  await assertRegionKeys(input, page, shell);

  if (policy.requireTemplateVerbatim ?? true) {
    for (const mount of input.mounts) {
      if (mount.page !== page.id) continue;
      await assertTemplateVerbatim(input, page, shell, mount.artifact, null);
    }
  }

  for (const expected of policy.expectMarkup ?? []) {
    if (shell.includes(expected)) continue;
    throw new PrerenderError(
      'ExpectedMarkupMissing',
      `the captured paint of page ${JSON.stringify(page.id)} does not contain ` +
        `${JSON.stringify(expected)}, which this page states its first paint carries. Either the ` +
        'capture caught a state that is not the first paint, or the paint changed and the ' +
        `expectation has not.\n  captured: ${shell}`,
      page,
    );
  }

  // Measured last of the checks and first of the writes: every capture-sourced
  // binding takes its text from THESE bytes, which the agreement above already
  // proved are the page's paint rather than one of two paints.
  await measureCapturedBindings(input, page, shell);

  const documentPath = join(input.htmlDir ?? input.distDir, basename(page.html));
  if (!existsSync(documentPath)) {
    throw new PrerenderError(
      'PageDocumentMissing',
      `page ${JSON.stringify(page.id)} has no built document at ${documentPath}. The capture ` +
        'succeeded and has nowhere to go; a built page is looked for by its file name under the ' +
        'output directory.',
      page,
    );
  }

  const before = readFileSync(documentPath, 'utf8');
  const after = rewritePageHtml(before, [
    { kind: 'inline-shell', selector: rootSelector, html: shell },
  ]);
  writeFileSync(documentPath, after, 'utf8');

  return {
    page,
    html: shell,
    bytes: Buffer.byteLength(shell),
    chunkPath,
    documentPath,
    captures,
  };
}


/**
 * A binding whose text is measured rather than derived, as its artifact states
 * it. A derivation reaching into a context store has no build-time answer — the
 * store does not exist until the page runs — so the pass emits an empty text and
 * says where the real one comes from.
 */
interface MeasuredBinding {
  id: string;
  locator: string;
}

/**
 * A keyed region, as far as a captured paint is concerned: where its items are,
 * and what an item says to name itself.
 *
 * The rest of the record — the item template, the projection, the item's own
 * bindings and wiring — is the resume path's business. What a build owes is the
 * key, on every item it painted.
 */
interface KeyedRegion {
  id: string;
  container: string;
  keyAttribute: string;
}

/**
 * Every item of every keyed region this paint carries states its key, or the
 * build stops here.
 *
 * The region is found by ADDRESSING it, exactly as the resumer will: the
 * component's root is identified out of the whole page, and the region's own
 * container locator is walked from it. A region the paint does not carry — a
 * list whose guard was recorded absent, or a container the emitted markup never
 * addressed — has no items and is passed over; a region the paint DOES carry is
 * held to every child of that container, because the runtime calls every one of
 * them an item.
 *
 * Vacuous for a page with no list, and deliberately so. It is the populated
 * capture this exists for: a build free to paint items it did not key is a build
 * that can serve a list the resume path could only address by position.
 */
async function assertRegionKeys(
  input: PrerenderInput,
  page: ResolvedPage,
  shell: string,
): Promise<void> {
  const readTemplate = input.readTemplate ?? readEmittedTemplate;

  for (const mount of input.mounts) {
    if (mount.page !== page.id) continue;

    const regions = await keyedRegionsOf(input, mount.artifact);
    if (regions.length === 0) continue;

    const measured = await measuredBindingsOf(input, mount.artifact);
    const claimed = await claimedChildrenOf(input, mount.artifact);
    const { html: template } = await readTemplate(input.artifactDir, mount);
    const parsed = parseCapturedMarkup(shell);
    try {
      // Nothing in the paint is this component: that is the verbatim check's
      // sentence to pass, and it is about to be asked. Keys are a claim about a
      // list this component painted, and there is no such list here.
      const root = componentRootFor(parsed.container, template, measured, regions, claimed);
      if (root === null) continue;

      for (const region of regions) {
        let container: Element;
        try {
          container = locate(root, region.container);
        } catch {
          continue; // the paint carries no such container, so it carries no items
        }

        const unkeyed = [...container.children].filter(
          (child) => !child.hasAttribute(region.keyAttribute),
        );
        if (unkeyed.length === 0) continue;

        throw new PrerenderError(
          'RegionItemKeyMissing',
          `the captured paint of page ${JSON.stringify(page.id)} carries ${unkeyed.length} item(s) ` +
            `of region ${JSON.stringify(region.id)} — ${JSON.stringify(mount.artifact)} at ` +
            `${JSON.stringify(region.container)} — with no ${region.keyAttribute} attribute. A ` +
            'resumed dispatch from inside a list is resolved by the key its item carries and by ' +
            'nothing else, so an unkeyed item could only be addressed by its POSITION among its ' +
            'siblings — which is the failure the key exists to prevent. The build that painted ' +
            'the items is the build that owes them.\n' +
            `  first unkeyed item: ${unkeyed[0]!.outerHTML}\n  captured: ${shell}`,
          page,
        );
      }
    } finally {
      parsed.close();
    }
  }
}

/**
 * One artifact's emitted markup is the markup the paint carries, and so is
 * every artifact it addressed.
 *
 * THE PROPERTY, and it is worth stating as one sentence: every byte of a
 * component's painted subtree is asserted by EXACTLY ONE artifact. The parent
 * excuses bytes precisely at its holes, and the child asserts precisely those
 * bytes against its own emitted template. Not a byte excused twice; not a byte
 * excused by nobody. A page carrying an addressed parent is checked against n+1
 * templates where it used to be checked against one, and the gate got stronger
 * rather than weaker for having learned the hole.
 *
 * `paint` is the markup THIS artifact must be found in — the whole captured
 * shell at the top, and the innerHTML of the hole one level down. `owner` names
 * the artifact that left the hole, or null at the top, and exists so a refusal
 * can say which composition it is talking about.
 *
 * The recursion terminates on the artifact that addresses nothing, and cannot
 * cycle: the pass refuses a claimed child that would close a loop
 * (`ClaimedChildCycle`) before any of these artifacts exist.
 */
async function assertTemplateVerbatim(
  input: PrerenderInput,
  page: ResolvedPage,
  paint: string,
  artifact: string,
  owner: string | null,
): Promise<void> {
  const readTemplate = input.readTemplate ?? readEmittedTemplate;
  const { html: template } = await readTemplate(input.artifactDir, { artifact });
  const measured = await measuredBindingsOf(input, artifact);
  const claimed = await claimedChildrenOf(input, artifact);

  // Where this artifact sits, said once so every refusal below says it the same
  // way. A child is named WITH its parent: "not verbatim" about an artifact
  // nothing on the page declares is a sentence with no way back to the page.
  const subject =
    owner === null
      ? `${JSON.stringify(artifact)}'s`
      : `${JSON.stringify(artifact)}'s — the child ${JSON.stringify(owner)} addressed —`;

  // A hole-free template IS a substring of the paint, byte for byte. That is
  // the strongest thing that can be said about it, so it stays what is said,
  // and it stays said for every artifact that has no hole of EITHER kind.
  if (measured.length === 0 && claimed.length === 0) {
    if (paint.includes(template)) return;
    throw new PrerenderError(
      'TemplateNotVerbatim',
      `the captured paint of page ${JSON.stringify(page.id)} does not contain ${subject} ` +
        'emitted markup verbatim, so the markup the resumer\'s locators address would not be ' +
        'the markup that is served.\n' +
        `  emitted:  ${template}\n  captured: ${paint}`,
      page,
    );
  }

  // A template with a hole in it cannot be a substring of the paint that fills
  // it: the build emitted an empty text where the capture is about to supply
  // one, and an empty element where another component's artifacts are about to.
  // What is checkable is everything ELSE — the template cut at its holes, each
  // piece appearing in the paint, in order. Every byte the build wrote is still
  // verified; the only bytes excused are the ones the build openly declined to
  // write, and each of those is about to be claimed by whoever did write it.
  const segments = templateSegments(template, measured, claimed);
  const missing = segments === null ? 0 : firstSegmentNotFound(paint, segments);
  if (segments === null || missing >= 0) {
    throw new PrerenderError(
      'TemplateNotVerbatim',
      `the captured paint of page ${JSON.stringify(page.id)} does not carry ${subject} emitted ` +
        `markup around its ${measured.length} measured binding(s) and ${claimed.length} ` +
        'addressed child(ren), so the markup the resumer\'s locators address would not be the ' +
        'markup that is served.\n' +
        (segments === null
          ? '  the template could not be cut at its holes: a measured binding or an addressed ' +
            'child names a locator the emitted markup does not address, or a child\'s mount is ' +
            'not an empty element naming that child.\n'
          : `  first piece missing: ${JSON.stringify(segments[missing])}\n`) +
        `  emitted:  ${template}\n  captured: ${paint}`,
      page,
    );
  }

  if (claimed.length === 0) return;

  // The pieces are in the paint, in order. That says the parent's own bytes are
  // there; it says NOTHING about what is inside the holes, which is the whole
  // point of a hole. So the parent's root is identified in the paint — by the
  // page rewriter's own answer to "which of these elements is that component",
  // which now empties a claimed child's hole exactly as this check punches it —
  // and each hole is opened and handed to the artifact that owns it.
  const inner: Array<{ child: CarriedChild; paint: string }> = [];
  const regions = await keyedRegionsOf(input, artifact);
  const parsed = parseCapturedMarkup(paint);
  try {
    const root = componentRootFor(parsed.container, template, measured, regions, claimed);
    if (root === null) {
      throw new PrerenderError(
        'TemplateNotVerbatim',
        `the captured paint of page ${JSON.stringify(page.id)} carries ${subject} emitted markup ` +
          `around its holes, and no element of that paint IS ${JSON.stringify(artifact)}: ` +
          'clearing its measured texts and emptying its addressed children on a copy of each ' +
          'candidate never reproduced the emitted template. The pieces matched somewhere the ' +
          'component is not.\n' +
          `  emitted:  ${template}\n  captured: ${paint}`,
        page,
      );
    }

    for (const child of claimed) {
      let hole: Element;
      try {
        hole = locate(root, child.locator);
      } catch {
        throw new PrerenderError(
          'TemplateNotVerbatim',
          `the captured paint of page ${JSON.stringify(page.id)} carries ` +
            `${JSON.stringify(artifact)} without the mount it left at ` +
            `${JSON.stringify(child.locator)} for ${JSON.stringify(child.artifact)}. The parent ` +
            'declined to describe those bytes because another component owns them; a paint with ' +
            'no such element is a paint where nobody does.\n' +
            `  emitted:  ${template}\n  captured: ${paint}`,
          page,
        );
      }

      const named = hole.getAttribute(RESUME_ATTRIBUTE);
      if (named !== child.artifact) {
        throw new PrerenderError(
          'TemplateNotVerbatim',
          `the captured paint of page ${JSON.stringify(page.id)} carries ` +
            `${JSON.stringify(artifact)} with a mount at ${JSON.stringify(child.locator)} naming ` +
            `${JSON.stringify(named ?? '')} where the build addressed ` +
            `${JSON.stringify(child.artifact)}. The resumer resolves a nested mount by the name ` +
            'it carries, so a hole labelled with another artifact is a subtree that would be ' +
            'resumed against markup no build emitted for it.\n' +
            `  emitted:  ${template}\n  captured: ${paint}`,
          page,
        );
      }

      inner.push({ child, paint: hole.innerHTML });
    }
  } finally {
    parsed.close();
  }

  // Read out of the parsed tree above, checked after it is closed: each hole's
  // contents are now that child's whole paint, and the child owes the same two
  // properties its parent just paid.
  for (const { child, paint: filled } of inner) {
    await assertTemplateVerbatim(input, page, filled, child.artifact, artifact);
  }
}

/**
 * Writes each capture-sourced binding's text into its artifact, read out of the
 * paint this page just captured.
 *
 * The whole soundness of the move is the ordering: the captures agreed byte for
 * byte BEFORE this runs, so the text taken here is a property of the code rather
 * than of one of two paints. Nothing is derived, folded or guessed — the element
 * at the binding's own locator is read, and what it says is what the artifact
 * gets.
 *
 * The component's root is found rather than assumed. A mount's artifacts are
 * addressed by locators from that root, and the shell is a whole page, so the
 * root is identified by the one thing that identifies it: the emitted template,
 * which is this markup with exactly the measured texts taken out. A candidate
 * matches when clearing those texts on a copy reproduces the emitted bytes.
 * Nothing matching is `CaptureBindingLocatorMissing` — the alternative would be
 * measuring some other element that happened to be shaped alike.
 */
async function measureCapturedBindings(
  input: PrerenderInput,
  page: ResolvedPage,
  shell: string,
): Promise<void> {
  const readTemplate = input.readTemplate ?? readEmittedTemplate;

  for (const mount of input.mounts) {
    if (mount.page !== page.id) continue;

    const structurePath = join(input.artifactDir, mount.artifact, 'structure.js');
    const measured = await measuredBindingsOf(input, mount.artifact);
    if (measured.length === 0) continue;

    const { html: template } = await readTemplate(input.artifactDir, mount);
    const regions = await keyedRegionsOf(input, mount.artifact);
    const claimed = await claimedChildrenOf(input, mount.artifact);
    const parsed = parseCapturedMarkup(shell);
    let texts: Map<string, string>;
    try {
      const root = componentRootFor(parsed.container, template, measured, regions, claimed);
      if (root === null) {
        throw new PrerenderError(
          'CaptureBindingLocatorMissing',
          `page ${JSON.stringify(page.id)} carries ${measured.length} binding(s) of ` +
            `${JSON.stringify(mount.artifact)} whose text is measured from the capture, and no ` +
            'element of the captured paint is that component: clearing those texts on a copy of ' +
            'each candidate never reproduced the emitted template. The measured text would be ' +
            `some other element's.\n  emitted:  ${template}\n  captured: ${shell}`,
          page,
        );
      }
      texts = new Map(measured.map((binding) => [binding.id, locate(root, binding.locator).textContent ?? '']));
    } finally {
      parsed.close();
    }

    // One rewrite, after every binding read: a half-measured artifact would be
    // worse than an unmeasured one.
    let source = readFileSync(structurePath, 'utf8');
    for (const [id, text] of texts) {
      const anchor = new RegExp(`(id: ${JSON.stringify(id)},[\\s\\S]*?initialText: )"[^"]*"`);
      if (!anchor.test(source)) {
        throw new PrerenderError(
          'CaptureBindingLocatorMissing',
          `binding ${JSON.stringify(id)} of ${JSON.stringify(mount.artifact)} says its text is ` +
            'measured, but its emitted `structure.js` has no `initialText` to write it into. The ' +
            'artifact and the module that reads it disagree about what was emitted.',
          page,
        );
      }
      source = source.replace(anchor, `$1${JSON.stringify(text)}`);
    }
    writeFileSync(structurePath, source, 'utf8');
  }
}

/**
 * What the emitted template says of itself, with its holes taken out: the bytes
 * either side of every hole, in order.
 *
 * Two kinds of hole, one mark. A measured binding's text is a hole the CAPTURE
 * fills; a claimed child's mount element is a hole another COMPONENT's
 * artifacts fill. Both are the same statement — the build declined to write
 * these bytes and said so — so both are punched the same way and the cut is
 * made once.
 *
 * The holes are found by ADDRESSING them, not by parsing for them — each hole
 * names its own locator, and that locator is the one the resumer will use.
 * Marking through the same address is what makes this a check on the same holes
 * rather than on ones that look alike. `null` says the template could not be
 * cut, which is a refusal rather than a pass: a hole whose locator does not
 * address anything in its own component's markup is an artifact set that
 * disagrees with itself.
 *
 * P1, THE BUILD DECLARED THE HOLE, is decided here and on the EMITTED TEMPLATE
 * rather than on the paint, because it is a question about what the build
 * wrote. A claimed child's locator has to resolve; the element it resolves to
 * has to be EMPTY, since a parent that painted something into its child's mount
 * is a parent describing bytes it does not own; and that element has to NAME
 * the child, since a hole standing in for one artifact and labelled another is
 * an artifact set at odds with itself. Any of the three failing is `null`.
 *
 * Order across a mixed template is preserved by construction rather than by
 * sorting: both kinds punch one mark into the tree, and the split is made on
 * the SERIALIZED root, which is in document order whatever order the punches
 * happened in.
 */
function templateSegments(
  template: string,
  measured: MeasuredBinding[],
  claimed: CarriedChild[],
): string[] | null {
  const parsed = parseCapturedMarkup(template);
  try {
    const root = parsed.container.firstElementChild;
    if (root === null || parsed.container.children.length !== 1) return null;

    for (const binding of measured) {
      try {
        locate(root, binding.locator).textContent = HOLE_MARK;
      } catch {
        return null;
      }
    }

    for (const child of claimed) {
      let hole: Element;
      try {
        hole = locate(root, child.locator);
      } catch {
        return null;
      }
      if (hole.innerHTML !== '') return null;
      if (hole.getAttribute(RESUME_ATTRIBUTE) !== child.artifact) return null;
      // `textContent`, never `innerHTML`. The mark is chosen so that `<` and
      // `>` cannot survive as themselves — which is only true of a TEXT node.
      // Assigned as markup the parser would read it as an element, the
      // serialized form below would never appear, and every addressed template
      // would fail the check for the wrong reason.
      hole.textContent = HOLE_MARK;
    }

    const marked = root.outerHTML;
    if (!marked.includes(HOLE_MARK_SERIALIZED)) return null;
    return marked.split(HOLE_MARK_SERIALIZED);
  } finally {
    parsed.close();
  }
}

/**
 * Where a hole is, written as text so the serializer escapes it into something
 * a template could not plausibly contain. `<` and `>` cannot survive as
 * themselves in a text node, so what comes back out is the entity form below —
 * fixed, and checked for rather than assumed.
 */
const HOLE_MARK = '<<unplugin-solid-resumability:hole>>';
const HOLE_MARK_SERIALIZED = '&lt;&lt;unplugin-solid-resumability:hole&gt;&gt;';

/**
 * The index of the first segment the paint does not carry after the one before
 * it, or -1 when every one of them is there, in order.
 *
 * Empty segments are skipped rather than searched for: a hole at either end of
 * the template, or two holes with nothing between them, produces one, and
 * "contains the empty string" is not a check.
 */
function firstSegmentNotFound(shell: string, segments: string[]): number {
  let at = 0;
  for (const [index, segment] of segments.entries()) {
    if (segment === '') continue;
    const found = shell.indexOf(segment, at);
    if (found === -1) return index;
    at = found + segment.length;
  }
  return -1;
}

/**
 * The bindings of one mount whose text the artifacts say a capture owes, read
 * out of the emitted `structure.js`.
 *
 * Asked twice per mount, on purpose: once to know how to check the template, and
 * once to fill it in. Reading the artifact both times rather than passing a list
 * between the two keeps the answer sourced from the same place the resume path
 * reads it from.
 */
async function measuredBindingsOf(
  input: PrerenderInput,
  artifact: string,
): Promise<MeasuredBinding[]> {
  const structurePath = join(input.artifactDir, artifact, 'structure.js');
  // A mount the pass refused has no artifacts, and a page may carry one.
  if (!existsSync(structurePath)) return [];

  const url = pathToFileURL(structurePath).href;
  const structure = (await import(`${url}?t=${Date.now()}`)) as {
    bindings?: Array<{ id: string; locator: string; initialTextFrom?: string }>;
  };
  return (structure.bindings ?? [])
    .filter((binding) => binding.initialTextFrom === 'capture')
    .map((binding) => ({ id: binding.id, locator: binding.locator }));
}

/**
 * The keyed regions of one mount, read out of the same emitted `structure.js`
 * the resume path reads them from. A component with no list says nothing about
 * them, and gets the empty answer every artifact emitted before regions existed
 * also gets.
 */
async function keyedRegionsOf(input: PrerenderInput, artifact: string): Promise<KeyedRegion[]> {
  const structurePath = join(input.artifactDir, artifact, 'structure.js');
  if (!existsSync(structurePath)) return [];

  const url = pathToFileURL(structurePath).href;
  const structure = (await import(`${url}?t=${Date.now()}`)) as {
    keyedRegions?: KeyedRegion[];
  };
  return (structure.keyedRegions ?? []).map((region) => ({
    id: region.id,
    container: region.container,
    keyAttribute: region.keyAttribute,
  }));
}

/**
 * The children one mount ADDRESSED rather than absorbed, read out of the
 * emitted manifest.
 *
 * A new reader beside the two above rather than a widening of either, and
 * deliberately so. `measuredBindingsOf` asks which texts the build declined to
 * write; this asks which SUBTREES it declined to describe. They are different
 * questions with different answers, and folding one into the other would
 * quietly change what the older check means for every artifact that has been
 * passing it.
 *
 * The manifest rather than `structure.js` because that is where a claimed child
 * lives: nothing on the resume path reads one, so nothing puts it on the eager
 * wire. A mount the pass refused has no artifacts at all, and a component that
 * addresses nothing writes no such key — both answer empty, which is the answer
 * that means "this template describes every byte of its own subtree".
 */
async function claimedChildrenOf(
  input: PrerenderInput,
  artifact: string,
): Promise<CarriedChild[]> {
  return claimedChildrenIn(artifactDir(input.artifactDir, artifact));
}

/**
 * The element in `container` that is this template, or null.
 *
 * One line, and a deliberate one: the answer comes from the page rewriter's own
 * `componentRootIn`, which is the same question asked by the check on a mount
 * the DOCUMENT carries. A capture and a hand-authored page are two triggers for
 * one obligation — the markup a locator addresses is the markup that is served
 * — and a second implementation of "which of these elements is that component"
 * would be two answers waiting to disagree.
 */
function componentRootFor(
  container: Element,
  template: string,
  measured: MeasuredBinding[],
  regions: KeyedRegion[] = [],
  claimed: CarriedChild[] = [],
): Element | null {
  return componentRootIn(container, template, {
    measured: measured.map((binding) => binding.locator),
    regions,
    claimed,
  });
}

/**
 * The built chunk of the page's group, refused unless the build made it exactly
 * one deferred chunk.
 *
 * Both halves of that are load-bearing. More than one chunk for the group means
 * the bundler split it, and a capture of one half would render a fraction of
 * the page; none means the group did not survive as its own module at all. And
 * a group that is not a dynamic entry has been folded into something the page
 * loads eagerly — the bytes this whole pipeline exists to keep off the wire
 * would be on it, and the capture would happily produce a correct-looking shell
 * for a page that had already lost.
 */
function groupChunkPath(input: PrerenderInput, page: ResolvedPage, moduleId: string): string {
  const manifestPath = join(input.distDir, input.manifest ?? DEFAULT_MANIFEST);
  if (!existsSync(manifestPath)) {
    throw new PrerenderError(
      'BuildManifestMissing',
      `the build wrote no manifest at ${manifestPath}, so which chunk the group of page ` +
        `${JSON.stringify(page.id)} became cannot be looked up. Capturing needs the built chunk; ` +
        'turn the manifest on, or say where it is with `manifest`.',
      page,
    );
  }

  // A manifest names a module the way the bundler's root sees it, which is what
  // a declared module id already is once it is made relative again.
  const source = relative(input.root, resolveUnder(input.root, moduleId));
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, ManifestChunk>;

  const found = Object.entries(manifest).filter(
    ([key, chunk]) => key === source || chunk.src === source,
  );

  if (found.length !== 1) {
    throw new PrerenderError(
      'GroupChunkAmbiguous',
      `the build has ${found.length} chunks for ${JSON.stringify(source)}, the group module of ` +
        `page ${JSON.stringify(page.id)}, and capturing needs exactly one. ` +
        (found.length === 0
          ? 'None means the group did not survive the build as a module of its own — check that ' +
            'it is reachable, and that nothing inlined it.'
          : 'More than one means the bundler split it, and a capture of one part would render a ' +
            'fraction of the page.'),
      page,
    );
  }

  const [, chunk] = found[0]!;
  if (chunk.isDynamicEntry !== true) {
    throw new PrerenderError(
      'GroupChunkNotDeferred',
      `${JSON.stringify(source)} is in the build, but not as a dynamic entry — so the group of ` +
        `page ${JSON.stringify(page.id)} is on the wire eagerly. That is the cost this pipeline ` +
        'exists to remove, and a captured first paint on top of it would hide the regression ' +
        'rather than report it.',
      page,
    );
  }

  return join(input.distDir, chunk.file);
}

/**
 * The document a capture renders into: the page's root element, empty, and
 * nothing else.
 *
 * Deliberately not the built page. The built page is what the capture is *for*,
 * and rendering into a copy of it would let markup the bundler put there leak
 * into the bytes that are then inlined back — the shell would grow a little
 * every build.
 */
function captureDocument(rootSelector: string): string {
  return `<!doctype html><html><head></head><body>${emptyElementHtml(rootSelector)}</body></html>`;
}

/**
 * What the child reported, if it got as far as reporting.
 *
 * Whatever the page's own code wrote to standard output comes first; the
 * payload is what follows the last mark. Text after the mark that will not
 * parse is a child that stopped in the middle of writing its report, which is
 * the same thing as not having written one — nothing is discarded by saying so,
 * because the caller still raises, on the exit status instead.
 */
function reportedIn(printed: string): CapturePayload | undefined {
  const at = printed.lastIndexOf(CAPTURE_PAYLOAD_MARK);
  if (at === -1) return undefined;
  try {
    return JSON.parse(printed.slice(at + CAPTURE_PAYLOAD_MARK.length)) as CapturePayload;
  } catch {
    return undefined;
  }
}

/** The one sentence this stage says about a capture that did not produce markup. */
function captureFailed(
  request: CaptureRequest,
  page: ResolvedPage,
  reason: string,
): PrerenderError {
  return new PrerenderError(
    'CaptureFailed',
    `running ${request.chunkPath} to capture page ${JSON.stringify(page.id)} failed. The ` +
      'chunk is the page as it will be served, so a chunk that cannot run in a headless ' +
      `document is a page that cannot be captured. (${reason})`,
    page,
  );
}

/**
 * One capture, in a process of its own.
 *
 * The child is this package's own capture module, run as a script: it carries a
 * branch that fires only when node was handed that file and this flag. Run
 * rather than imported because after bundling the module lives inside one of
 * the entry bundles under whatever export name the bundler chose, and a child
 * that had to import it by name would be a child that broke the day the bundler
 * renamed something.
 *
 * Standard error is inherited, so a page that logs or throws on its own account
 * says so in the build's log as it happens. A refusal this package states is
 * not that: the child reports it on standard output with the markup, and it is
 * quoted into the refusal below, where the caller is already looking.
 */
function captureInChildProcess(request: CaptureRequest, page: ResolvedPage): string {
  let printed: string;
  try {
    printed = execFileSync(
      process.execPath,
      [CAPTURE_MODULE_PATH, CAPTURE_FLAG, JSON.stringify(request)],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 64 * 1024 * 1024 },
    );
  } catch (cause) {
    // A child that reported before it stopped said something this package
    // wrote; one that did not is a page that crashed on its own, and what it
    // threw is in the log above rather than here.
    const stopped = cause as { stdout?: string | null; message: string };
    const reported = reportedIn(stopped.stdout ?? '');
    throw captureFailed(
      request,
      page,
      reported !== undefined && 'failure' in reported
        ? reported.failure
        : `${stopped.message}; what it threw is above this line`,
    );
  }

  const reported = reportedIn(printed);
  if (reported === undefined) {
    throw new PrerenderError(
      'CaptureFailed',
      `the capture of page ${JSON.stringify(page.id)} printed no markup. The child process ` +
        'exited without reporting, which means it never reached the end of the render.',
      page,
    );
  }

  // A child that reports a refusal and still exits zero is not a child this
  // package writes, but the payload says both things and only one of them is
  // markup: believe the refusal.
  if ('failure' in reported) throw captureFailed(request, page, reported.failure);

  return reported.html;
}

/** Where two strings first differ, with enough either side of it to read. */
function firstDifference(first: string, second: string): string {
  let at = 0;
  while (at < first.length && at < second.length && first[at] === second[at]) at += 1;
  const from = Math.max(0, at - 60);
  return (
    `at byte ${at}:\n` +
    `  first:  …${first.slice(from, at + 60)}…\n` +
    `  second: …${second.slice(from, at + 60)}…`
  );
}

/** What the trigger needs from the rest of the package, handed in rather than imported. */
export interface PrerenderContext {
  /** The options as they stand once the bundler has resolved its config. */
  options(): ResolvedOptions;
  /** How a component's emitted markup is read. */
  readTemplate?: TemplateReader;
}

/** How Vite states the two facts this trigger needs. Structural: no bundler's types are imported. */
export interface PrerenderBuildConfig {
  root?: string;
  command?: string;
  build?: { outDir?: string };
}

/**
 * The trigger: Vite's `closeBundle`, and the config hook that tells it where to
 * look.
 *
 * `closeBundle` because the capture runs the built chunk, and `closeBundle` is
 * the first moment every chunk is on disk. `configResolved` because the output
 * directory is the bundler's to decide and asking the consumer to declare it a
 * second time would be two places for one fact to drift apart.
 *
 * A dev server never gets here: there is no built chunk to run and no document
 * to write into. `transformIndexHtml` serves that workflow, and it serves it
 * with the page's real components rather than a captured stand-in.
 */
export function prerenderPlugin(context: PrerenderContext): UnpluginOptions {
  let distDir: string | undefined;
  let building = false;

  return {
    name: 'unplugin-solid-resumability:prerender',

    vite: {
      apply: 'build' as const,

      configResolved(config: PrerenderBuildConfig) {
        building = config.command === 'build';
        const root = config.root ?? process.cwd();
        distDir = resolveUnder(root, config.build?.outDir ?? 'dist');
      },

      async closeBundle() {
        if (!building || distDir === undefined) return;
        const options = context.options();
        if (!options.pages.some((page) => page.prerender !== false)) return;

        await prerenderPages({
          distDir,
          root: options.root,
          pages: options.pages,
          mounts: options.mounts,
          artifactDir: options.artifactDir,
          readTemplate: context.readTemplate,
        });
      },
    } as UnpluginOptions['vite'],
  };
}
