import { box } from '@async/witness';
import {
	TABS_DISPATCH,
	TABS_EAGER_JS_BASELINE_BYTES,
	TABS_EAGER_JS_CAP_BYTES,
	TABS_LIVE,
	TABS_LIVE_TAB,
	TABS_PANEL_PROFILE,
	TABS_PANEL_SETTINGS,
	TABS_PROVIDER_CHUNK,
	TABS_STORE_ATTRS,
	pageUrl,
} from '../config.ts';
import {
	arrivedSince,
	assert,
	describe,
	kindOf,
	pathOf,
	quietRequests,
	scripts,
	totalBytes,
} from './support/network.ts';
import { eagerScriptBytes } from './support/page-bytes.ts';

// ─────────────────────────────────────────────────────────────────────────────
// T090 / T091 WP-θ: priced deferral generality. Live TabsRoot is NOT on the
// eager graph. A miss starts one dynamic import of the provider; after
// mount, clicking a different live tab flips aria-selected. Does not
// move 3/12.
//
//   (1) SERVED SHAPE. First-party dispatch button, empty live region, no
//       store-derived tabs attrs, no live panel text.
//
//   (2) ZERO-EAGER LOAD. Exactly one script. On load no request fetches
//       the provider chunk. Eager entry dynamically imports it once and
//       does not statically import it. Store-derived attrs stay absent —
//       the provider has not run. A box that passes with the provider
//       already executed is tightened, not shipped.
//
//   (3) FIRST DISPATCH. A real Chrome click on the first-party button
//       lands while the load set still has no provider chunk, then
//       fetches exactly ONE provider chunk in the post-dispatch delta.
//
//   (4) LIVE TABS. After mount, the live region holds interactive tabs
//       under no [data-resume] ancestor. Clicking Settings flips
//       aria-selected and shows the settings panel.
//
//   Three-way failure (T087 Ruling 1): eager (provider on load), broken
//   (click fetches 0 / tabs never interactive), deferred (this path).
// ─────────────────────────────────────────────────────────────────────────────

async function servedDocument(url: string): Promise<string> {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}.`);
	return response.text();
}

function taggedInner(html: string, attr: string): string {
	const at = html.indexOf(attr);
	if (at === -1) throw new Error(`no [${attr}] in the page.`);
	const start = html.lastIndexOf('<', at);
	const openEnd = html.indexOf('>', at);
	const tag = /^<([a-z0-9]+)/i.exec(html.slice(start, openEnd + 1))?.[1];
	if (!tag) throw new Error(`could not read the [${attr}] host tag.`);
	let depth = 1;
	let index = openEnd + 1;
	const openPat = new RegExp(`<${tag}\\b`, 'gi');
	const closePat = new RegExp(`</${tag}>`, 'gi');
	while (depth > 0 && index < html.length) {
		openPat.lastIndex = index;
		closePat.lastIndex = index;
		const open = openPat.exec(html);
		const close = closePat.exec(html);
		if (!close) throw new Error(`[${attr}] never closes.`);
		if (open && open.index < close.index) {
			depth += 1;
			index = open.index + 1;
		} else {
			depth -= 1;
			if (depth === 0) return html.slice(openEnd + 1, close.index);
			index = close.index + 1;
		}
	}
	throw new Error(`[${attr}] never closes.`);
}

function hasAttribute(openTag: string, name: string): boolean {
	return new RegExp(`\\s${name}(?:=|\\s|>)`, 'i').test(openTag);
}

function dispatchButtonOpen(html: string): string | null {
	const inner = taggedInner(html, 'data-tabs-dispatch');
	const match = /<button\b[^>]*>/i.exec(inner);
	return match?.[0] ?? null;
}

export default box(
	{
		name: 'resumable tabs: deferred live TabsRoot; first dispatch fetches provider once then live aria-selected flips; no fallback',
		modes: ['dev'],
		tags: ['network', 'resumable', 'tabs'],
	},
	async ({ browser, expect, receipt }) => {
		const url = pageUrl('resumable', 'tabs');

		const served = await servedDocument(url);
		assert(
			served.includes('data-tabs-dispatch') && served.includes('data-tabs-live'),
			`(1) — served document is missing the dispatch mount or the live region:\n${served.slice(0, 800)}`,
		);
		const servedDispatch = dispatchButtonOpen(served);
		assert(
			servedDispatch !== null,
			`(1) — the first-party dispatch mount does not hold a <button>.`,
		);
		for (const name of TABS_STORE_ATTRS) {
			assert(
				!hasAttribute(servedDispatch, name) && !new RegExp(`\\s${name}=`, 'i').test(served),
				`(1) — served bytes already carry ${name}; store-derived attrs bake no bytes, so a value here was painted by the page or the build, and this is a stub.`,
			);
		}
		assert(
			!served.includes(TABS_PANEL_PROFILE) && !served.includes(TABS_PANEL_SETTINGS),
			`(1) — served document already carries live tab panel text; panels must be live-only:\n${served.slice(0, 800)}`,
		);
		receipt.note(
			`(1) — served first-party [data-tabs-dispatch] <button> and empty [data-tabs-live]. None of ${TABS_STORE_ATTRS.join(' / ')}.`,
		);

		const page = await browser.visit(url);
		const load = await quietRequests(page);
		receipt.note(`resumable tabs load set:\n${describe(load)}`);

		const documents = load.filter((request) => kindOf(request) === 'document');
		const stylesheets = load.filter((request) => kindOf(request) === 'stylesheet');
		const eagerScripts = scripts(load);
		assert(
			documents.length === 1 && stylesheets.length === 1 && eagerScripts.length === 1,
			`expected exactly one document, one stylesheet and one script on load; got ${documents.length}/${stylesheets.length}/${eagerScripts.length} in:\n${describe(load)}`,
		);

		const entryUrl = eagerScripts[0]!.url;
		const entrySource = await (await fetch(entryUrl)).text();

		assert(
			!load.some((request) => /fallback/i.test(pathOf(request))),
			`(2) — a fallback chunk was fetched on load:\n${describe(load)}`,
		);

		const loadProvider = load.filter((request) => TABS_PROVIDER_CHUNK.test(pathOf(request)));
		assert(
			loadProvider.length === 0,
			`(2) — EAGER: the provider chunk was fetched on load; deferred execution requires it absent until the first dispatch:\n${describe(loadProvider)}`,
		);
		const dynamicProvider = [...entrySource.matchAll(/import\("([^"]+)"\)/g)]
			.map((match) => match[1]!)
			.filter((specifier) => TABS_PROVIDER_CHUNK.test(`/${specifier.split('/').pop()}`));
		assert(
			dynamicProvider.length === 1,
			`(2) — the eager entry should dynamically import exactly one provider chunk; found ${dynamicProvider.length}: ${dynamicProvider.join(', ') || 'none'}.`,
		);
		assert(
			!/(?:^|[;}\s])import\s*[^"'`]*["'][^"']*tabs-provider/.test(entrySource),
			`(2) — the eager entry statically imports the provider; those bytes must sit behind import().`,
		);
		receipt.note(
			`(2) — load set has no provider-chunk request. Eager entry dynamically imports ${dynamicProvider[0]}.`,
		);

		const liveAfterLoad = await page.content();
		for (const name of TABS_STORE_ATTRS) {
			assert(
				!new RegExp(`\\s${name}=`, 'i').test(liveAfterLoad),
				`(2) — after load the page already carries ${name}; store-derived attrs arrive only after the provider mounts, so a value here means the provider ran on load (EAGER).`,
			);
		}
		assert(
			!liveAfterLoad.includes(TABS_PANEL_PROFILE) && !liveAfterLoad.includes(TABS_PANEL_SETTINGS),
			`(2) — after load the page already carries live tab panels; the provider ran on load (EAGER).`,
		);

		await expect.page.exists(page, `${TABS_DISPATCH} button`);
		await expect.page.bodyText(page, { notContains: TABS_PANEL_PROFILE });

		const beforeClick = await quietRequests(page);
		assert(
			!beforeClick.some((request) => TABS_PROVIDER_CHUNK.test(pathOf(request))),
			`(3) — the first dispatch must land while the load set contains no provider chunk:\n${describe(beforeClick)}`,
		);
		await page.click(`${TABS_DISPATCH} button`);
		const afterClick = await quietRequests(page);
		const clickArrivals = arrivedSince(beforeClick, afterClick);
		assert(
			!afterClick.some((request) => /fallback/i.test(pathOf(request))),
			`(3) — a fallback chunk was fetched after the click:\n${describe(afterClick)}`,
		);

		const providerArrivals = clickArrivals.filter((request) => TABS_PROVIDER_CHUNK.test(pathOf(request)));
		assert(
			providerArrivals.length === 1,
			`(3) — BROKEN: the click should fetch exactly one provider chunk after the click; got ${providerArrivals.length}:\n${describe(clickArrivals)}`,
		);
		receipt.note(
			`(3) — click fetched provider ${pathOf(providerArrivals[0]!)} (${providerArrivals[0]!.encodedDataLength} B), sequenced after the click.`,
		);

		await expect.page.exists(page, TABS_LIVE_TAB);
		await expect.page.bodyText(page, { contains: TABS_PANEL_PROFILE });

		const afterHtml = await page.content();
		const liveInner = taggedInner(afterHtml, 'data-tabs-live');
		assert(
			liveInner.includes(TABS_PANEL_PROFILE),
			`(4) — BROKEN: after the click, tab content is not inside ${TABS_LIVE}.\n${liveInner.slice(0, 400)}`,
		);
		assert(
			!/data-resume=/.test(liveInner),
			`(4) — mounted tabs sit under a [data-resume] ancestor inside the live region; content must stay live-rendered.\n${liveInner.slice(0, 400)}`,
		);

		const profileTab = `${TABS_LIVE} [role="tab"]:first-of-type`;
		const settingsTab = `${TABS_LIVE} [role="tab"]:nth-of-type(2)`;
		await expect.page.attribute(page, profileTab, 'aria-selected', 'true');
		await expect.page.exists(page, settingsTab);
		await page.click(settingsTab);
		await expect.page.attribute(page, settingsTab, 'aria-selected', 'true');
		await expect.page.bodyText(page, { contains: TABS_PANEL_SETTINGS });

		const flipped = await page.content();
		const flippedLive = taggedInner(flipped, 'data-tabs-live');
		assert(
			/aria-selected="true"/.test(flippedLive) && flippedLive.includes(TABS_PANEL_SETTINGS),
			`(4) — BROKEN: clicking a different live tab did not flip selection inside ${TABS_LIVE}.\n${flippedLive.slice(0, 400)}`,
		);
		assert(
			!/data-resume=/.test(flippedLive),
			`(4) — after the selection flip the live region gained a [data-resume] ancestor.`,
		);
		receipt.note(
			`(4) — live tabs in ${TABS_LIVE} under no [data-resume] ancestor. Settings click flipped aria-selected and mounted the settings panel.`,
		);

		const eagerBytes = totalBytes(eagerScripts);
		assert(
			eagerBytes < TABS_EAGER_JS_CAP_BYTES,
			`eager JS was ${eagerBytes} B, over the ${TABS_EAGER_JS_CAP_BYTES} B cap:\n${describe(eagerScripts)}`,
		);
		const entryFile = await eagerScriptBytes(url);
		receipt.note(
			`eager JS: ${entryFile.bytes} B file (baseline ${TABS_EAGER_JS_BASELINE_BYTES} B), ${eagerBytes} B on the wire, cap ${TABS_EAGER_JS_CAP_BYTES} B. Provider / library chunk deferred.`,
		);

		await expect.page.outcome(page, {
			interactions: { click: 2 },
			navigations: 0,
			consoleErrors: 0,
			failedRequests: 0,
		});
	},
);
