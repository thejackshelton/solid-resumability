import { box } from '@async/witness';
import { FIXTURES, FIXTURES_EAGER_JS_CAP_BYTES, ROSTER_READOUT, pageUrl } from '../config.ts';
import { handlerChunks, reachableChunks, regionsChunk, storePartition } from './support/chunks.ts';
import { arrivedSince, assert, describe, kindOf, pathOf, quietRequests, scripts, totalBytes } from './support/network.ts';
import { eagerScriptBytes } from './support/page-bytes.ts';

// The claim under test is "the handler code is not in the browser until the
// user asks for it". Nothing in the page can be trusted to report that about
// itself, so the proof is entirely network-shaped: what Chrome actually
// requested, when, and how many bytes it weighed.
//
// Three facts together are the claim:
//   - there is no fallback bundle to request. The branch that would carry the
//     framework and the whole classic component set is omitted from a build
//     whose every declared mount is provable, and this box asserts that the
//     chunks the page can reach are the handler artifacts, the region resolver
//     and the store partition with nothing left over — so "resumption bailed
//     out and the page is quietly running the eager path" is not a state this
//     build can be in.
//   - no `s<n>-*.js` chunk is requested before any interaction, and each one
//     arrives on exactly the interaction that needs it.
//   - the interactions work. Absent handler code that never becomes present is
//     just a broken page; the DOM assertions are what make the absence a
//     property of the design rather than of a failure.
//
// Five fixtures since the carrier landed, and the fifth is why the numbers here
// are itemized instead of counted. The roster's first click is one dispatch
// that ends three absences at once — its handler chunk, the keyed-region
// resolver, and the store partition — so this box states every URL it expects
// with the trigger that fetches it. `fixtures-region.box.ts` is the carrier's
// own witness, and takes the region apart claim by claim; what the roster is
// doing HERE is standing in the same line as the other four and paying its
// bill in public.

export default box(
	{
		name: 'resumable fixtures: no fallback, no handler chunk until the click that needs it',
		modes: ['dev'],
		tags: ['network', 'resumable'],
	},
	async ({ browser, expect, receipt }) => {
		const url = pageUrl('resumable', 'fixtures');
		const page = await browser.visit(url);
		const load = await quietRequests(page);

		receipt.note(`resumable fixtures load set:\n${describe(load)}`);

		// The whole load set, classified. Anything outside document/stylesheet/
		// script is named rather than filtered away, so a stray request cannot
		// hide behind a category.
		const documents = load.filter((request) => kindOf(request) === 'document');
		const stylesheets = load.filter((request) => kindOf(request) === 'stylesheet');
		const eagerScripts = scripts(load);
		const others = load.filter((request) => kindOf(request) === 'other');
		assert(
			documents.length === 1 && stylesheets.length === 1 && eagerScripts.length === 1,
			`expected exactly one document, one stylesheet and one script on load; got ${documents.length}/${stylesheets.length}/${eagerScripts.length} in:\n${describe(load)}`,
		);
		assert(
			others.every((request) => pathOf(request) === '/favicon.ico'),
			`unexpected non-asset requests on load:\n${describe(others)}`,
		);

		assert(
			!load.some((request) => /\/s\d+-[\w-]+\.js$/.test(pathOf(request))),
			`a handler chunk was requested before any interaction:\n${describe(load)}`,
		);

		// Every JS byte the page pulls before the first interaction, with no
		// exclusions: one entry bundle is all there is.
		const eagerBytes = totalBytes(eagerScripts);
		const classic = await eagerScriptBytes(pageUrl('classic', 'fixtures'));
		receipt.note(
			`eager JS on load: resumable ${eagerBytes} B on the wire (cap ${FIXTURES_EAGER_JS_CAP_BYTES} B); the classic build of the same page ships ${classic.bytes} B of entry bundle alone.`,
		);
		assert(
			eagerBytes < FIXTURES_EAGER_JS_CAP_BYTES,
			`eager JS was ${eagerBytes} B, over the ${FIXTURES_EAGER_JS_CAP_BYTES} B cap:\n${describe(eagerScripts)}`,
		);

		const entryUrl = eagerScripts[0]!.url;

		// ── the fallback bundle, re-derived as an absence ──────────────────
		//
		// OLD (retired 2026-08-13, when fallback auto-omit landed): two asserts
		// that no request's path contained `/fallback-`, one over the load set
		// and one over the whole session. Both were true and neither measured
		// anything any more: the plugin omits the branch for a page whose every
		// declared mount is provable, all five of this page's are, so a request
		// for a file that is not in the build is a request no browser could
		// make. A green line about a chunk nobody emitted is the shape this
		// suite exists to refuse.
		//
		// NEW: the branch is not in the graph, asserted. Every chunk this page
		// can reach from its entry is walked and classified by the kind the
		// emitter's filenames declare — handler artifact, region resolver,
		// store partition — and the claim is that nothing is left over. A build
		// that grew the branch back names a chunk matching none of the three
		// and this fails printing it. `fixtures-region.box.ts` carries the same
		// claim with the reasoning; here it is the load set's fourth fact.
		const reachable = await reachableChunks(entryUrl);
		const branch = reachable.filter((chunk) => chunk.kind === 'unclassified');
		assert(
			branch.length === 0,
			`the page can reach ${branch.length} chunk(s) that are neither a handler, the region resolver, nor the store partition — the fallback branch is back in the graph:\n${branch
				.map((chunk) => `  ${chunk.url} — named by ${chunk.namedBy}`)
				.join('\n')}`,
		);
		receipt.note(
			`no fallback bundle was requested because none exists: the ${reachable.length} chunks reachable from the entry are the entry, the handler artifacts, the region resolver and the store partition, with nothing left over. The build-wide reading — no chunk carries the ordinary renderer — is claim 7b of \`demo/scripts/check-zero-eager.mjs\`.`,
		);

		const chunks = await handlerChunks(entryUrl);
		const regions = await regionsChunk(entryUrl);
		const store = await storePartition(entryUrl);

		/**
		 * What one fixture's FIRST click is allowed to put on the wire, itemized
		 * by URL with the trigger stated for each.
		 *
		 * Four of the five cost one chunk, and for them this is the old
		 * one-request expectation with its name attached. The fifth is the
		 * carrier, and its bill is three lines rather than one because three
		 * different absences end on that click: the handler artifact, the
		 * keyed-region resolver (this is the page's first dispatch through a
		 * region container), and the store partition (its action slot names a
		 * store this page never created, so the mount point's `onMissing` goes
		 * and fetches one). Naming them separately is the point — a count would
		 * have said "four requests" and left which four to the reader.
		 */
		function expectedFirstFetch(fixture: (typeof FIXTURES)[number]): Map<string, string> {
			const expected = new Map<string, string>([
				[
					chunks.url(fixture.artifactId, fixture.handlerId),
					`${fixture.artifactId}/${fixture.handlerId}, the handler this click binds`,
				],
			]);
			if (fixture.alsoFetches.includes('regions')) {
				expected.set(regions, 'the keyed-region resolver, on the page\'s first region dispatch');
			}
			if (fixture.alsoFetches.includes('store')) {
				for (const url of store) {
					expected.set(url, 'the store partition, on the dispatch that first needs a store');
				}
			}
			return expected;
		}

		// The resumable page is server-rendered markup: every readout already
		// shows its initial value with no component body in the browser. The
		// roster's readout is the same claim on the carrier — `none` is what the
		// document says, and nothing has run to say anything else.
		await expect.page.text(page, '[data-testid="provable-counter-label"]', 'count: 0');
		await expect.page.text(page, '[data-testid="provable-stepper-total"]', '15');
		await expect.page.text(page, '[data-testid="provable-greeting-text"]', 'hello, world');
		await expect.page.text(page, '[data-testid="props-pair-label"]', '0');
		await expect.page.text(page, ROSTER_READOUT, 'none');

		for (const fixture of FIXTURES) {
			const expected = expectedFirstFetch(fixture);

			const beforeFirst = await quietRequests(page);
			await page.click(fixture.button);
			await expect.page.text(page, fixture.readout, fixture.afterFirst);
			const afterFirst = await quietRequests(page);
			const firstArrivals = arrivedSince(beforeFirst, afterFirst);
			const arrivedUrls = new Set(firstArrivals.map((request) => request.url));
			assert(
				arrivedUrls.size === firstArrivals.length &&
					arrivedUrls.size === expected.size &&
					[...expected.keys()].every((url) => arrivedUrls.has(url)),
				`${fixture.component}: the first click should fetch exactly:\n${[...expected]
					.map(([url, why]) => `  ${new URL(url).pathname} — ${why}`)
					.join('\n')}\nobserved:\n${describe(firstArrivals)}`,
			);
			for (const request of firstArrivals) {
				receipt.note(
					`${fixture.component}: first click fetched ${pathOf(request)} (${request.encodedDataLength} B) — ${expected.get(request.url)}.`,
				);
			}

			await page.click(fixture.button);
			await expect.page.text(page, fixture.readout, fixture.afterRepeat);
			const afterRepeat = await quietRequests(page);
			assert(
				arrivedSince(afterFirst, afterRepeat).length === 0,
				`${fixture.component}: the repeat click fetched something:\n${describe(arrivedSince(afterFirst, afterRepeat))}`,
			);
		}

		const final = await quietRequests(page);
		// The session's whole JavaScript bill, itemized rather than counted.
		//
		// This is also where the retired `/fallback-` line went: an itemized set
		// fails on ANY script outside it, a returning fallback branch included,
		// and it fails with that request's own path printed. The substring test
		// it replaces could only have caught a chunk that kept its old name.
		//
		// It used to be `1 + FIXTURES.length` — one entry, one handler chunk per
		// component — and a count is exactly what stopped being enough when the
		// carrier landed: two more chunks arrive on this page now, and a number
		// that grew by two would have proved only that a number grew. So the
		// expectation names every URL and says what put it there. Anything
		// extra fails with its own path printed; anything missing fails by name.
		const expectedSession = new Map<string, string>([
			[entryUrl, 'the entry bundle: the resumer, the artifacts, the deferral loader'],
			...FIXTURES.map(
				(fixture) =>
					[
						chunks.url(fixture.artifactId, fixture.handlerId),
						`${fixture.artifactId}/${fixture.handlerId}, fetched by ${fixture.component}'s first click`,
					] as const,
			),
			[regions, 'the keyed-region resolver, fetched by the roster\'s first dispatch and never again'],
			...store.map(
				(url) => [url, 'the store partition, fetched by the roster\'s first dispatch'] as const,
			),
		]);
		const sessionUrls = new Set(scripts(final).map((request) => request.url));
		const unexpected = [...sessionUrls].filter((url) => !expectedSession.has(url));
		const absent = [...expectedSession.keys()].filter((url) => !sessionUrls.has(url));
		assert(
			scripts(final).length === expectedSession.size &&
				unexpected.length === 0 &&
				absent.length === 0,
			`the session's script set is not the itemized ${expectedSession.size}:\n${[
				absent.length ? `expected but never fetched:\n${absent.join('\n')}` : '',
				unexpected.length ? `fetched but not expected:\n${unexpected.join('\n')}` : '',
			]
				.filter(Boolean)
				.join('\n')}\nobserved:\n${describe(scripts(final))}`,
		);
		receipt.note(
			`session script bill, itemized (${expectedSession.size} requests):\n${scripts(final)
				.map(
					(request) =>
						`  ${pathOf(request)} ${request.encodedDataLength} B — ${expectedSession.get(request.url)}`,
				)
				.join('\n')}`,
		);
		receipt.note(`full session request set:\n${describe(final)}`);

		// Ten clicks, two per component, all witnessed by the driver.
		await expect.page.outcome(page, {
			interactions: { click: FIXTURES.length * 2 },
			navigations: 0,
			consoleErrors: 0,
			failedRequests: 0,
		});
	},
);
