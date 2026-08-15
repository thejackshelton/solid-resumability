/**
 * The misfire gate.
 *
 * The failure this package exists to avoid is a plugin that is a wrapper
 * around one application's build scripts. That failure is cheap to detect: the
 * application it was extracted from has names, and if any of them survived
 * into `src/` then something was copied rather than generalized.
 *
 * Mechanical on purpose. "No app-specific hardcoding survives into the plugin"
 * is a build failure here rather than a reviewer's opinion, and the failure
 * names the file and the string so the fix is obvious.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'pathe';
import { describe, expect, it } from 'vitest';

const PLUGIN_SRC = resolve(import.meta.dirname, '../src');

/**
 * Names from the application this pipeline was extracted from: its components,
 * its store, its actions, its page, its generated modules, its markup and its
 * selectors. Every one of them has a derived or declared replacement in the
 * config surface.
 *
 * The list only ever grows. A stage that generates code is the easiest place
 * for one of these to reappear as a default nobody questioned, so each new
 * generator adds the names it was tempted by.
 */
const APP_SPECIFIC = [
  'Header',
  'TodosContext',
  'addTodo',
  'app.Header',
  'todos',
  'todos-group',
  'todos-resume',
  'app.resumable',
  '#root',
  'class="loading"',
  'new-todo',
  'todoapp',
  'claimHeader',
  'data-component',
];

function sourceFiles(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else found.push(path);
    }
  };
  walk(root);
  return found.sort();
}

describe('nothing app-specific survived into the plugin', () => {
  const files = sourceFiles(PLUGIN_SRC);

  it('reads a source tree worth checking', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(files)('%s', (file) => {
    const source = readFileSync(file, 'utf8');
    const hits = APP_SPECIFIC.filter((name) => source.includes(name));
    expect(
      hits,
      `${relative(PLUGIN_SRC, file)} carries application-specific ${hits
        .map((hit) => JSON.stringify(hit))
        .join(', ')} — derive it or declare it`,
    ).toEqual([]);
  });
});
