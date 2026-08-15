/**
 * The decisive test of this slice: the plugin's analyze stage IS the emit
 * script it replaces.
 *
 * Not "produces artifacts of the same shape" — produces the same bytes. Every
 * file the stage writes over the demo's seven declared mounts, and over the one
 * child those mounts address, is hashed and compared against the file the demo
 * already ships, and the file list is spelled out here rather than derived from
 * the output, so a stage that emitted nothing at all would fail rather than
 * pass over an empty set.
 *
 * The other two cases are the stage's refusals: a mount that had to be
 * provable and was not, and the artifact directories a shrinking declaration
 * leaves behind.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'pathe';
import { beforeAll, describe, expect, it } from 'vitest';

import { resolveOptions } from '../src/options.ts';
import {
  ClaimedChildEmissionError,
  deriveClaimedArtifacts,
  runAnalyzeStage,
  UnprovableMountError,
} from '../src/stages/analyze.ts';
import type { MountDeclaration } from '../src/types.ts';

const PLUGIN_ROOT = resolve(import.meta.dirname, '..');
const REPO_ROOT = resolve(PLUGIN_ROOT, '..');
const REFERENCE_ARTIFACTS = join(REPO_ROOT, 'demo/artifacts');
const VERIFY_OUT = join(PLUGIN_ROOT, '.verify-out');

/**
 * The demo's own declaration, restated as plugin options. Six purpose-built
 * fixtures and one component of a ported application, exactly as
 * `demo/build/fixtures.mjs` lists them.
 *
 * Seven declarations, eight artifact directories: `ComposedOuter` ADDRESSES
 * `ComposedInner` rather than absorbing it, so the stage emits a child nothing
 * here declares. That is the demo's shape too (`fixtures.mjs` writes the
 * seventh address down under `addressed`), and restating the declaration
 * without it is what left this file's expectation short of the corpus.
 */
const DEMO_MOUNTS: MountDeclaration[] = [
  {
    component: 'ProvableCounter',
    source: 'app/src/fixtures/ProvableCounter.tsx',
    artifact: 'ProvableCounter',
  },
  {
    component: 'ProvableStepper',
    source: 'app/src/fixtures/ProvableStepper.tsx',
    artifact: 'ProvableStepper',
  },
  {
    component: 'ProvableGreeting',
    source: 'app/src/fixtures/ProvableGreeting.tsx',
    artifact: 'ProvableGreeting',
  },
  {
    component: 'PropsPairParent',
    source: 'app/src/fixtures/PropsPair.tsx',
    artifact: 'PropsPair.PropsPairParent',
  },
  {
    component: 'ComposedOuter',
    source: 'app/src/fixtures/ComposedCounter.tsx',
    artifact: 'ComposedCounter.ComposedOuter',
  },
  {
    component: 'RosterList',
    source: 'app/src/fixtures/KeyedRoster.tsx',
    artifact: 'KeyedRoster.RosterList',
  },
  {
    component: 'Header',
    source: 'app/src/app.tsx',
    artifact: 'app.Header',
  },
];

/**
 * Every file the seven mounts and the one address they reach emit, named.
 * Derived lists make vacuous assertions: this one fails when a file goes
 * missing.
 *
 * The ten `ComposedCounter.*` entries were read off the reference tree and
 * WRITTEN DOWN, which is the only way this list is worth anything — a list
 * built from `listFiles` would agree with whatever the tree happened to hold,
 * including a tree with the addressed child's directory silently gone.
 */
const EXPECTED_FILES = [
  'ComposedCounter.ComposedInner/handlers/s0.js',
  'ComposedCounter.ComposedInner/manifest.json',
  'ComposedCounter.ComposedInner/structure.js',
  'ComposedCounter.ComposedInner/template.js',
  'ComposedCounter.ComposedInner/wiring.js',
  'ComposedCounter.ComposedOuter/handlers/s0.js',
  'ComposedCounter.ComposedOuter/manifest.json',
  'ComposedCounter.ComposedOuter/structure.js',
  'ComposedCounter.ComposedOuter/template.js',
  'ComposedCounter.ComposedOuter/wiring.js',
  'KeyedRoster.RosterList/handlers/s0.js',
  'KeyedRoster.RosterList/manifest.json',
  'KeyedRoster.RosterList/structure.js',
  'KeyedRoster.RosterList/template.js',
  'KeyedRoster.RosterList/wiring.js',
  'PropsPair.PropsPairParent/handlers/s0.js',
  'PropsPair.PropsPairParent/manifest.json',
  'PropsPair.PropsPairParent/structure.js',
  'PropsPair.PropsPairParent/template.js',
  'PropsPair.PropsPairParent/wiring.js',
  'ProvableCounter/handlers/s0.js',
  'ProvableCounter/handlers/s1.js',
  'ProvableCounter/manifest.json',
  'ProvableCounter/structure.js',
  'ProvableCounter/template.js',
  'ProvableCounter/wiring.js',
  'ProvableGreeting/handlers/s0.js',
  'ProvableGreeting/handlers/s1.js',
  'ProvableGreeting/manifest.json',
  'ProvableGreeting/structure.js',
  'ProvableGreeting/template.js',
  'ProvableGreeting/wiring.js',
  'ProvableStepper/handlers/s0.js',
  'ProvableStepper/handlers/s1.js',
  'ProvableStepper/manifest.json',
  'ProvableStepper/structure.js',
  'ProvableStepper/template.js',
  'ProvableStepper/wiring.js',
  'app.Header/handlers/s0.js',
  'app.Header/manifest.json',
  'app.Header/structure.js',
  'app.Header/template.js',
  'app.Header/wiring.js',
];

/**
 * Five of the forty-three quoted outright. If the pass ever changes what it
 * emits for the one application component in the corpus, these fail with a
 * number a reader can look up rather than with "the two directories differ".
 */
const ANCHORS: Record<string, string> = {
  'app.Header/template.js': 'ab51a8017eab90c0338552c77de31c622941c17ecd55d76152190bf960d44a40',
  'app.Header/structure.js': 'b31305b9667c699b73a3d42ee4ad06da1726de8b8e266aa59d66ffe9923ed597',
  'app.Header/wiring.js': '05c88ae25bc2c7f2792a7fd153a4e2f2b3b7a853202dda8f6144c168584eb794',
  'app.Header/handlers/s0.js': '24d82e00d49442a5bccdd005590096d5f78061bddd953851ec16d817cd3f2044',
  'app.Header/manifest.json': 'c5f68af96186e5152839b2defe32db6eb959f2f99486aa2a3bf79e01fa2be18b',
};

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function listFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else found.push(relative(root, path));
    }
  };
  walk(root);
  return found.sort();
}

describe('artifact byte parity with the emit script this stage replaces', () => {
  const artifactDir = join(VERIFY_OUT, 'artifacts');

  beforeAll(() => {
    rmSync(artifactDir, { recursive: true, force: true });
    mkdirSync(artifactDir, { recursive: true });

    const options = resolveOptions({ root: REPO_ROOT, artifactDir, mounts: DEMO_MOUNTS });
    runAnalyzeStage(options, { log: () => {} });
  });

  it('emits exactly the files the reference tree carries', () => {
    expect(listFiles(artifactDir)).toEqual(EXPECTED_FILES);
    // The reference side is untouched by this test and must stay the corpus it
    // is being compared against.
    expect(listFiles(REFERENCE_ARTIFACTS)).toEqual(EXPECTED_FILES);
  });

  it.each(EXPECTED_FILES)('%s is byte-identical to the reference artifact', (file) => {
    const emitted = join(artifactDir, file);
    const reference = join(REFERENCE_ARTIFACTS, file);
    expect(existsSync(emitted), `${file} was not emitted`).toBe(true);
    expect(sha256(emitted), `${file} differs from ${reference}`).toBe(sha256(reference));
  });

  it.each(Object.entries(ANCHORS))('%s matches its quoted hash', (file, hash) => {
    expect(sha256(join(artifactDir, file))).toBe(hash);
  });

  it('reports one provable line per mount, and one addressed line for the child', () => {
    const lines: string[] = [];
    const options = resolveOptions({ root: REPO_ROOT, artifactDir, mounts: DEMO_MOUNTS });
    const report = runAnalyzeStage(options, { log: (line) => lines.push(line) });

    // Every declaration is provable and says so, then the one address those
    // declarations reach reports itself under its own verb. The count is
    // written as the sum rather than as a literal so a mount added to the list
    // above without an emission moves this number too.
    expect(lines).toHaveLength(DEMO_MOUNTS.length + 1);
    for (const line of lines.slice(0, DEMO_MOUNTS.length)) {
      expect(line).toMatch(/^provable {2}\S+ \(\w+\): \d+ cell\(s\)/);
    }
    expect(lines[DEMO_MOUNTS.length]).toMatch(
      /^addressed app\/src\/fixtures\/ComposedCounter\.tsx \(ComposedInner\): claimed by ComposedCounter\.ComposedOuter at \S+ -> /,
    );
    expect(report.outcomes.map((outcome) => outcome.analysis.status)).toEqual(
      DEMO_MOUNTS.map(() => 'provable'),
    );
    expect(report.derived.map((entry) => entry.child.artifact)).toEqual([
      'ComposedCounter.ComposedInner',
    ]);
  });
});

describe('a mount that had to be provable and was not', () => {
  const artifactDir = join(VERIFY_OUT, 'refusal');

  it('throws, naming every reason with its line and column', () => {
    rmSync(artifactDir, { recursive: true, force: true });
    const options = resolveOptions({
      root: PLUGIN_ROOT,
      artifactDir,
      mounts: [
        {
          component: 'EscapingCounter',
          source: 'test/fixtures/refusal/EscapingCounter.tsx',
          expectProvable: true,
        },
      ],
    });

    let thrown: unknown;
    try {
      runAnalyzeStage(options, { log: () => {} });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(UnprovableMountError);
    const error = thrown as UnprovableMountError;
    expect(error.name).toBe('UnprovableMountError');
    expect(error.message).toContain('test/fixtures/refusal/EscapingCounter.tsx');
    expect(error.message).toContain('expected provable');

    const reasons = error.outcomes[0]!.analysis.reasons;
    expect(reasons.length).toBeGreaterThan(0);
    for (const reason of reasons) {
      expect(error.message).toContain(`${reason.code} @ ${reason.loc.line}:${reason.loc.column}`);
      expect(reason.loc.line).toBeGreaterThan(0);
    }
  });

  it('lets the same mount through when it was not expected to be provable', () => {
    rmSync(artifactDir, { recursive: true, force: true });
    const options = resolveOptions({
      root: PLUGIN_ROOT,
      artifactDir,
      mounts: [
        {
          component: 'EscapingCounter',
          source: 'test/fixtures/refusal/EscapingCounter.tsx',
          expectProvable: false,
        },
      ],
    });

    const report = runAnalyzeStage(options, { log: () => {} });
    expect(report.outcomes[0]!.analysis.status).toBe('fallback');
    expect(report.outcomes[0]!.emittedDir).toBeNull();
  });
});

/**
 * ADDRESSING, from this stage's seat: a declared mount that addresses a child
 * gets that child emitted too, at the address its own template already stamped,
 * without anyone declaring it.
 *
 * `ComposedOuter` addresses `ComposedInner`, which owns a `createSignal` and is
 * therefore outside depth-1 inlining's ceiling by construction — a child
 * inlining could not have taken, not one it happened not to take.
 */
describe('the children a declared mount addresses', () => {
  const artifactDir = join(VERIFY_OUT, 'addressed');
  const PARENT = 'ComposedCounter.ComposedOuter';
  const CHILD = 'ComposedCounter.ComposedInner';

  const composed: MountDeclaration[] = [
    { component: 'ComposedOuter', source: 'app/src/fixtures/ComposedCounter.tsx' },
  ];

  const CHILD_FILES = [
    `${CHILD}/handlers/s0.js`,
    `${CHILD}/manifest.json`,
    `${CHILD}/structure.js`,
    `${CHILD}/template.js`,
    `${CHILD}/wiring.js`,
  ];

  it('are emitted as full artifact sets nobody declared', () => {
    rmSync(artifactDir, { recursive: true, force: true });
    const options = resolveOptions({ root: REPO_ROOT, artifactDir, mounts: composed });
    const report = runAnalyzeStage(options, { log: () => {} });

    expect(report.outcomes).toHaveLength(1);
    expect(report.outcomes[0]!.mount.artifact).toBe(PARENT);

    expect(report.derived.map((entry) => entry.child.artifact)).toEqual([CHILD]);
    const [child] = report.derived;
    expect(child!.parent).toBe(PARENT);
    expect(child!.child.component).toBe('ComposedInner');
    expect(child!.emittedDir).toBe(join(artifactDir, CHILD));
    expect(child!.analysis.cells.map((cell) => cell.getter)).toEqual(['inner']);

    // The child's directory is a full artifact set, not a stub: the same five
    // files any declared mount of this shape emits.
    for (const file of CHILD_FILES) expect(existsSync(join(artifactDir, file))).toBe(true);
    expect(listFiles(artifactDir).filter((file) => file.startsWith(`${CHILD}/`))).toEqual(
      CHILD_FILES,
    );

    // And the parent's template really did leave the hole this fills.
    const manifest = JSON.parse(
      readFileSync(join(artifactDir, PARENT, 'manifest.json'), 'utf8'),
    ) as { claimedChildren?: Array<{ artifact: string; component: string; module: string }> };
    expect(manifest.claimedChildren).toEqual([
      {
        locator: expect.any(String),
        artifact: CHILD,
        component: 'ComposedInner',
        module: 'app/src/fixtures/ComposedCounter.tsx',
        recordedProps: [{ name: 'kind', value: 'seed' }],
      },
    ]);
  });

  it('report one addressed line each, naming who claimed them and where', () => {
    rmSync(artifactDir, { recursive: true, force: true });
    const lines: string[] = [];
    const options = resolveOptions({ root: REPO_ROOT, artifactDir, mounts: composed });
    runAnalyzeStage(options, { log: (line) => lines.push(line) });

    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^provable {2}\S+ \(ComposedOuter\): \d+ cell\(s\)/);
    expect(lines[1]).toMatch(
      /^addressed app\/src\/fixtures\/ComposedCounter\.tsx \(ComposedInner\): claimed by ComposedCounter\.ComposedOuter at \S+ -> /,
    );
  });

  /**
   * THE REGRESSION THIS SLICE EXISTS FOR. Pruning used to run first and keep
   * only what the consumer declared, so a derived child's directory was deleted
   * on the build after the one that wrote it.
   */
  it('survive the next build rather than being pruned as unclaimed', () => {
    rmSync(artifactDir, { recursive: true, force: true });
    const options = resolveOptions({ root: REPO_ROOT, artifactDir, mounts: composed });

    const first = runAnalyzeStage(options, { log: () => {} });
    expect(first.pruned).toEqual([]);

    const second = runAnalyzeStage(options, { log: () => {} });
    expect(second.pruned).toEqual([]);
    expect(statSync(join(artifactDir, CHILD)).isDirectory()).toBe(true);
    expect(existsSync(join(artifactDir, CHILD, 'template.js'))).toBe(true);
  });

  it('are kept while everything else under the tree still goes', () => {
    rmSync(artifactDir, { recursive: true, force: true });
    mkdirSync(join(artifactDir, 'RemovedFromTheList'), { recursive: true });

    const options = resolveOptions({ root: REPO_ROOT, artifactDir, mounts: composed });
    const report = runAnalyzeStage(options, { log: () => {} });

    expect(report.pruned).toEqual([join(artifactDir, 'RemovedFromTheList')]);
    expect(statSync(join(artifactDir, CHILD)).isDirectory()).toBe(true);
  });
});

/**
 * The recursion's own termination, which does not borrow the classifier's.
 *
 * `Trunk` addresses `Branch` and `Leaf`; `Branch` addresses `Leaf` too. So
 * `Leaf` is reached twice, by two routes at two depths, and the visited set of
 * artifact ids is the only thing that stops the second visit — the same set
 * that bounds a tree with a genuine cycle in it, which the classifier refuses
 * to produce but a stale or hand-edited manifest can still describe.
 */
describe('one address reached by two routes', () => {
  const artifactDir = join(VERIFY_OUT, 'cycle');
  const GROVE: MountDeclaration[] = [
    { component: 'Trunk', source: 'test/fixtures/addressing/Grove.tsx' },
  ];

  it('is emitted exactly once, and the walk stops there', () => {
    rmSync(artifactDir, { recursive: true, force: true });
    const options = resolveOptions({ root: PLUGIN_ROOT, artifactDir, mounts: GROVE });

    const report = runAnalyzeStage(options, { log: () => {} });

    // Both of the trunk's addresses, each derived once; the branch's own claim
    // on the leaf finds it already emitted and adds nothing.
    expect(report.derived.map((entry) => entry.child.artifact)).toEqual([
      'Grove.Branch',
      'Grove.Leaf',
    ]);
    expect(report.derived.map((entry) => entry.parent)).toEqual(['Grove.Trunk', 'Grove.Trunk']);
    expect(
      report.derived
        .find((entry) => entry.child.artifact === 'Grove.Branch')!
        .analysis.claimedChildren.map((claim) => claim.artifact),
    ).toEqual(['Grove.Leaf']);

    expect(
      listFiles(artifactDir)
        .map((file) => file.split('/')[0])
        .filter((dir, index, all) => all.indexOf(dir) === index),
    ).toEqual(['Grove.Branch', 'Grove.Leaf', 'Grove.Trunk']);
  });

  it('is left to the declaration when a declaration already owns it', () => {
    rmSync(artifactDir, { recursive: true, force: true });
    const options = resolveOptions({
      root: PLUGIN_ROOT,
      artifactDir,
      mounts: [...GROVE, { component: 'Leaf', source: 'test/fixtures/addressing/Grove.tsx' }],
    });

    const report = runAnalyzeStage(options, { log: () => {} });

    expect(report.outcomes.map((outcome) => outcome.mount.artifact)).toEqual([
      'Grove.Trunk',
      'Grove.Leaf',
    ]);
    expect(report.derived.map((entry) => entry.child.artifact)).toEqual(['Grove.Branch']);
    expect(report.pruned).toEqual([]);
  });
});

/**
 * A claimed address that cannot be emitted is a refusal with a name, because
 * the alternative is a mount container that ships empty and a resumer that
 * throws at the first interaction for a defect the build already knew about.
 */
describe('a claimed address the pass cannot turn into artifacts', () => {
  const artifactDir = join(VERIFY_OUT, 'claimed-refusal');

  const options = () =>
    resolveOptions({
      root: PLUGIN_ROOT,
      artifactDir,
      mounts: [{ component: 'Trunk', source: 'test/fixtures/addressing/Grove.tsx' }],
    });

  it('refuses by name when the addressed module is not there', () => {
    rmSync(artifactDir, { recursive: true, force: true });

    let thrown: unknown;
    try {
      deriveClaimedArtifacts(
        options(),
        [
          {
            artifact: 'Grove.Trunk',
            claimed: [
              {
                locator: '0/2',
                artifact: 'Vanished.Widget',
                component: 'Widget',
                module: 'test/fixtures/addressing/Vanished.tsx',
              },
            ],
          },
        ],
        { log: () => {} },
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ClaimedChildEmissionError);
    const error = thrown as ClaimedChildEmissionError;
    expect(error.name).toBe('ClaimedChildNotEmitted');
    expect(error.parent).toBe('Grove.Trunk');
    expect(error.child.artifact).toBe('Vanished.Widget');
    expect(error.message).toContain('test/fixtures/addressing/Vanished.tsx');
    expect(error.message).toContain('the module is not there');
  });

  it('refuses by name when the addressed component does not classify on its own', () => {
    rmSync(artifactDir, { recursive: true, force: true });

    let thrown: unknown;
    try {
      deriveClaimedArtifacts(
        options(),
        [
          {
            artifact: 'Grove.Trunk',
            claimed: [
              {
                locator: '0/2',
                artifact: 'EscapingCounter',
                component: 'EscapingCounter',
                module: 'test/fixtures/refusal/EscapingCounter.tsx',
              },
            ],
          },
        ],
        { log: () => {} },
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ClaimedChildEmissionError);
    const error = thrown as ClaimedChildEmissionError;
    expect(error.name).toBe('ClaimedChildNotEmitted');
    expect(error.message).toContain('classified provable from its parent and NOT on its own');
    expect(error.message).toMatch(/@ \d+:\d+ —/);
    expect(existsSync(join(artifactDir, 'EscapingCounter'))).toBe(false);
  });

  it('refuses by name when the artifacts land somewhere the parent does not address', () => {
    rmSync(artifactDir, { recursive: true, force: true });

    let thrown: unknown;
    try {
      deriveClaimedArtifacts(
        options(),
        [
          {
            artifact: 'Grove.Trunk',
            claimed: [
              {
                locator: '0/2',
                // The address the parent's markup stamped, disagreeing with the
                // key the pass derives from `(module, component)`.
                artifact: 'SomewhereElse',
                component: 'Leaf',
                module: 'test/fixtures/addressing/Grove.tsx',
              },
            ],
          },
        ],
        { log: () => {} },
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ClaimedChildEmissionError);
    const error = thrown as ClaimedChildEmissionError;
    expect(error.name).toBe('ClaimedChildMisaddressed');
    expect(error.message).toContain('Grove.Leaf');
    expect(error.message).toContain('SomewhereElse');
  });
});

describe('artifact directories no declared mount claims', () => {
  const artifactDir = join(VERIFY_OUT, 'prune');

  it('are removed once the pass knows what it emitted', () => {
    rmSync(artifactDir, { recursive: true, force: true });
    mkdirSync(join(artifactDir, 'RemovedFromTheList/handlers'), { recursive: true });

    const options = resolveOptions({
      root: REPO_ROOT,
      artifactDir,
      mounts: [DEMO_MOUNTS[0]!],
    });
    const report = runAnalyzeStage(options, { log: () => {} });

    expect(report.pruned).toEqual([join(artifactDir, 'RemovedFromTheList')]);
    expect(existsSync(join(artifactDir, 'RemovedFromTheList'))).toBe(false);
    expect(statSync(join(artifactDir, 'ProvableCounter')).isDirectory()).toBe(true);
  });

  it('are left alone when pruning is switched off', () => {
    rmSync(artifactDir, { recursive: true, force: true });
    mkdirSync(join(artifactDir, 'RemovedFromTheList'), { recursive: true });

    const options = resolveOptions({
      root: REPO_ROOT,
      artifactDir,
      mounts: [DEMO_MOUNTS[0]!],
      policies: { pruneStaleArtifacts: false },
    });
    const report = runAnalyzeStage(options, { log: () => {} });

    expect(report.pruned).toEqual([]);
    expect(existsSync(join(artifactDir, 'RemovedFromTheList'))).toBe(true);
  });
});
