#!/usr/bin/env node
/**
 * The Kobalte analyzability probe.
 *
 * It answers one bounded question: what does THIS repo's comptime pass say
 * about TWELVE PRE-REGISTERED Kobalte component functions — a set fixed on the
 * board before any verdict existed, so the answer cannot be a cherry-pick.
 *
 * Two arms, both pinned, both materialized off-tree under `os.tmpdir()`:
 *
 *   SOURCE (the REPORTING arm) — kobaltedev/kobalte at one commit, acquired by
 *   `git fetch --depth 1 origin <sha>`. Never by branch name, never through a
 *   codeload archive: GitHub's generated tarballs are not byte-stable, while
 *   git is content-addressed, so the SHA *is* the integrity hash. This arm is
 *   authored TypeScript, and it is what gives every published row a real
 *   `file:line` a Kobalte maintainer can act on.
 *
 *   DIST (the CORROBORATING arm, and the durability floor) —
 *   `@kobalte/core@2.0.0-alpha.0` by tarball integrity. npm's SLSA provenance
 *   resolves that tarball to the same commit, so the arms are the pre- and
 *   post-rolldown views of ONE artifact rather than two versions.
 *
 * Neither arm is installed and neither is built. `loadProjectFrom` follows
 * relative specifiers only and leaves bare ones external, and the dist keeps
 * its bare specifiers too, so the probe reads bytes and nothing else. It writes
 * only `docs/kobalte/profile.json` and `docs/kobalte/profile.md`, and it never
 * touches a `package.json`, a lockfile, or any `node_modules`.
 *
 * Content-hashed dist filenames are never hardcoded. Each arm is seeded from
 * its entrypoint and the wanted function is located across `project.modules`
 * with `findComponent`, then classified in the module that defines it.
 *
 *   node tools/kobalte-probe.mjs            # re-derive and publish
 *   node tools/kobalte-probe.mjs --verify   # re-acquire, re-derive, assert
 *
 * `--verify` re-acquires both arms from the network, asserts the tarball
 * integrity and `git rev-parse HEAD` both match their pins, asserts every
 * recorded per-component `(status, sorted reason codes)` tuple regenerates
 * identically from BOTH arms, re-renders both documents and asserts they are
 * byte-identical to what is on disk. Any difference exits non-zero.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { classifySite, findComponent, loadProjectFrom } from "../src/comptime/index.ts";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const WORK_ROOT = join(tmpdir(), "kobalte-probe");

// --------------------------------------------------------------------- pins

/**
 * The source arm's identity. `commit` is the whole of it: git names a tree by
 * its content, so re-acquiring this SHA either yields the same bytes or fails.
 * `tree` is recorded alongside it as a second, independent assertion.
 */
const SOURCE_ARM = {
  repo: "https://github.com/kobaltedev/kobalte.git",
  commit: "a892187065cf7e0d07e91db02310bd28a5619236",
  tree: "5b5d0ec25487640dfb6c70bec5d3e7bbbd5085e1",
};

/** The dist arm's identity: the published tarball, by hash and by byte count. */
const DIST_ARM = {
  spec: "@kobalte/core@2.0.0-alpha.0",
  tarball: "https://registry.npmjs.org/@kobalte/core/-/core-2.0.0-alpha.0.tgz",
  integrity: "sha512-6l5wJRkk/CRXWzbzwYeNfv38XHWKoL3Bj9ykJQexGcmyM2TQV4IpR1E/wDbhygT9TsI3LYP5qgdLj/l2xx+qiw==",
  bytes: 379195,
};

/**
 * THE PRE-REGISTERED TWELVE. Binding, and registered before any verdict
 * existed. This list is the entire subject of the published profile: every
 * claim the profile makes is a claim about these twelve functions and about
 * nothing else. A function that fails to resolve is recorded and the probe
 * stops — substitution is exactly how a pre-registered set quietly becomes a
 * selected one.
 */
const REGISTERED = [
  { entrypoint: "separator", fn: "SeparatorRoot" },
  { entrypoint: "button", fn: "ButtonRoot" },
  { entrypoint: "checkbox", fn: "CheckboxRoot" },
  { entrypoint: "checkbox", fn: "CheckboxControl" },
  { entrypoint: "checkbox", fn: "CheckboxIndicator" },
  { entrypoint: "dialog", fn: "DialogRoot" },
  { entrypoint: "dialog", fn: "DialogTrigger" },
  { entrypoint: "dialog", fn: "DialogContent" },
  { entrypoint: "dialog", fn: "DialogPortal" },
  { entrypoint: "tabs", fn: "TabsRoot" },
  { entrypoint: "tabs", fn: "TabsTrigger" },
  { entrypoint: "popover", fn: "PopoverContent" },
];

/**
 * ERRATA — corrections to how this profile is *read*, carried as data so the
 * published document can hold them without breaking the byte identity that
 * makes it a rendering rather than prose. Every entry here corrects an
 * inference; none of them touches a measured value, and an erratum that wanted
 * to change a code would be a re-derivation instead.
 *
 * `renderMarkdown` emits this array into `docs/kobalte/profile.md`, so the
 * correction reaches a reader of the profile itself rather than a sibling file
 * they would have no reason to open.
 */
const ERRATA = [
  {
    id: "E1",
    title: "Agreement between the arms is not corroboration of one cause",
    filed: "docs/kobalte/impossibility.md",
    corrects: "an inference from the totals, not a measurement",
    affects: ["totals.armsAgreeOnStatus", "totals.componentsWithIdenticalReasonCodes"],
    code: "jsx-component-element",
    standing:
      "Every code in this profile is correct, both arms, all twelve; a regeneration today is byte-identical and `--verify` says so. Nothing in this erratum asks a row to change.",
    misreading:
      "`armsAgreeOnStatus: true` and `componentsWithIdenticalReasonCodes: 11`, read casually, invite the inference that the two arms **corroborate one cause** for each shared code. For `jsx-component-element` — the code on all twelve — they do not.",
    arms: [
      {
        arm: "source",
        finding:
          "The polymorphic indirection's entry module is a bare `export * from` barrel. `loadProjectFrom` queues a module's `imports` only (`src/comptime/project.ts:78`), so the module behind the barrel never enters the analyzed set, its sole export record resolves to nothing, and `resolveChildComponent` bails at `definition() == null` (`classify.ts:373`). The arm never reaches the polymorphic machinery at all.",
      },
      {
        arm: "dist",
        finding:
          "Rolldown has flattened that edge into a direct named import, so the definition resolves, the machinery **is** reached, and the refusal happens later — at `inlinableChild`, on clauses about captures, statement count, whole-props use and a component root.",
      },
    ],
    reading: "Same code, same twelve, two different causes. The agreement is real; the corroboration it appears to offer is not.",
    consequence:
      "**The source arm is not a valid measurement surface for any polymorphic-path widening.** It cannot report whether such a widening worked, because it never executes the machinery the widening would change — a rule that fixed the shape completely would move zero source-arm codes, and a rule that broke it would also move zero.",
    ordering:
      "Future work on that path either measures on the **dist arm**, or lands the re-export-edge rule first and regenerates afterwards. The correct ordering is **rule-then-regenerate, not regenerate-now**; regenerating today produces the same bytes and buys nothing.",
    corroboration:
      "Not taken on trust. `test/fixtures/shapes/gate/` reproduces the mechanism in fourteen lines of first-party source, and `test/shape-corpus.test.ts` asserts the analyzed set of a module importing through a bare `export * from` barrel contains the barrel and not the module behind it.",
  },
];

/** How long a printed expression may run before the row elides the tail. */
const EXPRESSION_LIMIT = 220;

// -------------------------------------------------------------- acquisition

function git(cwd, ...args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function fail(message) {
  throw new Error(message);
}

/**
 * Materializes the source arm by SHA. The fetch runs every time: "re-acquire"
 * means re-acquire, and a depth-1 fetch of an object already present is cheap.
 * `checkout --force` plus `clean -fd` is what makes the byte identity real
 * rather than assumed — a leftover edit in the cache would otherwise silently
 * become part of the measurement.
 */
function acquireSource() {
  const dir = join(WORK_ROOT, `source-${SOURCE_ARM.commit}`);
  mkdirSync(dir, { recursive: true });

  if (!existsSync(join(dir, ".git"))) {
    git(dir, "init", "-q");
    git(dir, "remote", "add", "origin", SOURCE_ARM.repo);
  }
  git(dir, "fetch", "--depth", "1", "-q", "origin", SOURCE_ARM.commit);
  git(dir, "checkout", "-q", "--force", SOURCE_ARM.commit);
  git(dir, "clean", "-qfd");

  const head = git(dir, "rev-parse", "HEAD").trim();
  if (head !== SOURCE_ARM.commit) {
    fail(`source arm HEAD is ${head}, pinned at ${SOURCE_ARM.commit}`);
  }
  const tree = git(dir, "rev-parse", "HEAD^{tree}").trim();
  if (tree !== SOURCE_ARM.tree) {
    fail(`source arm tree is ${tree}, pinned at ${SOURCE_ARM.tree}`);
  }
  const dirty = git(dir, "status", "--porcelain").trim();
  if (dirty !== "") fail(`source arm working tree is not clean:\n${dirty}`);

  return { root: dir, head, tree };
}

/**
 * Materializes the dist arm by tarball integrity. The hash is asserted BEFORE
 * anything is extracted, so nothing that failed its integrity check is ever
 * read by the analyzer.
 */
async function acquireDist() {
  const response = await fetch(DIST_ARM.tarball);
  if (!response.ok) fail(`dist arm download failed: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());

  const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
  if (integrity !== DIST_ARM.integrity) {
    fail(`dist arm integrity is ${integrity}, pinned at ${DIST_ARM.integrity}`);
  }
  if (bytes.length !== DIST_ARM.bytes) {
    fail(`dist arm is ${bytes.length} bytes, pinned at ${DIST_ARM.bytes}`);
  }

  const dir = join(WORK_ROOT, "dist-2.0.0-alpha.0");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const tgz = join(dir, "core.tgz");
  writeFileSync(tgz, bytes);
  execFileSync("tar", ["-xzf", tgz, "-C", dir]);

  return { root: join(dir, "package"), integrity, bytes: bytes.length };
}

// ------------------------------------------------------------------ reading

/** The entry module each arm is seeded from, root-relative. */
const ENTRY = {
  source: (entrypoint) => `packages/core/src/${entrypoint}/index.tsx`,
  dist: (entrypoint) => `dist/${entrypoint}/index.jsx`,
};

function nameOf(node) {
  if (node == null) return null;
  if (node.type === "Identifier") return node.name;
  if (node.type === "MemberExpression") return `${nameOf(node.object)}.${nameOf(node.property)}`;
  return null;
}

/** Innermost node of `nodes` whose span encloses `[start, end]`. */
function innermost(nodes, start, end) {
  let best = null;
  for (const node of nodes) {
    if (node.start > start || end > node.end) continue;
    if (best === null || node.start > best.start) best = node;
  }
  return best;
}

/**
 * The public alias the entrypoint re-exports a function under, read off the
 * entry module's own import specifiers (`DialogRoot as Root`). Source arm only:
 * the dist entrypoint imports through rolldown's mangled edge (`r as
 * SeparatorRoot`), which names a chunk slot rather than a public alias.
 */
function aliasOf(entryModule, wanted) {
  for (const statement of entryModule.ast.body) {
    if (statement.type !== "ImportDeclaration") continue;
    for (const specifier of statement.specifiers ?? []) {
      if (specifier.type !== "ImportSpecifier") continue;
      if (specifier.imported?.name === wanted) return specifier.local.name;
    }
  }
  return null;
}

/** The author's own bytes for a refusal's span, collapsed onto one line. */
function excerpt(source, loc) {
  const raw = source.slice(loc.start, loc.end).replace(/\s+/g, " ").trim();
  return raw.length > EXPRESSION_LIMIT ? `${raw.slice(0, EXPRESSION_LIMIT)} …` : raw;
}

/**
 * Runs this repo's existing comptime pass over the twelve in one arm.
 *
 * Nothing here decides anything: it seeds `loadProjectFrom` from the
 * entrypoint, finds the module that DEFINES the wanted name, and hands that
 * module to `classifySite`. A name that resolves in no module, or in more than
 * one, is a hard stop rather than a guess.
 */
function analyzeArm(arm, root) {
  const entryOf = ENTRY[arm];
  const projects = new Map();
  const records = new Map();

  for (const { entrypoint, fn } of REGISTERED) {
    if (!projects.has(entrypoint)) {
      projects.set(entrypoint, loadProjectFrom([join(root, entryOf(entrypoint))], root));
    }
    const project = projects.get(entrypoint);

    const hits = [];
    for (const [path, module] of project.modules) {
      const site = findComponent(module, fn);
      if (site !== null) hits.push({ path, module, site });
    }
    if (hits.length === 0) {
      fail(`${entrypoint}/${fn} does not resolve in the ${arm} arm (${project.modules.size} modules linked)`);
    }
    if (hits.length > 1) {
      fail(`${entrypoint}/${fn} defines in ${hits.length} modules in the ${arm} arm: ${hits.map((h) => h.path).join(", ")}`);
    }

    const { path, module, site } = hits[0];
    const analysis = classifySite(module, site);

    const calls = module.findAll("CallExpression").filter((n) => n.start >= site.fn.start && n.end <= site.fn.end);
    const declarators = module
      .findAll("VariableDeclarator")
      .filter((n) => n.start >= site.fn.start && n.end <= site.fn.end);

    const reasons = analysis.reasons.map((reason) => {
      const call = innermost(calls, reason.loc.start, reason.loc.end);
      const declarator = innermost(declarators, reason.loc.start, reason.loc.end);
      return {
        code: reason.code,
        line: reason.loc.line,
        column: reason.loc.column,
        span: reason.loc.end - reason.loc.start,
        message: reason.message,
        detail: reason.detail ?? null,
        expression: excerpt(module.source, reason.loc),
        enclosingCall: call === null ? null : nameOf(call.callee),
        enclosingBinding: declarator?.id?.type === "Identifier" ? declarator.id.name : null,
      };
    });

    records.set(`${entrypoint}/${fn}`, {
      entrypoint,
      fn,
      module: path,
      exported: site.exported,
      linkedModules: project.modules.size,
      alias: arm === "source" ? aliasOf(project.entry, fn) : null,
      status: analysis.status,
      reasons,
    });
  }

  return records;
}

// ------------------------------------------------------------- the diagnosis

const NOT_AUTHORIZED = "NOT AUTHORIZED under zero-Solid-API-changes";

/** What `<X>` is, said once, for the elements the twelve actually route through. */
function elementRole(name) {
  if (name === "Polymorphic") return "Kobalte's polymorphic `as` indirection, which is how this component lets a caller swap its host element";
  if (name === "Portal") return "`<Portal>` from `@solidjs/web`, which relocates the subtree out of this component's own markup";
  if (name === "DismissableLayer") return "Kobalte's dismissable-layer wrapper, which carries the outside-press and escape handling this part exists to provide";
  if (name === "DomCollectionProvider") return "Kobalte's DOM-collection provider, which registers the descendants roving focus walks";
  if (name.endsWith("Context")) return "a Kobalte context provider element, which is how this component publishes its state to the parts below it";
  if (name.includes(".")) return "a Kobalte compound part reached through a `JSXMemberExpression` — the module it comes from IS in the analyzed set here, so the member-expression form alone is what the splice cannot address";
  return "a Kobalte component element";
}

function elementKobalteChange(name) {
  if (name === "Polymorphic") {
    return "Render the host element directly rather than through `<Polymorphic>`. That removes this component's `as` override, so it is a change to its public shape, not a local tidy-up.";
  }
  if (name === "Portal") {
    return "Render the content in place instead of through `<Portal>` — which removes the out-of-tree layering this part exists to provide.";
  }
  if (name === "DismissableLayer") {
    return "Render the content element directly and attach the dismiss behaviour as a primitive on a ref, rather than wrapping the markup in a behaviour component.";
  }
  if (name === "DomCollectionProvider") {
    return "Register collection items without a provider element in the returned markup.";
  }
  if (name.endsWith("Context")) {
    return "Publish this component's state without a provider ELEMENT in the returned markup. Solid's context API takes a provider component in the tree, so there is no local Kobalte-side edit here: the state would have to be shared by some other mechanism entirely.";
  }
  if (name.includes(".")) {
    return `Import the part as a plain binding rather than reaching it through a namespace object (\`${name}\` -> \`${name.split(".").pop()}\`). That alone does not make it templatable — it is still a component element — but it is the change that takes the member-expression form out of the way.`;
  }
  return `Return an intrinsic root rather than delegating the whole body to \`<${name}>\`.`;
}

function elementAnalyzerChange(name) {
  if (name.includes(".")) {
    return `${NOT_AUTHORIZED} — admit a \`JSXMemberExpression\` in \`tryInlineComponent\`, which today requires a \`JSXIdentifier\` whose \`definition()\` lies inside the analyzed set.`;
  }
  return `${NOT_AUTHORIZED} — widen the depth-1 component splice so \`<${name}>\`'s body is absorbed into this template, or admit component elements into static templating outright.`;
}

/** The JSX element name a `jsx-component-element` refusal points at. */
function jsxName(expression) {
  const match = /^<\s*([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*)/.exec(expression);
  return match === null ? "a component" : match[1].replace(/\s+/g, "");
}

/** Distinct `use*Context` hooks a refusal's own span calls. */
function contextHooks(expression) {
  const found = new Set();
  for (const match of expression.matchAll(/\buse[A-Za-z]*Context\b/g)) found.add(match[0]);
  return [...found];
}

/**
 * The causing shape in one sentence naming the Kobalte construct, plus the two
 * NEVER-MERGED "what would have to change" columns.
 *
 * Every sentence is derived from what the classifier actually recorded — the
 * code, its detail, the printed expression, and the construct enclosing it —
 * so the prose regenerates with the measurement instead of drifting from it.
 * The analyzer column is a DIAGNOSIS, not a plan: this tranche authorizes zero
 * Solid API changes, and every entry in it says so.
 */
function describe(component, reason) {
  const { code, detail, expression, enclosingCall, enclosingBinding } = reason;
  const fn = component.fn;

  if (code === "no-signal-source") {
    const hooks = contextHooks(expression);
    const via = hooks.length === 0 ? "its props" : hooks.map((h) => `\`${h}\``).join(" and ");
    return {
      shape: `\`${fn}\` declares no \`createSignal\` of its own: it is a leaf that reads ${via} and renders from what it finds there, so there is no source cell for a resumed page to restore.`,
      kobalte: `Nothing local. A context-consuming leaf holds no state by construction — the cell this part would resume is declared by the provider above it, which this profile classifies separately.`,
      analyzer: `${NOT_AUTHORIZED} — resolve a consumer's cells through the provider that supplies its context, so a stateless leaf inherits the provider's source cells instead of refusing for having none.`,
    };
  }

  if (code === "signal-initializer-not-literal") {
    if (/ownedWrite/.test(expression)) {
      return {
        shape: `\`${fn}\` creates this cell as \`createSignal(undefined, { ownedWrite: true })\` — the Solid 2 opt-in Kobalte uses so a descendant part can write the ref signal its owner declared. The pass freezes a source cell from a single literal argument, and a two-argument factory call is not one.`,
        kobalte: "Drop the options argument on this cell, or carry the shared-write opt-in somewhere other than the factory call. The cost is real rather than cosmetic: `ownedWrite: true` is what lets a nested part set the ref this component owns.",
        analyzer: `${NOT_AUTHORIZED} — fold a statically-known options object and keep the first literal argument as the cell's initial value.`,
      };
    }
    return {
      shape: `\`${fn}\` seeds this cell from \`${expression}\`, a computed initializer rather than a serializable literal — Kobalte starts its DOM-collection cell from a fresh array, which is a new identity on every call.`,
      kobalte: "Seed the collection cell from a serializable literal. For a collection that is not a small edit: it means a representation whose empty state is not a freshly allocated array.",
      analyzer: `${NOT_AUTHORIZED} — widen \`StaticValue\` past string/number/boolean/null to admit empty array and object literals as frozen initial values.`,
    };
  }

  if (code === "jsx-component-element") {
    const name = jsxName(expression);
    return {
      shape: `\`${fn}\`'s markup routes through \`<${name}>\`, ${elementRole(name)}; only intrinsic elements template statically, so the pass stops at this element.`,
      kobalte: elementKobalteChange(name),
      analyzer: elementAnalyzerChange(name),
    };
  }

  if (code === "signal-escapes-to-opaque-callee") {
    const binding = detail?.binding ?? "the cell";
    const callee = detail?.callee ?? "an external callee";
    const definedIn = detail?.definedIn ?? null;
    const where =
      definedIn === null
        ? "a Kobalte primitive whose definition this pass did not resolve into the analyzed set at all"
        : `a Kobalte primitive defined in \`${definedIn}\`, outside this component`;
    return {
      shape: `\`${binding}\` is handed to \`${callee}\`, ${where}, so what that primitive does with the signal is invisible and the cell cannot be proved to stay inside \`${fn}\`.`,
      kobalte: `Have \`${callee}\` take a plain value and a callback rather than the signal pair, so the cell never crosses the module edge.`,
      analyzer:
        definedIn === null
          ? `${NOT_AUTHORIZED} — resolve \`${callee}\` and summarize its use of the signal instead of treating an unresolved callee as opaque.`
          : `${NOT_AUTHORIZED} — summarize what \`${callee}\` does with the signal instead of treating every out-of-component callee as opaque.`,
    };
  }

  if (code === "signal-escapes-unanalyzable-use") {
    const binding = detail?.binding ?? "the cell";
    if (detail?.parent === "ArrayExpression") {
      return {
        shape: `\`${binding}\` sits inside the \`ref={[…]}\` array literal Kobalte uses to fan one host-element ref out to both its own setter and the caller's \`props.ref\`; an array-literal position is not one the pass can prove safe for a setter.`,
        kobalte: "Merge the two refs behind a single callback rather than handing the setter to an array literal in the `ref` attribute.",
        analyzer: `${NOT_AUTHORIZED} — admit an array-literal ref fan-out as a proved-safe setter position.`,
      };
    }
    if (enclosingCall !== null) {
      return {
        shape: `\`${binding}\` is packed into the options object literal Kobalte hands to \`${enclosingCall}(…)\`, so the cell leaves \`${fn}\` as a field of an argument the pass cannot follow.`,
        kobalte: `Pass \`${enclosingCall}\` a value it can read rather than the cell itself, so what crosses the call boundary is data instead of a live signal.`,
        analyzer: `${NOT_AUTHORIZED} — follow a signal through an options-object field into \`${enclosingCall}\` and summarize what it does there.`,
      };
    }
    const holder = enclosingBinding === null ? "an object literal" : `the \`${enclosingBinding}\` object literal`;
    return {
      shape: `\`${binding}\` is packed as a field of ${holder} that \`${fn}\` publishes through its context provider element, so the cell escapes the component that declared it and becomes state any descendant can reach.`,
      kobalte: "Publish a read-only accessor rather than the cell itself, so the setter never becomes a context field. That changes what the parts below this one are allowed to do, which is an API decision rather than a refactor.",
      analyzer: `${NOT_AUTHORIZED} — track a signal through a context value object and into its consumers, which is a whole-graph analysis this pass does not attempt.`,
    };
  }

  if (code === "show-branch-not-static-at-capture") {
    return {
      shape: `The \`<Show>\` guard is \`${expression}\` — a presence accessor Kobalte derives from its disclosure state and reads back off context. The build can neither fold it nor measure it, so which branch the served markup carries is not settled before the page runs.`,
      kobalte: "Make the guard something the build can settle — a literal, or a value captured in the served first paint. A presence accessor driven by open/close state is neither, and it is the behaviour this part exists to provide.",
      analyzer: `${NOT_AUTHORIZED} — measure a two-state region whose guard reads a third-party context accessor.`,
    };
  }

  if (code === "jsx-dynamic-child-not-derivable") {
    return {
      shape: `\`${expression}\` is a caller-supplied children slot: \`${fn}\` places arbitrary markup it never sees, so nothing in the build can derive the text this position will carry.`,
      kobalte: "Nothing local. A compound component that did not accept opaque children would not be a compound component; the slot is the feature.",
      analyzer: `${NOT_AUTHORIZED} — admit an opaque children slot as a templated hole to be filled at capture.`,
    };
  }

  return {
    shape: `\`${fn}\` was refused with \`${code}\` at \`${expression}\`.`,
    kobalte: "Not characterised: this code was not observed across the twelve when the profile's prose was written.",
    analyzer: `${NOT_AUTHORIZED}.`,
  };
}

// ------------------------------------------------------------------- shaping

function tally(reasons) {
  const counts = new Map();
  for (const reason of reasons) counts.set(reason.code, (counts.get(reason.code) ?? 0) + 1);
  return counts;
}

function sortedCodes(reasons) {
  return reasons.map((reason) => reason.code).sort();
}

/**
 * One published row per pre-registered function.
 *
 * Reasons are published from the SOURCE arm, which is why the source arm is the
 * reporting one: its `file:line` is a place a maintainer can open. A code the
 * dist arm raises and the source arm does not would be published from the dist
 * arm and marked as such; the delta column carries the difference either way.
 */
function buildComponents(source, dist) {
  const components = [];

  for (const { entrypoint, fn } of REGISTERED) {
    const key = `${entrypoint}/${fn}`;
    const src = source.get(key);
    const dst = dist.get(key);

    if (src.status !== dst.status) {
      fail(
        `${key}: the two arms disagree on STATUS (source ${src.status}, dist ${dst.status}). ` +
          "That is a Judge question, not a Worker's — reason-code deltas are expected, status deltas are not.",
      );
    }

    const srcCounts = tally(src.reasons);
    const dstCounts = tally(dst.reasons);
    const srcCodes = new Set(srcCounts.keys());
    const dstCodes = new Set(dstCounts.keys());

    const published = src.reasons.map((reason) => {
      const prose = describe(src, reason);
      return {
        code: reason.code,
        loc: `${src.module}:${reason.line}:${reason.column}`,
        line: reason.line,
        column: reason.column,
        arm: "source",
        alsoInDist: dstCodes.has(reason.code),
        expression: reason.expression,
        expressionBytes: reason.span,
        message: reason.message,
        detail: reason.detail,
        shape: prose.shape,
        wouldChange: { kobalte: prose.kobalte, analyzer: prose.analyzer },
      };
    });

    for (const reason of dst.reasons) {
      if (srcCodes.has(reason.code)) continue;
      const prose = describe(dst, reason);
      published.push({
        code: reason.code,
        loc: `${dst.module}:${reason.line}:${reason.column}`,
        line: reason.line,
        column: reason.column,
        arm: "dist",
        alsoInDist: true,
        expression: reason.expression,
        expressionBytes: reason.span,
        message: reason.message,
        detail: reason.detail,
        shape: prose.shape,
        wouldChange: { kobalte: prose.kobalte, analyzer: prose.analyzer },
      });
    }

    const countDelta = [];
    for (const code of [...new Set([...srcCodes, ...dstCodes])].sort()) {
      const a = srcCounts.get(code) ?? 0;
      const b = dstCounts.get(code) ?? 0;
      if (a !== b) countDelta.push({ code, source: a, dist: b });
    }

    components.push({
      entrypoint,
      function: fn,
      alias: src.alias,
      publicPath: `@kobalte/core/${entrypoint}`,
      verdict: src.status,
      authoredSource: src.module,
      chunk: dst.module,
      exported: src.exported,
      arms: {
        source: { status: src.status, module: src.module, linkedModules: src.linkedModules, codes: sortedCodes(src.reasons) },
        dist: { status: dst.status, module: dst.module, linkedModules: dst.linkedModules, codes: sortedCodes(dst.reasons) },
      },
      delta: {
        identical: countDelta.length === 0,
        sourceOnly: [...srcCodes].filter((code) => !dstCodes.has(code)).sort(),
        distOnly: [...dstCodes].filter((code) => !srcCodes.has(code)).sort(),
        counts: countDelta,
      },
      reasons: published,
    });
  }

  return components;
}

/**
 * The ranked refusals table, in `docs/coverage/baseline.md`'s existing schema:
 * distinct components carrying the code, occurrences as the tiebreak, plus the
 * only-blocker count. A second schema would make the two documents impossible
 * to read against each other, so there is not one.
 */
function rankRefusals(components) {
  const byCode = new Map();
  for (const component of components) {
    const seen = new Set();
    for (const reason of component.reasons) {
      const entry = byCode.get(reason.code) ?? { code: reason.code, components: 0, occurrences: 0, onlyBlockerFor: 0 };
      entry.occurrences += 1;
      if (!seen.has(reason.code)) {
        entry.components += 1;
        seen.add(reason.code);
      }
      byCode.set(reason.code, entry);
    }
  }
  for (const component of components) {
    const codes = new Set(component.reasons.map((reason) => reason.code));
    if (codes.size !== 1) continue;
    const [only] = codes;
    byCode.get(only).onlyBlockerFor += 1;
  }
  return [...byCode.values()].sort(
    (a, b) => b.components - a.components || b.occurrences - a.occurrences || a.code.localeCompare(b.code),
  );
}

function onlyBlockers(components) {
  return components
    .filter((component) => new Set(component.reasons.map((r) => r.code)).size === 1)
    .map((component) => ({
      function: component.function,
      authoredSource: component.authoredSource,
      code: component.reasons[0].code,
    }));
}

function buildProfile(sourceArm, distArm, source, dist) {
  const components = buildComponents(source, dist);
  const manifest = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));

  const provable = components.filter((c) => c.verdict === "provable").length;
  const sourceFiles = new Set(components.map((c) => c.authoredSource));
  const distFiles = new Set(components.map((c) => c.chunk));

  return {
    schema: "kobalte-refusal-profile/1",
    subject: {
      claim: "Every statement in this profile is bounded to the twelve pre-registered functions listed in `components`.",
      preRegistered: REGISTERED.map((r) => `${r.entrypoint}/${r.fn}`),
      count: REGISTERED.length,
    },
    provenance: {
      source: {
        role: "reporting",
        repo: SOURCE_ARM.repo,
        commit: sourceArm.head,
        tree: sourceArm.tree,
        acquisition: "git fetch --depth 1 origin <sha>",
        files: sourceFiles.size,
      },
      dist: {
        role: "corroborating",
        spec: DIST_ARM.spec,
        tarball: DIST_ARM.tarball,
        integrity: distArm.integrity,
        bytes: distArm.bytes,
        provenanceNote: "npm SLSA provenance resolves this tarball to the source arm's commit, so the arms are the pre- and post-rolldown views of one artifact.",
        files: distFiles.size,
      },
    },
    analyzer: {
      pass: "src/comptime (write: false)",
      entryPoints: ["loadProjectFrom", "findComponent", "classifySite"],
      yukuAnalyzer: manifest.dependencies["yuku-analyzer"],
      yukuParser: manifest.dependencies["yuku-parser"],
      yukuCodegen: manifest.dependencies["yuku-codegen"],
      installed: false,
      built: false,
    },
    totals: {
      components: components.length,
      provable,
      fallback: components.length - provable,
      provableFraction: `${((provable / components.length) * 100).toFixed(1)}%`,
      sourceFiles: sourceFiles.size,
      distFiles: distFiles.size,
      armsAgreeOnStatus: components.every((c) => c.arms.source.status === c.arms.dist.status),
      componentsWithIdenticalReasonCodes: components.filter((c) => c.delta.identical).length,
    },
    ranked: rankRefusals(components),
    onlyBlockers: onlyBlockers(components),
    errata: ERRATA,
    components,
  };
}

// ------------------------------------------------------------------ markdown

const cell = (text) => String(text).replaceAll("|", "\\|").replaceAll("\n", " ");
const code = (text) => `\`${String(text).replaceAll("`", "'").replaceAll("|", "\\|")}\``;

/**
 * Rows are grouped by (code, shape) so a component that escapes nine cells into
 * one context object reads as one diagnosis with nine sites, not nine
 * diagnoses. Nothing is dropped: every `line:column` and every printed
 * expression appears in the row it belongs to, and `profile.json` carries the
 * reasons ungrouped.
 */
function groupReasons(reasons) {
  const groups = new Map();
  for (const reason of reasons) {
    const key = `${reason.code}\u0000${reason.shape}`;
    const group = groups.get(key) ?? {
      code: reason.code,
      shape: reason.shape,
      wouldChange: reason.wouldChange,
      arm: reason.arm,
      alsoInDist: reason.alsoInDist,
      sites: [],
    };
    group.sites.push(reason);
    groups.set(key, group);
  }
  return [...groups.values()];
}

function deltaCell(group) {
  if (group.arm === "dist") return "**dist only**";
  return group.alsoInDist ? "same in both arms" : "**source only**";
}

function componentSection(component) {
  const lines = [];
  const alias = component.alias === null ? "" : ` — \`${component.publicPath}\` -> \`${component.alias}\``;

  lines.push(`### \`${component.function}\`${alias}`);
  lines.push("");
  lines.push("| Field | Value |");
  lines.push("|---|---|");
  lines.push(`| Entrypoint | ${code(component.publicPath)} |`);
  lines.push(`| Function | ${code(component.function)} |`);
  lines.push(`| Authored source (source arm) | ${code(component.authoredSource)} |`);
  lines.push(`| Chunk (dist arm) | ${code(component.chunk)} |`);
  lines.push(`| Exported from its module | ${component.exported ? "yes" : "no"} |`);
  lines.push(`| Verdict, source arm | **${component.arms.source.status}** |`);
  lines.push(`| Verdict, dist arm | **${component.arms.dist.status}** |`);
  lines.push(
    `| Reason set | ${component.reasons.length} occurrence(s) across ${new Set(component.reasons.map((r) => r.code)).size} code(s) |`,
  );
  lines.push("");

  if (component.reasons.length === 0) {
    lines.push("No refusal reasons: this function classified `provable`.");
    lines.push("");
    return lines;
  }

  lines.push(
    "| Code | Where (`line:column`) | Triggering expression | Causing shape | (a) Kobalte-side change | (b) Analyzer-side change — NOT AUTHORIZED | Δ source vs dist |",
  );
  lines.push("|---|---|---|---|---|---|---|");
  for (const group of groupReasons(component.reasons)) {
    const where = group.sites.map((site) => code(`${site.line}:${site.column}`)).join("<br>");
    const printed = group.sites.map((site) => code(site.expression)).join("<br>");
    lines.push(
      `| ${code(group.code)} | ${where} | ${printed} | ${cell(group.shape)} | ${cell(group.wouldChange.kobalte)} | ${cell(group.wouldChange.analyzer)} | ${deltaCell(group)} |`,
    );
  }
  lines.push("");
  return lines;
}

/**
 * The errata block. It renders from `profile.errata` for one reason: the byte
 * check at the bottom of `--verify` means a hand-appended correction to
 * `docs/kobalte/profile.md` fails the very command that certifies the
 * measurement the correction is about. Carried as data, the profile holds its
 * own errata and still regenerates byte-identically by construction.
 *
 * Nothing here is a measurement. Each entry corrects a *reading* of the
 * measurements, which is why it sits beside the totals it qualifies rather
 * than inside them.
 */
function errataSection(p) {
  if (p.errata.length === 0) return [];

  const lines = [];
  lines.push("## Errata");
  lines.push("");
  lines.push(
    "Corrections to how this profile is **read**. No entry below changes a measured value — every code in every row is correct in both arms, and a regeneration today is byte-identical. What an erratum corrects is an inference a reader is invited to draw and should not.",
  );
  lines.push("");

  for (const erratum of p.errata) {
    lines.push(`### ${erratum.id} — ${erratum.title}`);
    lines.push("");
    lines.push("| Field | Value |");
    lines.push("|---|---|");
    lines.push(`| Corrects | ${cell(erratum.corrects)} |`);
    lines.push(`| Fields it qualifies | ${erratum.affects.map(code).join(", ")} |`);
    lines.push(`| Code at issue | ${code(erratum.code)} |`);
    lines.push(`| Full account | ${code(erratum.filed)} |`);
    lines.push("");
    lines.push(`**The measurements stand.** ${erratum.standing}`);
    lines.push("");
    lines.push(`**What is wrong is a reading.** ${erratum.misreading}`);
    lines.push("");
    for (const arm of erratum.arms) lines.push(`- **${arm.arm} arm:** ${arm.finding}`);
    lines.push("");
    lines.push(erratum.reading);
    lines.push("");
    lines.push(`**The operational consequence, which is the part that must not be lost.** ${erratum.consequence}`);
    lines.push("");
    lines.push(erratum.ordering);
    lines.push("");
    lines.push(erratum.corroboration);
    lines.push("");
  }

  return lines;
}

function renderMarkdown(profile) {
  const p = profile;
  const lines = [];
  const twelve = `${p.totals.components}`;

  lines.push("# Kobalte under this repo's comptime pass — a refusal profile over twelve pre-registered functions");
  lines.push("");
  lines.push("Generated by `node tools/kobalte-probe.mjs`. Do not hand-edit: regenerate.");
  lines.push("");
  lines.push("## What this document claims, and what it does not");
  lines.push("");
  lines.push(
    `This profile reports what this repo's existing comptime pass says about **${twelve} named Kobalte component functions**, listed below. Those ${twelve} functions were registered on the board **before any verdict existed**, which is the only reason the result can be read as a measurement rather than a selection.`,
  );
  lines.push("");
  lines.push(
    `**Every claim here is bounded to those ${twelve} functions.** This document does not say anything about Kobalte's other entrypoints, and a reader should not extend it to them: that would be a completeness claim nothing here priced.`,
  );
  lines.push("");
  lines.push(
    "One refusal that is **not** a Kobalte verdict, stated up front so it is never mistaken for one: a first-party component whose own markup renders `<Dialog.Root>` is refused with `jsx-component-element` at the analyzed-set boundary, because `tryInlineComponent` wants a `JSXIdentifier` whose `definition()` is inside the analyzed set and a member expression on a bare specifier is neither. That refusal is identical for **any** third-party library and says nothing about Kobalte. It is not measured here, and no row below is it.",
  );
  lines.push("");
  lines.push(
    "Two rows below do carry `jsx-component-element` on a member expression — `<Button.Root>` and `<Popper.Positioner>` — and they are a different thing: those come from relative imports inside Kobalte's own package, which this probe's module walk followed, so the defining module **is** in the analyzed set and only the member-expression form is in the way. Every verdict below is about a Kobalte function classified in the Kobalte module that defines it.",
  );
  lines.push("");
  lines.push("### The pre-registered set");
  lines.push("");
  for (const id of p.subject.preRegistered) lines.push(`- ${code(id)}`);
  lines.push("");

  lines.push("## Identity and provenance");
  lines.push("");
  lines.push(
    "Two arms, both pinned, both materialized off-tree under `os.tmpdir()`. Nothing was installed, nothing was built, no `package.json` or lockfile was touched, and no bundle was emitted — the pass ran with `write: false`.",
  );
  lines.push("");
  lines.push("| Arm | Role | Identity | How it was acquired |");
  lines.push("|---|---|---|---|");
  lines.push(
    `| source | **reporting** — every row's ${code("file:line")} | ${code(p.provenance.source.repo)} at commit ${code(p.provenance.source.commit)} (tree ${code(p.provenance.source.tree)}) | ${code(p.provenance.source.acquisition)}; never by branch name, never through a codeload archive |`,
  );
  lines.push(
    `| dist | **corroborating**, and the durability floor | ${code(p.provenance.dist.spec)}, integrity ${code(p.provenance.dist.integrity)}, ${p.provenance.dist.bytes} bytes | registry tarball, hash asserted before extraction |`,
  );
  lines.push("");
  lines.push(
    "GitHub's generated `.tar.gz` archives are not byte-stable, so the source arm is fetched by SHA: git is content-addressed, which makes the commit its own integrity hash. " +
      p.provenance.dist.provenanceNote +
      " That is why a reason-code difference between the arms is a fact about the analyzer's reach and not about two different libraries.",
  );
  lines.push("");
  lines.push(
    `Analyzer identity: this repo's ${code(p.analyzer.pass)} through ${p.analyzer.entryPoints.map(code).join(", ")}, on ${code(`yuku-analyzer@${p.analyzer.yukuAnalyzer}`)} / ${code(`yuku-parser@${p.analyzer.yukuParser}`)} / ${code(`yuku-codegen@${p.analyzer.yukuCodegen}`)}. No file under ${code("src/comptime/")} or ${code("plugin/src/")} was changed to produce this profile; a mirror-shaped analyzer would make every verdict below meaningless.`,
  );
  lines.push("");

  lines.push("## Method");
  lines.push("");
  lines.push(
    "Each arm is seeded from its entrypoint module — `packages/core/src/<entrypoint>/index.tsx` in the source arm, `dist/<entrypoint>/index.jsx` in the dist arm — and `loadProjectFrom` walks the relative imports on disk, leaving bare specifiers external exactly as a real build would. The wanted function is then located across `project.modules` with `findComponent` and classified **in the module that defines it**. No content-hashed dist filename is written down anywhere in the probe: a name that resolved in zero modules, or in more than one, would be a hard stop rather than a guess.",
  );
  lines.push("");

  lines.push("## Headline");
  lines.push("");
  lines.push(
    `**${p.totals.provable} / ${p.totals.components} of the pre-registered functions classify \`provable\` (${p.totals.provableFraction}).**`,
  );
  lines.push("");
  if (p.totals.provable === 0) {
    lines.push(
      `None of the ${twelve} pre-registered functions is provable under this repo's comptime pass as it stands. That is a claim over a closed, enumerated set — it is why the set is enumerated — and it should not be read as a claim about Kobalte's other entrypoints.`,
    );
  } else {
    lines.push(
      `${p.totals.provable} of the ${twelve} classify provable and ${p.totals.fallback} refuse. Both halves are reported below in the same form.`,
    );
  }
  lines.push("");
  lines.push(
    `The two arms **agree on status for all ${twelve}**${p.totals.armsAgreeOnStatus ? "" : " — except where noted"}, and ${p.totals.componentsWithIdenticalReasonCodes} of ${twelve} carry identical reason-code multisets. The divergences are in the delta section.` +
      (p.errata.length > 0
        ? " **That agreement is not corroboration of one cause. Read the errata immediately below before treating it as one.**"
        : ""),
  );
  lines.push("");
  lines.push("| Segment | Files | Components | Provable | Fallback | Provable fraction |");
  lines.push("|---|---|---|---|---|---|");
  lines.push(
    `| ${code("kobalte-source")} | ${p.totals.sourceFiles} | ${p.totals.components} | ${p.totals.provable} | ${p.totals.fallback} | ${p.totals.provableFraction} |`,
  );
  lines.push(
    `| ${code("kobalte-dist")} | ${p.totals.distFiles} | ${p.totals.components} | ${p.totals.provable} | ${p.totals.fallback} | ${p.totals.provableFraction} |`,
  );
  lines.push("");
  lines.push(
    "The two segments are the same twelve functions read from the same artifact before and after rolldown, so the rows are a corroboration rather than two populations. The file counts differ because rolldown merges an entrypoint's parts into one chunk.",
  );
  lines.push("");

  lines.push(...errataSection(p));

  lines.push("## Verdicts");
  lines.push("");
  lines.push(
    "One section per pre-registered function. The reason set is **complete**: the classifier collects every applicable code, and every occurrence it recorded is in the table. Rows are grouped by (code, causing shape), so the `Where` and `Triggering expression` cells carry one entry per site.",
  );
  lines.push("");
  lines.push(
    "Columns (a) and (b) are never merged. (a) is what Kobalte would have to change. (b) is what this analyzer would have to change, and **every entry in it is NOT AUTHORIZED** under this tranche's zero-Solid-API-changes constraint — it is a diagnosis of where the pass stops, not a plan to move it.",
  );
  lines.push("");
  for (const component of p.components) lines.push(...componentSection(component));

  lines.push("## Ranked refusals");
  lines.push("");
  lines.push(
    "Ranked by how many distinct components carry the code; occurrences break ties. Same schema as `docs/coverage/baseline.md`, deliberately — a second schema would make the two documents impossible to read against each other.",
  );
  lines.push("");
  lines.push("| Rank | Code | Components | Occurrences | Only-blocker for |");
  lines.push("|---|---|---|---|---|");
  p.ranked.forEach((entry, index) => {
    lines.push(`| ${index + 1} | ${code(entry.code)} | ${entry.components} | ${entry.occurrences} | ${entry.onlyBlockerFor} |`);
  });
  lines.push("");

  lines.push("## Only-blockers");
  lines.push("");
  lines.push("Components whose entire refusal set is a single code — lift that code and they flip.");
  lines.push("");
  if (p.onlyBlockers.length === 0) {
    const widths = p.components.map((c) => new Set(c.reasons.map((r) => r.code)).size);
    lines.push(`_No function among the ${twelve} is blocked by exactly one code._`);
    lines.push("");
    lines.push(
      `That is the load-bearing finding of this table rather than an empty result. Each of the ${twelve} carries between ${Math.min(...widths)} and ${Math.max(...widths)} distinct codes, so no single change on either side of the line flips any of them: the shapes stack.`,
    );
  } else {
    lines.push("| Component | File | Only blocker |");
    lines.push("|---|---|---|");
    for (const entry of p.onlyBlockers) {
      lines.push(`| ${code(entry.function)} | ${code(entry.authoredSource)} | ${code(entry.code)} |`);
    }
  }
  lines.push("");

  lines.push("## Source vs dist: the reason-code delta");
  lines.push("");
  lines.push(
    "The narrow third column in each verdict table, collected. A difference here is a difference in what the analyzer could **link**, because both arms are the same artifact.",
  );
  lines.push("");
  lines.push("| Function | Identical | Source-only codes | Dist-only codes | Occurrence differences |");
  lines.push("|---|---|---|---|---|");
  for (const component of p.components) {
    const counts = component.delta.counts
      .map((entry) => `${code(entry.code)} ${entry.source} vs ${entry.dist}`)
      .join("<br>");
    lines.push(
      `| ${code(component.function)} | ${component.delta.identical ? "yes" : "**no**"} | ${component.delta.sourceOnly.map(code).join("<br>") || "—"} | ${component.delta.distOnly.map(code).join("<br>") || "—"} | ${counts || "—"} |`,
    );
  }
  lines.push("");
  const diverging = p.components.filter((c) => !c.delta.identical);
  if (diverging.length === 0) {
    lines.push(`All ${twelve} carry identical reason-code multisets in both arms.`);
    lines.push("");
  } else {
    for (const component of diverging) {
      const unresolved = [
        ...new Set(
          component.reasons
            .filter((r) => !r.alsoInDist && r.detail?.callee != null && r.detail?.definedIn == null)
            .map((r) => r.detail.callee),
        ),
      ].sort();

      lines.push(
        `**${component.function}** — the source arm raises ${component.delta.sourceOnly.map(code).join(", ") || "no code the dist arm does not"}${component.delta.distOnly.length > 0 ? ` and the dist arm raises ${component.delta.distOnly.map(code).join(", ")}` : " that the dist arm does not"}.`,
      );
      lines.push("");
      if (unresolved.length > 0) {
        lines.push(
          `On this axis the **bundled arm is the more analyzable one**, and the cause sits on this side of the line rather than Kobalte's. Every source-only reason here records ${code("definedIn: null")} for ${unresolved.map(code).join(", ")} — the pass did not resolve the callee at all. ${code("loadProjectFrom")} (${code("src/comptime/project.ts")}) queues a module's ${code("imports")} records and nothing else, so an ${code("export * from")} barrel's re-exports are never added to the analyzed set and ${code("Symbol.definition()")} has nothing to resolve against. In the authored source that helper arrives through such a barrel chain; rolldown flattens the same edge into a direct named import, which the walk **does** follow — and with the definition in hand the pass clears the escape instead of refusing it.`,
        );
        lines.push("");
        lines.push(
          "Recorded as an analyzer-side observation about this pass's module walk. Like every entry in column (b), it is not authorized to be acted on in this tranche.",
        );
      } else {
        lines.push(
          "The two arms are the same artifact before and after rolldown, so this difference is a statement about what the pass could link in each, not about two libraries. It is recorded here and not acted on.",
        );
      }
      lines.push("");
    }
  }

  lines.push("## Component inventory");
  lines.push("");
  lines.push("| Component | File | Exported | Verdict | Inlined by | Codes |");
  lines.push("|---|---|---|---|---|---|");
  for (const component of p.components) {
    const codes = [...new Set(component.reasons.map((r) => r.code))].sort().map(code).join("<br>") || "—";
    lines.push(
      `| ${code(component.function)} | ${code(component.authoredSource)} | ${component.exported ? "yes" : "no"} | ${component.verdict} | — | ${codes} |`,
    );
  }
  lines.push("");

  lines.push("## Determinism");
  lines.push("");
  lines.push("Both inputs are pinned by content, and the output carries no clock:");
  lines.push("");
  lines.push(`- source arm — ${code(p.provenance.source.commit)} (tree ${code(p.provenance.source.tree)})`);
  lines.push(`- dist arm — ${code(p.provenance.dist.integrity)} (${p.provenance.dist.bytes} bytes)`);
  lines.push("");
  lines.push(
    "`node tools/kobalte-probe.mjs --verify` re-acquires both arms from the network, asserts the tarball integrity and `git rev-parse HEAD` both still match their pins, re-derives every per-component `(status, sorted reason codes)` tuple from **both** arms and asserts each regenerates identically, then re-renders this document and `profile.json` and asserts both are byte-identical to what is on disk. Any difference exits non-zero.",
  );
  lines.push("");

  return `${lines.join("\n")}\n`;
}

// ---------------------------------------------------------------------- main

function renderJson(profile) {
  return `${JSON.stringify(profile, null, 2)}\n`;
}

async function derive() {
  const sourceArm = acquireSource();
  const distArm = await acquireDist();
  const source = analyzeArm("source", sourceArm.root);
  const dist = analyzeArm("dist", distArm.root);
  return buildProfile(sourceArm, distArm, source, dist);
}

const JSON_PATH = join(REPO_ROOT, "docs/kobalte/profile.json");
const MD_PATH = join(REPO_ROOT, "docs/kobalte/profile.md");

async function main() {
  const verify = process.argv.includes("--verify");
  const profile = await derive();
  const json = renderJson(profile);
  const markdown = renderMarkdown(profile);

  if (!verify) {
    mkdirSync(dirname(JSON_PATH), { recursive: true });
    writeFileSync(JSON_PATH, json);
    writeFileSync(MD_PATH, markdown);
    const provable = profile.totals.provable;
    console.log(
      `published docs/kobalte/profile.{json,md} — ${provable}/${profile.totals.components} provable, ` +
        `${profile.totals.componentsWithIdenticalReasonCodes}/${profile.totals.components} reason-code-identical across arms`,
    );
    return;
  }

  const recorded = JSON.parse(readFileSync(JSON_PATH, "utf8"));
  const problems = [];

  const wanted = REGISTERED.map((r) => `${r.entrypoint}/${r.fn}`).sort();
  const got = recorded.components.map((c) => `${c.entrypoint}/${c.function}`).sort();
  if (JSON.stringify(got) !== JSON.stringify(wanted)) {
    problems.push(`recorded set is not the pre-registered set: ${JSON.stringify(got)}`);
  }

  if (recorded.provenance.source.commit !== SOURCE_ARM.commit) {
    problems.push(`recorded source commit ${recorded.provenance.source.commit} != pin ${SOURCE_ARM.commit}`);
  }
  if (recorded.provenance.dist.integrity !== DIST_ARM.integrity) {
    problems.push(`recorded dist integrity ${recorded.provenance.dist.integrity} != pin ${DIST_ARM.integrity}`);
  }

  const freshById = new Map(profile.components.map((c) => [`${c.entrypoint}/${c.function}`, c]));
  for (const component of recorded.components) {
    const id = `${component.entrypoint}/${component.function}`;
    const fresh = freshById.get(id);
    if (fresh === undefined) {
      problems.push(`${id}: recorded but did not regenerate`);
      continue;
    }
    for (const arm of ["source", "dist"]) {
      const was = component.arms?.[arm];
      const now = fresh.arms[arm];
      if (was === undefined) {
        problems.push(`${id}: recorded profile carries no ${arm} arm tuple`);
        continue;
      }
      if (was.status !== now.status) {
        problems.push(`${id} (${arm} arm): status ${was.status} -> ${now.status}`);
      }
      if (JSON.stringify(was.codes) !== JSON.stringify(now.codes)) {
        problems.push(`${id} (${arm} arm): reason codes ${JSON.stringify(was.codes)} -> ${JSON.stringify(now.codes)}`);
      }
    }
  }

  if (readFileSync(JSON_PATH, "utf8") !== json) problems.push("docs/kobalte/profile.json is not byte-identical to a fresh render");
  if (readFileSync(MD_PATH, "utf8") !== markdown) problems.push("docs/kobalte/profile.md is not byte-identical to a fresh render");

  if (problems.length > 0) {
    console.error("kobalte-probe --verify FAILED:");
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `kobalte-probe --verify ok — source ${SOURCE_ARM.commit.slice(0, 12)}, dist ${DIST_ARM.integrity.slice(0, 18)}…, ` +
      `${profile.totals.components}/${profile.totals.components} tuples regenerate identically from both arms, both documents byte-identical`,
  );
}

await main();
