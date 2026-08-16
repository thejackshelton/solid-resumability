import { box } from '@async/witness';
import {
	CLICK_ARTIFACT,
	DIALOG_ARTIFACT,
	DIALOG_CHILD_COMPONENT,
	DIALOG_COMPONENT,
	DIALOG_CONTENT,
	DIALOG_EAGER_JS_BASELINE_BYTES,
	DIALOG_EAGER_JS_CAP_BYTES,
	DIALOG_LIVE,
	DIALOG_MOUNT,
	DIALOG_PROVIDER_CHUNK,
	DIALOG_STORE_ATTRS,
	pageUrl,
} from '../config.ts';
import { reachableChunks } from './support/chunks.ts';
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
// T085 / T086 WP-ζ: priced deferral. Live DialogRoot is NOT on the eager
// graph. A miss starts one dynamic import of the provider; the same click
// awaits whenProvided and still flips aria-expanded / mounts content.
//
//   (1) SERVED SHAPE. Unchanged from T068: the trigger mount holds a div
//       hole stamped with the claimed child's artifact id, holding the
//       child's own <button> with the record's baked aria-haspopup="dialog",
//       and NO store-derived attr. Served content region: empty.
//
//   (2) ADOPTED BYTES / ZERO-EAGER LOAD. Exactly one trigger button (a
//       live repaint would leave two). On load no request fetches the
//       provider chunk or a library chunk it names. Store-derived attrs
//       stay absent — the provider has not run. A box that passes with
//       the provider already executed is tightened, not shipped.
//
//   (3) CHILD FROM ITS OWN ARTIFACT. The eager entry names the claimed
//       child's structure and wiring under the qualified id, and the hole's
//       data-resume equals that id. Not the click page's record-free id.
//
//   (4) REAL CLICK. A real Chrome click on the resumed trigger fetches
//       exactly ONE provider chunk, sequenced after the click (the
//       dispatch awaited whenProvided). After: aria-expanded flips AND
//       dialog content mounts in the live region. No /fallback/ fetch
//       for the resumed mounts.
//
//   (5) CONTENT STAYS LIVE. The mounted content sits under no [data-resume]
//       ancestor, and no content artifact exists.
//
//   (6) STUB-TIGHTENING (T068, retargeted). A box that can pass with the
//       provider executed on load, without the click, with page-painted
//       aria-expanded, with a repainted trigger, or with page-constructed
//       context is tightened, not shipped. Eager-by-design (T061 Ruling 5)
//       is the topology this witness inverted.
// ─────────────────────────────────────────────────────────────────────────────

async function servedDocument(url: string): Promise<string> {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}.`);
	return response.text();
}

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

function mountInner(html: string, address: string, where: string): string {
	const open = resumeOpenTag(html, address, where);
	const at = html.indexOf(open);
	const innerStart = at + open.length;
	const close = html.indexOf('</div>', innerStart);
	if (close === -1) {
		throw new Error(`the [data-resume="${address}"] element in ${where} is never closed.`);
	}
	return html.slice(innerStart, close);
}

function buttonOpenTag(markup: string): string | null {
	const match = /<button\b[^>]*>/i.exec(markup);
	return match?.[0] ?? null;
}

function attributeOf(openTag: string, name: string): string | null {
	const match = new RegExp(`\\s${name}="([^"]*)"`, 'i').exec(openTag);
	return match ? match[1]! : null;
}

function hasAttribute(openTag: string, name: string): boolean {
	return new RegExp(`\\s${name}(?:=|\\s|>)`, 'i').test(openTag);
}

function claimedChildId(html: string, where: string): string {
	const inner = mountInner(html, DIALOG_ARTIFACT, where);
	const match = /data-resume="([^"]+)"/.exec(inner);
	if (!match) {
		throw new Error(`no claimed-child [data-resume] inside the trigger mount in ${where}.`);
	}
	return match[1]!;
}

function countButtons(html: string): number {
	return (html.match(/<button\b/gi) ?? []).length;
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

export default box(
	{
		name: 'resumable dialog: deferred live DialogRoot, resumed DialogTrigger; click fetches provider once then flips aria-expanded and mounts content; no fallback',
		modes: ['dev'],
		tags: ['network', 'resumable', 'dialog'],
	},
	async ({ browser, expect, receipt }) => {
		const url = pageUrl('resumable', 'dialog');

		const served = await servedDocument(url);
		const servedOpen = resumeOpenTag(served, DIALOG_ARTIFACT, 'the served document');
		assert(
			servedOpen.includes(`data-component="${DIALOG_COMPONENT}"`),
			`(1) — the served mount is not ${DIALOG_COMPONENT}:\n${servedOpen}`,
		);
		const childId = claimedChildId(served, 'the served document');
		assert(
			childId !== CLICK_ARTIFACT && childId.includes('~'),
			`(1) — claimed child id ${JSON.stringify(childId)} is not record-qualified (must be distinct from ${CLICK_ARTIFACT}).`,
		);
		const servedInner = mountInner(served, DIALOG_ARTIFACT, 'the served document');
		assert(
			servedInner.includes(`data-resume="${childId}"`) && servedInner.includes(`data-component="${DIALOG_CHILD_COMPONENT}"`),
			`(1) — the trigger mount does not hold the child's address hole:\n${servedInner}`,
		);
		const servedChildInner = mountInner(served, childId, 'the served document');
		const servedButton = buttonOpenTag(servedChildInner);
		assert(
			servedButton !== null && /<button\b/i.test(servedChildInner),
			`(1) — the claimed-child hole does not hold the child's <button>:\n${servedChildInner}`,
		);
		if (hasAttribute(servedButton, 'aria-haspopup')) {
			assert(
				attributeOf(servedButton, 'aria-haspopup') === 'dialog',
				`(1) — served <button> carries aria-haspopup="${attributeOf(servedButton, 'aria-haspopup')}", not the record's "dialog":\n${servedButton}`,
			);
		}
		for (const name of DIALOG_STORE_ATTRS) {
			assert(
				!hasAttribute(servedButton, name),
				`(1) — served <button> already carries ${name}="${attributeOf(servedButton, name)}"; store-derived attrs bake no bytes, so a value here was painted by the page or the build, and this is a stub:\n${servedButton}`,
			);
		}
		assert(
			!served.includes(DIALOG_CONTENT) && !/role="dialog"/i.test(served),
			`(1) — served document already carries dialog content markup; content must be live-only:\n${served.slice(0, 800)}`,
		);
		receipt.note(
			`(1) — served mount [data-resume="${DIALOG_ARTIFACT}"] holds a hole [data-resume="${childId}"] with <button aria-haspopup="dialog"> and none of ${DIALOG_STORE_ATTRS.join(' / ')}. No content markup.`,
		);

		const page = await browser.visit(url);
		const load = await quietRequests(page);
		receipt.note(`resumable dialog load set:\n${describe(load)}`);

		const documents = load.filter((request) => kindOf(request) === 'document');
		const stylesheets = load.filter((request) => kindOf(request) === 'stylesheet');
		const eagerScripts = scripts(load);
		assert(
			documents.length === 1 && stylesheets.length === 1 && eagerScripts.length === 1,
			`expected exactly one document, one stylesheet and one script on load; got ${documents.length}/${stylesheets.length}/${eagerScripts.length} in:\n${describe(load)}`,
		);

		const entryUrl = eagerScripts[0]!.url;
		const entrySource = await (await fetch(entryUrl)).text();
		for (const artifact of [DIALOG_ARTIFACT, childId]) {
			for (const file of ['structure.js', 'wiring.js']) {
				assert(
					entrySource.includes(`../artifacts/${artifact}/${file}`),
					`(3) — the eager entry does not name ../artifacts/${artifact}/${file}.`,
				);
			}
			assert(
				!entrySource.includes(`../artifacts/${artifact}/template.js`),
				`the eager entry names the template.js module for ${artifact}; this page inlines the template and must not ship it.`,
			);
		}
		assert(
			!entrySource.includes(`../artifacts/${CLICK_ARTIFACT}/`),
			`(3) — the eager entry names the click page's record-free ${CLICK_ARTIFACT}; the child must resume from the qualified id.`,
		);
		receipt.note(
			`(3) — hole data-resume="${childId}" is the same string the eager entry names. Not ${CLICK_ARTIFACT}.`,
		);

		assert(
			!load.some((request) => /fallback/i.test(pathOf(request))),
			`(4) — a fallback chunk was fetched on load:\n${describe(load)}`,
		);

		const loadProvider = load.filter((request) => DIALOG_PROVIDER_CHUNK.test(pathOf(request)));
		assert(
			loadProvider.length === 0,
			`(2) — the provider chunk was fetched on load; deferred execution requires it absent until the first dispatch:\n${describe(loadProvider)}`,
		);
		const dynamicProvider = [...entrySource.matchAll(/import\("([^"]+)"\)/g)]
			.map((match) => match[1]!)
			.filter((specifier) => DIALOG_PROVIDER_CHUNK.test(`/${specifier.split('/').pop()}`));
		assert(
			dynamicProvider.length === 1,
			`(2) — the eager entry should dynamically import exactly one provider chunk; found ${dynamicProvider.length}: ${dynamicProvider.join(', ') || 'none'}.`,
		);
		assert(
			!/(?:^|[;}\s])import\s*[^"'`]*["'][^"']*dialog-provider/.test(entrySource),
			`(2) — the eager entry statically imports the provider; those bytes must sit behind import().`,
		);
		receipt.note(
			`(2) — load set has no provider-chunk request. Eager entry dynamically imports ${dynamicProvider[0]}.`,
		);

		const live = await page.content();
		assert(
			countButtons(live) === 1,
			`(2) — the page has ${countButtons(live)} <button> elements after load; a live repaint of the trigger would leave two.\n`,
		);
		const liveChildInner = mountInner(live, childId, 'the resumed page');
		const liveButton = buttonOpenTag(liveChildInner);
		assert(
			liveButton !== null,
			`(2) — after resume the child hole no longer holds a <button>; the component body ran or the mount was replaced:\n${liveChildInner}`,
		);
		for (const name of DIALOG_STORE_ATTRS) {
			assert(
				!hasAttribute(liveButton, name),
				`(2) — after load the <button> already carries ${name}="${attributeOf(liveButton, name)}"; store-derived attrs arrive only after the provider mounts, so a value here means the provider ran on load:\n${liveButton}`,
			);
		}

		const reachable = await reachableChunks(entryUrl);
		receipt.note(`reachable chunks: ${reachable.length}`);
		receipt.note(
			`(2) — exactly one <button>. Store-derived attrs still absent after load (provider not executed). Served bytes had none of them.`,
		);

		await expect.page.exists(page, `${DIALOG_MOUNT} button`);
		await expect.page.bodyText(page, { notContains: DIALOG_CONTENT });

		const beforeClick = await quietRequests(page);
		await page.click(`${DIALOG_MOUNT} button`);
		const afterClick = await quietRequests(page);
		const clickArrivals = arrivedSince(beforeClick, afterClick);
		assert(
			!afterClick.some((request) => /fallback/i.test(pathOf(request))),
			`(4) — a fallback chunk was fetched after the click:\n${describe(afterClick)}`,
		);
		assert(
			clickArrivals.every((request) => {
				const path = pathOf(request);
				return path === '/favicon.ico' || kindOf(request) !== 'script' || !/fallback/i.test(path);
			}),
			`(4) — the click put a fallback script on the wire:\n${describe(clickArrivals)}`,
		);

		const providerArrivals = clickArrivals.filter((request) => DIALOG_PROVIDER_CHUNK.test(pathOf(request)));
		assert(
			providerArrivals.length === 1,
			`(4) — the click should fetch exactly one provider chunk after the click; got ${providerArrivals.length}:\n${describe(clickArrivals)}`,
		);
		receipt.note(
			`(4) — click fetched provider ${pathOf(providerArrivals[0]!)} (${providerArrivals[0]!.encodedDataLength} B), sequenced after the click.`,
		);

		await expect.page.attribute(page, `${DIALOG_MOUNT} button`, 'aria-expanded', 'true');
		await expect.page.exists(page, `${DIALOG_LIVE}`);
		await expect.page.bodyText(page, { contains: DIALOG_CONTENT });

		const afterHtml = await page.content();
		const liveInner = taggedInner(afterHtml, 'data-dialog-live');
		assert(
			liveInner.includes(DIALOG_CONTENT),
			`(5) — after the click, dialog content is not inside ${DIALOG_LIVE}; content must stay live-rendered.\n${liveInner.slice(0, 400)}`,
		);
		assert(
			!/data-resume=/.test(liveInner),
			`(5) — mounted content sits under a [data-resume] ancestor inside the live region; content must stay live-rendered.\n${liveInner.slice(0, 400)}`,
		);
		assert(
			!/artifacts\/[^"'`]*Content/.test(entrySource),
			`(5) — the eager entry names a content artifact; content must not be resumed.`,
		);
		receipt.note(
			`(4)(5) — real Chrome click on ${DIALOG_MOUNT} button fetched the provider once after the click. aria-expanded flipped to "true". Content mounted in the live region under no [data-resume] ancestor. Still zero /fallback/ fetches.`,
		);

		const eagerBytes = totalBytes(eagerScripts);
		assert(
			eagerBytes < DIALOG_EAGER_JS_CAP_BYTES,
			`eager JS was ${eagerBytes} B, over the ${DIALOG_EAGER_JS_CAP_BYTES} B cap:\n${describe(eagerScripts)}`,
		);
		const entryFile = await eagerScriptBytes(url);
		receipt.note(
			`eager JS: ${entryFile.bytes} B file (baseline ${DIALOG_EAGER_JS_BASELINE_BYTES} B), ${eagerBytes} B on the wire, cap ${DIALOG_EAGER_JS_CAP_BYTES} B. Provider / library chunk deferred.`,
		);

		await expect.page.outcome(page, {
			interactions: { click: 1 },
			navigations: 0,
			consoleErrors: 0,
			failedRequests: 0,
		});
	},
);
