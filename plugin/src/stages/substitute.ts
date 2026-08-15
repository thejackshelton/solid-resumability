/**
 * Substitution: the module a resumability compiler emits for a page.
 *
 * A component the pass proved does not need to ship. The rewritten module
 * carries the corpus module with its proven component's body gone and its
 * mount point replaced by an expression that publishes the live store and
 * claims the element already carrying the resumed component. Every other
 * component in the module is copied through byte for byte and still renders
 * the ordinary way.
 *
 * Three edits, all of them read off the analysis rather than found in the text:
 *
 *   1. REMOVAL. `ComponentSite.fn` is the function node; the top-level
 *      statement carrying it is the span that goes. Not stubbed, not renamed,
 *      not left for a minifier to maybe drop — the claim is that the component
 *      never runs, and the strongest form of that claim is that its body is not
 *      in the module.
 *
 *   2. THE MOUNT POINT. The unique `<Component />` element inside another
 *      component's returned markup becomes `{claim(useContext(Ctx))}` — an
 *      expression, not a component, because a substituted component would
 *      itself be a function the page executes. The argument is the component's
 *      own context read, reprinted from its own AST and evaluated at the same
 *      point in the same owner tree: that is what lets the page reach the LIVE
 *      store without one byte of the source module changing.
 *
 *   3. IMPORT RE-ROOTING. The rewritten module sits in the generated directory,
 *      so every relative specifier is recomputed from there to the file it
 *      already named. Bare specifiers are left alone.
 *
 * Everything this stage will not do, it refuses by name. A substituter that
 * guessed would emit a page that looks right and resumes the wrong element.
 */

import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'pathe';

import { contains, printExpression, unwrap, type Node } from '../../../src/comptime/ast.ts';
import { findComponents, type ComponentSite } from '../../../src/comptime/discover.ts';
import { loadProject } from '../../../src/comptime/project.ts';
import { useContextCalls } from '../../../src/comptime/stores.ts';
import type { Analysis, ProvableAnalysis } from '../../../src/comptime/types.ts';
import type {
  ResolvedMount,
  ResolvedOptions,
  SubstitutionEdit,
  SubstitutionResult,
} from '../types.ts';
import type { MountOutcome } from './analyze.ts';

/** Every shape this stage declines to rewrite. */
export type SubstitutionRefusalName =
  | 'SubstitutionNotDeclared'
  | 'ComponentNotDeclared'
  | 'ComponentNotModuleLocal'
  | 'UnprovableSubstitution'
  | 'MountSiteMissing'
  | 'MultipleMountSites'
  | 'MountElementNotBare'
  | 'ContextBindingUnreachable'
  | 'ComponentSurvivedRemoval';

/**
 * A module this stage will not rewrite.
 *
 * `name` is the refusal's own name rather than the class's, so a caller can
 * branch on which rule fired without matching on prose that may be reworded.
 */
export class SubstitutionError extends Error {
  readonly mount: ResolvedMount;

  constructor(name: SubstitutionRefusalName, message: string, mount: ResolvedMount) {
    super(message);
    this.name = name;
    this.mount = mount;
  }
}

export interface SubstituteStageOptions {
  /** Where the per-module lines go. Defaults to stdout. */
  log?: (line: string) => void;
}

export interface SubstituteReport {
  results: SubstitutionResult[];
}

/**
 * Rewrites every mount that declared a substitution and writes each result.
 *
 * Runs in the same pass as analyze and directly after it, because it consumes
 * that pass's verdicts and because the generated modules have to be real files
 * before module resolution begins.
 */
export function runSubstituteStage(
  options: ResolvedOptions,
  outcomes: MountOutcome[],
  stage: SubstituteStageOptions = {},
): SubstituteReport {
  const log = stage.log ?? ((line: string) => console.log(line));
  const results: SubstitutionResult[] = [];

  for (const outcome of outcomes) {
    if (outcome.mount.substitute === undefined) continue;

    const result = substituteModule(options, outcome.mount, outcome.analysis);
    mkdirSync(dirname(result.path), { recursive: true });
    writeFileSync(result.path, result.code, 'utf8');
    results.push(result);

    log(
      `substituted  ${outcome.mount.source} (${outcome.mount.component}) -> ` +
        `${relative(options.root, result.path)}`,
    );
  }

  return { results };
}

/**
 * The rewrite as a function of the source, so a test can run it without a
 * filesystem and the build and the tests cannot diverge.
 */
export function substituteModule(
  options: ResolvedOptions,
  mount: ResolvedMount,
  analysis: Analysis,
): SubstitutionResult {
  const substitution = mount.substitute;
  if (substitution === undefined) {
    throw new SubstitutionError(
      'SubstitutionNotDeclared',
      `mount ${JSON.stringify(mount.component)} has no \`substitute\` declaration, so there is ` +
        'nowhere to write a rewritten module and no glue to claim it with.',
      mount,
    );
  }

  const source = readFileSync(mount.sourcePath, 'utf8');
  const outPath = substitution.outPath;

  let edits: SubstitutionEdit[] = [];
  let refusal: SubstitutionError | undefined;
  try {
    edits = planEdits(options, mount, analysis, source, outPath);
  } catch (error) {
    // The escape hatch exists for exactly the shapes the analysis refuses, so
    // a refusal is what the consumer's transform is handed rather than what it
    // is denied the chance to answer.
    if (!(error instanceof SubstitutionError) || options.substitute.transform === undefined) throw error;
    refusal = error;
  }

  const transform = options.substitute.transform;
  if (transform !== undefined) {
    const code = transform({ source, path: mount.sourcePath, mount, outPath, analysis, edits, refusal });
    return { mount, path: outPath, code, edits, transformed: true };
  }

  const body = applyEdits(source, edits);
  survives(body, mount);

  const banner = substitution.banner ?? defaultBanner(mount);
  const claim = `import { ${substitution.helper} } from ${JSON.stringify(substitution.specifier)};`;
  const code = `${endsWithNewline(banner)}\n${claim}\n${body}`;

  return { mount, path: outPath, code, edits, transformed: false };
}

/**
 * The three edits, in source order. Computing them all before applying any is
 * what lets a consumer's transform see the whole rewrite rather than a
 * half-rewritten string.
 */
function planEdits(
  options: ResolvedOptions,
  mount: ResolvedMount,
  analysis: Analysis,
  source: string,
  outPath: string,
): SubstitutionEdit[] {
  const project = loadProject(mount.sourcePath, options.corpusRoot);
  const moduleInfo = project.entry;
  const sites = findComponents(moduleInfo);
  const site = sites.find((candidate) => candidate.name === mount.component) ?? null;

  const elements = mountElements(moduleInfo, mount.component);

  if (site === null) {
    // A component mounted here but declared elsewhere would need two modules
    // rewritten at once. Declined rather than half-supported.
    if (elements.length > 0) {
      throw new SubstitutionError(
        'ComponentNotModuleLocal',
        `${mount.source} mounts \`${mount.component}\` but does not declare it. Substitution ` +
          'rewrites one module: the component and its mount point have to live in the same ' +
          'file. Declare the mount against the module that owns the component, or supply ' +
          '`substitute.transform`.',
        mount,
      );
    }
    throw new SubstitutionError(
      'ComponentNotDeclared',
      `${mount.source} declares no module-scope component named \`${mount.component}\`. Found: ` +
        `${sites.map((candidate) => candidate.name).join(', ') || '(none)'}.`,
      mount,
    );
  }

  if (analysis.status !== 'provable') {
    throw new SubstitutionError(
      'UnprovableSubstitution',
      `\`${mount.component}\` in ${mount.source} classified fallback, so there are no artifacts ` +
        `to substitute to: ${analysis.reasons.map((reason) => reason.code).join(', ') || '(no reason given)'}. ` +
        'A component that still has to run is one this stage leaves alone.',
      mount,
    );
  }

  const element = uniqueMountElement(elements, site, sites, mount);

  const edits: SubstitutionEdit[] = [
    ...rerootedImports(moduleInfo, source, mount.sourcePath, outPath),
    removal(moduleInfo, site, source),
    {
      kind: 'replace-mount',
      start: element.start,
      end: element.end,
      text: claimExpression(moduleInfo, site, analysis, mount),
      note: `the mount point of \`${mount.component}\` claims its resumed element`,
    },
  ];

  return edits.sort((left, right) => left.start - right.start);
}

/** Every `<Component …>` element in the module, mount point or not. */
function mountElements(moduleInfo: { findAll(type: string): Node[] }, component: string): Node[] {
  return moduleInfo.findAll('JSXElement').filter((element: Node) => {
    const name = element.openingElement?.name;
    return name != null && name.type === 'JSXIdentifier' && name.name === component;
  });
}

/**
 * The one mount point, or a refusal.
 *
 * Uniqueness is the whole check: one set of artifacts describes one element,
 * so a component mounted twice has no single element the claim could take, and
 * taking the first would resume one of them and leave the other empty.
 */
function uniqueMountElement(
  elements: Node[],
  site: ComponentSite,
  sites: ComponentSite[],
  mount: ResolvedMount,
): Node {
  // A component that mounts itself is recursion, not a mount point.
  const outside = elements.filter((element) => !contains(site.fn, element));

  if (outside.length > 1) {
    throw new SubstitutionError(
      'MultipleMountSites',
      `${mount.source} mounts \`${mount.component}\` ${outside.length} times. One set of ` +
        'artifacts describes one element, so which of them the claim would take is not ' +
        'decidable. Mount it once, or supply `substitute.transform`.',
      mount,
    );
  }

  const element = outside[0];
  const parent =
    element === undefined
      ? undefined
      : sites.find((candidate) => candidate !== site && contains(candidate.returnArgument, element));

  if (element === undefined || parent === undefined) {
    throw new SubstitutionError(
      'MountSiteMissing',
      `${mount.source} declares \`${mount.component}\` but no other component in it returns a ` +
        '`<' + mount.component + ' />` element. There is nothing to replace, and removing the ' +
        'component alone would drop it from the page.',
      mount,
    );
  }

  const attributes = (element.openingElement?.attributes as Node[] | undefined) ?? [];
  const children = (element.children as Node[] | undefined) ?? [];
  if (attributes.length > 0 || children.length > 0) {
    throw new SubstitutionError(
      'MountElementNotBare',
      `the mount point of \`${mount.component}\` in ${mount.source} carries ` +
        `${attributes.length} prop(s) and ${children.length} child node(s). The artifacts model ` +
        'neither, so a resumed element cannot receive them. Move what it needs into the store, ' +
        'or supply `substitute.transform`.',
      mount,
    );
  }

  return element;
}

/**
 * The expression the mount point becomes.
 *
 * The argument is not invented: it is the component's own `useContext` call,
 * reprinted from the AST the pass already proved. The local name has to be the
 * name the analysis knows the context by, because that is the name the claim
 * is written with — an alias is a refusal rather than a guess.
 */
function claimExpression(
  moduleInfo: Node,
  site: ComponentSite,
  analysis: ProvableAnalysis,
  mount: ResolvedMount,
): string {
  const calls = useContextCalls(moduleInfo, site.fn);
  const args: string[] = [];

  for (const store of analysis.stores) {
    const call = calls.find((candidate: Node) => {
      const argument = unwrap(candidate.arguments[0]);
      return argument != null && argument.type === 'Identifier' && argument.name === store.context;
    });

    if (call === undefined) {
      const named = calls
        .map((candidate: Node) => unwrap(candidate.arguments[0])?.name)
        .filter((name: unknown) => typeof name === 'string');
      throw new SubstitutionError(
        'ContextBindingUnreachable',
        `\`${mount.component}\` reads the context \`${store.context}\` declared in ` +
          `${store.contextModule}, but ${mount.source} has no binding of that name — it reads ` +
          `${named.map((name: string) => `\`${name}\``).join(', ') || '(nothing)'} instead. The ` +
          'claim is written with the name the analysis knows, so import the context under its ' +
          'own name, or supply `substitute.transform`.',
        mount,
      );
    }

    args.push(printExpression(call));
  }

  return `{${mount.substitute!.helper}(${args.join(', ')})}`;
}

/**
 * The removal span: the whole top-level statement, so an exported component
 * does not leave its `export` behind.
 *
 * The blank lines either side collapse into one, which is what the module
 * would have looked like had the component never been written there.
 */
function removal(moduleInfo: Node, site: ComponentSite, source: string): SubstitutionEdit {
  const statement =
    (moduleInfo.ast.body as Node[]).find((candidate: Node) => contains(candidate, site.fn)) ?? site.fn;

  let start = statement.start;
  let end = statement.end;
  while (start > 0 && source.charCodeAt(start - 1) === 10) start -= 1;
  while (end < source.length && source.charCodeAt(end) === 10) end += 1;

  let text = '\n\n';
  if (start === 0) text = '';
  else if (end >= source.length) text = '\n';

  return { kind: 'remove-component', start, end, text, note: `\`${site.name}\` is not in the module` };
}

/**
 * Every relative specifier, recomputed from the generated directory to the
 * file it already named. Bare specifiers are somebody else's resolution and
 * are left exactly as written.
 */
function rerootedImports(
  moduleInfo: Node,
  source: string,
  sourcePath: string,
  outPath: string,
): SubstitutionEdit[] {
  const fromDir = dirname(outPath);
  const edits: SubstitutionEdit[] = [];

  for (const statement of moduleInfo.ast.body as Node[]) {
    const specifier = statement?.source;
    if (specifier == null || typeof specifier.value !== 'string') continue;
    if (!specifier.value.startsWith('.')) continue;

    const target = resolve(dirname(sourcePath), specifier.value);
    let rerooted = relative(fromDir, target);
    if (!rerooted.startsWith('.')) rerooted = `./${rerooted}`;

    // The delimiter is the author's, not this stage's.
    const quote = source[specifier.start] ?? '"';
    edits.push({
      kind: 'reroot-import',
      start: specifier.start,
      end: specifier.end,
      text: `${quote}${rerooted}${quote}`,
      note: `${specifier.value} is reached from the generated directory`,
    });
  }

  return edits;
}

/** Splices the edits into the source, last first so earlier spans stay valid. */
function applyEdits(source: string, edits: SubstitutionEdit[]): string {
  let out = source;
  for (const edit of [...edits].sort((left, right) => right.start - left.start)) {
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  }
  return out;
}

/**
 * The claim this stage makes, checked against what it emitted: the component's
 * name does not occur in the rewritten code at all. Prose is not code, so the
 * consumer's banner is not part of what is checked.
 */
function survives(body: string, mount: ResolvedMount): void {
  const token = new RegExp(`\\b${mount.component.replace(/[^\w$]/g, '\\$&')}\\b`);
  if (!token.test(body)) return;

  throw new SubstitutionError(
    'ComponentSurvivedRemoval',
    `\`${mount.component}\` still occurs in the module rewritten from ${mount.source}. The ` +
      'removal cut a span that was not the whole component, or something else in the file ' +
      'names it.',
    mount,
  );
}

/** Provenance, and what the one edit was. Replaced wholesale by `substitute.banner`. */
function defaultBanner(mount: ResolvedMount): string {
  return (
    `// Generated by unplugin-solid-resumability from ${mount.source}. Do not edit.\n` +
    '//\n' +
    `// The module with ONE edit a resumability compiler would make: the mount\n` +
    `// point of \`${mount.component}\` — a component this pass proves — no longer renders a\n` +
    '// component. It publishes the live store and claims the element already\n' +
    `// carrying the resumed component, and \`${mount.component}\`'s body is not in this file\n` +
    '// at all. Every other component here is the source module, unchanged.\n'
  );
}

function endsWithNewline(text: string): string {
  return text.endsWith('\n') ? text : `${text}\n`;
}
