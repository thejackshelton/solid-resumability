/**
 * The published shape, checked from a consumer's position.
 *
 * Four claims. Every subpath a consumer can write resolves to a file that is
 * actually on disk after a build — an exports map is a promise, and a promise
 * pointing at a file the build never wrote is worse than no subpath at all.
 * Every browser-half subpath actually *loads*, from a directory holding nothing
 * but the tarball's own files. The tarball carries the built output and none of
 * the sources. And the browser half arrives one module per source module,
 * because a fused runtime would silently change which bytes a page pulls
 * eagerly.
 *
 * The second claim is the one that earns its cost. `existsSync` asks whether a
 * file is there; it cannot ask whether that file's own imports resolve. The
 * browser half used to ship a module importing `../../artifacts/CounterA/*` —
 * a path outside `files: ["dist"]`, present in this working tree and absent
 * from every install of the package. The file existed and the subpath was
 * broken, and only loading it says so. So: pack the package, extract it
 * somewhere outside this repo, and `import()` each subpath as a consumer would
 * — in a real node process, so what resolves it is node's resolver rather than
 * the test runner's.
 *
 * Requires `pnpm build` to have run.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'pathe';
import { afterAll, describe, expect, it } from 'vitest';

const PLUGIN_ROOT = resolve(import.meta.dirname, '..');
const REPO_ROOT = resolve(PLUGIN_ROOT, '..');

interface Manifest {
  name: string;
  files: string[];
  exports: Record<string, string | Record<string, string>>;
}

const manifest = JSON.parse(
  readFileSync(join(PLUGIN_ROOT, 'package.json'), 'utf8'),
) as Manifest;

/** Every `./dist/...` target in the map, flattened out of its conditions, with the subpath that names it. */
function exportTargets(): Array<{ subpath: string; condition: string; target: string }> {
  const targets: Array<{ subpath: string; condition: string; target: string }> = [];
  for (const [subpath, value] of Object.entries(manifest.exports)) {
    if (typeof value === 'string') targets.push({ subpath, condition: 'default', target: value });
    else {
      for (const [condition, target] of Object.entries(value)) {
        targets.push({ subpath, condition, target });
      }
    }
  }
  return targets;
}

describe('the exports map', () => {
  it('declares the subpaths the convention expects', () => {
    expect(Object.keys(manifest.exports)).toEqual([
      '.',
      './vite',
      './rollup',
      './rolldown',
      './webpack',
      './rspack',
      './esbuild',
      './node',
      './runtime/*',
      './types',
      './package.json',
    ]);
  });

  it.each(exportTargets().filter((entry) => !entry.target.includes('*')))(
    '$subpath ($condition) resolves to a file that exists',
    ({ target }) => {
      const path = resolve(PLUGIN_ROOT, target);
      expect(existsSync(path), `${target} is declared but was never built`).toBe(true);
    },
  );

  it('resolves every runtime subpath the pattern promises', () => {
    const pattern = manifest.exports['./runtime/*'] as string;
    for (const module of runtimeModules()) {
      const name = module.replace(/\.js$/, '');
      const path = resolve(PLUGIN_ROOT, pattern.replace('*', name));
      expect(existsSync(path), `./runtime/${name} does not resolve`).toBe(true);
    }
  });
});

/**
 * A consumer, staged: a directory outside this repo whose `node_modules` holds
 * the extracted tarball and nothing else. Nothing here can reach a file the
 * package did not publish, which is the whole point — a broken subpath fails
 * loudly instead of quietly borrowing this working tree.
 */
const consumer = stageConsumer();

afterAll(() => rmSync(consumer.root, { recursive: true, force: true }));

function stageConsumer(): { root: string; installed: string } {
  const root = mkdtempSync(join(tmpdir(), 'unplugin-solid-resumability-consumer-'));
  const modules = join(root, 'node_modules');
  mkdirSync(modules, { recursive: true });

  // The real thing, not `--dry-run`: a listing cannot be extracted.
  const tarball = execFileSync('npm', ['pack', '--silent', '--pack-destination', root], {
    cwd: PLUGIN_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  })
    .trim()
    .split('\n')
    .at(-1)!;

  // Every tarball unpacks to `package/`; moving it under the package's own name
  // is what makes a bare specifier resolve to it.
  execFileSync('tar', ['-xzf', join(root, tarball), '-C', modules], { stdio: 'ignore' });
  const installed = join(modules, manifest.name);
  mkdirSync(resolve(installed, '..'), { recursive: true });
  execFileSync('mv', [join(modules, 'package'), installed], { stdio: 'ignore' });

  return { root, installed };
}

/** The subpaths a consumer can write for the browser half, from what was published. */
function stagedRuntimeSubpaths(): string[] {
  return readdirSync(join(consumer.installed, 'dist/runtime'), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
    .map((entry) => `${manifest.name}/runtime/${entry.name.replace(/\.js$/, '')}`)
    .sort();
}

describe('every browser-half subpath loads from an install', () => {
  it('publishes the same modules it built', () => {
    expect(stagedRuntimeSubpaths().map((subpath) => subpath.split('/').at(-1))).toEqual(
      runtimeModules().map((name) => name.replace(/\.js$/, '')),
    );
  });

  it.each(stagedRuntimeSubpaths())('%s imports', (subpath) => {
    // A separate node process, so the resolver under test is node's own rather
    // than the one vitest installs — and so the failure, if there is one, is
    // the exact `ERR_MODULE_NOT_FOUND` a consumer would read.
    const probe = join(consumer.root, `probe-${subpath.split('/').at(-1)}.mjs`);
    writeFileSync(probe, `await import(${JSON.stringify(subpath)});\n`, 'utf8');

    expect(() => {
      execFileSync(process.execPath, [probe], { cwd: consumer.root, stdio: ['ignore', 'ignore', 'pipe'] });
    }, `${subpath} is published but does not load`).not.toThrow();
  });
});

describe('the tarball', () => {
  type Packed = { files: Array<{ path: string }> };
  const report = JSON.parse(
    execFileSync('npm', ['pack', '--dry-run', '--json'], {
      cwd: PLUGIN_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }),
  ) as Packed[] | Record<string, Packed>;
  // npm has reported this as an array and as an object keyed by package name;
  // both say the same thing and neither is worth pinning a version over.
  const packed = Array.isArray(report) ? report : Object.values(report);
  const files = packed[0]!.files.map((file) => file.path);

  it('carries the built output', () => {
    expect(files.some((path) => path.startsWith('dist/'))).toBe(true);
    expect(files).toContain('dist/index.mjs');
    expect(files).toContain('dist/node.mjs');
    expect(files).toContain('dist/runtime/resumer.js');
  });

  it('carries no sources', () => {
    const sources = files.filter((path) => path.startsWith('src/'));
    expect(sources, `sources leaked into the tarball: ${sources.join(', ')}`).toEqual([]);
  });
});

/** The names under `dist/runtime`, which is where the browser half lands. */
function runtimeModules(): string[] {
  return readdirSync(join(PLUGIN_ROOT, 'dist/runtime'), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
    .map((entry) => entry.name)
    .sort();
}

/**
 * The two browser-half modules that are bound to this repo and deliberately not
 * published: `artifacts.ts` globs the repo's own `artifacts/*`, and `index.ts`
 * exists only to join that glob to the resumer. `plugin/src/runtime/index.ts`
 * ships under the `index` name in their place.
 */
const REPO_BOUND = ['index.ts', 'artifacts.ts'];

/** The modules the browser half is authored as. `.d.ts` declares types and compiles to nothing. */
function runtimeSources(): string[] {
  const shared = readdirSync(join(REPO_ROOT, 'src/resume'), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts'))
    .filter((entry) => !REPO_BOUND.includes(entry.name))
    .map((entry) => entry.name.replace(/\.ts$/, '.js'));
  return [...shared, 'index.js'].sort();
}

describe('the browser half', () => {
  it('is emitted one output module per source module, not fused', () => {
    const emitted = runtimeModules();
    const sources = runtimeSources();

    expect(sources.length).toBeGreaterThan(1);
    expect(emitted).toEqual(sources);
    expect(emitted).toHaveLength(sources.length);
  });

  it('publishes no module bound to this repo’s own artifacts', () => {
    for (const name of runtimeModules()) {
      const source = readFileSync(join(PLUGIN_ROOT, 'dist/runtime', name), 'utf8');
      expect(source, `dist/runtime/${name} imports artifacts that are not published`).not.toMatch(
        /from\s+["'][^"']*\/artifacts\//,
      );
    }
  });

  it('leaves no directories under dist/runtime', () => {
    const directories = readdirSync(join(PLUGIN_ROOT, 'dist/runtime'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    expect(directories).toEqual([]);
  });
});
