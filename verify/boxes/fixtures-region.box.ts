import { box } from '@async/witness';
import {
	FIXTURES_EAGER_JS_CAP_BYTES,
	ROSTER_CONTAINER,
	ROSTER_MOUNT,
	ROSTER_READOUT,
	ROSTER_SEED_ORDER,
	ROSTER_SERVED_ORDER,
	pageUrl,
	rosterDropButton,
} from '../config.ts';
import { handlerChunks, reachableChunks, regionsChunk, storePartition } from './support/chunks.ts';
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
// The carrier's own witness: a keyed list the DOCUMENT carries, resumed by key.
//
// Every other box on this page measures absence — code that is not on the wire
// until someone asks for it. This one measures something the machinery has
// never been asked to show outside a unit test: a populated list nobody's
// JavaScript built, whose items answer a click by IDENTITY, in a real browser,
// with the region's markup provably untouched from the served bytes.
//
// The three claims, and why each one needs the other two:
//
//   1. The list is in the DOCUMENT. Fetched here with `fetch`, before any
//      browser is involved: three `<li data-key>` elements, in the order the
//      page serves them. No component body produced them, because there is no
//      component body on this page — and the build refuses the page if the
//      hand-authored markup drifts from the emitted template or loses a key
//      (`check-template`, in the plugin).
//
//   2. A click resolves by KEY, not by position. The served order is the
//      REVERSE of the store's seed order, so the two disagree for every member
//      but the middle one. Clicking the THIRD item as served and reading
//      `dropped ada` — Ada being the store's FIRST member — is one observation
//      that only key resolution can produce. A page that counted siblings would
//      say `dropped alan` and this box would go red on the text.
//
//   3. The region does not move. The `<ul>` is snapshotted around every single
//      dispatch and compared byte for byte against what the server sent. The
//      readout that changes is a sibling of the container, not a descendant of
//      an item: the action's RETURN goes into a cell OUTSIDE the region, so one
//      click is evidence for key identity and DOM invariance at the same time.
//
// And the economics, itemized by URL, bytes and trigger, because "it worked"
// is only interesting if what it cost is stated: the region resolver arrives in
// exactly one chunk on the first region dispatch and never again, one handler
// chunk serves every item of the list, and the store ARRIVES — one dynamic
// import, framework-free, on the dispatch that first needs it.
//
// Nothing on this page hydrates. The document is already painted; the region
// RESUMES, the store ARRIVES, and the deferral group — the framework and the
// four bodies that stay with it, two the pass cannot prove and two it proves
// but may not substitute — is uninvolved from the first byte to the last.
//
// ── What this box does NOT claim ────────────────────────────────────────────
//
//   D1. NOTHING IS REMOVED. `drop` records an id and returns a line; the roster
//       the page serves is the roster the page keeps. This box asserts the list
//       is unchanged — it is not a deletion witness, and a reader who takes
//       `dropped ada` for a removal is reading a word, not a measurement.
//
//   D2. NO RE-RENDER, NO LIST UPDATE. No item is created, destroyed, reordered
//       or re-bound by anything measured here. The region's markup is invariant
//       BY ASSERTION, which is the evidence — not a side effect of a list that
//       happened not to change.
//
//   D3. A RESUMED PAGE STILL CANNOT MUTATE A LIST WITHOUT THE GROUP. Painting a
//       changed list needs a renderer, and this build ships no renderer at all
//       — the fallback branch is auto-omitted, which is the claim asserted
//       below, so the limit is harder than "a chunk nobody fetches". What is
//       witnessed is dispatch and resolution, which is the half the machinery
//       owns; the other half is still the framework's, and it is not here.
//
//   D4. THE STORE PARTITION IS NOT ABSENT FROM THE BUILD. It is in the build
//       twice over: as the chunk this page fetches on demand, and inside the
//       fallback graph, which reaches exactly three store-partition modules
//       (claim 7b of `demo/scripts/check-zero-eager.mjs`). The claim is about
//       WHEN those bytes cross the wire, never about a build that lacks them.
//
//   D5. THE KEYS ARE THE DOCUMENT'S; THE RESOLUTION IS THE STORE'S. Nothing at
//       runtime trusts the served markup: a key the live store's list does not
//       have is a refusal, not a guess at the neighbour. That the keys are
//       present, unique and matched to the emitted template is the BUILD's
//       assertion (`check-template`), quoted here rather than re-measured.
//
//   D6. ONE PAGE, ONE REGION, ONE CARRIER. This is a witness that the keyed-
//       region machinery works on the wire, not a coverage statement. It moves
//       no analyzer verdict, it says nothing about lists in general, and the
//       provider's expected refusal — `Roster` creates the store, so the
//       resumable page never runs it — stands exactly where the coverage
//       baseline records it.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The four dispatches, and the shape of the evidence they make.
 *
 * `position` is where the item sits AS SERVED; `member` is who the store says
 * that is. They agree only for Grace. The first click is the third item — the
 * ruling's own case, where position and identity are furthest apart — and the
 * plan then walks the rest of the list so the ONE handler chunk that arrived on
 * click one is seen serving every item, and comes back to the third to spend a
 * fourth click that fetches nothing at all.
 */
const DISPATCHES: ReadonlyArray<{
	readonly position: number;
	readonly member: string;
	readonly readout: string;
}> = [
	{ position: 3, member: 'ada', readout: 'dropped ada' },
	{ position: 1, member: 'alan', readout: 'dropped alan' },
	{ position: 2, member: 'grace', readout: 'dropped grace' },
	{ position: 3, member: 'ada', readout: 'dropped ada' },
];

/** Where the same member sits in the CLASSIC variant, which renders seed order. */
function classicPosition(member: string): number {
	const index = ROSTER_SEED_ORDER.indexOf(member as (typeof ROSTER_SEED_ORDER)[number]);
	if (index === -1) throw new Error(`${member} is not a seeded roster member.`);
	return index + 1;
}

/**
 * The region container, cut out of a page's bytes exactly as they are.
 *
 * Both sides of the comparison go through this: the server's response and the
 * live DOM serialized by Chrome. That is what makes "byte-identical" mean
 * something — the same extraction over the same markup, so a difference is a
 * difference in the page rather than in how it was read.
 */
function containerMarkup(html: string, where: string): string {
	const start = html.indexOf('<ul class="roster">');
	const end = html.indexOf('</ul>', start);
	if (start === -1 || end === -1) {
		throw new Error(`no roster container found in ${where}.`);
	}
	return html.slice(start, end + '</ul>'.length);
}

/** The served document, straight off the static server, with no browser in it. */
async function servedDocument(url: string): Promise<string> {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}.`);
	return response.text();
}

export default box(
	{
		name: 'resumable fixtures: the document carries the list, and a click resolves it by key without moving it',
		modes: ['dev'],
		tags: ['network', 'resumable', 'regions'],
	},
	async ({ browser, expect, receipt }) => {
		const url = pageUrl('resumable', 'fixtures');

		// ── 1. the list is in the document ─────────────────────────────────
		// A plain fetch: no browser, no scripts, no chance that something ran.
		// If the items are in these bytes then no JavaScript built them, and
		// that is the whole of claim one.
		const served = await servedDocument(url);
		const servedContainer = containerMarkup(served, 'the served document');
		const servedKeys = [...servedContainer.matchAll(/data-key="([^"]+)"/g)].map(
			(match) => match[1]!,
		);
		assert(
			servedKeys.join(',') === ROSTER_SERVED_ORDER.join(','),
			`the served document carries [${servedKeys}] as its roster keys; expected [${ROSTER_SERVED_ORDER}].`,
		);
		assert(
			new Set(servedKeys).size === servedKeys.length,
			`the served roster repeats a key: [${servedKeys}].`,
		);
		assert(
			[...ROSTER_SERVED_ORDER].join(',') === [...ROSTER_SEED_ORDER].reverse().join(','),
			`the served order [${ROSTER_SERVED_ORDER}] is no longer the reverse of the seed order — position and identity would agree, and a by-position dispatch would pass this box.`,
		);
		receipt.note(
			`the document serves the list already populated: keys [${servedKeys.join(', ')}], against the store's seed order [${ROSTER_SEED_ORDER.join(', ')}] — reversed, so position and identity disagree for Alan and Ada.`,
		);

		const page = await browser.visit(url);
		const load = await quietRequests(page);
		receipt.note(`resumable fixtures load set (region run):\n${describe(load)}`);

		// The live DOM against the served bytes, before anything is clicked.
		// The resumer has already run here — it installed its listeners on this
		// container — and the container still weighs what the server sent.
		const afterResume = containerMarkup(await page.content(), 'the resumed page');
		assert(
			afterResume === servedContainer,
			`resuming the page changed the region's markup.\nserved:\n${servedContainer}\nafter resume:\n${afterResume}`,
		);

		// ── the eager set: no component body, no framework byte ────────────
		// One script on load, and the reason there is only one is stronger than
		// it was: this build has no fallback branch for a second one to be.
		const eagerScripts = scripts(load);
		assert(
			eagerScripts.length === 1,
			`expected exactly one script on load; observed:\n${describe(eagerScripts)}`,
		);
		const entryUrl = eagerScripts[0]!.url;
		const eagerBytes = totalBytes(eagerScripts);
		const classic = await eagerScriptBytes(pageUrl('classic', 'fixtures'));
		assert(
			eagerBytes < FIXTURES_EAGER_JS_CAP_BYTES,
			`eager JS was ${eagerBytes} B, over the ${FIXTURES_EAGER_JS_CAP_BYTES} B cap:\n${describe(eagerScripts)}`,
		);

		// ── the branch that is not there ───────────────────────────────────
		//
		// OLD (retired 2026-08-13, when fallback auto-omit landed): "the
		// fallback group is named by the entry and never fetched". The group
		// chunk was resolved out of the entry's dynamic imports and asserted
		// absent from every request set below — the framework sitting behind
		// one `import()` nobody takes. The plugin's `policies.fallback:
		// 'auto-omit'` drops that import for a page whose every declared mount
		// is provable, all five of this page's are, so the chunk the claim
		// resolved does not exist and the claim could only fail on a resolver
		// that found nothing. An unfetched chunk was the evidence; there is no
		// chunk to leave unfetched.
		//
		// NEW: the branch is not in the graph, and that is asserted rather than
		// inherited. Every chunk this page can reach from its entry — static
		// and dynamic, transitively — is walked and classified by the kind the
		// emitter's own filenames declare: a handler artifact, the region
		// resolver, the store partition. The claim is that the UNCLASSIFIED set
		// is EMPTY, taken over the whole walk rather than read off a lookup
		// that started nowhere, because an emptiness produced by looking at
		// nothing is not a measurement. What the page does is not decline to
		// fetch a framework; it has nothing to fall back to.
		//
		// It stays falsifiable in the direction that matters: a build that grew
		// the branch back names a chunk that is none of the three kinds, and
		// this fails printing that chunk and the one whose bytes named it —
		// which is more than the resolver it replaces could say, since that one
		// threw on the count before it could name anything. The build-wide half
		// — no chunk in the fixtures build carries the ordinary renderer,
		// reachable from this entry or not — is claim 7b of
		// `demo/scripts/check-zero-eager.mjs`, gated against the module graph at
		// build time and quoted here rather than restated from a wire that can
		// only see what the page is able to ask for.
		const reachable = await reachableChunks(entryUrl);
		const branch = reachable.filter((chunk) => chunk.kind === 'unclassified');
		assert(
			branch.length === 0,
			`the page can reach ${branch.length} chunk(s) that are neither a handler, the region resolver, nor the store partition — the fallback branch is back in the graph:\n${branch
				.map((chunk) => `  ${chunk.url} — named by ${chunk.namedBy}`)
				.join('\n')}`,
		);
		const census = (['handler', 'regions', 'store'] as const).map(
			(kind) => `${reachable.filter((chunk) => chunk.kind === kind).length} ${kind}`,
		);
		receipt.note(
			`there is no fallback group to fetch: the ${reachable.length} chunks reachable from this entry, walked static and dynamic, are the entry itself plus ${census.join(', ')} — and none of them is a group chunk. The framework is not one import away from this page; it is not in the graph. (No chunk in the build carries it either: claim 7b of \`demo/scripts/check-zero-eager.mjs\`, gated against the module graph.)`,
		);

		const regions = await regionsChunk(entryUrl);
		const handler = (await handlerChunks(entryUrl)).url('KeyedRoster.RosterList', 's0');
		const store = await storePartition(entryUrl);
		const notYet = new Map<string, string>([
			[regions, 'the keyed-region resolver'],
			[handler, "the roster item's handler"],
			...store.map((chunkUrl) => [chunkUrl, 'the store partition'] as const),
		]);
		for (const [chunkUrl, what] of notYet) {
			assert(
				!load.some((request) => request.url === chunkUrl),
				`${what} (${new URL(chunkUrl).pathname}) was fetched on load, before anyone clicked anything:\n${describe(load)}`,
			);
		}
		receipt.note(
			`eager JS on load: ${eagerBytes} B in one entry chunk (cap ${FIXTURES_EAGER_JS_CAP_BYTES} B), against ${classic.bytes} B of classic entry for the same five components. Absent from the load set and named by the entry itself: ${[...notYet]
				.map(([chunkUrl, what]) => `${new URL(chunkUrl).pathname} (${what})`)
				.join(', ')}.`,
		);

		await expect.page.count(page, `${ROSTER_CONTAINER} > li.member`, 3);
		await expect.page.text(page, ROSTER_READOUT, 'none');

		// ── 2 and 3. the dispatches ────────────────────────────────────────
		let before = load;
		let previousContainer = servedContainer;
		for (const [index, dispatch] of DISPATCHES.entries()) {
			const clickNumber = index + 1;
			await page.click(rosterDropButton(dispatch.position));
			await expect.page.text(page, ROSTER_READOUT, dispatch.readout);

			// The readout names who the STORE resolved, and the item that was
			// clicked is the one at that position in the SERVED order. On click
			// one those two are Ada and the third item: identity from the store,
			// position from the document, and they cross.
			const key = servedKeys[dispatch.position - 1]!;
			assert(
				key === dispatch.member,
				`served position ${dispatch.position} carries data-key="${key}", not "${dispatch.member}" — the fixture's premise moved.`,
			);

			const after = await quietRequests(page);
			const arrivals = arrivedSince(before, after);
			const arrivedUrls = new Set(arrivals.map((request) => request.url));

			if (clickNumber === 1) {
				// One dispatch, three absences ended, itemized.
				const expected = new Map<string, string>([
					[regions, 'the keyed-region resolver, on the first dispatch through a region container'],
					[handler, 'KeyedRoster.RosterList/s0, the item handler this list dispatches through'],
					...store.map(
						(chunkUrl) =>
							[chunkUrl, 'the store partition, on the dispatch that first needed a store'] as const,
					),
				]);
				assert(
					arrivals.length === expected.size &&
						[...expected.keys()].every((chunkUrl) => arrivedUrls.has(chunkUrl)),
					`the first region dispatch should fetch exactly:\n${[...expected]
						.map(([chunkUrl, why]) => `  ${new URL(chunkUrl).pathname} — ${why}`)
						.join('\n')}\nobserved:\n${describe(arrivals)}`,
				);
				for (const request of arrivals) {
					receipt.note(
						`click 1 (served position 3 → ${dispatch.member}): ${request.url} — ${request.encodedDataLength} B — ${expected.get(request.url)}.`,
					);
				}
			} else {
				assert(
					arrivals.length === 0,
					`click ${clickNumber} (served position ${dispatch.position} → ${dispatch.member}) fetched something; the resolver, the handler and the store were already here:\n${describe(arrivals)}`,
				);
				receipt.note(
					`click ${clickNumber} (served position ${dispatch.position} → ${dispatch.member}): readout \`${dispatch.readout}\`, 0 B fetched — one handler chunk is serving every item of the list.`,
				);
			}

			// The region, byte for byte, around this dispatch. Compared against
			// the SERVED markup rather than against the previous snapshot, so a
			// drift that crept in one click at a time cannot pass by being small.
			const container = containerMarkup(await page.content(), `the page after click ${clickNumber}`);
			assert(
				container === servedContainer,
				`click ${clickNumber} moved the region's markup.\nbefore:\n${previousContainer}\nafter:\n${container}`,
			);
			previousContainer = container;
			before = after;
		}

		receipt.note(
			`the region's markup is byte-identical across all ${DISPATCHES.length} dispatches: ${servedContainer.length} B of \`<ul class="roster">\`, the same bytes the server sent, before the first click and after the last.`,
		);

		// ── the session's whole bill ───────────────────────────────────────
		const final = await quietRequests(page);
		const sessionScripts = scripts(final);
		const expectedSession = new Map<string, string>([
			[entryUrl, 'the entry bundle, on load'],
			[handler, 'the item handler, on the first dispatch'],
			[regions, 'the keyed-region resolver, on the first dispatch'],
			...store.map(
				(chunkUrl) => [chunkUrl, 'the store partition, on the first dispatch'] as const,
			),
		]);
		const unexpected = sessionScripts.filter((request) => !expectedSession.has(request.url));
		assert(
			sessionScripts.length === expectedSession.size && unexpected.length === 0,
			`the session fetched scripts outside the itemized set:\n${describe(unexpected)}\nwhole set:\n${describe(sessionScripts)}`,
		);
		// The session's whole bill used to end with one more line — "the group
		// was never fetched" — and the assertion above is what carries that now.
		// It is the stronger form for a build with no branch in it: naming every
		// script the session was allowed to fetch fails on ANY chunk outside the
		// itemized set, a returning fallback branch included, and it fails with
		// that chunk's own path printed. A `!fetched(theGroup)` line would have
		// needed a group to name.
		receipt.note(
			`whole session, ${DISPATCHES.length} dispatches, ${sessionScripts.length} script requests totalling ${totalBytes(sessionScripts)} B:\n${sessionScripts
				.map(
					(request) =>
						`  ${pathOf(request)} ${request.encodedDataLength} B — ${expectedSession.get(request.url)}`,
				)
				.join('\n')}\nno group chunk appears, and none exists to: this build ships no fallback branch.`,
		);

		await expect.page.outcome(page, {
			interactions: { click: DISPATCHES.length },
			navigations: 0,
			consoleErrors: 0,
			failedRequests: 0,
		});

		// ── 4. the classic variant, same source, same answers ──────────────
		// The control, and it is a control in two directions. The same fixture
		// source, built the ordinary way, gives the same four readouts — so the
		// resumed page is not a page that behaves differently, it is the same
		// page reached without the bytes. And it gets there by throwing the
		// document's list away: `render()` builds its own nodes, so the keys the
		// document carried are gone from the DOM and the order is the store's.
		// Same members, different positions, same readouts.
		const classicPage = await browser.visit(pageUrl('classic', 'fixtures'));
		const classicLoad = await quietRequests(classicPage);
		await expect.page.count(classicPage, `${ROSTER_CONTAINER} > li.member`, 3);
		await expect.page.count(classicPage, `${ROSTER_CONTAINER} > li.member[data-key]`, 0);
		await expect.page.text(classicPage, ROSTER_READOUT, 'none');
		const classicContainer = containerMarkup(
			await classicPage.content(),
			'the classic page after render',
		);
		assert(
			classicContainer !== servedContainer,
			'the classic variant left the served list in place; it is supposed to clear the mount and render its own, which is the cost this comparison is about.',
		);

		for (const dispatch of DISPATCHES) {
			await classicPage.click(rosterDropButton(classicPosition(dispatch.member)));
			await expect.page.text(classicPage, ROSTER_READOUT, dispatch.readout);
		}
		const classicAfter = await quietRequests(classicPage);
		const classicArrivals = arrivedSince(classicLoad, classicAfter);
		assert(
			classicArrivals.length === 0,
			`the classic variant fetched something per dispatch, which it has nothing to fetch:\n${describe(classicArrivals)}`,
		);
		receipt.note(
			`classic control: the same four dispatches — ${DISPATCHES.map((dispatch) => `${dispatch.member}@${classicPosition(dispatch.member)}`).join(', ')} against ${DISPATCHES.map((dispatch) => `${dispatch.member}@${dispatch.position}`).join(', ')} on the resumable side — produce the same four readouts out of one ${classic.bytes} B entry bundle, with 0 B fetched after load. Same members, different positions, same answers.`,
		);

		await expect.page.outcome(classicPage, {
			interactions: { click: DISPATCHES.length },
			navigations: 0,
			consoleErrors: 0,
			failedRequests: 0,
		});
	},
);
