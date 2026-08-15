/**
 * Corpus enumeration and segmentation.
 *
 * The coverage metric is reported per *segment*, never blended:
 *
 *   - `app`      — the ported first-party sources (`app/src/**` minus the
 *                  fixture directory). This is the headline denominator.
 *   - `fixtures` — the hand-written near-miss slice (`app/src/fixtures/**`),
 *                  written to land on both sides of specific refusal codes.
 *                  Synthetic by construction, so it is reported on its own and
 *                  never folded into the headline.
 *
 * Every file is assigned a segment here, so no record downstream can exist
 * without one.
 */

import { readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "pathe";

export type Segment = "app" | "fixtures";

export const SEGMENTS: readonly Segment[] = ["app", "fixtures"];

/** Extensions the analyzer is willing to parse as corpus source. */
const SOURCE_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", ".mts", ".mjs", ".cts", ".cjs"];

/** Directories that are never corpus, whatever they contain. */
const SKIP_DIRECTORIES = new Set(["node_modules", "dist", "build"]);

export interface CorpusFile {
  /** Absolute path on this machine. */
  absolute: string;
  /** Path relative to the project root, posix-shaped: `app/src/app.tsx`. */
  path: string;
  /** Path relative to the corpus directory, posix-shaped: `fixtures/X.tsx`. */
  relative: string;
  segment: Segment;
}

function isSource(name: string): boolean {
  if (name.endsWith(".d.ts")) return false;
  return SOURCE_EXTENSIONS.some((extension) => name.endsWith(extension));
}

/**
 * Every source file under `corpusDir`, in a deterministic order.
 *
 * Directory entries are sorted by name before descending, and the result is
 * sorted again by corpus-relative path, so the walk does not inherit the
 * filesystem's ordering.
 */
export function collectCorpus(
  corpusDir: string,
  root: string,
  fixtureSubdirectory = "fixtures",
): CorpusFile[] {
  const corpus = resolve(corpusDir);
  const rootDir = resolve(root);
  const files: CorpusFile[] = [];
  const fixturePrefix = `${fixtureSubdirectory}/`;

  const walk = (directory: string): void => {
    const entries = readdirSync(directory).sort();
    for (const entry of entries) {
      if (entry.startsWith(".")) continue;
      const absolute = join(directory, entry);
      const stats = statSync(absolute);

      if (stats.isDirectory()) {
        if (SKIP_DIRECTORIES.has(entry)) continue;
        walk(absolute);
        continue;
      }

      if (!stats.isFile() || !isSource(entry)) continue;

      const relativePath = relative(corpus, absolute);
      files.push({
        absolute,
        path: relative(rootDir, absolute),
        relative: relativePath,
        segment: relativePath.startsWith(fixturePrefix) ? "fixtures" : "app",
      });
    }
  };

  walk(corpus);
  files.sort((a, b) => (a.relative < b.relative ? -1 : a.relative > b.relative ? 1 : 0));
  return files;
}
