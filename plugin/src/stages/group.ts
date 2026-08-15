/**
 * The deferral group of a page, as a module: one chunk, one import, one
 * execution.
 *
 * A page's provable components resume from markup that is already in the
 * document. Everything else on that page — the framework, the store, the
 * components that share it — is one connected component of the shared-source
 * graph, and one connected component is one module. Every static import in the
 * module this stage emits is a byte that is not on the wire until the first
 * interaction asks for it, and there is exactly one import site for it, so the
 * bytes arrive once.
 *
 * ── What the emitted module does ──────────────────────────────────────────
 * Render-and-replace. The served page is a captured first paint that no
 * framework claims; nothing is asked to take it over. The shell is discarded
 * and the same code that produced it runs again at the same state, so the
 * first paint after the swap is the paint that was already there.
 *
 * Two things do not survive a swap on their own, and the emitted module
 * carries both across it:
 *
 *   the resumed mounts   The live elements — served markup, delegated
 *                        listeners, whatever the user has typed into them —
 *                        are detached before the root is cleared and handed to
 *                        the substituted mount points, so the render inserts
 *                        THOSE nodes rather than copies of them.
 *   focus and selection  Properties of the document, not of any node. Recorded
 *                        before the swap and restored after, and emitted only
 *                        when the page asked for them (`carryFocus`).
 *
 * What it does not do is wait. An asynchronous projection is not awaited:
 * awaiting it would render the loaded state at the swap and the swap would
 * become visible.
 *
 * ── Everything here is derived ────────────────────────────────────────────
 * The entry component's module is the substituted module of a mount on this
 * page. The glue is the module that page's substitution already names. The
 * mounts are found by the attribute the inlining stage stamps into them, over
 * the artifact keys the pass emitted. The template glob addresses those same
 * artifact directories from wherever the consumer put this module. Nothing in
 * the emitted text is a name this package knows in advance.
 */

import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'pathe';
import { Analyzer } from 'yuku-analyzer';

import { findComponents } from '../../../src/comptime/discover.ts';
import { RESUME_ATTRIBUTE } from '../html.ts';
import { artifactDir, claimedChildrenIn } from '../node.ts';
import { resolveUnder } from '../options.ts';
import type {
  GroupPolicy,
  ResolvedMount,
  ResolvedOptions,
  ResolvedPage,
  SubstitutionResult,
} from '../types.ts';

/** Every shape this stage declines to generate a module for. */
export type GroupRefusalName =
  | 'GroupNotDeclared'
  | 'GroupEntryModuleMissing'
  | 'GroupEntryComponentMissing'
  | 'GroupEntryComponentNotExported'
  | 'GroupEntryComponentAmbiguous'
  | 'GroupGlueUndeclared'
  | 'ClaimedChildTemplateShipped';

/**
 * A group this stage will not generate.
 *
 * `name` is the refusal's own name rather than the class's, so a caller can
 * branch on which rule fired without matching on prose that may be reworded.
 */
export class GroupGenerationError extends Error {
  readonly page: ResolvedPage;

  constructor(name: GroupRefusalName, message: string, page: ResolvedPage) {
    super(message);
    this.name = name;
    this.page = page;
  }
}

/** One generated group module: what it is, where it goes, and what it reaches. */
export interface GeneratedGroup {
  page: ResolvedPage;
  policy: GroupPolicy;
  /** Absolute path the module is written to. */
  path: string;
  code: string;
  /** Every specifier the module imports, in emitted order. Globs included, as written. */
  imports: string[];
  /** The mounts whose live elements the module claims, in declaration order. */
  claims: ResolvedMount[];
}

export interface GroupStageOptions {
  /** Where the per-page lines go. Defaults to stdout. */
  log?: (line: string) => void;
}

export interface GroupReport {
  groups: GeneratedGroup[];
}

/** The framework call the emitted module renders through, when a page names no other. */
const DEFAULT_RENDER = { module: '@solidjs/web', named: 'render' };

/** The glue names the emitted module calls, when a page names no others. */
const DEFAULT_GLUE = { createMount: 'createMount', offerClaim: 'offerClaim' };

/**
 * Generates and writes the group module of every page that declares one.
 *
 * Runs in the same pass as analyze and substitution, and after them: it reads
 * their results, and the frozen module graph these builds are measured against
 * names generated modules by path, so they have to be real files before module
 * resolution begins.
 */
export function runGroupStage(
  options: ResolvedOptions,
  substitutions: SubstitutionResult[],
  stage: GroupStageOptions = {},
): GroupReport {
  const log = stage.log ?? ((line: string) => console.log(line));
  const groups: GeneratedGroup[] = [];

  for (const page of options.pages) {
    if (page.group === false) continue;

    const group = generateGroupModule(options, page, substitutions);
    mkdirSync(dirname(group.path), { recursive: true });
    writeFileSync(group.path, group.code, 'utf8');
    groups.push(group);

    log(
      `group        ${page.id} (${group.claims.length} resumed mount(s)) -> ` +
        `${relative(options.root, group.path)}`,
    );
  }

  return { groups };
}

/**
 * The generation as a function of the configuration and the substitutions, so
 * a test can run it without writing a file and the build and the tests cannot
 * diverge.
 */
export function generateGroupModule(
  options: ResolvedOptions,
  page: ResolvedPage,
  substitutions: SubstitutionResult[],
): GeneratedGroup {
  const policy = page.group;
  if (policy === false) {
    throw new GroupGenerationError(
      'GroupNotDeclared',
      `page ${JSON.stringify(page.id)} declares no group, so there is no module to generate. A ` +
        'page whose components all resume needs none.',
      page,
    );
  }

  const modulePath = resolveUnder(options.root, policy.moduleId);
  const fromDir = dirname(modulePath);

  const onPage = substitutions.filter((result) => result.mount.page === page.id);
  if (onPage.length === 0) {
    throw new GroupGenerationError(
      'GroupEntryModuleMissing',
      `page ${JSON.stringify(page.id)} declares a group rendering ` +
        `\`${policy.entryComponent}\`, but no mount on this page declares a substitution. The ` +
        'group renders the rewritten module, so a page with nothing rewritten has nothing for ' +
        'its group to render.',
      page,
    );
  }

  const entry = entryModule(page, policy, onPage);
  const claims = onPage.map((result) => result.mount);
  const glue = glueSpecifier(page, policy, onPage, options, fromDir);

  const render = { ...DEFAULT_RENDER, ...policy.render };
  const glueNames = { ...DEFAULT_GLUE, ...policy.glue };
  const carryFocus = policy.carryFocus ?? true;

  assertNoClaimedChildTemplates(options, page, claims);

  const templateGlobs = claims.map((mount) =>
    specifier(fromDir, join(options.artifactDir, mount.artifact, 'template.js')),
  );
  const entrySpecifier = specifier(fromDir, entry.path);

  const imports = [render.module, entrySpecifier, glue, ...templateGlobs];

  const code = emit({
    page,
    policy,
    render,
    glueNames,
    glueSpecifier: glue,
    entrySpecifier,
    templateGlobs,
    claims,
    carryFocus,
    rootSelector: rootSelectorOf(page, policy),
  });

  return { page, policy, path: modulePath, code, imports, claims };
}

/**
 * No mount whose artifacts ADDRESS a child has its template shipped into the
 * group.
 *
 * The reason is one line of the resume path and it is not going to move.
 * `resumeBundle` compares the container's `innerHTML` against the emitted
 * `template.html` EXACTLY, because a resumed mount whose served markup drifted
 * from the emitted markup is a mount whose locators address the wrong nodes.
 * For an addressed parent that comparison cannot ever hold: the parent's
 * template carries an empty element where the child goes, the served container
 * carries that element FILLED with the child's own markup, and a filled hole is
 * not the hole. The bundle would throw at the first interaction on every page
 * that shipped it.
 *
 * So the refusal is here, at the one place this package puts a `template.js` on
 * the wire, rather than as a relaxation of the equality at runtime. The
 * comparison stays exact and the build declines to hand it something it is
 * guaranteed to reject — a build-time refusal with a name, instead of a runtime
 * throw with a stack trace.
 *
 * The reach is exactly this package's own emission. A consumer who globs
 * `template.js` by hand is outside it, and no build-time check can be otherwise:
 * this stage can only refuse the imports it writes.
 */
function assertNoClaimedChildTemplates(
  options: ResolvedOptions,
  page: ResolvedPage,
  claims: ResolvedMount[],
): void {
  for (const mount of claims) {
    const claimed = claimedChildrenIn(artifactDir(options.artifactDir, mount.artifact));
    if (claimed.length === 0) continue;

    throw new GroupGenerationError(
      'ClaimedChildTemplateShipped',
      `page ${JSON.stringify(page.id)} would import the emitted template of ` +
        `${JSON.stringify(mount.artifact)} into its group, and that component ADDRESSES ` +
        `${claimed.length} child(ren) — ` +
        `${claimed.map((child) => JSON.stringify(child.artifact)).join(', ')}. Its template ` +
        'carries an empty element at each of those addresses, and the served mount carries them ' +
        'FILLED with the children\'s own markup. The resume path compares a mount\'s served ' +
        'markup against its emitted template exactly, so a template shipped for an addressed ' +
        'parent is a template the page is guaranteed to reject at the first interaction. Filling ' +
        'the hole is the build\'s job; carrying the template that no longer describes the result ' +
        'is nobody\'s.',
      page,
    );
  }
}

/**
 * The rewritten module the group renders, and the proof that it renders
 * something.
 *
 * Checked against the emitted source rather than assumed: a group whose entry
 * component is not in the module it would import is a page that builds, ships
 * a chunk, and throws at the first interaction.
 */
function entryModule(
  page: ResolvedPage,
  policy: GroupPolicy,
  onPage: SubstitutionResult[],
): SubstitutionResult {
  const carriers = onPage.filter((result) => {
    const site = componentSite(result, policy.entryComponent);
    return site !== null && site.exported;
  });

  if (carriers.length > 1) {
    throw new GroupGenerationError(
      'GroupEntryComponentAmbiguous',
      `${carriers.length} rewritten modules on page ${JSON.stringify(page.id)} export ` +
        `\`${policy.entryComponent}\`. Which one the group renders is not decidable; rename one, ` +
        'or declare the group on the page that owns it.',
      page,
    );
  }

  const carrier = carriers[0];
  if (carrier !== undefined) return carrier;

  // Declared but not exported is its own answer, and a different one: the
  // component is there and the module simply cannot be asked for it.
  const unexported = onPage.find((result) => componentSite(result, policy.entryComponent) !== null);
  if (unexported !== undefined) {
    throw new GroupGenerationError(
      'GroupEntryComponentNotExported',
      `\`${policy.entryComponent}\` is declared in the module rewritten from ` +
        `${unexported.mount.source} but is not exported from it, so the group cannot import it. ` +
        'Export it from the source module.',
      page,
    );
  }

  throw new GroupGenerationError(
    'GroupEntryComponentMissing',
    `no rewritten module on page ${JSON.stringify(page.id)} declares a component named ` +
      `\`${policy.entryComponent}\`. The rewritten modules on this page are ` +
      `${onPage.map((result) => JSON.stringify(result.mount.source)).join(', ')}. ` +
      '`entryComponent` is the component the group renders, and it has to be one of theirs.',
    page,
  );
}

/**
 * One component of the rewritten module, read off its own source.
 *
 * A single-module analyzer is enough: whether a module declares a component
 * and exports it is a question about that module, and linking it to the rest
 * of the corpus would answer nothing this asks.
 */
function componentSite(result: SubstitutionResult, component: string) {
  const analyzer = new Analyzer();
  const moduleInfo = analyzer.addFile(result.path, result.code);
  analyzer.link();
  return findComponents(moduleInfo).find((site) => site.name === component) ?? null;
}

/**
 * The module the emitted code calls for its mount glue.
 *
 * Defaulted from the substitution's own claim module, because the glue that
 * hands a resumed element to a substituted mount point and the glue that
 * offers it are two halves of one protocol and live together in every project
 * that has written it once.
 */
function glueSpecifier(
  page: ResolvedPage,
  policy: GroupPolicy,
  onPage: SubstitutionResult[],
  options: ResolvedOptions,
  fromDir: string,
): string {
  const declared = policy.glue?.module;
  if (declared !== undefined) {
    const target = resolveUnder(options.root, declared);
    return existsAsFile(target) ? specifier(fromDir, target) : declared;
  }

  const inherited = onPage.find((result) => result.mount.substitute?.modulePath !== undefined);
  if (inherited !== undefined) {
    return specifier(fromDir, inherited.mount.substitute!.modulePath!);
  }

  // A bare specifier the substitution passed through has no path to re-root
  // from, so it is emitted as the consumer wrote it.
  const bare = onPage.find((result) => result.mount.substitute !== undefined);
  if (bare !== undefined) return bare.mount.substitute!.specifier;

  throw new GroupGenerationError(
    'GroupGlueUndeclared',
    `page ${JSON.stringify(page.id)} declares a group, but no module on it names the glue the ` +
      'group calls to build a mount from a template and to offer a live one to its substituted ' +
      'mount point. Declare `group.glue.module`.',
    page,
  );
}

/**
 * A declared glue module that resolves to a file is re-rooted to the emitted
 * module's directory; anything else is a bare specifier, somebody else's
 * resolution, and is emitted exactly as written.
 */
function existsAsFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile();
}

/**
 * How the emitted `execute` finds the element it renders into when its caller
 * names none: the page's own root selector, which the capture policy already
 * states when there is one.
 */
function rootSelectorOf(page: ResolvedPage, policy: GroupPolicy): string | undefined {
  if (policy.rootSelector !== undefined) return policy.rootSelector;
  if (page.prerender !== false) return page.prerender.rootSelector;
  return undefined;
}

/**
 * A string literal for the emitted module, in the delimiter that leaves it
 * readable: double quotes, unless the text carries them and no single quote of
 * its own — a selector escaped into `\"` is a selector nobody wants to read.
 */
function quote(text: string): string {
  if (text.includes('"') && !text.includes("'")) return `'${text}'`;
  return JSON.stringify(text);
}

/** A relative specifier from the emitted module's directory, posix-shaped and explicitly relative. */
function specifier(fromDir: string, target: string): string {
  const path = relative(fromDir, target);
  return path.startsWith('.') ? path : `./${path}`;
}

interface EmitInput {
  page: ResolvedPage;
  policy: GroupPolicy;
  render: { module: string; named: string };
  glueNames: { createMount: string; offerClaim: string };
  glueSpecifier: string;
  entrySpecifier: string;
  templateGlobs: string[];
  claims: ResolvedMount[];
  carryFocus: boolean;
  rootSelector: string | undefined;
}

/**
 * The module text.
 *
 * Written as one template rather than assembled from fragments: what this
 * emits is code a person will read in a stack trace and in a diff of their own
 * repository, and code that reads as though someone wrote it is code they can
 * follow when it is the thing that broke.
 *
 * ── One mount is its own shape ────────────────────────────────────────────
 * A page with a single resumed mount gets the module a person would have
 * written for that page: the selector at the one site that queries it, the one
 * element in a `const`, no keyed table and no loop over a list of one. The
 * table and the loop are what N mounts need, and a consumer with one mount
 * should not carry the generality that serves the other case — this module is
 * shipped code, and every line of it is bytes behind the first interaction.
 *
 * The two shapes are the same protocol, in the same order, reaching the same
 * modules: claim the served element (or build it from its template artifact
 * when the capture is what is running), save the caret, detach before the root
 * is cleared, offer, render, restore.
 */
function emit(input: EmitInput): string {
  const { render, glueNames, claims, carryFocus } = input;
  const globs = input.templateGlobs.map((glob) => JSON.stringify(glob)).join(', ');
  const only = claims.length === 1 ? claims[0]! : undefined;

  const claimRows = claims
    .map(
      (mount) =>
        `  { artifact: ${JSON.stringify(mount.artifact)}, ` +
        `selector: ${quote(`[${RESUME_ATTRIBUTE}="${mount.artifact}"]`)} },`,
    )
    .join('\n');

  const rootDefault =
    input.rootSelector === undefined
      ? ''
      : ` = document.querySelector<HTMLElement>(${JSON.stringify(input.rootSelector)})!`;

  const focusDeclarations = carryFocus
    ? `
interface SavedFocus {
  element: HTMLElement;
  start: number | null;
  end: number | null;
}

/** The caret, read while the node is still the focused one. */
function saveFocus(claimed: ${only === undefined ? 'HTMLElement[]' : 'HTMLElement'}): SavedFocus | null {
  const active = document.activeElement as HTMLElement | null;
  if (!active || !${
    only === undefined
      ? 'claimed.some((element) => element.contains(active))'
      : 'claimed.contains(active)'
  }) return null;

  const field = active as Partial<HTMLInputElement>;
  if (typeof field.setSelectionRange !== "function") return { element: active, start: null, end: null };
  try {
    return { element: active, start: field.selectionStart ?? null, end: field.selectionEnd ?? null };
  } catch {
    // Selection is not readable on every input type, and losing it is not a
    // reason to lose the focus as well.
    return { element: active, start: null, end: null };
  }
}

function restoreFocus(saved: SavedFocus | null): void {
  if (!saved || !saved.element.isConnected) return;
  saved.element.focus();
  if (saved.start === null) return;
  const field = saved.element as Partial<HTMLInputElement>;
  try {
    field.setSelectionRange?.(saved.start, saved.end ?? saved.start);
  } catch {
    // Same as above: a restored focus without a restored caret is still the
    // better of the two outcomes.
  }
}
`
    : '';

  const saveCall = carryFocus ? '  const focus = saveFocus(claimed);\n\n' : '';
  const restoreCall = carryFocus ? '\n  restoreFocus(focus);\n' : '\n';

  const templatesDoc =
    only === undefined
      ? `/**
 * The template artifacts of this page's resumed mounts, eager *in this chunk*
 * and nowhere else.`
      : `/**
 * The template artifact of this page's resumed mount, eager *in this chunk*
 * and nowhere else.`;

  const lookup =
    only === undefined
      ? `
function templateHtml(artifact: string): string {
  const suffix = \`/\${artifact}/template.js\`;
  for (const [path, module] of Object.entries(TEMPLATES)) {
    if (path.endsWith(suffix)) return module.html;
  }
  throw new Error(\`resume: this build emitted no template artifact for \${artifact}\`);
}
`
      : `
/**
 * The one artifact the glob above names.
 *
 * One mount is one template, so there is no key to look anything up by: the
 * glob's single entry is the answer.
 */
function templateHtml(): string {
  const template = Object.values(TEMPLATES).at(0);
  if (template === undefined) {
    throw new Error(${JSON.stringify(
      `resume: this build emitted no template artifact for ${only.artifact}`,
    )});
  }
  return template.html;
}
`;

  const claimTable =
    only === undefined
      ? `
/** Every mount this page resumed: the artifact it carries, and how it is found in the served markup. */
const CLAIMED = [
${claimRows}
] as const;
`
      : '';

  const swap =
    only === undefined
      ? `  // The served mounts, or — for the capture that produces the served page —
  // the template artifacts the capture is about to prove are in it.
  const claimed = CLAIMED.map(
    (mount) =>
      root.querySelector<HTMLElement>(mount.selector) ?? ${glueNames.createMount}(templateHtml(mount.artifact)),
  );

${saveCall}  // Detached first, so clearing the root cannot take them: these elements are
  // what the new tree is required to reuse.
  for (const element of claimed) element.remove();
  root.replaceChildren();
  for (const element of claimed) ${glueNames.offerClaim}(element);
`
      : `  // The served mount, or — for the capture that produces the served page —
  // the template artifact the capture is about to prove is in it.
  const claimed =
    root.querySelector<HTMLElement>(${quote(`[${RESUME_ATTRIBUTE}="${only.artifact}"]`)}) ??
    ${glueNames.createMount}(templateHtml());

${saveCall}  // Detached first, so clearing the root cannot take it: this element is what
  // the new tree is required to reuse.
  claimed.remove();
  root.replaceChildren();
  ${glueNames.offerClaim}(claimed);
`;

  return `${banner(input)}
import { ${render.named} } from ${JSON.stringify(render.module)};

import { ${input.policy.entryComponent} } from ${JSON.stringify(input.entrySpecifier)};
import { ${glueNames.createMount}, ${glueNames.offerClaim} } from ${JSON.stringify(input.glueSpecifier)};

${templatesDoc}
 *
 * The shipped page never reaches this glob: it finds the markup in the
 * document, where the build inlined it. The build-time capture is the one
 * caller — it runs this module against a document that has no shell in it yet,
 * because producing the shell is what the run is for.
 */
const TEMPLATES = import.meta.glob<{ html: string; root: string }>([${globs}], {
  eager: true,
});
${claimTable}${lookup}${focusDeclarations}
/**
 * Renders the group into \`root\`, claiming ${only === undefined ? 'each' : 'the'} resumed element.
 *
 * Called once per page — the loader that imports this module holds the single
 * promise that guarantees it. Returns the render's disposer, which is what a
 * test (and the build-time capture) uses to tear the page down again.
 */
export function execute(root: HTMLElement${rootDefault}): () => void {
${swap}
  const dispose = ${render.named}(${input.policy.entryComponent} as never, root);
${restoreCall}  return dispose;
}
`;
}

/** Provenance, and what the module is for, in the words the page's own configuration gives it. */
function banner(input: EmitInput): string {
  const names = input.claims.map((mount) => mount.artifact).join(', ');
  return (
    `// Generated by unplugin-solid-resumability for page ${JSON.stringify(input.page.id)}. Do not edit.\n` +
    '//\n' +
    '// The deferral group of this page: one chunk, one import, one execution.\n' +
    '// Every static import below is a byte that is not on the wire until the\n' +
    '// first interaction asks for it.\n' +
    '//\n' +
    `// What execution does is render-and-replace: ${names} — served markup,\n` +
    '// delegated listeners, whatever the user has typed in — is detached before\n' +
    `// the root is cleared and handed to \`${input.policy.entryComponent}\`'s substituted mount point, so\n` +
    '// the render inserts those same nodes rather than copies of them.\n'
  );
}
