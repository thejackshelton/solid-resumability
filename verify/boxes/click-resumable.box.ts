import { box } from '@async/witness';
import {
	CLICK_ARTIFACT,
	CLICK_COMPONENT,
	CLICK_COMPUTED_ATTRS,
	CLICK_EAGER_JS_BASELINE_BYTES,
	CLICK_EAGER_JS_CAP_BYTES,
	CLICK_MERGED_PROPS,
	CLICK_MOUNT,
	CLICK_REST_PROVIDE,
	CLICK_SENTINEL,
	CLICK_SENTINEL_AFTER,
	CLICK_SENTINEL_ATTR,
	pageUrl,
} from '../config.ts';
import { reachableChunks, regionsChunk } from './support/chunks.ts';
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
// Ruling 1 (a)–(d): the installed package's own ButtonRoot resumes in Chrome
// AND a real click lands on the resumed element.
//
//   (a) THE FOLDED INTRINSIC IS IN THE DOCUMENT, BEFORE ANY BROWSER. A plain
//       `fetch`: the mount addressed `DvspU6cJ.ButtonRoot` holds `<button>`
//       and that open tag does not carry type / role / tabindex / disabled /
//       aria-disabled. Measured attrs bake no bytes. If those names are
//       already in the served markup, the page (or the build) painted them
//       and this is a stub.
//
//   (b) THE FIVE ATTRS ARE THE ARTIFACT'S COMPUTE OVER LIVE-RESOLVED SLOTS.
//       The eager entry ships the binding computes. This box extracts those
//       functions from the shipped bytes, runs them over the live host's
//       tagName projection plus the page's published identities (mergedProps
//       type/disabled; live href for the native-link arm), and asserts the
//       live DOM against THAT result. The box does not author the expected
//       strings.
//
//   (c) THE BODY NEVER RUNS. fellBack is inferred empty because the entry
//       names this artifact (resume would return null otherwise), apply ran
//       (b), and no fallback / unclassified chunk is in the graph or on the
//       wire. One eager script under the page's own cap.
//
//   (d) A REAL CLICK FIRES THE PAGE-OWNED HANDLER. Before the click the
//       page-owned sentinel must NOT carry data-clicked. The box then
//       dispatches a real Chrome click on the resumed button and asserts
//       `[data-click-sentinel]` got `data-clicked="1"`, with still zero
//       fallback fetches after the click. A box that skipped the click, or
//       that passed because the page painted the sentinel, is a stub.
//
// ── What this box does NOT claim ────────────────────────────────────────────
//
//   D1. NOT A PRERENDER PROOF. prerender:false; the verbatim/capture hole-arm
//       is not on this wire.
//
//   D2. NOT A COVERAGE STATEMENT. A provable classification is not a resume.
//
//   D3. PAGE-PAINTED VALUES THAT MATCH THE COMPUTE cannot be distinguished
//       from apply() after load. The strongest falsifiable pair is: served
//       markup has none of the five attrs, and the live values equal the
//       artifact compute over live-resolved slots.
// ─────────────────────────────────────────────────────────────────────────────

/** The served document, straight off the static server, with no browser in it. */
async function servedDocument(url: string): Promise<string> {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}.`);
	return response.text();
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

/**
 * Inner markup of the resume mount, from the first `>` after `data-resume`
 * through the matching `</div>`. The mount is a single wrapper; its child is
 * the folded intrinsic.
 */
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

/** The first `<button…>` open tag inside a stretch of markup, or null. */
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

function sentinelOpenTag(html: string, where: string): string {
	const match = /<[^>]*\bdata-click-sentinel\b[^>]*>/i.exec(html);
	if (!match) {
		throw new Error(`no [data-click-sentinel] element in ${where}.`);
	}
	return match[0];
}

/**
 * Pull one attribute binding's `compute` out of the shipped entry and return
 * it as a function. The expected live values come from THIS, not from a
 * string the box authored.
 */
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

/**
 * Slots the artifact computes close over, resolved from the LIVE host and
 * the page's published identities — never from strings this box authored
 * as expected attribute values.
 */
function liveResolvedSlots(liveButton: string): Record<string, unknown> {
	const tagName = hostTagName(liveButton);
	const href = attributeOf(liveButton, 'href');
	return {
		tagName: () => tagName,
		type: CLICK_MERGED_PROPS,
		disabled: CLICK_MERGED_PROPS,
		ref: () => ({
			getAttribute: (name: string) => (name === 'href' ? href : null),
		}),
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

export default box(
	{
		name: 'resumable click: installed ButtonRoot resumes as a folded button; attrs are the artifact compute; a real click fires the page-owned handler; no fallback',
		modes: ['dev'],
		tags: ['network', 'resumable', 'click'],
	},
	async ({ browser, expect, receipt }) => {
		const url = pageUrl('resumable', 'click');

		// ── (a) the folded intrinsic is in the document ────────────────────
		const served = await servedDocument(url);
		const servedOpen = resumeOpenTag(served, CLICK_ARTIFACT, 'the served document');
		assert(
			servedOpen.includes(`data-component="${CLICK_COMPONENT}"`),
			`(a) — the served mount is not ${CLICK_COMPONENT}:\n${servedOpen}`,
		);
		const servedInner = mountInner(served, CLICK_ARTIFACT, 'the served document');
		const servedButton = buttonOpenTag(servedInner);
		assert(
			servedButton !== null && /<button\b/i.test(servedInner),
			`(a) — the served mount [data-resume="${CLICK_ARTIFACT}"] does not hold the folded <button>:\n${servedInner}`,
		);
		for (const name of CLICK_COMPUTED_ATTRS) {
			assert(
				!hasAttribute(servedButton, name),
				`(a) — served <button> already carries ${name}="${attributeOf(servedButton, name)}"; measured attrs bake no bytes, so a value here was painted by the page or the build, and this is a stub:\n${servedButton}`,
			);
		}
		assert(
			!hasAttribute(servedButton, 'id'),
			`(a) — served <button> already carries id="${attributeOf(servedButton, 'id')}"; the rest-spread is a resume assign, not first-paint markup:\n${servedButton}`,
		);
		const servedSentinel = sentinelOpenTag(served, 'the served document');
		assert(
			!hasAttribute(servedSentinel, CLICK_SENTINEL_ATTR),
			`(a) — served sentinel already carries ${CLICK_SENTINEL_ATTR}="${attributeOf(servedSentinel, CLICK_SENTINEL_ATTR)}"; the click consequence was painted before any click:\n${servedSentinel}`,
		);
		receipt.note(
			`(a) — served mount [data-resume="${CLICK_ARTIFACT}"] holds the folded intrinsic ${servedButton} with none of type / role / tabindex / disabled / aria-disabled / id. Sentinel is idle. The document is the template; nothing has run.`,
		);

		const page = await browser.visit(url);
		const load = await quietRequests(page);
		receipt.note(`resumable click load set:\n${describe(load)}`);

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

		const entryUrl = eagerScripts[0]!.url;
		const entrySource = await (await fetch(entryUrl)).text();
		for (const artifact of ['structure.js', 'wiring.js']) {
			assert(
				entrySource.includes(`../artifacts/${CLICK_ARTIFACT}/${artifact}`),
				`the eager entry does not name ../artifacts/${CLICK_ARTIFACT}/${artifact}; this page is not resuming the installed package's own function.`,
			);
		}
		assert(
			!entrySource.includes(`../artifacts/${CLICK_ARTIFACT}/template.js`),
			`the eager entry names the template.js module; this page inlines the template and must not ship it.`,
		);

		// ── (c) no fallback in the graph, none on the wire ─────────────────
		const reachable = await reachableChunks(entryUrl);
		const branch = reachable.filter((chunk) => chunk.kind === 'unclassified');
		assert(
			branch.length === 0,
			`(c) — the page can reach ${branch.length} chunk(s) that are neither the entry, a handler, the region resolver, nor the store partition — a fallback branch is in the graph:\n${branch
				.map((chunk) => `  ${chunk.url} — named by ${chunk.namedBy}`)
				.join('\n')}`,
		);
		assert(
			!load.some((request) => /fallback/i.test(pathOf(request))),
			`(c) — a fallback chunk was fetched on load:\n${describe(load)}`,
		);
		const regions = await regionsChunk(entryUrl);
		assert(
			!load.some((request) => request.url === regions),
			`(c) — the keyed-region resolver ${regions} was fetched by a page with no list and no event:\n${describe(scripts(load))}`,
		);
		assert(
			load.every((request) => request.url === entryUrl || kindOf(request) !== 'script'),
			`(c) — a script other than the entry was requested on load:\n${describe(scripts(load))}`,
		);
		receipt.note(
			`(c) — no fallback: the ${reachable.length} reachable chunks are the entry plus the region resolver (unfetched). No unclassified node, no /fallback/ request, one script on load.`,
		);

		// ── (b) live attrs === artifact compute(live-resolved slots) ────────
		const live = await page.content();
		const liveInner = mountInner(live, CLICK_ARTIFACT, 'the resumed page');
		const liveButton = buttonOpenTag(liveInner);
		assert(
			liveButton !== null,
			`(b) — after resume the mount no longer holds a <button>; the component body ran or the mount was replaced:\n${liveInner}`,
		);
		assert(
			/<button\b/i.test(liveInner),
			`(b) — after resume the mount lost the folded <button>:\n${liveInner}`,
		);

		const slots = liveResolvedSlots(liveButton);
		const expected: Record<(typeof CLICK_COMPUTED_ATTRS)[number], string | null> = {
			type: attrValue(artifactCompute(entrySource, 'type')(slots)),
			role: attrValue(artifactCompute(entrySource, 'role')(slots)),
			tabindex: attrValue(artifactCompute(entrySource, 'tabindex')(slots)),
			disabled: attrValue(artifactCompute(entrySource, 'disabled')(slots)),
			'aria-disabled': attrValue(artifactCompute(entrySource, 'aria-disabled')(slots)),
		};
		for (const name of CLICK_COMPUTED_ATTRS) {
			assertAttrMatches(liveButton, name, expected[name], '(b)');
		}
		receipt.note(
			`(b) — artifact computes over live-resolved slots (tagName()==="${hostTagName(liveButton)}", mergedProps ${JSON.stringify(CLICK_MERGED_PROPS)}): ${CLICK_COMPUTED_ATTRS.map((name) => `${name}=${expected[name] === null ? '(absent)' : JSON.stringify(expected[name])}`).join(', ')}. Live <button> matches. Values came from the shipped compute, not from a string this box painted.`,
		);

		await expect.page.exists(page, `${CLICK_MOUNT} button`);
		await expect.page.attribute(page, `${CLICK_MOUNT} button`, 'id', CLICK_REST_PROVIDE.id);
		for (const name of CLICK_COMPUTED_ATTRS) {
			await expect.page.attribute(page, `${CLICK_MOUNT} button`, name, expected[name]);
		}

		const idleSentinel = sentinelOpenTag(live, 'the resumed page before click');
		assert(
			!hasAttribute(idleSentinel, CLICK_SENTINEL_ATTR),
			`(d) — sentinel already carries ${CLICK_SENTINEL_ATTR}="${attributeOf(idleSentinel, CLICK_SENTINEL_ATTR)}" before any click; the consequence was painted and this is a stub:\n${idleSentinel}`,
		);
		await expect.page.attribute(page, CLICK_SENTINEL, CLICK_SENTINEL_ATTR, null);

		// ── (d) a real Chrome click on the resumed button ──────────────────
		const beforeClick = await quietRequests(page);
		await page.click(`${CLICK_MOUNT} button`);
		const afterClick = await quietRequests(page);
		assert(
			!afterClick.some((request) => /fallback/i.test(pathOf(request))),
			`(d) — a fallback chunk was fetched after the click:\n${describe(afterClick)}`,
		);
		assert(
			scripts(afterClick).length === 1 && scripts(afterClick)[0]!.url === entryUrl,
			`(d) — the click fetched a script beyond the entry (a fallback or handler chunk):\n${describe(scripts(afterClick))}`,
		);
		assert(
			afterClick.length === beforeClick.length ||
				afterClick.slice(beforeClick.length).every((request) => pathOf(request) === '/favicon.ico'),
			`(d) — the click put unexpected requests on the wire:\n${describe(afterClick.slice(beforeClick.length))}`,
		);

		await expect.page.attribute(page, CLICK_SENTINEL, CLICK_SENTINEL_ATTR, CLICK_SENTINEL_AFTER);
		const clicked = await page.content();
		const clickedSentinel = sentinelOpenTag(clicked, 'the page after click');
		assert(
			attributeOf(clickedSentinel, CLICK_SENTINEL_ATTR) === CLICK_SENTINEL_AFTER,
			`(d) — after a real click on the resumed button, the sentinel is ${clickedSentinel}, not ${CLICK_SENTINEL_ATTR}="${CLICK_SENTINEL_AFTER}". The page-owned handler did not fire.`,
		);
		receipt.note(
			`(d) — real Chrome click on ${CLICK_MOUNT} button. Sentinel went from idle to ${CLICK_SENTINEL_ATTR}="${CLICK_SENTINEL_AFTER}". Still zero fallback fetches; still one script (the entry). The click landed on a working element and the page-owned handler fired.`,
		);

		// ── the bill ───────────────────────────────────────────────────────
		const eagerBytes = totalBytes(eagerScripts);
		assert(
			eagerBytes < CLICK_EAGER_JS_CAP_BYTES,
			`eager JS was ${eagerBytes} B, over the ${CLICK_EAGER_JS_CAP_BYTES} B cap:\n${describe(eagerScripts)}`,
		);
		const entryFile = await eagerScriptBytes(url);
		receipt.note(
			`eager JS: ${entryFile.bytes} B file (baseline ${CLICK_EAGER_JS_BASELINE_BYTES} B), ${eagerBytes} B on the wire, cap ${CLICK_EAGER_JS_CAP_BYTES} B — ${CLICK_EAGER_JS_CAP_BYTES - entryFile.bytes} B of headroom. One entry script; regions named and unfetched.`,
		);

		const final = await quietRequests(page);
		assert(
			scripts(final).length === 1 && scripts(final)[0]!.url === entryUrl,
			`the session fetched scripts beyond the entry:\n${describe(scripts(final))}`,
		);
		assert(
			!final.some((request) => /fallback/i.test(pathOf(request))),
			`the session fetched a fallback chunk:\n${describe(final)}`,
		);
		receipt.note(`full session request set:\n${describe(final)}`);

		await expect.page.outcome(page, {
			interactions: { click: 1 },
			navigations: 0,
			consoleErrors: 0,
			failedRequests: 0,
		});
	},
);
