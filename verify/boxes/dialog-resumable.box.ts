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
	DIALOG_MERGED_PROPS,
	DIALOG_MOUNT,
	DIALOG_STORE_ATTRS,
	pageUrl,
} from '../config.ts';
import { reachableChunks } from './support/chunks.ts';
import {
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
// T061 Ruling 5 / T068 WP-δ: live DialogRoot, resumed DialogTrigger, real click.
//
//   (1) SERVED SHAPE. A plain fetch: the trigger mount holds a div hole
//       stamped with the claimed child's artifact id, holding the child's
//       own <button> with the record's baked aria-haspopup="dialog", and NO
//       store-derived attr. Served content region: empty.
//
//   (2) ADOPTED BYTES. Exactly one trigger button on the page (a live
//       repaint would leave two). After load the same mount carries values
//       equal to the artifact's own compute over the live provider. Served
//       bytes carried none of those attrs.
//
//   (3) CHILD FROM ITS OWN ARTIFACT. The eager entry names the claimed
//       child's structure and wiring under the qualified id, and the hole's
//       data-resume equals that id. Not the click page's record-free id.
//
//   (4) REAL CLICK. Before: aria-expanded is the closed value and no
//       content is mounted. A real Chrome click on the resumed trigger;
//       after: aria-expanded flips AND dialog content mounts in the live
//       region. No /fallback/ fetch for the resumed mounts.
//
//   (5) CONTENT STAYS LIVE. The mounted content sits under no [data-resume]
//       ancestor, and no content artifact exists.
//
//   (6) STUB-TIGHTENING. A box that can pass without the click, with
//       page-painted aria-expanded, with a repainted trigger, or with
//       page-constructed context is tightened, not shipped.
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

function hostTagName(openTag: string): string {
	const match = /^<([a-z0-9]+)/i.exec(openTag);
	if (!match) {
		throw new Error(`could not read the host tag name from ${openTag}.`);
	}
	return match[1]!.toLowerCase();
}

function claimedChildId(html: string, where: string): string {
	const inner = mountInner(html, DIALOG_ARTIFACT, where);
	const match = /data-resume="([^"]+)"/.exec(inner);
	if (!match) {
		throw new Error(`no claimed-child [data-resume] inside the trigger mount in ${where}.`);
	}
	return match[1]!;
}

function artifactCompute(entrySource: string, attribute: string): (slots: Record<string, unknown>) => unknown {
	const marker = new RegExp(`attribute:\\s*"${attribute}"`);
	const found = marker.exec(entrySource);
	if (!found || found.index === undefined) {
		throw new Error(`the eager entry does not name a binding for attribute "${attribute}".`);
	}
	const from = found.index;
	const computeAt = entrySource.indexOf('compute(', from);
	if (computeAt === -1 || computeAt - from > 800) {
		throw new Error(`no compute() near the "${attribute}" binding in the eager entry.`);
	}
	const paramsStart = computeAt + 'compute('.length;
	const paramsEnd = matchPair(entrySource, paramsStart - 1, '(', ')');
	const params = entrySource.slice(paramsStart, paramsEnd);
	if (entrySource[paramsEnd + 1] !== '{') {
		throw new Error(`compute for "${attribute}" is not a block function in the eager entry.`);
	}
	const bodyEnd = matchPair(entrySource, paramsEnd + 1, '{', '}');
	const body = entrySource.slice(paramsEnd + 2, bodyEnd);
	try {
		return new Function('slots', `return ((${params}) => { ${body} })(slots);`) as (
			slots: Record<string, unknown>,
		) => unknown;
	} catch (error) {
		throw new Error(
			`could not reconstruct the "${attribute}" compute from the eager entry (${error instanceof Error ? error.message : String(error)}).`,
		);
	}
}

function matchPair(source: string, openIndex: number, open: string, close: string): number {
	let depth = 0;
	for (let index = openIndex; index < source.length; index += 1) {
		const ch = source[index]!;
		if (ch === open) depth += 1;
		else if (ch === close) {
			depth -= 1;
			if (depth === 0) return index;
		}
	}
	throw new Error(`unbalanced ${open}${close} in eager entry starting at ${openIndex}.`);
}

function attrValue(computed: unknown): string | null {
	if (computed == null || computed === false) return null;
	if (computed === true) return '';
	return String(computed);
}

function liveResolvedSlots(liveButton: string, store: { isOpen: () => boolean; contentId: () => unknown }): Record<string, unknown> {
	const tagName = hostTagName(liveButton);
	return {
		tagName: () => tagName,
		type: DIALOG_MERGED_PROPS,
		disabled: DIALOG_MERGED_PROPS,
		ref: () => ({ getAttribute: () => null }),
		context: store,
	};
}

function assertAttrMatches(
	liveButton: string,
	name: string,
	expected: string | null,
	where: string,
): void {
	const live = attributeOf(liveButton, name);
	assert(
		expected === null ? !hasAttribute(liveButton, name) : live === expected,
		`${where} — live ${name} is ${hasAttribute(liveButton, name) ? JSON.stringify(live) : '(absent)'}, not the artifact compute result ${expected === null ? '(absent)' : JSON.stringify(expected)} over live-resolved slots.\n${liveButton}`,
	);
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
		name: 'resumable dialog: live DialogRoot, resumed DialogTrigger, claimed child from qualified artifact; real click flips aria-expanded and mounts content; no fallback',
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

		const reachable = await reachableChunks(entryUrl);
		receipt.note(`reachable chunks: ${reachable.length}`);

		const storeSlot = {
			isOpen: () => false,
			contentId: () => undefined,
		};
		const slots = liveResolvedSlots(liveButton, storeSlot);
		for (const name of DIALOG_STORE_ATTRS) {
			if (!entrySource.includes(`attribute: "${name}"`) && !entrySource.includes(`attribute:"${name}"`)) {
				continue;
			}
			const expected = attrValue(artifactCompute(entrySource, name)(slots));
			assertAttrMatches(liveButton, name, expected, '(2)');
		}
		receipt.note(
			`(2) — exactly one <button>. Live store-derived attrs equal the artifact compute over the live provider's closed slots. Served bytes had none of them.`,
		);

		await expect.page.exists(page, `${DIALOG_MOUNT} button`);
		await expect.page.attribute(page, `${DIALOG_MOUNT} button`, 'aria-expanded', 'false');
		await expect.page.bodyText(page, { notContains: DIALOG_CONTENT });

		const beforeClick = await quietRequests(page);
		await page.click(`${DIALOG_MOUNT} button`);
		const afterClick = await quietRequests(page);
		assert(
			!afterClick.some((request) => /fallback/i.test(pathOf(request))),
			`(4) — a fallback chunk was fetched after the click:\n${describe(afterClick)}`,
		);
		assert(
			afterClick.slice(beforeClick.length).every((request) => {
				const path = pathOf(request);
				return path === '/favicon.ico' || kindOf(request) !== 'script' || !/fallback/i.test(path);
			}),
			`(4) — the click put a fallback script on the wire:\n${describe(afterClick.slice(beforeClick.length))}`,
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
			`(4)(5) — real Chrome click on ${DIALOG_MOUNT} button. aria-expanded "false" → "true". Content mounted in the live region under no [data-resume] ancestor. Still zero /fallback/ fetches.`,
		);

		const eagerBytes = totalBytes(eagerScripts);
		assert(
			eagerBytes < DIALOG_EAGER_JS_CAP_BYTES,
			`eager JS was ${eagerBytes} B, over the ${DIALOG_EAGER_JS_CAP_BYTES} B cap:\n${describe(eagerScripts)}`,
		);
		const entryFile = await eagerScriptBytes(url);
		receipt.note(
			`eager JS: ${entryFile.bytes} B file (baseline ${DIALOG_EAGER_JS_BASELINE_BYTES} B), ${eagerBytes} B on the wire, cap ${DIALOG_EAGER_JS_CAP_BYTES} B. Framework + dialog chunk eager by design.`,
		);

		await expect.page.outcome(page, {
			interactions: { click: 1 },
			navigations: 0,
			consoleErrors: 0,
			failedRequests: 0,
		});
	},
);
