/**
 * The decisive test of this half of the slice: the generated group module
 * reaches exactly the modules the hand-written one reaches.
 *
 * Not "looks similar" — the same import graph, module for module, resolved to
 * files on disk and listed explicitly below. That is the property worth
 * pinning, because the module graph of the deferred chunk is what the frozen
 * group anatomy is stated in: six application modules, no more and no fewer.
 * Prose and phrasing may differ from the module a person wrote by hand; a
 * seventh import may not.
 *
 * The compile check is the other half. A generated module nobody type-checks
 * is a generated module that breaks a consumer's build with a stack trace
 * pointing at a file they did not write, so the emission is written out and
 * run through `tsc` against the real corpus it addresses — the real rewritten
 * module, the real glue, the real framework types.
 *
 * Generality is then proven from the other direction, because a graph match
 * with one application would also be satisfied by hardcoding that
 * application. The synthetic case renders a different component from a
 * different corpus at a different depth, calls glue of another name, and
 * renders through a framework specifier of its own.
 *
 * The third property is that generality is not billed to the consumer who does
 * not use it. A page with one resumed mount gets the module a person would
 * have written for one mount — no keyed table, no lookup by key, no loop over
 * a list of one — and a page with two gets all three, because two is where
 * they start deciding something. Both are asserted here, on the same emitter.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, relative, resolve } from 'pathe';
import { describe, expect, it } from 'vitest';

import { analyzeFixture } from '../../src/comptime/index.ts';
import { resolveOptions } from '../src/options.ts';
import { generateGroupModule, GroupGenerationError, runGroupStage } from '../src/stages/group.ts';
import { substituteModule } from '../src/stages/substitute.ts';
import type { ResolvedOptions, ResumabilityOptions, SubstitutionResult } from '../src/types.ts';

const PLUGIN_ROOT = resolve(import.meta.dirname, '..');
const REPO_ROOT = resolve(PLUGIN_ROOT, '..');
const VERIFY_OUT = join(PLUGIN_ROOT, '.verify-out/group');

/** The module this stage generalizes, and the graph it is measured against. */
const HAND_WRITTEN = join(REPO_ROOT, 'demo/src/todos-group.ts');

/**
 * The demo's own configuration, as a consumer would write it.
 *
 * Every value here is a declaration: where the rewritten module goes, which
 * component the group renders, where the group module lands. Nothing about the
 * application is known to the stage that reads it.
 */
function demoOptions(moduleId: string, overrides: Partial<ResumabilityOptions> = {}): ResolvedOptions {
  return resolveOptions({
    root: REPO_ROOT,
    artifactDir: 'demo/artifacts',
    generatedDir: 'demo/src/generated',
    mounts: [
      {
        component: 'Header',
        source: 'app/src/app.tsx',
        page: 'page',
        substitute: {
          out: 'app.resumable.tsx',
          claim: { module: 'demo/src/todos-resume.ts' },
        },
      },
    ],
    pages: [
      {
        id: 'page',
        html: 'demo/todos.html',
        prerender: { rootSelector: '#root' },
        group: { moduleId, entryComponent: 'App' },
      },
    ],
    ...overrides,
  });
}

/** The rewritten module the group renders, computed and never written: the demo tree is read-only here. */
function demoSubstitution(options: ResolvedOptions): SubstitutionResult {
  const mount = options.mounts[0]!;
  const analysis = analyzeFixture(mount.sourcePath, {
    root: options.corpusRoot,
    component: mount.component,
  });
  return substituteModule(options, mount, analysis);
}

/** Asserts the stage refused, and refused under the name the caller expected. */
function refusalFrom(run: () => unknown): GroupGenerationError {
  let thrown: unknown;
  try {
    run();
  } catch (error) {
    thrown = error;
  }
  expect(thrown, 'expected a refusal, got none').toBeInstanceOf(GroupGenerationError);
  return thrown as GroupGenerationError;
}

/**
 * Every module a source reaches: its static imports, plus the files each eager
 * glob expands to.
 *
 * A glob is an import graph stated as a pattern, so comparing patterns would
 * compare spellings. These are resolved to absolute files, which is what the
 * bundler puts in the chunk and what the frozen anatomy counts.
 */
function importedModules(source: string, fromDir: string): string[] {
  const specifiers = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((hit) => hit[1]!);

  for (const call of source.matchAll(/import\.meta\.glob[^(]*\(([\s\S]*?)\{/g)) {
    for (const literal of call[1]!.matchAll(/["']([^"']+)["']/g)) specifiers.push(literal[1]!);
  }

  const reached = new Set<string>();
  for (const specifier of specifiers) {
    if (!specifier.startsWith('.')) {
      reached.add(specifier);
      continue;
    }
    for (const file of expandGlob(resolve(fromDir, specifier))) reached.add(file);
  }

  return [...reached].sort();
}

/** The files one absolute pattern names. A pattern without a wildcard names one file. */
function expandGlob(pattern: string): string[] {
  if (!pattern.includes('*')) {
    expect(existsSync(pattern), `${pattern} is imported but is not on disk`).toBe(true);
    return [pattern];
  }

  const base = dirname(pattern.slice(0, pattern.indexOf('*')));
  const matcher = new RegExp(
    `^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')}$`,
  );

  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (matcher.test(path)) found.push(path);
    }
  };
  walk(base);
  return found.sort();
}

describe('the group module a person wrote by hand, generated from the declaration', () => {
  const options = demoOptions('demo/src/todos-group.ts');
  const group = generateGroupModule(options, options.pages[0]!, [demoSubstitution(options)]);

  const reference = readFileSync(HAND_WRITTEN, 'utf8');

  it('lands where the declaration put it, and writes nothing on its own', () => {
    expect(group.path).toBe(HAND_WRITTEN);
    // Generation is a function; only the stage writes. The reference side of
    // this comparison has to be the file it always was.
    expect(readFileSync(HAND_WRITTEN, 'utf8')).toBe(reference);
  });

  it('emits the specifiers this test states, and no others', () => {
    expect(group.imports).toEqual([
      '@solidjs/web',
      './generated/app.resumable.tsx',
      './todos-resume.ts',
      '../artifacts/app.Header/template.js',
    ]);
  });

  it('reaches the same modules the hand-written group reaches, module for module', () => {
    const generated = importedModules(group.code, dirname(group.path));
    const written = importedModules(reference, dirname(HAND_WRITTEN));

    expect(generated).toEqual(written);
    expect(generated).toEqual([
      join(REPO_ROOT, 'demo/artifacts/app.Header/template.js'),
      join(REPO_ROOT, 'demo/src/generated/app.resumable.tsx'),
      join(REPO_ROOT, 'demo/src/todos-resume.ts'),
      '@solidjs/web',
    ]);
  });

  it('claims the page mount by the attribute the inlining stage stamps into it', () => {
    expect(group.claims.map((mount) => mount.artifact)).toEqual(['app.Header']);
    expect(group.code).toContain(
      'root.querySelector<HTMLElement>(\'[data-resume="app.Header"]\') ??',
    );
    expect(group.code).toContain('createMount(templateHtml());');
  });

  it('carries none of the N-mount machinery for a page that resumes one mount', () => {
    // The regression this pins: generality that costs the single-mount
    // consumer bytes. One mount is one element — a keyed table, a lookup by
    // key and a loop over a list of one are all shipped behind the first
    // interaction, and none of them decides anything here.
    expect(group.code).not.toContain('CLAIMED');
    expect(group.code).not.toContain('.map(');
    expect(group.code).not.toContain('for (const element of claimed)');
    expect(group.code).not.toContain('Object.entries(TEMPLATES)');
    expect(group.code).toContain('function saveFocus(claimed: HTMLElement): SavedFocus | null {');
    expect(group.code).toContain('function templateHtml(): string {');
  });

  it('renders the entry component the page declared, and carries focus by default', () => {
    expect(group.code).toContain('const dispose = render(App as never, root);');
    expect(group.code).toContain('const focus = saveFocus(claimed);');
    expect(group.code).toContain('restoreFocus(focus);');
  });

  it('detaches the claimed elements before it clears the root', () => {
    const detach = group.code.indexOf('claimed.remove();');
    const clear = group.code.indexOf('root.replaceChildren();');
    const offer = group.code.indexOf('offerClaim(claimed);');
    const render = group.code.indexOf('const dispose = render(');

    expect(detach).toBeGreaterThan(-1);
    expect(detach).toBeLessThan(clear);
    expect(clear).toBeLessThan(offer);
    expect(offer).toBeLessThan(render);
  });

  it('takes its default root from the capture policy the page already states', () => {
    expect(group.code).toContain(
      'export function execute(root: HTMLElement = document.querySelector<HTMLElement>("#root")!)',
    );
  });

  it('is deterministic: a second generation is the same bytes', () => {
    const again = generateGroupModule(options, options.pages[0]!, [demoSubstitution(options)]);
    expect(again.code).toBe(group.code);
  });
});

describe('the generated module compiles against the corpus it addresses', () => {
  // Written beside the plugin rather than into the application, because the
  // application tree is read-only here — the specifiers are re-rooted from
  // wherever the module sits, so the same emission type-checks from anywhere
  // and this is the one place this test is allowed to put a file.
  const moduleId = 'plugin/.verify-out/group/emitted-group.ts';
  const options = demoOptions(moduleId);
  const group = generateGroupModule(options, options.pages[0]!, [demoSubstitution(options)]);

  const tsconfig = join(VERIFY_OUT, 'tsconfig.json');

  it('type-checks with the real rewritten module, the real glue and the real framework types', () => {
    mkdirSync(VERIFY_OUT, { recursive: true });
    writeFileSync(group.path, group.code, 'utf8');
    writeFileSync(
      tsconfig,
      `${JSON.stringify(
        {
          compilerOptions: {
            target: 'ESNext',
            module: 'ESNext',
            moduleResolution: 'Bundler',
            allowImportingTsExtensions: true,
            noEmit: true,
            strict: true,
            skipLibCheck: true,
            lib: ['ESNext', 'DOM', 'DOM.Iterable'],
            jsx: 'preserve',
            jsxImportSource: '@solidjs/web',
            esModuleInterop: true,
            allowJs: true,
            checkJs: false,
            // `import.meta.glob` is the bundler's, and typing it is what makes
            // the eager template map a checked expression rather than an any.
            types: ['vite/client', 'node'],
          },
          include: [relative(VERIFY_OUT, group.path)],
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    const tsc = join(PLUGIN_ROOT, 'node_modules/.bin/tsc');
    let output = '';
    try {
      output = execFileSync(tsc, ['--noEmit', '-p', tsconfig], {
        cwd: PLUGIN_ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      // A compiler that refused says why on stdout; the assertion below is
      // what should print it, not a nonzero exit code.
      output = String((error as { stdout?: string }).stdout ?? error);
    }

    expect(output.trim()).toBe('');
  });

  it('re-roots every specifier to wherever the consumer put the module', () => {
    expect(group.imports).toEqual([
      '@solidjs/web',
      '../../../demo/src/generated/app.resumable.tsx',
      '../../../demo/src/todos-resume.ts',
      '../../../demo/artifacts/app.Header/template.js',
    ]);
  });
});

describe('a corpus that shares nothing with the one this was extracted from', () => {
  const generatedDir = join(VERIFY_OUT, 'shelf/generated');
  const moduleId = join(VERIFY_OUT, 'shelf/shelf-group.ts');

  function shelfOptions(overrides: Partial<ResumabilityOptions> = {}): ResolvedOptions {
    return resolveOptions({
      root: PLUGIN_ROOT,
      artifactDir: join(VERIFY_OUT, 'shelf/artifacts'),
      generatedDir,
      mounts: [
        {
          component: 'ShelfToolbar',
          source: 'test/fixtures/corpus/features/shelf/shelf-page.tsx',
          page: 'shelf',
          substitute: {
            out: 'shelf.resumable.tsx',
            claim: { module: 'test/fixtures/corpus/shared/shelf-resume.ts' },
          },
        },
      ],
      pages: [
        {
          id: 'shelf',
          html: 'test/fixtures/html/shelf.html',
          group: {
            moduleId,
            entryComponent: 'ShelfPage',
            rootSelector: '.shelf-mount',
            glue: {
              module: 'test/fixtures/corpus/shared/shelf-page-glue.ts',
              createMount: 'buildShelfMount',
              offerClaim: 'lendShelfMount',
            },
            render: { module: '@shelf/runtime', named: 'mountShelf' },
          },
        },
      ],
      ...overrides,
    });
  }

  function shelfGroup(overrides: Partial<ResumabilityOptions> = {}) {
    const options = shelfOptions(overrides);
    const mount = options.mounts[0]!;
    const analysis = analyzeFixture(mount.sourcePath, {
      root: options.corpusRoot,
      component: mount.component,
    });
    const substitution = substituteModule(options, mount, analysis);
    return { options, group: generateGroupModule(options, options.pages[0]!, [substitution]) };
  }

  const { group } = shelfGroup();

  it('imports this corpus own modules, at this corpus own depth', () => {
    expect(group.imports).toEqual([
      '@shelf/runtime',
      './generated/shelf.resumable.tsx',
      '../../../test/fixtures/corpus/shared/shelf-page-glue.ts',
      './artifacts/shelf-page.ShelfToolbar/template.js',
    ]);
  });

  it('calls the glue by the names this page declared', () => {
    expect(group.code).toContain(
      'import { buildShelfMount, lendShelfMount } from "../../../test/fixtures/corpus/shared/shelf-page-glue.ts";',
    );
    expect(group.code).toContain('const dispose = mountShelf(ShelfPage as never, root);');
    expect(group.code).not.toContain('createMount');
    expect(group.code).not.toContain('offerClaim');
  });

  it('finds its root by the selector this page declared', () => {
    expect(group.code).toContain('document.querySelector<HTMLElement>(".shelf-mount")!');
  });

  it('takes no root default at all when nothing declares one', () => {
    const { group: bare } = shelfGroup({
      pages: [
        {
          id: 'shelf',
          html: 'test/fixtures/html/shelf.html',
          group: { moduleId, entryComponent: 'ShelfPage' },
        },
      ],
    });
    expect(bare.code).toContain('export function execute(root: HTMLElement): () => void {');
    // With no substitution glue of its own declared, the group inherits the
    // module the rewritten mount point already calls.
    expect(bare.imports).toContain('../../../test/fixtures/corpus/shared/shelf-resume.ts');
  });

  it('omits the focus machinery entirely when the page does not carry focus', () => {
    const { group: unfocused } = shelfGroup({
      pages: [
        {
          id: 'shelf',
          html: 'test/fixtures/html/shelf.html',
          group: { moduleId, entryComponent: 'ShelfPage', carryFocus: false },
        },
      ],
    });

    expect(unfocused.code).not.toContain('SavedFocus');
    expect(unfocused.code).not.toContain('saveFocus');
    expect(unfocused.code).not.toContain('restoreFocus');
    expect(unfocused.code).not.toContain('setSelectionRange');
    // The swap itself is untouched: focus is the only thing that went.
    expect(unfocused.code).toContain('claimed.remove();');
    expect(unfocused.code).toContain('root.replaceChildren();');
  });

  it('keeps the keyed table and the loop for a page that resumes more than one mount', () => {
    const options = shelfOptions();
    const mount = options.mounts[0]!;
    const analysis = analyzeFixture(mount.sourcePath, {
      root: options.corpusRoot,
      component: mount.component,
    });
    const first = substituteModule(options, mount, analysis);

    // The second mount is stated rather than analyzed. What this case is for
    // is the group codegen's N-mount shape, and the group stage's input is
    // substitutions — a second one is the whole of what the case needs.
    const second: SubstitutionResult = {
      mount: { ...mount, component: 'ShelfBadge', artifact: 'shelf-aside.ShelfBadge' },
      path: join(generatedDir, 'aside.resumable.tsx'),
      code: 'export function ShelfBadge() {\n  return null;\n}\n',
      edits: [],
      transformed: false,
    };

    const pair = generateGroupModule(options, options.pages[0]!, [first, second]);

    expect(pair.claims.map((claim) => claim.artifact)).toEqual([
      'shelf-page.ShelfToolbar',
      'shelf-aside.ShelfBadge',
    ]);
    expect(pair.imports).toEqual([
      '@shelf/runtime',
      './generated/shelf.resumable.tsx',
      '../../../test/fixtures/corpus/shared/shelf-page-glue.ts',
      './artifacts/shelf-page.ShelfToolbar/template.js',
      './artifacts/shelf-aside.ShelfBadge/template.js',
    ]);

    // Two mounts are two elements, so the table that names them and the loop
    // that walks them are exactly what this page needs — and the lookup by
    // artifact key comes back with them.
    expect(pair.code).toContain(
      '  { artifact: "shelf-page.ShelfToolbar", selector: \'[data-resume="shelf-page.ShelfToolbar"]\' },',
    );
    expect(pair.code).toContain(
      '  { artifact: "shelf-aside.ShelfBadge", selector: \'[data-resume="shelf-aside.ShelfBadge"]\' },',
    );
    expect(pair.code).toContain('const claimed = CLAIMED.map(');
    expect(pair.code).toContain('Object.entries(TEMPLATES)');
    expect(pair.code).toContain('for (const element of claimed) element.remove();');
    expect(pair.code).toContain('for (const element of claimed) lendShelfMount(element);');
    expect(pair.code).toContain('function saveFocus(claimed: HTMLElement[]): SavedFocus | null {');
  });

  it('writes the module where the declaration put it', () => {
    const options = shelfOptions();
    const mount = options.mounts[0]!;
    const analysis = analyzeFixture(mount.sourcePath, {
      root: options.corpusRoot,
      component: mount.component,
    });
    const substitution = substituteModule(options, mount, analysis);

    rmSync(join(VERIFY_OUT, 'shelf/shelf-group.ts'), { force: true });
    const report = runGroupStage(options, [substitution], { log: () => {} });

    expect(report.groups).toHaveLength(1);
    const written = report.groups[0]!.path;
    expect(statSync(written).isFile()).toBe(true);
    expect(readFileSync(written, 'utf8')).toBe(report.groups[0]!.code);
  });
});

describe('the shapes it refuses rather than guesses at', () => {
  const options = demoOptions('demo/src/todos-group.ts');
  const substitution = demoSubstitution(options);

  it('refuses a page that declares no group', () => {
    const bare = resolveOptions({
      root: REPO_ROOT,
      mounts: [{ component: 'Header', source: 'app/src/app.tsx' }],
      pages: [{ id: 'page', html: 'demo/todos.html' }],
    });
    const error = refusalFrom(() => generateGroupModule(bare, bare.pages[0]!, []));
    expect(error.name).toBe('GroupNotDeclared');
  });

  it('refuses a group whose page had nothing rewritten', () => {
    const error = refusalFrom(() => generateGroupModule(options, options.pages[0]!, []));
    expect(error.name).toBe('GroupEntryModuleMissing');
    expect(error.message).toContain('`App`');
    expect(error.message).toContain('no mount on this page declares a substitution');
  });

  it('refuses an entry component the rewritten module does not declare', () => {
    const wrong = demoOptions('demo/src/todos-group.ts', {
      pages: [
        {
          id: 'page',
          html: 'demo/todos.html',
          group: { moduleId: 'demo/src/todos-group.ts', entryComponent: 'Shelf' },
        },
      ],
    });
    const error = refusalFrom(() =>
      generateGroupModule(wrong, wrong.pages[0]!, [demoSubstitution(wrong)]),
    );
    expect(error.name).toBe('GroupEntryComponentMissing');
    expect(error.message).toContain('`Shelf`');
    expect(error.message).toContain('app/src/app.tsx');
  });

  it('refuses an entry component the rewritten module keeps to itself', () => {
    const unexported = demoOptions('demo/src/todos-group.ts', {
      pages: [
        {
          id: 'page',
          html: 'demo/todos.html',
          group: { moduleId: 'demo/src/todos-group.ts', entryComponent: 'TodoItem' },
        },
      ],
    });
    const error = refusalFrom(() =>
      generateGroupModule(unexported, unexported.pages[0]!, [substitution]),
    );
    expect(error.name).toBe('GroupEntryComponentNotExported');
    expect(error.message).toContain('`TodoItem`');
    expect(error.message).toContain('not exported');
  });
});

/**
 * The one refusal in this stage that is about the RESUME path rather than about
 * the module being generated.
 *
 * `resumeBundle` compares a mount's served `innerHTML` against its emitted
 * `template.html` exactly, because markup that drifted from what the build
 * emitted is markup whose locators address the wrong nodes. An addressed parent
 * can never satisfy that comparison: its template carries an EMPTY element
 * where the child goes and the served container carries that element FILLED, so
 * a page that shipped the template would throw at its first interaction.
 *
 * The equality is not relaxed to fix that. This stage is the only place in the
 * package that puts a `template.js` on the wire, so the refusal goes here — a
 * named build-time stop instead of a runtime throw. Its reach is exactly this
 * package's own emission: a consumer globbing `template.js` by hand is outside
 * it, and no check written here could be otherwise.
 */
describe('a mount whose component addressed a child', () => {
  const CLAIMED = join(VERIFY_OUT, 'claimed/artifacts');

  /** The demo's own declaration, pointed at an artifact tree this test writes. */
  function withClaim(children: unknown[]): ResolvedOptions {
    mkdirSync(join(CLAIMED, 'app.Header'), { recursive: true });
    writeFileSync(
      join(CLAIMED, 'app.Header/manifest.json'),
      `${JSON.stringify({ artifact: 'app.Header', ...(children.length === 0 ? {} : { claimedChildren: children }) }, null, 2)}\n`,
      'utf8',
    );
    return demoOptions('demo/src/todos-group.ts', { artifactDir: CLAIMED });
  }

  it('refuses to import its template into the group', () => {
    const claimed = withClaim([
      { locator: '/2', artifact: 'app.Badge', component: 'Badge', module: 'app/src/app.tsx' },
    ]);
    const error = refusalFrom(() =>
      generateGroupModule(claimed, claimed.pages[0]!, [demoSubstitution(claimed)]),
    );

    expect(error.name).toBe('ClaimedChildTemplateShipped');
    expect(error.message).toContain('"app.Header"');
    expect(error.message).toContain('"app.Badge"');
    expect(error.message).toContain('guaranteed to reject at the first interaction');
  });

  it('says nothing about a mount that addresses nothing, which is every mount today', () => {
    // The condition is the claim, not the presence of a manifest: the shipped
    // demo mount has one and addresses no child, and its group generates
    // exactly as it did before this refusal existed.
    const bare = withClaim([]);
    const { imports } = generateGroupModule(bare, bare.pages[0]!, [demoSubstitution(bare)]);
    expect(imports.filter((one) => one.endsWith('/app.Header/template.js'))).toHaveLength(1);
  });
});
