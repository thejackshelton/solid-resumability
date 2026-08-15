import { box } from '@async/witness';
import {
	COMPOSED_HOLE_BEFORE_FILL,
	COMPOSED_INNER,
	COMPOSED_OUTER,
	COMPOSED_PAIR_EAGER_BYTES,
	COMPOSED_RECORDED,
	FIXTURES_EAGER_JS_BEFORE_COMPOSED_BYTES,
	FIXTURES_EAGER_JS_CAP_BYTES,
	FIXTURES_INDEXING_LAYER_BYTES,
	pageUrl,
} from '../config.ts';
import { handlerChunks, isHandlerChunk, reachableChunks } from './support/chunks.ts';
import {
	arrivedSince,
	assert,
	describe,
	pathOf,
	quietRequests,
	scripts,
	totalBytes,
} from './support/network.ts';
import { eagerScriptBytes } from './support/page-bytes.ts';

// ─────────────────────────────────────────────────────────────────────────────
// The addressing witness: two components resuming on one page, one INSIDE the
// other, each on an address of its own.
//
// Every other box on this page measures one component at a time. This one
// measures the relation between two, and the relation is the whole point: the
// parent does not absorb its child. It leaves a hole, the build fills the hole
// with the child's own painted markup under the child's own address, and each
// of them resumes on the address it was given. Nothing here hydrates and
// nothing re-renders — the child's markup ARRIVES in the document, and the two
// components RESUME.
//
// The six claims, and why the box needs all six:
//
//   C1. THE COMPOSITION IS IN THE DOCUMENT, BEFORE ANY BROWSER. A plain
//       `fetch`: the bytes carry the parent's address, and INSIDE its subtree a
//       second, different `[data-resume]` element that is NOT EMPTY, carrying
//       the child's own painted markup. Two addresses, one inside the other, in
//       bytes no JavaScript produced. This is the observation that separates
//       ADDRESSING from INLINING — an inlined child leaves no second address,
//       because its bindings were re-homed onto its parent's cells and there is
//       nothing left to address.
//
//   C2. TWO BUNDLES, NOT ONE. Both artifact ids are named by the eager entry —
//       structure and wiring eagerly, one handler each lazily — and the walk
//       over every chunk the page can reach resolves TWO DISTINCT handler chunk
//       URLs. A page that had folded the child into the parent would name one.
//
//   C3. THE CHILD RESUMES ON ITS OWN ADDRESS. The address the document gives
//       the child IS the artifact directory the build emitted for it, and one
//       click on the child's button moves the child's readout and fetches
//       EXACTLY ONE chunk: the child's own, and specifically not the parent's.
//
//   C4. THE PARENT DID NOT DISPATCH, asserted two ways — the parent's readout
//       is unchanged, AND the parent's handler chunk is absent from everything
//       the session has fetched. Then the mirror: click the parent, the parent
//       moves, the child is unchanged, exactly one new chunk. This is the real
//       risk on this page rather than a formality: `resumer.ts:432-437` matches
//       `candidate.element === target || candidate.element.contains(target)`,
//       and the parent's container CONTAINS the child's button. The delegated
//       listener on the parent receives every click the child's button makes.
//       What keeps the parent from answering is that its wiring addresses ITS
//       OWN button, which contains nothing — and that is a property to measure,
//       not to assume.
//
//   C5. THE MARKUP DOES NOT MOVE. The parent's mount subtree is snapshotted
//       from the served bytes and again after every dispatch, through ONE
//       extractor used on both sides, with only the two readout texts masked.
//       Everything else is byte-identical: the child's element, its address,
//       its buttons and its nesting are the server's bytes from the first
//       fetch to the last click.
//
//   C6. THE BILL, ITEMIZED. What this cost, stated rather than implied: the
//       page's eager JS old and new against a cap that has not moved, one entry
//       script, every session script named URL by URL with the trigger that
//       fetched it, zero fetches on repeat clicks, and the reachable walk with
//       nothing unclassified in it.
//
// A note on where C1 stops and C3 begins, because the split is deliberate and
// it is what makes this box falsifiable in two independent directions. C1 owns
// the DOCUMENT's shape: two nested addresses, the inner one non-empty and
// painted. C3 owns IDENTITY: that the inner address is the artifact the build
// emitted, that the registry resolves it, and that the click fetches that
// artifact's chunk. Point the child's `data-resume` at an artifact that does
// not exist and the composition is still in the bytes — C1 is green, correctly,
// because the document really does carry two nested addresses — while C3 goes
// red, because an address that names nothing resumes nothing. Empty the child's
// mount and C1 goes red on the bytes themselves. Two injections, two claims,
// one each; had C1 hard-coded the child's id, both injections would have fired
// the same assertion and the second would have measured nothing new.
//
// ── What this box does NOT claim ────────────────────────────────────────────
//
//   D1. NOT A REAL APPLICATION COMPONENT. `ComposedCounter` is a purpose-built
//       fixture. The corpus app holds 3/5 and `App` is still REFUSED on its
//       root. This witnesses that composition resumes; it says nothing about
//       this repo's application composing.
//
//   D2. THE RECORDED VALUE IS FIRST-PAINT MARKUP, NOT A RESUME OVERLAY. v1
//       admits one build-constant on the addressed child; classify-with-record
//       bakes it into the child's own template and existing fill carries it.
//       Nothing on the resume path reads the parent's claimedChildren. A
//       reader who takes "recorded" for "applied at boot" is reading a word,
//       not a measurement. This page is prerender:false — the verbatim/capture
//       hole-arm is not on this wire.
//
//   D3. THE PARENT DOES NOT RESUME THE CHILD; THE PAGE DOES. Nothing in the
//       parent's bundle names the child at runtime. `resumeAll` walks
//       `[data-component]` across the whole document and hands each mount to
//       the resumer independently, so the parent-child relation witnessed here
//       is a BUILD-TIME fact and a DOM-CONTAINMENT fact, not a runtime edge.
//       One hop only: nothing here says a claimed child may claim a child.
//
//   D4. THE VERBATIM GATE IS NOT EXERCISED BY THESE BYTES. The fixtures page is
//       built with `prerender: false`, so the element-hole arm of the template
//       gate is unit-proved, not wire-proved. Reading this box as evidence that
//       the capture path learned holes is reading the wrong box.
//
//   D5. NO TEMPLATE MODULE SHIPS ON THIS PAGE, which is why the resume path's
//       template comparison (`resumer.ts:175`) never runs here at all. That is
//       enforced by name in the build (`ClaimedChildTemplateShipped`) rather
//       than relied on, and hole-aware equality on the resume path remains
//       unpaid work — not a solved problem this box quietly stepped over.
//
//   D6. `fixtures 9/28` IS A COVERAGE STATEMENT AND IT IS NOT THIS. No analyzer
//       verdict is evidence here. What is witnessed is two components resuming
//       on one page, one inside the other, in a real browser.
//
//   D7. THIS PAGE'S EAGER TOTAL IS NOT A COST OF ADDRESSING. Of the pair's
//       1,755 B, 861 B is the addressed pair's own payload; 894 B is REGISTRY
//       INDEXING, which every component on this page pays whether it claims
//       anything or not, and page-wide that layer is 3,327 B of the 18,257 B
//       entry. A reader who takes 18,257 for the price of composing two
//       components is reading a chunk total, not a measurement. The number is
//       reported here so that when the indexing work lands it moves for a
//       reason already written down.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The four dispatches: one each, then one each again.
 *
 * Clicks 1 and 2 are C3 and C4's mirror — each component answers its own
 * button and neither answers the other's. Clicks 3 and 4 spend a second click
 * on each and fetch nothing at all, which is what makes the first two fetches
 * arrivals rather than traffic.
 */
const DISPATCHES: ReadonlyArray<{
	readonly who: 'inner' | 'outer';
	readonly outer: string;
	readonly inner: string;
	/** Whose handler chunk this click is allowed to put on the wire; none. */
	readonly fetches: 'inner' | 'outer' | null;
}> = [
	{ who: 'inner', outer: 'outer: 0', inner: 'inner: 1', fetches: 'inner' },
	{ who: 'outer', outer: 'outer: 1', inner: 'inner: 1', fetches: 'outer' },
	{ who: 'inner', outer: 'outer: 1', inner: 'inner: 2', fetches: null },
	{ who: 'outer', outer: 'outer: 2', inner: 'inner: 2', fetches: null },
];

/** The served document, straight off the static server, with no browser in it. */
async function servedDocument(url: string): Promise<string> {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}.`);
	return response.text();
}

/**
 * A mount's INNER markup, cut out of a page's bytes exactly as they are.
 *
 * Both sides of every comparison below go through this one function: the
 * server's response and the live DOM serialized by Chrome. That is what makes
 * "byte-identical" mean something — the same extraction over the same markup,
 * so a difference is a difference in the page and not in how it was read.
 *
 * Inner rather than outer on purpose. The mount's own open tag is written
 * across three lines in `demo/fixtures.html` and Chrome serializes it on one,
 * which is a difference in whitespace nobody authored and nobody should have to
 * normalize away. What the subtree holds is the claim; how its container's
 * attributes were typed is not.
 *
 * The depth count is over `<div` alone because that is what the mount is: the
 * subtree holds divs, spans and buttons, and only the divs can close it.
 */
function mountSubtree(html: string, address: string, where: string): string {
	const marker = `data-resume="${address}"`;
	const at = html.indexOf(marker);
	if (at === -1) {
		throw new Error(`no [data-resume="${address}"] element in ${where}.`);
	}
	const openEnd = html.indexOf('>', at + marker.length);
	if (openEnd === -1) {
		throw new Error(`the [data-resume="${address}"] open tag in ${where} never closes.`);
	}
	let depth = 1;
	let cursor = openEnd + 1;
	while (depth > 0) {
		const open = html.indexOf('<div', cursor);
		const close = html.indexOf('</div>', cursor);
		if (close === -1) {
			throw new Error(`the [data-resume="${address}"] element in ${where} is never closed.`);
		}
		if (open !== -1 && open < close) {
			depth += 1;
			cursor = open + '<div'.length;
			continue;
		}
		depth -= 1;
		if (depth === 0) return html.slice(openEnd + 1, close);
		cursor = close + '</div>'.length;
	}
	throw new Error(`unreachable: [data-resume="${address}"] in ${where}.`);
}

/** Every `data-resume` address written inside a stretch of markup. */
function addressesIn(markup: string): string[] {
	return [...markup.matchAll(/data-resume="([^"]+)"/g)].map((match) => match[1]!);
}

/** The opening tag of a `[data-resume]` element, cut out of page bytes. */
function resumeOpenTag(html: string, address: string, where: string): string {
	const marker = `data-resume="${address}"`;
	const at = html.indexOf(marker);
	if (at === -1) {
		throw new Error(`no [data-resume="${address}"] element in ${where}.`);
	}
	const start = html.lastIndexOf('<', at);
	const end = html.indexOf('>', at);
	if (start === -1 || end === -1) {
		throw new Error(`the [data-resume="${address}"] open tag in ${where} never closes.`);
	}
	return html.slice(start, end + 1);
}

/** Attribute names on an HTML open tag, in source order. */
function attributeNames(openTag: string): string[] {
	return [...openTag.matchAll(/\s([A-Za-z_:][\w:.-]*)=/g)].map((match) => match[1]!);
}

const READOUT = /(<span data-testid="composed-(?:outer|inner)-label">)[^<]*(<\/span>)/g;

/**
 * The parent's subtree with the two readout texts blanked, and nothing else.
 *
 * "Only the readouts change" is a claim about what is allowed to move, so the
 * masking is bounded rather than generous: exactly two readouts must be found,
 * and only the text between a labelled span's own tags is replaced. A subtree
 * that lost a readout — or grew a third — fails here rather than passing by
 * having less to compare.
 */
function withoutReadouts(subtree: string, where: string): string {
	let masked = 0;
	const blanked = subtree.replace(READOUT, (_match, open: string, close: string) => {
		masked += 1;
		return `${open}«readout»${close}`;
	});
	if (masked !== 2) {
		throw new Error(`${where} carries ${masked} composed readouts, not 2:\n${subtree}`);
	}
	return blanked;
}

export default box(
	{
		name: 'resumable fixtures: a child arrives addressed inside its parent, and each resumes on its own address',
		modes: ['dev'],
		tags: ['network', 'resumable', 'addressing'],
	},
	async ({ browser, expect, receipt }) => {
		const url = pageUrl('resumable', 'fixtures');

		// ── C1. the composition is in the document ─────────────────────────
		// A plain fetch: no browser, no scripts, no chance that something ran.
		// If both addresses are in these bytes, with the child's painted markup
		// inside the second one, then no JavaScript composed them.
		const served = await servedDocument(url);
		const servedParent = mountSubtree(served, COMPOSED_OUTER.artifactId, 'the served document');
		const nested = addressesIn(servedParent);
		assert(
			nested.length === 1,
			`the parent's subtree carries ${nested.length} nested addresses [${nested.join(', ')}]; expected exactly one — the claimed child's.`,
		);
		const childAddress = nested[0]!;
		assert(
			childAddress !== COMPOSED_OUTER.artifactId,
			`the nested address is the parent's own (${childAddress}); a second address that repeats the first is not a second component.`,
		);
		const servedChild = mountSubtree(servedParent, childAddress, "the parent's served subtree");
		assert(
			servedChild.trim().length > 0,
			`the child's mount ([data-resume="${childAddress}"]) is EMPTY in the served bytes: the document carries an address with no component behind it, which is a mount the resumer throws on.`,
		);
		for (const wanted of [
			'data-testid="composed-inner-label"',
			'data-testid="composed-inner-inc"',
			'inner: 0',
		]) {
			assert(
				servedChild.includes(wanted),
				`the child's mount does not carry ${wanted}; what is inside it is not the child's painted markup:\n${servedChild}`,
			);
		}
		for (const wanted of ['data-testid="composed-outer-label"', 'outer: 0']) {
			assert(
				servedParent.includes(wanted),
				`the parent's subtree does not carry ${wanted}; the hole was filled but the parent was not painted:\n${servedParent}`,
			);
		}
		receipt.note(
			`C1 — the composition is in the DOCUMENT: ${servedParent.length} B of markup under [data-resume="${COMPOSED_OUTER.artifactId}"], holding a second address [data-resume="${childAddress}"] with ${servedChild.length} B of the child's own painted markup inside it. Two addresses, one inside the other, fetched before any browser was started. An inlined child leaves no second address; this one has its own.`,
		);

		// ── W1 / W2 / W5. recorded first-paint, hole still two attributes ──
		// W1 is C1's shape restated as the recorded-prop wire claim: two nested
		// addresses, inner non-empty with the child's own painted markup.
		receipt.note(
			`W1 — two nested [data-resume] addresses; the inner is non-empty and carries the child's own painted markup (${servedChild.length} B).`,
		);
		assert(
			servedChild.includes(`data-testid="${COMPOSED_RECORDED.testid}"`) &&
				servedChild.includes(COMPOSED_RECORDED.value),
			`W2 — the recorded ${COMPOSED_RECORDED.name} is not in the child's first paint (fetch, no click):\n${servedChild}`,
		);
		receipt.note(
			`W2 — the recorded ${COMPOSED_RECORDED.name}="${COMPOSED_RECORDED.value}" is in the child's FIRST PAINT, fetched with no browser and no click.`,
		);
		const holeOpen = resumeOpenTag(served, childAddress, 'the served document');
		const holeAttrs = attributeNames(holeOpen);
		assert(
			holeAttrs.length === 2 &&
				holeAttrs[0] === 'data-resume' &&
				holeAttrs[1] === 'data-component',
			`W5 — the hole open tag carries [${holeAttrs.join(', ')}], not exactly data-resume and data-component:\n${holeOpen}`,
		);
		assert(
			holeOpen === COMPOSED_HOLE_BEFORE_FILL.replace('></div>', '>'),
			`W5 — the served hole open tag is not the before-fill hole (${COMPOSED_HOLE_BEFORE_FILL}):\n${holeOpen}`,
		);
		receipt.note(
			`W5 — the hole remains exactly two attributes (data-resume, data-component) and empty before fill (${COMPOSED_HOLE_BEFORE_FILL}). After fill the open tag is unchanged; the child's markup is inside, not on the hole.`,
		);

		const page = await browser.visit(url);
		const load = await quietRequests(page);
		receipt.note(`resumable fixtures load set (addressing run):\n${describe(load)}`);

		// C5's first snapshot: the resumer has already run here — it installed
		// its listeners on both containers — and the subtree still weighs what
		// the server sent.
		const servedStable = withoutReadouts(servedParent, 'the served document');
		const afterResume = withoutReadouts(
			mountSubtree(await page.content(), COMPOSED_OUTER.artifactId, 'the resumed page'),
			'the resumed page',
		);
		assert(
			afterResume === servedStable,
			`resuming the page changed the parent's subtree.\nserved:\n${servedStable}\nafter resume:\n${afterResume}`,
		);

		// ── C2. two bundles, not one ───────────────────────────────────────
		const eagerScripts = scripts(load);
		assert(
			eagerScripts.length === 1,
			`expected exactly one script on load; observed:\n${describe(eagerScripts)}`,
		);
		const entryUrl = eagerScripts[0]!.url;
		const entrySource = await (await fetch(entryUrl)).text();
		for (const fixture of [COMPOSED_OUTER, COMPOSED_INNER]) {
			for (const artifact of ['structure.js', 'wiring.js']) {
				assert(
					entrySource.includes(`../artifacts/${fixture.artifactId}/${artifact}`),
					`the eager entry does not name ../artifacts/${fixture.artifactId}/${artifact}; ${fixture.component} has no bundle of its own in this build.`,
				);
			}
		}
		const chunks = await handlerChunks(entryUrl);
		const innerChunk = chunks.url(COMPOSED_INNER.artifactId, COMPOSED_INNER.handlerId);
		const outerChunk = chunks.url(COMPOSED_OUTER.artifactId, COMPOSED_OUTER.handlerId);
		assert(
			innerChunk !== outerChunk,
			`both components resolve to the same handler chunk (${new URL(innerChunk).pathname}); one chunk for two components is one bundle, which is the thing addressing is supposed to have stopped.`,
		);
		const reachable = await reachableChunks(entryUrl);
		for (const [chunkUrl, whose] of [
			[innerChunk, COMPOSED_INNER.component],
			[outerChunk, COMPOSED_OUTER.component],
		] as const) {
			const found = reachable.find((chunk) => chunk.url === chunkUrl);
			assert(
				found?.kind === 'handler',
				`${whose}'s handler chunk (${new URL(chunkUrl).pathname}) is not reachable from the entry as a handler artifact; the walk classified it ${found?.kind ?? '(absent)'}.`,
			);
		}
		assert(
			!entrySource.includes(`../artifacts/${COMPOSED_OUTER.artifactId}/template.js`),
			`W4 — the eager entry names the parent's template.js; an addressed parent's template must stay off the wire.`,
		);
		receipt.note(
			`C2 — two bundles, not one: the eager entry names ${COMPOSED_OUTER.artifactId} and ${COMPOSED_INNER.artifactId} with a structure and a wiring each, and the reachable-chunk walk resolves two DISTINCT handler chunks — ${new URL(outerChunk).pathname} for the parent, ${new URL(innerChunk).pathname} for the child.`,
		);
		receipt.note(
			`W4 — parent template.js is absent from the eager entry; the child's structure.js and wiring.js are still the child's (${COMPOSED_INNER.artifactId}).`,
		);

		// Neither is on the wire yet. The whole page is painted, both
		// components are resumed, and no handler has been fetched.
		for (const [chunkUrl, whose] of [
			[innerChunk, COMPOSED_INNER.component],
			[outerChunk, COMPOSED_OUTER.component],
		] as const) {
			assert(
				!load.some((request) => request.url === chunkUrl),
				`${whose}'s handler chunk (${new URL(chunkUrl).pathname}) was fetched on load, before anyone clicked anything:\n${describe(load)}`,
			);
		}

		// ── C3's premise: the address in the document is the CHILD'S OWN ────
		// This is the identity half, and it is C3's rather than C1's: a
		// document can carry two nested addresses while the inner one names an
		// artifact nothing emitted. That page composes in its bytes and resumes
		// nothing, and this is the line that catches it.
		assert(
			childAddress === COMPOSED_INNER.artifactId,
			`the child's mount is addressed "${childAddress}", which is not the artifact directory the build emitted for it (${COMPOSED_INNER.artifactId}) — the registry resolves by that name, so this address resumes nothing.`,
		);

		await expect.page.text(page, COMPOSED_OUTER.readout, 'outer: 0');
		await expect.page.text(page, COMPOSED_INNER.readout, 'inner: 0');

		// ── C3, C4 and C5. the dispatches ──────────────────────────────────
		const fixtureOf = { inner: COMPOSED_INNER, outer: COMPOSED_OUTER } as const;
		const chunkOf = { inner: innerChunk, outer: outerChunk } as const;
		const fetched = new Set<string>();
		let before = load;
		for (const [index, dispatch] of DISPATCHES.entries()) {
			const clickNumber = index + 1;
			const fixture = fixtureOf[dispatch.who];
			await page.click(fixture.button);

			// Both readouts, every time. One of them moving is the dispatch;
			// the OTHER one holding still is C4, and it is asserted on every
			// click rather than once — the parent's listener receives every
			// click the child's button makes, so "the parent did not answer"
			// is a standing claim and not a one-off observation.
			await expect.page.text(page, COMPOSED_OUTER.readout, dispatch.outer);
			await expect.page.text(page, COMPOSED_INNER.readout, dispatch.inner);

			const after = await quietRequests(page);
			const arrivals = arrivedSince(before, after);
			if (dispatch.fetches) {
				const wanted = chunkOf[dispatch.fetches];
				assert(
					arrivals.length === 1 && arrivals[0]!.url === wanted,
					`click ${clickNumber} on ${fixture.component} should have fetched exactly ${new URL(wanted).pathname} and nothing else; observed:\n${describe(arrivals)}`,
				);
				fetched.add(wanted);
				receipt.note(
					`click ${clickNumber} — ${fixture.component}: readout \`${dispatch[dispatch.who]}\`, and exactly one chunk arrived: ${pathOf(arrivals[0]!)} (${arrivals[0]!.encodedDataLength} B), ${fixture.artifactId}/${fixture.handlerId}. The other component's readout is unchanged at \`${dispatch.who === 'inner' ? dispatch.outer : dispatch.inner}\`.`,
				);
			} else {
				assert(
					arrivals.length === 0,
					`click ${clickNumber} on ${fixture.component} fetched something; its handler was already here:\n${describe(arrivals)}`,
				);
				receipt.note(
					`click ${clickNumber} — ${fixture.component}: readout \`${dispatch[dispatch.who]}\`, 0 B fetched. The handler that arrived on its first click is the handler that serves it.`,
				);
			}

			// C4's second arm, as a SET rather than as an absence: the handler
			// chunks this session has fetched are exactly the ones the clicks
			// so far are allowed to have fetched. After click 1 that set is the
			// child's alone — the parent's chunk is not merely un-arrived on
			// this click, it is nowhere in the session.
			const handlersSoFar = new Set(
				scripts(after)
					.filter((request) => isHandlerChunk(pathOf(request)))
					.map((request) => request.url),
			);
			assert(
				handlersSoFar.size === fetched.size &&
					[...fetched].every((chunkUrl) => handlersSoFar.has(chunkUrl)),
				`after click ${clickNumber} the session has fetched handler chunks [${[...handlersSoFar].map((chunkUrl) => new URL(chunkUrl).pathname).join(', ')}]; the clicks so far account for [${[...fetched].map((chunkUrl) => new URL(chunkUrl).pathname).join(', ')}].`,
			);

			// C5: the parent's whole subtree, against the SERVED bytes rather
			// than against the previous snapshot, so a drift that crept in one
			// click at a time cannot pass by being small.
			const subtree = withoutReadouts(
				mountSubtree(await page.content(), COMPOSED_OUTER.artifactId, `click ${clickNumber}`),
				`the page after click ${clickNumber}`,
			);
			assert(
				subtree === servedStable,
				`click ${clickNumber} moved markup other than the readouts.\nserved:\n${servedStable}\nafter:\n${subtree}`,
			);
			before = after;
		}
		receipt.note(
			`C4 — the parent did not dispatch, and neither did the child on the parent's click. Both readouts were asserted after all ${DISPATCHES.length} clicks, and the session's handler-chunk set grew by exactly the component that was clicked. The parent's delegated listener receives every one of the child's clicks (\`resumer.ts:432-437\` matches \`element.contains(target)\` and the parent's container contains the child's button); its wiring addresses its own button, which contains nothing.`,
		);
		receipt.note(
			`W3 — child click fetched only the child's handler chunk; parent click is the mirror. Same four dispatches as C3/C4.`,
		);
		receipt.note(
			`C5 — the markup does not move: ${servedStable.length} B of the parent's subtree, extracted from the served bytes and from the live DOM by the same function, are byte-identical after resume and after every one of the ${DISPATCHES.length} dispatches, with only the two readout texts masked. The child's element, its address and its nesting are the server's bytes throughout.`,
		);

		// ── C6. the bill, itemized ─────────────────────────────────────────
		const eagerBytes = totalBytes(eagerScripts);
		assert(
			eagerBytes < FIXTURES_EAGER_JS_CAP_BYTES,
			`eager JS was ${eagerBytes} B, over the ${FIXTURES_EAGER_JS_CAP_BYTES} B cap:\n${describe(eagerScripts)}`,
		);
		const entryFile = await eagerScriptBytes(url);
		const delta = entryFile.bytes - FIXTURES_EAGER_JS_BEFORE_COMPOSED_BYTES;
		receipt.note(
			`C6 — the bill. Eager JS: ${FIXTURES_EAGER_JS_BEFORE_COMPOSED_BYTES} B before the addressed pair, ${entryFile.bytes} B now (${delta >= 0 ? '+' : ''}${delta} B), in ONE entry script, against a ${FIXTURES_EAGER_JS_CAP_BYTES} B cap that has not moved — ${FIXTURES_EAGER_JS_CAP_BYTES - entryFile.bytes} B of headroom. On the wire the browser recorded ${eagerBytes} B for the same script, response headers included.`,
		);
		receipt.note(
			`C6 — where the ${COMPOSED_PAIR_EAGER_BYTES.total} B went, in shipped bytes: ${COMPOSED_PAIR_EAGER_BYTES.payload} B is the addressed pair's OWN payload (two structures, two wirings) and ${COMPOSED_PAIR_EAGER_BYTES.indexing} B is REGISTRY INDEXING — ${COMPOSED_PAIR_EAGER_BYTES.namespaceWrappers} B of module-namespace wrappers, ${COMPOSED_PAIR_EAGER_BYTES.staticGlobKeys} B of eager glob keys, ${COMPOSED_PAIR_EAGER_BYTES.lazyGlobEntries} B of lazy glob entries. That layer is not a cost of addressing: every component on this page pays its share, and page-wide it is ${FIXTURES_INDEXING_LAYER_BYTES} B of the ${entryFile.bytes} B entry. It is named here so that when the indexing work lands, this number moves for a reason already written down.`,
		);

		const branch = reachable.filter((chunk) => chunk.kind === 'unclassified');
		assert(
			branch.length === 0,
			`the page can reach ${branch.length} chunk(s) that are neither a handler, the region resolver, nor the store partition:\n${branch
				.map((chunk) => `  ${chunk.url} — named by ${chunk.namedBy}`)
				.join('\n')}`,
		);
		receipt.note(
			`C6 — nothing else is in the graph: the ${reachable.length} chunks reachable from this entry, walked static and dynamic, are the entry plus ${reachable.filter((chunk) => chunk.kind === 'handler').length} handler artifacts, the region resolver and the store partition, with NOTHING unclassified. Two components composed, and no component body and no framework byte anywhere in the walk.`,
		);

		const final = await quietRequests(page);
		const sessionScripts = scripts(final);
		const expectedSession = new Map<string, string>([
			[entryUrl, 'the entry bundle, on load: the resumer, both components\' structure and wiring'],
			[innerChunk, `${COMPOSED_INNER.artifactId}/${COMPOSED_INNER.handlerId}, on the child's first click`],
			[outerChunk, `${COMPOSED_OUTER.artifactId}/${COMPOSED_OUTER.handlerId}, on the parent's first click`],
		]);
		const unexpected = sessionScripts.filter((request) => !expectedSession.has(request.url));
		assert(
			sessionScripts.length === expectedSession.size && unexpected.length === 0,
			`the session fetched scripts outside the itemized set:\n${describe(unexpected)}\nwhole set:\n${describe(sessionScripts)}`,
		);
		receipt.note(
			`C6 — whole session, ${DISPATCHES.length} dispatches, ${sessionScripts.length} script requests totalling ${totalBytes(sessionScripts)} B:\n${sessionScripts
				.map(
					(request) =>
						`  ${pathOf(request)} ${request.encodedDataLength} B — ${expectedSession.get(request.url)}`,
				)
				.join('\n')}\nThe two components are composed in the document and separate on the wire: one chunk each, on the click that needed it, and nothing on the clicks after.`,
		);

		await expect.page.outcome(page, {
			interactions: { click: DISPATCHES.length },
			navigations: 0,
			consoleErrors: 0,
			failedRequests: 0,
		});
	},
);
