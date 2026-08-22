/**
 * Analyze and emit: the pass over every declared mount, the children those
 * mounts ADDRESS, and the artifacts all of it writes.
 *
 * The body is a plain function of explicit inputs. Nothing here asks a bundler
 * for anything — it reads sources and writes an artifact tree — which is why
 * the same code serves a universal `buildStart` hook, a consumer's own script,
 * and a test that runs it into a scratch directory.
 *
 * A mount declared provable that comes back fallback is a hard failure, not a
 * warning. These are the positive controls of the whole configuration: if the
 * pass stops proving them, the build is no longer the thing it claims to be
 * and should say so rather than emit a page with a hole in it.
 *
 * THE DECLARATION IS NO LONGER THE WHOLE ARTIFACT TREE. A provable component
 * that addresses a child leaves an element-shaped hole in its own template and
 * records the child's address in `claimedChildren`; that address names an
 * artifact directory the consumer never declared and cannot be asked to. So
 * this stage DERIVES the rest of the tree: every claimed child, transitively,
 * is emitted here exactly as a declared mount is, and pruning is taught the
 * derived set rather than the declaration alone. The alternative is a page that
 * ships a mount container nothing can fill, and the resumer throws for want of
 * a root element in it — a defect the compiler already refuses at classify time
 * (`ClaimedChildEmptyTemplate`) and this stage may not manufacture at emit
 * time.
 */

import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, relative, resolve } from 'pathe';

import {
  analyzeWithIdentityProps,
  analyzeWithRecordedProps,
  emit,
  runComptime,
} from '../../../src/comptime/index.ts';
import {
  claimedArtifactKey,
  identityRecordKey,
  type Analysis,
  type ClaimedChild,
  type IdentityProp,
  type ProvableAnalysis,
  type RecordedProp,
} from '../../../src/comptime/types.ts';
import type { ResolvedMount, ResolvedOptions } from '../types.ts';

/** What one mount's pass produced. `emittedDir` is absolute; null when the verdict was fallback. */
export interface MountOutcome {
  mount: ResolvedMount;
  analysis: Analysis;
  emittedDir: string | null;
}

/**
 * One artifact directory this pass emitted because something ADDRESSED it, not
 * because anyone declared it.
 */
export interface DerivedChild {
  /** The artifact directory whose template carries the hole this fills. */
  parent: string;
  /** The address as the parent's own template stamped it. */
  child: ClaimedChild;
  analysis: ProvableAnalysis;
  /** Absolute, and always `<artifactDir>/<child.artifact>` — the refusal below is that check. */
  emittedDir: string;
}

/**
 * An artifact directory that addressed children, and the addresses it stamped.
 * The recursion's unit of work: it starts from the declared mounts' claims and
 * queues one of these per child it emits.
 */
export interface ClaimedOrigin {
  artifact: string;
  claimed: readonly ClaimedChild[];
}

/** What the stage did, for a caller that wants to assert on it rather than read logs. */
export interface AnalyzeReport {
  outcomes: MountOutcome[];
  /** Artifacts emitted because a template addressed them, in the order they were reached. */
  derived: DerivedChild[];
  /** Artifact directories removed because nothing declared or addressed them. Absolute. */
  pruned: string[];
}

/** A mount that had to be provable and was not. */
export class UnprovableMountError extends Error {
  readonly outcomes: MountOutcome[];

  constructor(message: string, outcomes: MountOutcome[]) {
    super(message);
    this.name = 'UnprovableMountError';
    this.outcomes = outcomes;
  }
}

/** Every way a claimed address fails to become artifacts. */
export type ClaimedChildRefusalName =
  | 'ClaimedChildNotEmitted'
  | 'ClaimedChildMisaddressed'
  | 'ClaimedChildRecordMismatch';

/**
 * A child a template addressed and this stage could not emit.
 *
 * A REFUSAL, NEVER A SKIP, and the distinction is the whole point of the class.
 * The parent's template has already been written with an empty mount container
 * at this address; skipping the child leaves a hole with nothing on the other
 * end of it, the page ships that container empty, and `resumeBundle` throws
 * "has no root element in this container" at the first interaction. A build
 * that cannot emit a claimed child has learned something the build must say out
 * loud, at the address, with the reasons — not something it may quietly leave
 * for the browser to discover.
 *
 * `name` is the refusal's own name rather than the class's, so a caller branches
 * on which rule fired rather than on prose that may be reworded.
 */
export class ClaimedChildEmissionError extends Error {
  readonly parent: string;
  readonly child: ClaimedChild;

  constructor(name: ClaimedChildRefusalName, message: string, parent: string, child: ClaimedChild) {
    super(message);
    this.name = name;
    this.parent = parent;
    this.child = child;
  }
}

export interface AnalyzeStageOptions {
  /** Where the per-mount verdict lines go. Defaults to stdout. */
  log?: (line: string) => void;
}

/**
 * Runs the pass over every declared mount, then over everything those mounts
 * addressed, pruning once the tree is whole and refusing last.
 *
 * PRUNING MOVED BEHIND EMISSION, and that is the one ordering decision in this
 * function. It used to come first, on the reasoning that emission overwrites
 * per mount and a mount *removed* from the declaration must not leave its
 * directory behind. That reasoning survives intact — the keep set is still
 * exactly what this pass is willing to own, and everything else still goes —
 * but the keep set is no longer knowable before the pass runs. A claimed child
 * is discovered by classifying its parent, so pruning first would sweep away
 * the child directories of the previous build and pruning with the declaration
 * alone would sweep away the ones this build just wrote. Pruning last is the
 * only order in which the set it is deciding against is the set that exists.
 */
export function runAnalyzeStage(
  options: ResolvedOptions,
  stage: AnalyzeStageOptions = {},
): AnalyzeReport {
  const log = stage.log ?? ((line: string) => console.log(line));

  const outcomes: MountOutcome[] = [];
  const origins: ClaimedOrigin[] = [];
  for (const mount of options.mounts) {
    const { analysis, emitted } = runComptime(mount.sourcePath, {
      root: options.corpusRoot,
      outRoot: options.artifactDir,
      component: mount.component,
    });
    outcomes.push({ mount, analysis, emittedDir: emitted?.dir ?? null });

    if (analysis.status !== 'provable') continue;

    log(
      `provable  ${analysis.module} (${analysis.component}): ` +
        `${analysis.cells.length} cell(s), ${analysis.bindings.length} binding(s), ` +
        `${analysis.handlers.length} handler(s) -> ` +
        `${relative(options.corpusRoot, emitted!.dir)}/`,
    );

    if (analysis.claimedChildren.length > 0) {
      origins.push({ artifact: mount.artifact, claimed: analysis.claimedChildren });
    }
  }

  const derived = deriveClaimedArtifacts(options, origins, { log });

  const pruned = options.policies.pruneStaleArtifacts ? pruneStaleArtifacts(options, derived) : [];

  const unprovable = outcomes.filter(
    (outcome) => outcome.mount.expectProvable && outcome.analysis.status !== 'provable',
  );
  if (unprovable.length > 0) throw unprovableError(unprovable, outcomes.length);

  return { outcomes, derived, pruned };
}

/**
 * Every artifact reachable from a declared mount through `claimedChildren`,
 * emitted.
 *
 * TERMINATION IS A PROPERTY OF THIS LOOP AND OF NOTHING ELSE. The classifier
 * already refuses a cycle by name (`ClaimedChildCycle`) while it is walking the
 * chain of components being addressed, and this function deliberately does not
 * lean on that: it works over artifact ids, which are what the emitted tree is
 * keyed by, and it marks an id visited BEFORE it emits it. The visited set is
 * seeded with every declared mount, so an address that is already someone's
 * declaration is left to that declaration, and a queue that would revisit an id
 * — through a genuine mutual claim, through two parents addressing one child,
 * or through a manifest a hand has edited — finds it already marked and stops.
 * A malformed tree makes this pass do less work, never more.
 *
 * Breadth-first rather than recursive so the depth of a composition is a number
 * in a queue rather than a frame on the JavaScript stack.
 */
export function deriveClaimedArtifacts(
  options: ResolvedOptions,
  origins: readonly ClaimedOrigin[],
  stage: AnalyzeStageOptions = {},
): DerivedChild[] {
  const log = stage.log ?? ((line: string) => console.log(line));

  const visited = new Set(options.mounts.map((mount) => mount.artifact));
  const derived: DerivedChild[] = [];
  const queue: ClaimedOrigin[] = [...origins];

  while (queue.length > 0) {
    const origin = queue.shift()!;
    for (const child of origin.claimed) {
      if (visited.has(child.artifact)) continue;
      visited.add(child.artifact);

      const emitted = emitClaimedChild(options, origin.artifact, child);
      derived.push(emitted);

      log(
        `addressed ${child.module} (${child.component}): ` +
          `claimed by ${origin.artifact} at ${child.locator} -> ` +
          `${relative(options.corpusRoot, emitted.emittedDir)}/`,
      );

      if (emitted.analysis.claimedChildren.length > 0) {
        queue.push({ artifact: child.artifact, claimed: emitted.analysis.claimedChildren });
      }
    }
  }

  return derived;
}

function recordsEqual(
  left: ReadonlyArray<RecordedProp> | undefined,
  right: ReadonlyArray<RecordedProp> | undefined,
): boolean {
  const prior = left ?? [];
  const next = right ?? [];
  if (prior.length !== next.length) return false;
  if (prior.length === 0) return true;
  const byName = new Map(prior.map((prop) => [prop.name, prop.value]));
  return next.every((prop) => byName.get(prop.name) === prop.value);
}

function identityKey(prop: IdentityProp): string {
  return identityRecordKey(prop);
}

function identitiesEqual(
  left: ReadonlyArray<IdentityProp> | undefined,
  right: ReadonlyArray<IdentityProp> | undefined,
): boolean {
  const prior = left ?? [];
  const next = right ?? [];
  if (prior.length !== next.length) return false;
  if (prior.length === 0) return true;
  const seen = new Set(prior.map(identityKey));
  return next.every((prop) => seen.has(identityKey(prop)));
}

interface StampedClaim {
  recordedProps?: RecordedProp[];
  identityProps?: IdentityProp[];
}

/**
 * The record the parent's own manifest stamped for this address, or undefined
 * when that file is not there yet (a hand-built origin in a test, a vanished
 * module). Compared against the in-memory ClaimedChild so a child cannot be
 * published under a valuation the parent did not write.
 */
function stampedClaimOf(
  options: ResolvedOptions,
  parent: string,
  artifact: string,
): StampedClaim | undefined {
  const path = join(options.artifactDir, parent, 'manifest.json');
  if (!existsSync(path)) return undefined;
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as {
    claimedChildren?: Array<{
      artifact: string;
      recordedProps?: RecordedProp[];
      identityProps?: IdentityProp[];
    }>;
  };
  return manifest.claimedChildren?.find((entry) => entry.artifact === artifact);
}

/**
 * One claimed address, turned into artifacts or refused by name.
 *
 * The child is classified from its own module rather than from its parent's
 * seat, because that is what the address means: a component with an artifact
 * directory of its own, found and resumed by exactly the walk that already
 * finds a page's root mounts. The isolated re-run sees the parent's recorded
 * props — slice A's `analyzeWithRecordedProps` — and, when the parent stamped
 * an identity record, slice C's `analyzeWithIdentityProps`. A hard consistency
 * check refuses rather than publish if either record disagrees with the
 * parent's ClaimedChild entry, or if the emitted artifact would not match the
 * isolated classify that used it.
 *
 * Four things can go wrong and all four are refusals — the module cannot be
 * read or classified, the record disagrees, the verdict is not provable, or
 * the artifacts landed somewhere other than the address the parent's template
 * already stamped into its markup. The last is the quietest and the worst: a
 * directory full of correct artifacts at a name nothing looks for is a hole
 * that stays empty.
 */
function emitClaimedChild(
  options: ResolvedOptions,
  parent: string,
  child: ClaimedChild,
): DerivedChild {
  const sourcePath = join(options.corpusRoot, child.module);
  const expected = resolve(join(options.artifactDir, child.artifact));
  const where =
    `${child.module} (${child.component}), addressed by ${parent} at ${child.locator}`;

  if (!existsSync(sourcePath)) {
    throw new ClaimedChildEmissionError(
      'ClaimedChildNotEmitted',
      `${where}: the module is not there (looked at ${sourcePath}). The parent's template ` +
        `already carries an empty mount container at this address; a build that cannot emit ` +
        `what fills it must say so rather than ship the hole.`,
      parent,
      child,
    );
  }

  const record = child.recordedProps ?? [];
  const identities = child.identityProps ?? [];
  const derived = claimedArtifactKey(child.module, child.component, record, identities);
  if (child.artifact !== derived) {
    throw new ClaimedChildEmissionError(
      'ClaimedChildMisaddressed',
      `${where}: emitted to ${join(options.artifactDir, derived)}, and the parent's markup addresses ${expected}. ` +
        `Artifacts at a name nothing looks for fill nothing.`,
      parent,
      child,
    );
  }
  const stamped = stampedClaimOf(options, parent, child.artifact);
  if (
    !recordsEqual(stamped?.recordedProps, child.recordedProps) ||
    !identitiesEqual(stamped?.identityProps, child.identityProps)
  ) {
    throw new ClaimedChildEmissionError(
      'ClaimedChildRecordMismatch',
      `${where}: the child artifact would be published under a record that disagrees ` +
        `with the parent's ClaimedChild entry. Refuse rather than publish.`,
      parent,
      child,
    );
  }

  const isolatedOptions = {
    root: options.corpusRoot,
    component: child.component,
    write: false as const,
    ...(record.length > 0 ? { recordedProps: record } : {}),
  };

  let isolated: Analysis;
  try {
    isolated =
      identities.length > 0
        ? analyzeWithIdentityProps(sourcePath, identities, isolatedOptions)
        : analyzeWithRecordedProps(sourcePath, record, isolatedOptions);
  } catch (error) {
    throw new ClaimedChildEmissionError(
      'ClaimedChildNotEmitted',
      `${where}: the pass threw classifying or emitting it — ` +
        `${error instanceof Error ? error.message : String(error)}`,
      parent,
      child,
    );
  }

  if (isolated.status !== 'provable') {
    const reasons = isolated.reasons.map(
      (reason) => `${reason.code} @ ${reason.loc.line}:${reason.loc.column} — ${reason.message}`,
    );
    throw new ClaimedChildEmissionError(
      'ClaimedChildNotEmitted',
      `${where}: classified provable from its parent and NOT on its own.\n` +
        reasons.map((reason) => `          ${reason}`).join('\n'),
      parent,
      child,
    );
  }

  let emitted;
  try {
    emitted = emit(isolated, expected);
  } catch (error) {
    throw new ClaimedChildEmissionError(
      'ClaimedChildNotEmitted',
      `${where}: the pass threw classifying or emitting it — ` +
        `${error instanceof Error ? error.message : String(error)}`,
      parent,
      child,
    );
  }

  if (resolve(emitted.dir) !== expected) {
    throw new ClaimedChildEmissionError(
      'ClaimedChildMisaddressed',
      `${where}: emitted to ${emitted.dir}, and the parent's markup addresses ${expected}. ` +
        `Artifacts at a name nothing looks for fill nothing.`,
      parent,
      child,
    );
  }

  return { parent, child, analysis: isolated, emittedDir: emitted.dir };
}

/**
 * The refusal message carries every reason with its line and column, because a
 * verdict without a location is a verdict no one can act on — the point of the
 * message is that the reader opens the file at the right line.
 */
function unprovableError(unprovable: MountOutcome[], total: number): UnprovableMountError {
  const lines: string[] = [];
  for (const { mount, analysis } of unprovable) {
    lines.push(`fallback  ${mount.source} (${mount.component}) — expected provable`);
    for (const reason of analysis.reasons) {
      lines.push(`          ${reason.code} @ ${reason.loc.line}:${reason.loc.column} — ${reason.message}`);
    }
  }
  lines.push('');
  lines.push(`${unprovable.length} of ${total} declared components are no longer provable.`);
  return new UnprovableMountError(lines.join('\n'), unprovable);
}

/**
 * Everything under the artifact directory that this pass will not own.
 *
 * The keep set is the declaration PLUS the derivation. A claimed child's
 * directory is as load-bearing as a declared mount's — the parent's shipped
 * markup names it — and it is not something any consumer can be asked to
 * declare, since it is discovered by classifying the parent. Keeping only the
 * declaration would delete, on every build, exactly the directories the build
 * before it had to write.
 */
function pruneStaleArtifacts(options: ResolvedOptions, derived: readonly DerivedChild[]): string[] {
  if (!existsSync(options.artifactDir)) return [];

  const keep = new Set([
    ...options.mounts.map((mount) => join(options.artifactDir, mount.artifact)),
    ...derived.map((entry) => join(options.artifactDir, entry.child.artifact)),
  ]);
  const pruned: string[] = [];

  for (const entry of readdirSync(options.artifactDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(options.artifactDir, entry.name);
    if (keep.has(dir)) continue;
    rmSync(dir, { recursive: true, force: true });
    pruned.push(dir);
  }

  return pruned;
}
