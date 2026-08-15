/**
 * The page rewrites, and the one rule that makes them safe: a rewrite that
 * cannot find its target is a build failure, never a no-op.
 *
 * Four edits, and between them they are the whole difference a served page
 * shows. A page points at a different entry module. A mount point declared
 * empty in the source document is served with its component's emitted markup
 * already in it. A root element is served with the captured first paint in it.
 * A mount the DOCUMENT already carries is served exactly as its author wrote
 * it, having been held to the markup the pass emitted for it. The first three
 * replace bytes the author wrote with bytes the pass emitted; the fourth
 * replaces nothing and is here to refuse. Each one is addressed by something in
 * the document rather than by position.
 *
 * ── Written or carried, never neither ─────────────────────────────────────
 * A declared mount is either WRITTEN by the pass — inlined here, or painted by
 * the capture, and either way the pass owes the bytes and stamps the keys — or
 * CARRIED by the document, in which case the document owes them and the build
 * verifies them; there is no third answer, and a mount nobody owes is the one
 * outcome this file exists to make impossible.
 *
 * Which of the two a mount is, is not a policy anyone declares: a component
 * whose artifacts declare a keyed region paints a list out of a store that does
 * not exist until the page runs, so the bytes the build could write for it are
 * the list's container and nothing in it. A document that means to serve those
 * items has to carry them, and this file's answer to such a mount is the
 * verifying edit rather than the filling one.
 *
 * ── A mount is not always a declaration ───────────────────────────────────
 * A component that ADDRESSED a child emits a template with an element-shaped
 * hole in it, stamped with the child's own artifact directory. That hole is a
 * mount like any other and it is filled by the same edit, one difference aside:
 * nobody declared it. It arrives in the document only when its parent's markup
 * does, so its edit is computed from the parent's artifacts and applied after
 * the parent's — parent-first, by how the list is built rather than by how it
 * happens to sort. `pageTemplates` is that list, and the two ways a child can
 * fail to have bytes — no template to read, or a template with nothing in it —
 * are refusals there rather than a hole quietly served empty.
 *
 * ── Why every miss throws ─────────────────────────────────────────────────
 * The failure mode this file exists to prevent is a page that still loads.
 * A swap whose target moved leaves the classic entry in place: the page works,
 * boots the whole framework, and every measurement it is asked for is a lie.
 * An inline whose mount moved serves an empty element: the page renders, a
 * little later than it should, and nothing says why. Both are silent, and
 * silence is what a rewriter owes its caller loudest.
 *
 * ── Pure, so the trigger is the only bundler-specific part ────────────────
 * `rewritePageHtml` takes markup and a list of edits and returns markup. It
 * reads no files, knows no bundler, and is the single implementation behind
 * every caller: the dev server's `transformIndexHtml`, the capture stage that
 * inlines a shell, and any later trigger that rewrites built output in place.
 * What differs between those callers is where the markup comes from and where
 * it goes — never what an edit means.
 *
 * The verifying edit is here, on that core, for one reason: a carried mount
 * that is wrong is wrong in development, and the trigger a page is served from
 * under `pnpm dev` is `transformIndexHtml`. A check that lived in a build-only
 * stage would let a developer edit a list's markup, watch the page come up, and
 * meet the refusal weeks later in CI.
 *
 * ── The one parse this file makes ─────────────────────────────────────────
 * Writing a mount is a splice and needs no document. Verifying one is a
 * comparison, and there is nothing to compare bytes of: a hand-authored
 * document is indented and a built template is not, so byte equality would
 * refuse every document a person could write. So the carried subtree and the
 * emitted template are parsed and compared as NODES, and the headless DOM that
 * parses them is the capture module's — one typed contract for it in this
 * package, borrowed rather than declared a second time. Still no file is read
 * and still no bundler is known; the parsed document is a local, and the
 * markup that goes back to the caller is the markup that came in.
 */

import type { UnpluginOptions } from 'unplugin';

import { locate } from '../../src/resume/locate.ts';
import { ResumabilityConfigError } from './options.ts';
import { parseCapturedMarkup } from './stages/capture.ts';
import type { ResolvedOptions, ResolvedPage } from './types.ts';

/**
 * The attribute a resumed mount carries: the artifact directory the pass
 * emitted for the component in it.
 *
 * Stated once, here, because two stages depend on agreeing about it — the
 * inline below writes markup into elements carrying it, and the generated
 * group module finds those same elements by it at load.
 */
export const RESUME_ATTRIBUTE = 'data-resume';

/** Point the page at a different entry module. */
export interface EntrySwapEdit {
  kind: 'swap-entry';
  /** The reference as the source document writes it. */
  from: string;
  /** What it becomes. */
  to: string;
}

/** Fill one declared mount point with its component's emitted markup. */
export interface TemplateInlineEdit {
  kind: 'inline-template';
  /** The artifact directory, which is what the mount element carries. */
  artifact: string;
  html: string;
}

/** Fill the page's root element with a captured first paint. */
export interface ShellInlineEdit {
  kind: 'inline-shell';
  /** How the root element is addressed. */
  selector: string;
  html: string;
}

/**
 * One keyed region, as a document-carried mount is concerned with it: where its
 * items are, and what an item says to name itself.
 *
 * The rest of the artifact's record — the item template, the projection, the
 * item's own bindings and wiring — is the resume path's business. What a
 * carrier owes is the container, and a key on every item in it.
 */
export interface CarriedRegion {
  id: string;
  /** Locator of the container, from the component's root. */
  container: string;
  /** The attribute an item states its key on. */
  keyAttribute: string;
}

/**
 * One CLAIMED CHILD, as the markup is concerned with it: an element-shaped hole
 * the parent left empty, and the artifact whose own bytes fill it.
 *
 * The third address kind, beside a measured text and a keyed region. All three
 * say the same thing in different shapes — here are bytes this component's
 * template does not describe — and they are all read the same way, by walking
 * the artifact's own locator rather than by looking for something hole-shaped.
 *
 * `artifact` is not decoration. The hole is emptied on a copy before the
 * comparison, and emptying the WRONG element would manufacture a match out of
 * two elements that merely happen to sit at the same index; so the element the
 * locator reaches has to name the child it is supposed to be holding.
 */
export interface CarriedChild {
  /** Locator of the mount container the parent left empty, from the component's root. */
  locator: string;
  /** The artifact directory the child's own bytes come from, as the hole states it. */
  artifact: string;
}

/**
 * Hold one declared mount to the markup the pass emitted for it, and write
 * nothing.
 *
 * The edit a CARRIED mount gets, and it is an edit rather than an absence on
 * purpose: a mount that produced no edit at all would be a mount the page's
 * edit list never mentions, and the difference between "verified" and
 * "forgotten" would stop being visible anywhere.
 */
export interface TemplateCheckEdit {
  kind: 'check-template';
  /** The artifact directory, which is what the mount element carries. */
  artifact: string;
  /** The emitted markup the served subtree has to reproduce. */
  html: string;
  /** The keyed regions the artifact declares. Non-empty — they are why this mount is carried. */
  regions: CarriedRegion[];
  /** Locators of the texts the build declined to write, cleared before the comparison. */
  measured?: string[];
  /** The element-shaped holes the build left for children it addressed, emptied before the comparison. */
  claimed?: CarriedChild[];
}

export type HtmlEdit = EntrySwapEdit | TemplateInlineEdit | TemplateCheckEdit | ShellInlineEdit;

/** Every way a page rewrite declines to proceed. */
export type HtmlRefusalName =
  | 'EntryReferenceMissing'
  | 'EntryReferenceAmbiguous'
  | 'MountMissing'
  | 'MountAmbiguous'
  | 'MountNotEmpty'
  | 'MountMarkupMissing'
  | 'MountMarkupMismatch'
  | 'RegionItemKeyMissing'
  | 'RegionItemKeyDuplicate'
  | 'ShellTargetMissing'
  | 'ShellTargetAmbiguous'
  | 'ShellTargetNotEmpty'
  | 'SelectorUnsupported'
  | 'PageRequestAmbiguous'
  | 'ClaimedChildTemplateMissing'
  | 'ClaimedChildTemplateEmpty'
  | 'ClaimedChildAddressTaken';

/**
 * A page this rewriter will not produce.
 *
 * `name` is the refusal's own name rather than the class's, so a caller can
 * branch on which rule fired without matching on prose that may be reworded.
 */
export class HtmlRewriteError extends Error {
  constructor(name: HtmlRefusalName, message: string) {
    super(message);
    this.name = name;
  }
}

/**
 * Applies every edit, in the order given, and returns the rewritten markup.
 *
 * Every edit is applied to the output of the one before it, so an inline can
 * land inside markup a previous inline produced. Nothing else in the document
 * is touched: this is a splice at each target, not a parse and a reserialize,
 * because a document that went through a serializer would differ from the
 * author's in ways nobody asked for.
 */
export function rewritePageHtml(html: string, edits: HtmlEdit[]): string {
  let out = html;
  for (const edit of edits) out = applyEdit(out, edit);
  return out;
}

function applyEdit(html: string, edit: HtmlEdit): string {
  if (edit.kind === 'swap-entry') return swapEntry(html, edit);
  if (edit.kind === 'check-template') return checkCarriedTemplate(html, edit);
  if (edit.kind === 'inline-template') {
    return inlineInto(html, mountSelector(edit.artifact), edit.html, {
      missing: 'MountMissing',
      ambiguous: 'MountAmbiguous',
      notEmpty: 'MountNotEmpty',
      what: `the mount point of ${JSON.stringify(edit.artifact)}`,
    });
  }
  return inlineInto(html, edit.selector, edit.html, {
    missing: 'ShellTargetMissing',
    ambiguous: 'ShellTargetAmbiguous',
    notEmpty: 'ShellTargetNotEmpty',
    what: `the root element ${JSON.stringify(edit.selector)}`,
  });
}

/**
 * The entry swap: one exact reference, replaced.
 *
 * Exact rather than pattern-matched, and refused when the document names it
 * twice, because both a miss and a second occurrence mean the page is not the
 * page this edit was computed for.
 */
function swapEntry(html: string, edit: EntrySwapEdit): string {
  const occurrences = html.split(edit.from).length - 1;

  if (occurrences === 0) {
    throw new HtmlRewriteError(
      'EntryReferenceMissing',
      `the page does not reference ${JSON.stringify(edit.from)}, so the entry module cannot be ` +
        `swapped for ${JSON.stringify(edit.to)}. A page whose entry moved would still load — the ` +
        'classic one — which is why this is a failure rather than a page served unchanged.',
    );
  }

  if (occurrences > 1) {
    throw new HtmlRewriteError(
      'EntryReferenceAmbiguous',
      `the page references ${JSON.stringify(edit.from)} ${occurrences} times. Which of them is ` +
        'the entry is not decidable here, and swapping all of them would rewrite references this ' +
        'edit was never told about.',
    );
  }

  return html.replace(edit.from, edit.to);
}

interface InlineNames {
  missing: HtmlRefusalName;
  ambiguous: HtmlRefusalName;
  notEmpty: HtmlRefusalName;
  /** How the target is named in a refusal. */
  what: string;
}

/** Fills the one empty element the selector addresses. */
function inlineInto(html: string, selector: string, markup: string, names: InlineNames): string {
  const matches = findElements(html, selector);

  if (matches.length === 0) {
    throw new HtmlRewriteError(
      names.missing,
      `the page has no element matching ${JSON.stringify(selector)}, so ${names.what} has ` +
        'nowhere to go. Serving the page without it would serve an element the pass proved ' +
        'markup for and then left blank.',
    );
  }

  if (matches.length > 1) {
    throw new HtmlRewriteError(
      names.ambiguous,
      `the page has ${matches.length} elements matching ${JSON.stringify(selector)}. One set of ` +
        `emitted markup describes one element, so which of them ${names.what} refers to is not ` +
        'decidable.',
    );
  }

  const target = matches[0]!;
  if (html.slice(target.contentStart, target.contentEnd).trim() !== '') {
    throw new HtmlRewriteError(
      names.notEmpty,
      `${names.what} already has content in it. Inlining into it would serve the same markup ` +
        'twice; a mount point the pass fills is declared empty in the source document.',
    );
  }

  return html.slice(0, target.contentStart) + markup + html.slice(target.contentEnd);
}

/**
 * The carried mount: everything the filling edit would have written, proved to
 * be there already, and not one byte changed.
 *
 * The mount is found by the same selector the filling edit uses and refused by
 * the same two names, because "which element is this mount" is one question
 * however the mount is owed. What follows is the part only a carrier needs: the
 * document's own subtree is held to the emitted template, and every item of
 * every keyed region in it is held to its key.
 *
 * Returns the markup it was given. A check that returned anything else would be
 * a rewrite wearing a check's name.
 */
function checkCarriedTemplate(html: string, edit: TemplateCheckEdit): string {
  const selector = mountSelector(edit.artifact);
  const matches = findElements(html, selector);

  if (matches.length === 0) {
    throw new HtmlRewriteError(
      'MountMissing',
      `the page has no element matching ${JSON.stringify(selector)}, so the mount point of ` +
        `${JSON.stringify(edit.artifact)} — which this page CARRIES rather than has filled — is ` +
        'nowhere to be found. Serving the page without it would serve a page whose component the ' +
        'resumer will look for and not find.',
    );
  }

  if (matches.length > 1) {
    throw new HtmlRewriteError(
      'MountAmbiguous',
      `the page has ${matches.length} elements matching ${JSON.stringify(selector)}. One set of ` +
        `emitted markup describes one element, so which of them the mount point of ` +
        `${JSON.stringify(edit.artifact)} refers to is not decidable.`,
    );
  }

  const target = matches[0]!;
  const carried = html.slice(target.contentStart, target.contentEnd);
  const measured = edit.measured ?? [];
  const parsed = parseCapturedMarkup(carried);

  try {
    if (carried.trim() === '' || parsed.container.children.length === 0) {
      throw new HtmlRewriteError(
        'MountMarkupMissing',
        `the mount point of ${JSON.stringify(edit.artifact)} carries no markup. This mount is the ` +
          'document\'s to write: its component paints a keyed list out of a store that does not ' +
          'exist until the page runs, so the pass has a template for it and no items to put in ' +
          'one. An empty mount here is a page that serves nothing where its list goes and paints ' +
          'it only once the group arrives — which is the delay this whole pass exists to remove, ' +
          'arrived at silently.\n' +
          `  emitted: ${edit.html}`,
      );
    }

    // Every element the served subtree offers, each one carrying the copy the
    // comparison is made against: measured texts cleared, keyed regions emptied
    // and claimed children's holes emptied, exactly the bytes the build openly
    // declined to write. A candidate that cannot address one of them is not a
    // candidate at all, and NONE of them being able to is its own refusal — the
    // document is carrying something, and what it is carrying has no room in it
    // for the parts of this component that belong to somebody else.
    const claimed = edit.claimed ?? [];
    const candidates = clearedCandidates(parsed.container, measured, edit.regions, claimed);
    if (candidates.length === 0) {
      // Named by which address failed rather than by whichever kind is older.
      // A refusal that says "region" about a missing child's mount is the gate
      // rejecting for the right reason and reporting the wrong one.
      const addresses = [
        ...edit.regions.map((region) => `region ${JSON.stringify(region.container)}`),
        ...claimed.map(
          (child) =>
            `the mount of ${JSON.stringify(child.artifact)} at ${JSON.stringify(child.locator)}`,
        ),
      ].join(', ');

      throw new HtmlRewriteError(
        'MountMarkupMissing',
        `the mount point of ${JSON.stringify(edit.artifact)} carries markup addressing none of ` +
          `${addresses}. Those are the elements of this component the resume path walks to: a ` +
          'region\'s container to find the items a dispatch is resolved against, and an addressed ' +
          'child\'s mount to find the component that owns the bytes inside it. A document ' +
          'carrying the component without them carries a component that can never be addressed.\n' +
          `  emitted: ${edit.html}\n  served:  ${carried.trim()}`,
      );
    }

    const wanted = canonicalMarkup(edit.html);
    const root = candidates.find((candidate) => canonicalOf(candidate.cleared) === wanted);
    if (root === undefined) {
      throw new HtmlRewriteError(
        'MountMarkupMismatch',
        `the subtree the page serves at the mount of ${JSON.stringify(edit.artifact)} is not the ` +
          'markup the pass emitted for it. The two are compared with every keyed region emptied ' +
          'and every measured text cleared — the bytes the build declined to write — and as ' +
          'parsed nodes rather than as bytes, so the indentation a person writes between elements ' +
          'is nobody\'s business here. What is left has to agree: an element the resumer addresses ' +
          'by a path of child indices is addressed in markup the pass never saw, and a document ' +
          'free to drift from it is a document free to bind a listener to the wrong element.\n' +
          `  emitted: ${edit.html}\n  served:  ${carried.trim()}`,
      );
    }

    assertCarriedRegionKeys(root.element, edit);
  } finally {
    parsed.close();
  }

  return html;
}

/**
 * Every item of every carried region states its key, and no two of them state
 * the same one.
 *
 * `RegionItemKeyMissing` is the name the capture path already refuses under,
 * deliberately: one obligation — an item is addressed by the key it carries and
 * by nothing else — with two triggers, the build that paints the items and the
 * document that carries them, and one string for a consumer to branch on.
 *
 * The duplicate is this path's own. A build painting from a keyed projection
 * cannot write the same key twice; a person writing the list by hand can, and
 * two items answering to one key means a dispatch from either resolves to
 * whichever the walk reached first.
 */
function assertCarriedRegionKeys(root: Element, edit: TemplateCheckEdit): void {
  for (const region of edit.regions) {
    const container = locate(root, region.container);
    const items = [...container.children];

    const unkeyed = items.filter((item) => !item.hasAttribute(region.keyAttribute));
    if (unkeyed.length > 0) {
      throw new HtmlRewriteError(
        'RegionItemKeyMissing',
        `the page carries ${unkeyed.length} item(s) of region ${JSON.stringify(region.id)} — ` +
          `${JSON.stringify(edit.artifact)} at ${JSON.stringify(region.container)} — with no ` +
          `${region.keyAttribute} attribute. A resumed dispatch from inside a list is resolved by ` +
          'the key its item carries and by nothing else, so an unkeyed item could only be ' +
          'addressed by its POSITION among its siblings — which is the failure the key exists to ' +
          'prevent. The document that carries the items is the document that owes them.\n' +
          `  first unkeyed item: ${unkeyed[0]!.outerHTML}`,
      );
    }

    const seen = new Set<string>();
    for (const item of items) {
      const key = item.getAttribute(region.keyAttribute) ?? '';
      if (!seen.has(key)) {
        seen.add(key);
        continue;
      }
      throw new HtmlRewriteError(
        'RegionItemKeyDuplicate',
        `the page carries two items of region ${JSON.stringify(region.id)} — ` +
          `${JSON.stringify(edit.artifact)} at ${JSON.stringify(region.container)} — whose ` +
          `${region.keyAttribute} is both ${JSON.stringify(key)}. A key is an identity: the ` +
          'resume path resolves a dispatch to the one item carrying it, so two of them means a ' +
          'click on either is answered by whichever the walk reached first, and the store would ' +
          'be told about an item nobody touched.\n' +
          `  second item: ${item.outerHTML}`,
      );
    }
  }
}

/** How a mount element is addressed, for the edit that fills one and the edit that checks one. */
function mountSelector(artifact: string): string {
  return `[${RESUME_ATTRIBUTE}="${artifact}"]`;
}

/** One candidate for a component's root, and the copy the comparison is made against. */
interface ClearedCandidate {
  element: Element;
  cleared: Element;
}

/**
 * Every element under `container` that can address what the artifacts say this
 * component addresses, each with a copy of itself holding the comparable bytes.
 *
 * A copy, because the clearing is destructive and the served markup is the
 * caller's. An element that cannot address a measured binding's locator, a
 * region's container or a claimed child's hole is dropped rather than compared:
 * the comparison it would lose is not evidence about that element, and the
 * point of walking every candidate is that a mount may wrap its component in
 * markup of its own.
 */
function clearedCandidates(
  container: Element,
  measured: string[],
  regions: CarriedRegion[],
  claimed: CarriedChild[],
): ClearedCandidate[] {
  const found: ClearedCandidate[] = [];

  for (const element of [...container.querySelectorAll('*')]) {
    const cleared = clearedCopy(element, measured, regions, claimed);
    if (cleared !== null) found.push({ element, cleared });
  }

  return found;
}

/**
 * A copy of one element with the measured texts cleared, every keyed region
 * emptied and every claimed child's hole emptied, or null when it cannot
 * address one of them.
 *
 * The addresses are the artifacts' own locators, which are the addresses the
 * resumer will use. Marking through the same address is what makes this a check
 * on the same holes rather than on ones that look alike.
 *
 * The claimed child gets the region's treatment and one thing more. Emptying is
 * the same move — a hole is a hole — but a region's container is the
 * component's own element and a child's hole is a mount point that NAMES the
 * artifact standing in it. So the name is required to match before the bytes
 * are thrown away: emptying an element that merely sits at the same index would
 * manufacture agreement between a served subtree and an emitted template that
 * do not agree at all.
 */
function clearedCopy(
  element: Element,
  measured: string[],
  regions: CarriedRegion[],
  claimed: CarriedChild[],
): Element | null {
  const copy = element.cloneNode(true) as Element;

  for (const locator of measured) {
    try {
      locate(copy, locator).textContent = '';
    } catch {
      return null;
    }
  }

  for (const region of regions) {
    try {
      locate(copy, region.container).innerHTML = '';
    } catch {
      return null;
    }
  }

  for (const child of claimed) {
    let hole: Element;
    try {
      hole = locate(copy, child.locator);
    } catch {
      return null;
    }
    if (hole.getAttribute(RESUME_ATTRIBUTE) !== child.artifact) return null;
    hole.innerHTML = '';
  }

  return copy;
}

/**
 * The element in `container` that IS this template, or null.
 *
 * The one implementation of "which of these elements is that component",
 * shared by the carried-mount check here and the capture stage that has to find
 * a component's root inside a whole page's paint. Compared with the measured
 * texts cleared, the keyed regions emptied and the claimed children's holes
 * emptied — the same equality the verbatim check makes, weakened by exactly the
 * bytes the build openly declined to write: a text with no build-time answer, a
 * list whose items are the page's own rather than the build's markup, and a
 * subtree that belongs to another component's artifacts.
 */
export function componentRootIn(
  container: Element,
  template: string,
  addresses: { measured?: string[]; regions?: CarriedRegion[]; claimed?: CarriedChild[] } = {},
): Element | null {
  const wanted = canonicalMarkup(template);
  const found = clearedCandidates(
    container,
    addresses.measured ?? [],
    addresses.regions ?? [],
    addresses.claimed ?? [],
  ).find((candidate) => canonicalOf(candidate.cleared) === wanted);

  return found?.element ?? null;
}

/** What `canonicalOf` says about markup, once it is parsed. */
function canonicalMarkup(markup: string): string {
  const parsed = parseCapturedMarkup(markup);
  try {
    const root = parsed.container.firstElementChild;
    // Markup that is not one element is markup no component emitted, and
    // returning it unparsed is how it fails to equal anything.
    return root === null || parsed.container.children.length !== 1 ? markup : canonicalOf(root);
  } finally {
    parsed.close();
  }
}

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

/**
 * One element written down as what a parsed document says it is, so that two of
 * them can be compared without either's serialization getting a vote.
 *
 * Three decisions, each of them the whole reason this is not a byte comparison:
 *
 *   whitespace   A text node that is nothing but whitespace is dropped. A
 *                hand-authored list is indented and a built template is not,
 *                and the indentation between two elements is invisible to
 *                every locator, every binding and every listener in the resume
 *                path. Text that is NOT whitespace-only is kept exactly as
 *                written, because that text is what a binding owns and a
 *                document that drifts a character of it is a document serving
 *                one thing and about to render another.
 *   attributes   Compared as a set, sorted by name. A parsed node's attributes
 *                have no order — only its serialization does — and refusing a
 *                document for writing two attributes in the other order would
 *                be refusing it for nothing.
 *   comments     Dropped. Locators address element children, so a comment
 *                shifts nothing the resume path can see.
 */
function canonicalOf(element: Element): string {
  const tag = element.tagName.toLowerCase();

  const attributes = [...element.attributes]
    .map((attribute) => ` ${attribute.name}=${JSON.stringify(attribute.value)}`)
    .sort()
    .join('');

  let inner = '';
  for (const child of [...element.childNodes]) {
    if (child.nodeType === ELEMENT_NODE) {
      inner += canonicalOf(child as Element);
      continue;
    }
    if (child.nodeType !== TEXT_NODE) continue;
    const text = child.nodeValue ?? '';
    if (text.trim() === '') continue;
    inner += JSON.stringify(text);
  }

  return `<${tag}${attributes}>${inner}</${tag}>`;
}

/** One matched element: where its content starts and where it ends. */
interface ElementMatch {
  contentStart: number;
  contentEnd: number;
}

/**
 * The selector subset a raw-markup rewriter can honour.
 *
 * An id, a class, or an attribute, each optionally qualified by a tag name.
 * That is every way the documents this rewrites address a mount point or a
 * root, and anything beyond it — a descendant combinator, say — needs a real
 * document rather than a scan, which is a parse this file deliberately does
 * not do. Refused by name rather than approximated.
 */
interface ParsedSelector {
  tag: string | null;
  attribute: string;
  value: string;
  /** True when the attribute is a space-separated list and one token has to match. */
  token: boolean;
}

const SELECTOR = /^([a-zA-Z][\w-]*)?(?:#([\w-]+)|\.([\w-]+)|\[([\w:-]+)=["']([^"']*)["']\])$/;

function parseSelector(selector: string): ParsedSelector {
  const parsed = SELECTOR.exec(selector.trim());
  if (parsed === null) {
    throw new HtmlRewriteError(
      'SelectorUnsupported',
      `${JSON.stringify(selector)} is not a selector this rewriter can honour. It matches an ` +
        'element by id, by class, or by attribute, each optionally qualified by a tag name — ' +
        'anything more needs a parsed document, and parsing one would reserialize every byte of ' +
        'the page.',
    );
  }

  const [, tag, id, className, attribute, value] = parsed;
  if (id !== undefined) return { tag: tag ?? null, attribute: 'id', value: id, token: false };
  if (className !== undefined) {
    return { tag: tag ?? null, attribute: 'class', value: className, token: true };
  }
  return { tag: tag ?? null, attribute: attribute!, value: value!, token: false };
}

/**
 * The smallest empty element the selector would match.
 *
 * The capture needs a document to render into, and what it needs in that
 * document is the one element the page declares as its root — empty, because
 * filling it is what the run is for. Building it from the same selector the
 * inlining edit uses means the two cannot disagree about what the root is: a
 * capture that rendered into an element the rewrite could not find afterwards
 * would fail late, with markup in hand and nowhere to put it.
 *
 * The tag defaults to `div` when the selector names none, since a selector that
 * addresses by id, class or attribute says nothing about the element's name and
 * a container is what a root is.
 */
export function emptyElementHtml(selector: string): string {
  const wanted = parseSelector(selector);
  const tag = wanted.tag ?? 'div';
  return `<${tag} ${wanted.attribute}="${wanted.value}"></${tag}>`;
}

const OPEN_TAG = /<([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
const ATTRIBUTE = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/**
 * Every element the selector matches, found by scanning open tags.
 *
 * The element's end is its matching close tag, found by counting opens and
 * closes of the same tag name so a nested element of the same name does not
 * close its parent. Void elements never match: a mount point and a root are
 * containers, and a container is what these edits fill.
 */
function findElements(html: string, selector: string): ElementMatch[] {
  const wanted = parseSelector(selector);
  const found: ElementMatch[] = [];

  OPEN_TAG.lastIndex = 0;
  for (let open = OPEN_TAG.exec(html); open !== null; open = OPEN_TAG.exec(html)) {
    const tag = open[1]!;
    const attributes = open[2] ?? '';
    if (attributes.endsWith('/')) continue;
    if (wanted.tag !== null && tag.toLowerCase() !== wanted.tag.toLowerCase()) continue;
    if (!attributesMatch(attributes, wanted)) continue;

    const contentStart = open.index + open[0].length;
    const contentEnd = closeOf(html, tag, contentStart);
    if (contentEnd === null) continue;
    found.push({ contentStart, contentEnd });
  }

  return found;
}

function attributesMatch(attributes: string, wanted: ParsedSelector): boolean {
  ATTRIBUTE.lastIndex = 0;
  for (let hit = ATTRIBUTE.exec(attributes); hit !== null; hit = ATTRIBUTE.exec(attributes)) {
    if (hit[1]!.toLowerCase() !== wanted.attribute.toLowerCase()) continue;
    const value = hit[2] ?? hit[3] ?? '';
    if (wanted.token) {
      if (value.split(/\s+/).includes(wanted.value)) return true;
      continue;
    }
    if (value === wanted.value) return true;
  }
  return false;
}

/** The index the element's own close tag starts at, or null when it has none. */
function closeOf(html: string, tag: string, from: number): number | null {
  const boundary = new RegExp(`<(/?)${tag}\\b`, 'gi');
  boundary.lastIndex = from;
  let depth = 0;

  for (let hit = boundary.exec(html); hit !== null; hit = boundary.exec(html)) {
    if (hit[1] === '/') {
      if (depth === 0) return hit.index;
      depth -= 1;
      continue;
    }
    depth += 1;
  }

  return null;
}

/**
 * One component's emitted markup, as the trigger read it, and what the same
 * artifacts say about the three kinds of bytes the build declined to write.
 *
 * All three of the extra fields are optional and all three default to the empty
 * answer, which is what every component with no list, no capture-measured text
 * and no addressed child has to say: a mount that declares none of them is a
 * mount the pass fills, exactly as before.
 */
export interface PageTemplate {
  artifact: string;
  html: string;
  /** The keyed regions the artifact declares. Any at all makes this mount a carried one. */
  regions?: CarriedRegion[];
  /** Locators of the bindings whose text a capture measures rather than the build folding it. */
  measured?: string[];
  /** The children the artifact ADDRESSED: one empty element each, filled from the child's own artifacts. */
  claimed?: CarriedChild[];
}

/**
 * The edits one page declares, computed from the declaration rather than
 * found in the markup.
 *
 * The templates are passed in rather than read here: what a page's mounts are
 * filled with is a filesystem question, and keeping it out of this function is
 * what lets a test state the markup and what lets the same function serve a
 * dev server and a built page.
 *
 * One edit per template, always, and in the order the templates arrive. A
 * template whose artifacts declare a keyed region gets the verifying edit and
 * every other one gets the filling edit — written or carried, and never a mount
 * this list quietly has nothing to say about.
 *
 * The templates are a page's declared mounts AND the children those mounts
 * addressed, in that order, which is why the order they arrive in is load
 * bearing rather than incidental: a child's hole is an element of its parent's
 * markup, so the edit that fills it has nothing to find until the edit that
 * writes the parent has run. `pageTemplates` is where that order is made
 * structural.
 */
export function pageEdits(page: ResolvedPage, templates: PageTemplate[]): HtmlEdit[] {
  const edits: HtmlEdit[] = [];

  if (page.entry !== undefined) {
    edits.push({ kind: 'swap-entry', from: page.entry.from, to: page.entry.to });
  }

  if (page.inlineTemplates) {
    for (const template of templates) {
      const regions = template.regions ?? [];
      if (regions.length === 0) {
        edits.push({ kind: 'inline-template', artifact: template.artifact, html: template.html });
        continue;
      }
      edits.push({
        kind: 'check-template',
        artifact: template.artifact,
        html: template.html,
        regions,
        measured: template.measured ?? [],
        claimed: template.claimed ?? [],
      });
    }
  }

  return edits;
}

/** Whether a page asks for anything only an HTML-capable trigger can perform. */
export function declaresPageFeatures(page: ResolvedPage): boolean {
  return page.entry !== undefined || page.inlineTemplates || page.prerender !== false;
}

/**
 * The honesty guard, at construction time.
 *
 * Serving a rewritten page needs a hook that sees the page. Vite's is the only
 * one that does, and it is the only one that reaches a dev server at all —
 * rewriting built output is a different trigger over this same pure core, and
 * it is not what a page under `pnpm dev` is served from. So a bundler with no
 * such hook and a page that declares rewrites is a build that would come up,
 * serve the classic page, and pass every check the consumer knows to run.
 * Refused here instead, before a file is read.
 */
export function assertPageFeaturesSupported(
  pages: ResolvedPage[],
  framework: string | undefined,
): void {
  if (framework === 'vite') return;

  const declared = pages.filter((page) => declaresPageFeatures(page));
  if (declared.length === 0) return;

  throw new ResumabilityConfigError(
    'PageFeaturesUnsupported',
    `page ${declared.map((page) => JSON.stringify(page.id)).join(', ')} declares HTML rewrites ` +
      `(entry, inlineTemplates or prerender), and the ${framework ?? 'current'} target has no ` +
      'hook that serves a page. Only Vite does, which is why 0.1 automates these there and ' +
      'exposes the rewriter itself for anyone rewriting built output as a post-build step. ' +
      'Drop the page declarations, or run this pass under Vite.',
  );
}

/**
 * One artifact directory's own answer about itself: the markup it emitted, and
 * the three kinds of bytes it declined to write.
 */
export interface EmittedPageTemplate {
  html: string;
  regions?: CarriedRegion[];
  measured?: string[];
  claimed?: CarriedChild[];
}

/**
 * Reads one component's emitted markup out of the artifact directory, and with
 * it whatever that directory says about the bytes the build declined to write.
 * A reader that answers with the markup alone describes a mount the pass fills,
 * which is what every reader written before carried mounts existed was
 * describing.
 *
 * It takes an artifact rather than a mount because a claimed child has no
 * declaration to be a mount of: its address is a hole in another component's
 * template, and reading it is the same read either way.
 */
export type PageTemplateReader = (
  artifactRoot: string,
  ref: { artifact: string },
) => Promise<EmittedPageTemplate>;

/** What the trigger needs from the rest of the package, handed in rather than imported. */
export interface PageHtmlContext {
  /** The options as they stand when a page is served, which is after the bundler resolved its config. */
  options(): ResolvedOptions;
  readTemplate: PageTemplateReader;
}

/**
 * Every template a page's mounts imply: each declared mount, and after it every
 * child that mount ADDRESSED, and after those their own children.
 *
 * ── Parent-first, by construction rather than by sort ─────────────────────
 * There is no comparator here and no ordering key to get backwards. A template
 * is appended by `append`, and `append` pushes the node BEFORE it looks at that
 * node's claimed children — so the only way into the list for a child is
 * through a call its parent makes after the parent is already in it. The
 * distance between a parent and its child in the list varies; which of them
 * comes first does not, because no code path exists that appends a child
 * without its parent already being appended.
 *
 * That is what the fill needs and why it is stated structurally: an edit list
 * is applied in order, a child's hole exists only once its parent's markup is
 * in the document, and a child edit that ran first would find no mount and
 * refuse a page that is perfectly well formed.
 *
 * ── One address, one hole ─────────────────────────────────────────────────
 * An artifact directory is an ADDRESS, and a page addresses each of them once.
 * Two holes carrying the same address is not a page with a component in it
 * twice — it is a page where `[data-resume="x"]` names two elements, which the
 * fill cannot tell apart and the generated group module resolves by taking the
 * first one it finds. So a second claim on an address this page already gives
 * out is a refusal, and refusing it here is also what keeps the ordering above
 * honest: every artifact in the list has exactly ONE parent, so the list is a
 * forest walked parent-first rather than a graph whose second parent could
 * follow its own child.
 */
export async function pageTemplates(
  mounts: readonly { artifact: string }[],
  artifactRoot: string,
  read: PageTemplateReader,
): Promise<PageTemplate[]> {
  const templates: PageTemplate[] = [];
  /** Which hole gave each address out, so a second one can say what it collides with. */
  const addressedBy = new Map<string, string>();

  const append = async (artifact: string, claimedBy: string | undefined): Promise<void> => {
    const owner = addressedBy.get(artifact);
    if (owner !== undefined) {
      throw new HtmlRewriteError(
        'ClaimedChildAddressTaken',
        `this page addresses ${JSON.stringify(artifact)} twice — ${owner} and ` +
          `${sourceOfClaim(claimedBy)} each hold a mount carrying that artifact. An artifact ` +
          'directory is an address, and one page hands each of them out once: two elements ' +
          `carrying ${JSON.stringify(mountSelector(artifact))} cannot be told apart by the fill, ` +
          'and the group module resolves that selector by taking the first element it finds. ' +
          'Filling one of them and leaving the other empty is the page this refusal exists to ' +
          'stop being served.',
      );
    }
    addressedBy.set(artifact, sourceOfClaim(claimedBy));

    const emitted =
      claimedBy === undefined
        ? await read(artifactRoot, { artifact })
        : await readClaimedChild(artifact, claimedBy, artifactRoot, read);

    // The push, and then the children. This line before the loop below is the
    // whole of the parent-first guarantee.
    templates.push({
      artifact,
      html: emitted.html,
      regions: emitted.regions,
      measured: emitted.measured,
      claimed: emitted.claimed,
    });

    for (const child of emitted.claimed ?? []) await append(child.artifact, artifact);
  };

  for (const mount of mounts) await append(mount.artifact, undefined);

  return templates;
}

/** How a claim is named in a refusal: a parent's hole, or the consumer's own declaration. */
function sourceOfClaim(claimedBy: string | undefined): string {
  return claimedBy === undefined
    ? 'the page declaration'
    : `the mount ${JSON.stringify(claimedBy)} addressed`;
}

/**
 * A claimed child's own emitted markup, or a refusal naming which of the two
 * ways it can be absent happened.
 *
 * Neither of them may be a skip, and the reason is one line of the resume path:
 * a mount served empty makes `resumeBundle` throw "has no root element in this
 * container" when the page runs. The compiler already refuses that class at
 * compile time — a child whose template is empty is declined by name rather
 * than addressed — so a hole reaching the wire unfilled means the rewrite stage
 * manufactured a defect the analysis had already ruled out. A build that stops
 * here costs the developer a message; a page that ships costs them the throw,
 * in a browser, with nothing to say which component it was about.
 */
async function readClaimedChild(
  artifact: string,
  parent: string,
  artifactRoot: string,
  read: PageTemplateReader,
): Promise<EmittedPageTemplate> {
  let emitted: EmittedPageTemplate;
  try {
    emitted = await read(artifactRoot, { artifact });
  } catch (error) {
    throw new HtmlRewriteError(
      'ClaimedChildTemplateMissing',
      `the mount of ${JSON.stringify(parent)} holds an addressed child at ` +
        `${JSON.stringify(artifact)}, and that artifact directory has no markup to read: ` +
        `${error instanceof Error ? error.message : String(error)}. The parent's own template ` +
        'carries the hole either way, so serving this page would serve an element the pass ' +
        'stamped with an address and then left blank, and the resumer would meet it as a mount ' +
        'with no root element in it.',
    );
  }

  if (emitted.html.trim() === '') {
    throw new HtmlRewriteError(
      'ClaimedChildTemplateEmpty',
      `the addressed child ${JSON.stringify(artifact)}, held by the mount of ` +
        `${JSON.stringify(parent)}, emitted no markup. Filling a hole with nothing is the same ` +
        'page as never filling it: the mount ships empty and the resumer throws for it at first ' +
        'paint. A child with no template is a child the analysis declines to address, so a build ' +
        'reaching here is one whose artifacts and whose page disagree.',
    );
  }

  return emitted;
}

/** How Vite addresses the page being transformed. Structural: this package depends on no bundler's types. */
export interface PageRequest {
  path?: string;
  filename?: string;
}

/**
 * The page a request is for, or undefined when it is one this pass was told
 * nothing about.
 *
 * Matched on the absolute file first, because that is unambiguous, and on the
 * file name second, because a dev server addresses a page by URL and a build
 * addresses the same page by path. Two declarations that match one request is
 * a refusal: serving one of them would be a coin toss.
 */
export function pageForRequest(
  pages: ResolvedPage[],
  request: PageRequest,
): ResolvedPage | undefined {
  const filename = request.filename?.replace(/\\/g, '/');
  const exact = pages.filter((page) => filename !== undefined && filename === page.htmlPath);
  if (exact.length === 1) return exact[0];

  const path = (request.path ?? filename ?? '').split('?')[0]!.replace(/\\/g, '/');
  if (path === '') return undefined;

  const matched = pages.filter((page) => {
    const name = page.htmlPath.slice(page.htmlPath.lastIndexOf('/') + 1);
    return path === page.htmlPath || path.endsWith(`/${name}`);
  });

  if (matched.length > 1) {
    throw new HtmlRewriteError(
      'PageRequestAmbiguous',
      `the request for ${JSON.stringify(path)} matches ` +
        `${matched.map((page) => JSON.stringify(page.id)).join(', ')}. Two declared pages with ` +
        'the same file name cannot be told apart by the name alone.',
    );
  }

  return matched[0];
}

/**
 * The trigger: Vite's `transformIndexHtml`, and nothing else.
 *
 * `order: 'pre'` so the rewritten entry is the one Vite's own HTML handling
 * sees — a swap that ran afterwards would swap a reference the bundler had
 * already resolved and bundled.
 */
export function pageHtmlPlugin(context: PageHtmlContext): UnpluginOptions {
  return {
    name: 'unplugin-solid-resumability:html',
    enforce: 'pre',
    vite: {
      transformIndexHtml: {
        order: 'pre' as const,
        async handler(html: string, request: PageRequest): Promise<string> {
          const options = context.options();
          const page = pageForRequest(options.pages, request ?? {});
          if (page === undefined) return html;

          // Every mount this page declares, and everything those mounts
          // ADDRESSED: a declaration names the components a consumer asked for,
          // and the artifacts name the ones those components handed a hole to.
          // Both are this page's to serve, and the second kind is nobody's to
          // declare — which is why the list is derived here rather than read
          // off the config.
          const templates = page.inlineTemplates
            ? await pageTemplates(
                options.mounts.filter((mount) => mount.page === page.id),
                options.artifactDir,
                context.readTemplate,
              )
            : [];

          return rewritePageHtml(html, pageEdits(page, templates));
        },
      },
    } as UnpluginOptions['vite'],
  };
}
