// Which chunk carries which handler is decided by the build, not by this
// suite: hard-coding `s0-BM-E1Zv7.js` would make the boxes lie the moment a
// hash changed. The built entry bundle already states the mapping, because the
// resumer needs it at runtime:
//
//   "../artifacts/ProvableCounter/handlers/s0.js": () => __vitePreload(
//       () => import("./s0-BM-E1Zv7.js"), [], import.meta.url)
//
// Reading it back out of the shipped bytes is the honest source: the expected
// chunk URL for a component is whatever the page itself would ask for.

const HANDLER_ENTRY =
	/"\.\.\/artifacts\/([\w.]+)\/handlers\/(s\d+)\.js"\s*:\s*\(\)\s*=>\s*[\w$]+\(\s*\(\)\s*=>\s*import\("([^"]+)"/g;

export type HandlerChunks = {
	/** Absolute URL of the chunk for `<artifactId>/<handlerId>`. */
	url(artifactId: string, handlerId: string): string;
	/** Every chunk URL the entry bundle can lazily import. */
	readonly all: readonly string[];
};

/** Every specifier the entry bundle can `import()`, resolved against it. */
const DYNAMIC_IMPORT = /import\("([^"]+)"\)/g;

/** A lazily-imported handler chunk, by the filename the emitter gives it. */
const HANDLER_CHUNK = /\/s\d+-[\w-]+\.js$/;

/**
 * The keyed-region resolver, by the filename the bundler gives its module.
 *
 * The resumer names it in an `import()` it takes only for an event that came
 * through a region container, so every entry that carries the resume runtime
 * NAMES this chunk and a page whose components carry no list never asks for it.
 * Naming it here is what lets the boxes below say that as a claim about the
 * wire rather than leaving it as an absence nobody looked for.
 */
const REGIONS_CHUNK = /\/regions-[\w-]+\.js$/;

/**
 * The store partition, by the stem the emitter gives `demo/src/roster-store.ts`.
 *
 * The fourth chunk kind, and the newest: the carrier's list reads a store its
 * own provider creates, the resumable page never runs that provider, so the
 * store is UNPROVIDED at load and the page's answer to the first dispatch that
 * wants one is a dynamic `import()` of this module. It is named here for the
 * same reason the region resolver is — a box that could only count requests
 * would have to call this chunk "one more file"; a box that can name it can say
 * WHICH bytes arrived and on WHICH dispatch.
 *
 * The stem is the honest half of the name and the hash is the build's: matching
 * `roster-store-` rather than `roster-store-CLezwhwK.js` keeps this from going
 * red on a rebuild that changed nothing but a content hash.
 */
const STORE_CHUNK = /\/roster-store-[\w-]+\.js$/;

/** Every specifier a chunk statically imports, as written in its own bytes. */
const STATIC_IMPORT = /(?:^|[;}\s])(?:import|export)\s*(?:[\w${},*\s]*from\s*)?"([^"]+)"/g;

async function chunkSource(chunkUrl: string): Promise<string> {
	const response = await fetch(chunkUrl);
	if (!response.ok) {
		throw new Error(`chunk ${chunkUrl} returned HTTP ${response.status}.`);
	}
	return response.text();
}

/** Every chunk the entry bundle can `import()`, resolved against it. */
async function dynamicImports(entryUrl: string): Promise<string[]> {
	const source = await chunkSource(entryUrl);
	return [
		...new Set([...source.matchAll(DYNAMIC_IMPORT)].map((match) => new URL(match[1]!, entryUrl).href)),
	];
}

/** What kind of chunk a built filename declares itself to be. */
export type ChunkKind = 'entry' | 'handler' | 'regions' | 'store' | 'unclassified';

/** One chunk of the reachable graph, with the chunk whose bytes named it. */
export type ReachedChunk = {
	readonly url: string;
	readonly kind: ChunkKind;
	/** The chunk that named this one; the entry names itself. */
	readonly namedBy: string;
};

function kindOf(chunkUrl: string): ChunkKind {
	const path = new URL(chunkUrl).pathname;
	if (HANDLER_CHUNK.test(path)) return 'handler';
	if (REGIONS_CHUNK.test(path)) return 'regions';
	if (STORE_CHUNK.test(path)) return 'store';
	return 'unclassified';
}

/**
 * Every chunk a page can reach from its entry — static imports and dynamic
 * ones, transitively — each one classified by the kind the emitter's own
 * filename declares.
 *
 * The three named kinds are the whole vocabulary of a page whose framework is
 * gone: a handler artifact, the region resolver, the store partition. Anything
 * else a reachable chunk names is `unclassified`, and on the fixtures build
 * `unclassified` has exactly one candidate — the fallback branch. So a caller
 * that asserts the unclassified set is EMPTY is asserting the branch is not in
 * the graph at all, over every chunk the walk reaches rather than over one
 * chunk it went looking for. `groupChunk` below answers the opposite question
 * for pages that still have a group, and the two share this classification so
 * neither can drift from the other's idea of what a group chunk is.
 *
 * Bare specifiers are recorded and not walked: a built chunk has none, and one
 * appearing means a dependency was externalized rather than bundled — which is
 * `unclassified` by the same reading, and a finding rather than a crash.
 */
export async function reachableChunks(entryUrl: string): Promise<readonly ReachedChunk[]> {
	const found = new Map<string, ReachedChunk>([
		[entryUrl, { url: entryUrl, kind: 'entry', namedBy: entryUrl }],
	]);
	const queue = [entryUrl];
	for (let index = 0; index < queue.length; index += 1) {
		const current = queue[index]!;
		const source = await chunkSource(current);
		const specifiers = [
			...[...source.matchAll(DYNAMIC_IMPORT)].map((match) => match[1]!),
			...[...source.matchAll(STATIC_IMPORT)].map((match) => match[1]!),
		];
		for (const specifier of specifiers) {
			const relative = specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('/');
			const url = relative ? new URL(specifier, current).href : specifier;
			if (found.has(url)) continue;
			const kind = relative ? kindOf(url) : 'unclassified';
			found.set(url, { url, kind, namedBy: current });
			// An unclassified node is what the caller is about to fail on; its
			// own imports are not this walk's business, and fetching a bare
			// specifier is not something this walk can do at all.
			if (kind !== 'unclassified') queue.push(url);
		}
	}
	return [...found.values()];
}

/**
 * The deferral group's chunk URL, read out of the entry bundle rather than
 * named here.
 *
 * The entry can import exactly four kinds of chunk: a handler artifact, one
 * per component event; the keyed-region resolver, which is the resume runtime's
 * own lazy half; the store partition, which is the carrier page's answer to a
 * dispatch that finds no live store; and the group. Naming the group by
 * elimination keeps the expectation tied to what the page would actually
 * request, and fails loudly if the build ever emits the group as more than one
 * dynamic entry — which is the shape the deferral boundary is not allowed to
 * take.
 *
 * The fourth kind is why this list is stated rather than assumed. Before the
 * carrier landed, "not a handler and not the resolver" meant "the group" on
 * both pages; on the fixtures page it now also catches the store, and an
 * elimination that had quietly gone from one answer to two would have made this
 * function throw on a page whose group is exactly where it was.
 *
 * The todos page is what calls this now. The fixtures page has no group to
 * resolve since fallback auto-omit landed, and a function whose contract is
 * "exactly one" is the wrong instrument for a build that emits none — that page
 * asserts the ABSENCE with `reachableChunks` instead, which is the stronger
 * claim and the one the emptiness has to be measured for.
 */
export async function groupChunk(entryUrl: string): Promise<string> {
	const group = (await dynamicImports(entryUrl)).filter(
		(url) => kindOf(url) === 'unclassified',
	);
	if (group.length !== 1) {
		throw new Error(
			`${entryUrl} has ${group.length} dynamic imports that are neither a handler, the region resolver, nor the store partition; expected exactly one group chunk. Found: ${group.join(', ') || '(none)'}.`,
		);
	}
	return group[0]!;
}

/**
 * The store partition's chunk URLs — the module the page imports, and every
 * module that one drags in with it.
 *
 * Two files on the wire for one `import()`, and the second is not guessed: the
 * store chunk's own bytes name it (`import{…}from"./roster-C5QnQ3kt.js"`), so
 * the expectation a box states is the one the browser will act on. Both are
 * returned because both are what "the store arrives" costs, and a box that
 * itemized only the first would be quoting half a fetch.
 *
 * Everything in this set is framework-free by construction — that is claim 7a
 * of `demo/scripts/check-zero-eager.mjs`, gated at build time against the
 * module graph. This function is the wire-side half: what the page fetches when
 * it needs a store, by URL and by byte.
 */
export async function storePartition(entryUrl: string): Promise<readonly string[]> {
	const store = (await dynamicImports(entryUrl)).filter((url) =>
		STORE_CHUNK.test(new URL(url).pathname),
	);
	if (store.length !== 1) {
		throw new Error(
			`${entryUrl} names ${store.length} store-partition chunks; expected exactly one. Found: ${store.join(', ') || '(none)'}.`,
		);
	}
	const entry = store[0]!;
	const response = await fetch(entry);
	if (!response.ok) {
		throw new Error(`store chunk ${entry} returned HTTP ${response.status}.`);
	}
	const source = await response.text();
	const imported = [...source.matchAll(STATIC_IMPORT)].map(
		(match) => new URL(match[1]!, entry).href,
	);
	return [...new Set([entry, ...imported])];
}

/**
 * The keyed-region resolver's chunk URL, by the same reading of the same bytes.
 *
 * Present in the entry's import list and absent from every request a page
 * without a list makes: those are two different facts, and this is what lets a
 * box assert the second one by name instead of inferring it from a count.
 */
export async function regionsChunk(entryUrl: string): Promise<string> {
	const found = (await dynamicImports(entryUrl)).filter((url) =>
		REGIONS_CHUNK.test(new URL(url).pathname),
	);
	if (found.length !== 1) {
		throw new Error(
			`${entryUrl} names ${found.length} region-resolver chunks; expected exactly one. Found: ${found.join(', ') || '(none)'}.`,
		);
	}
	return found[0]!;
}

/** True for a chunk emitted for one component's handler. */
export function isHandlerChunk(pathname: string): boolean {
	return HANDLER_CHUNK.test(pathname);
}

/** Parses the artifact/handler -> chunk-URL map out of a built entry bundle. */
export async function handlerChunks(entryUrl: string): Promise<HandlerChunks> {
	const source = await chunkSource(entryUrl);
	const byKey = new Map<string, string>();
	for (const match of source.matchAll(HANDLER_ENTRY)) {
		const [, artifactId, handlerId, specifier] = match;
		byKey.set(`${artifactId}/${handlerId}`, new URL(specifier!, entryUrl).href);
	}
	if (byKey.size === 0) {
		throw new Error(`no lazy handler imports found in ${entryUrl}; the build shape changed.`);
	}
	return {
		url(artifactId: string, handlerId: string): string {
			const found = byKey.get(`${artifactId}/${handlerId}`);
			if (found === undefined) {
				throw new Error(
					`${artifactId}/${handlerId} is not a lazy import of ${entryUrl}; known: ${[...byKey.keys()].join(', ')}.`,
				);
			}
			return found;
		},
		all: [...byKey.values()],
	};
}
