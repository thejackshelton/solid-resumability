import { box } from '@async/witness';
import {
	RULE_ARTIFACT,
	RULE_COMPONENT,
	RULE_EAGER_JS_BASELINE_BYTES,
	RULE_EAGER_JS_CAP_BYTES,
	RULE_MOUNT,
	RULE_ORIENTATION_PROVIDE,
	RULE_REST_PROVIDE,
	RULE_TAG_NAME_CONTRACT,
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
// Oracle half 2: the installed package's own SeparatorRoot resumes in Chrome.
//
// A first-party mirror resuming is a rehearsal. This box drives the rule page,
// whose classified and emitted function is the package's SeparatorRoot (the
// defining module the probe flipped), and asserts a REAL resume:
//
//   C1. THE FOLDED INTRINSIC IS IN THE DOCUMENT, BEFORE ANY BROWSER. A plain
//       `fetch`: the mount addressed `QhqEt4aD.SeparatorRoot` holds `<hr>` and
//       that open tag does not carry role / aria-orientation / data-orientation.
//       Measured attrs bake no bytes. If those names are already in the served
//       markup, the page (or the build) painted them and this is a stub.
//
//   C2. THE A11Y ATTRS ARE THE ARTIFACT'S COMPUTE, NOT A PAINTED STRING. The
//       eager entry ships the binding computes. This box extracts those
//       functions from the shipped bytes, runs them over the page's published
//       identities (orientation vertical; tagName contract `"hr"`), and asserts
//       the live DOM against THAT result. The box does not author the expected
//       strings. A page that painted different values fails; a page that
//       painted the exact compute results cannot be distinguished from apply()
//       (named below as D3) — the served-clean check is the other arm.
//
//   C3. THE BODY NEVER RUNS. fellBack is inferred empty because the entry
//       names this artifact (resume would return null otherwise), apply ran
//       (C2), and no fallback / unclassified chunk is in the graph or on the
//       wire. The page does not publish the fellBack array; a throw is a
//       console error and a missing attr, not a silent fallback.
//
//   C4. REF REPLAY RAN BEFORE EFFECTS. The restore walk is after ref replay +
//       flush (resumer.ts). Observable pins: the rest-spread `id` is on the
//       live `<hr>` (spread is after that flush) and the role compute is the
//       tag-name contract — createTagName's fallback and the folded host are
//       both `"hr"`, so a restore that can read tagName after replay writes
//       role as the compute decides (absent). If slot d0 is captured and not
//       in `cells`, role apply throws — that is T045's named residual, and
//       this box goes red naming it rather than skipping the compute.
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
//       markup has none of the attrs, and the live values equal the artifact
//       compute over the page's provides. The box itself never writes the DOM.
// ─────────────────────────────────────────────────────────────────────────────

const A11Y_ATTRS = ['role', 'aria-orientation', 'data-orientation'] as const;

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

/** The first `<hr…>` open tag inside a stretch of markup, or null. */
function hrOpenTag(markup: string): string | null {
	const match = /<hr\b[^>]*>/i.exec(markup);
	return match?.[0] ?? null;
}

function attributeOf(openTag: string, name: string): string | null {
	const match = new RegExp(`\\s${name}="([^"]*)"`, 'i').exec(openTag);
	return match ? match[1]! : null;
}

function hasAttribute(openTag: string, name: string): boolean {
	return new RegExp(`\\s${name}=`, 'i').test(openTag);
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

function cellsName(entrySource: string, id: string): boolean {
	return new RegExp(`id:\\s*"${id}"`).test(entrySource);
}

function roleCapturesD0(entrySource: string): boolean {
	const marker = /attribute:\s*"role"/;
	const found = marker.exec(entrySource);
	if (!found || found.index === undefined) return false;
	const window = entrySource.slice(found.index, found.index + 400);
	return /cell:\s*"d0"/.test(window);
}

export default box(
	{
		name: 'resumable rule: installed SeparatorRoot resumes as a folded hr; a11y attrs are the artifact compute; no fallback',
		modes: ['dev'],
		tags: ['network', 'resumable', 'rule'],
	},
	async ({ browser, expect, receipt }) => {
		const url = pageUrl('resumable', 'rule');

		// ── C1. the folded intrinsic is in the document ────────────────────
		const served = await servedDocument(url);
		const servedOpen = resumeOpenTag(served, RULE_ARTIFACT, 'the served document');
		assert(
			servedOpen.includes(`data-component="${RULE_COMPONENT}"`),
			`C1 — the served mount is not ${RULE_COMPONENT}:\n${servedOpen}`,
		);
		const servedInner = mountInner(served, RULE_ARTIFACT, 'the served document');
		const servedHr = hrOpenTag(servedInner);
		assert(
			servedHr !== null && /<hr\b/i.test(servedInner),
			`C1 — the served mount [data-resume="${RULE_ARTIFACT}"] does not hold the folded <hr>:\n${servedInner}`,
		);
		for (const name of A11Y_ATTRS) {
			assert(
				!hasAttribute(servedHr, name),
				`C1 — served <hr> already carries ${name}="${attributeOf(servedHr, name)}"; measured attrs bake no bytes, so a value here was painted by the page or the build, and this is a stub:\n${servedHr}`,
			);
		}
		assert(
			!hasAttribute(servedHr, 'id'),
			`C1 — served <hr> already carries id="${attributeOf(servedHr, 'id')}"; the rest-spread is a resume assign, not first-paint markup:\n${servedHr}`,
		);
		receipt.note(
			`C1 — served mount [data-resume="${RULE_ARTIFACT}"] holds the folded intrinsic ${servedHr} with no role / aria-orientation / data-orientation / id. The document is the template; nothing has run.`,
		);

		const page = await browser.visit(url);
		const load = await quietRequests(page);
		receipt.note(`resumable rule load set:\n${describe(load)}`);

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
				entrySource.includes(`../artifacts/${RULE_ARTIFACT}/${artifact}`),
				`the eager entry does not name ../artifacts/${RULE_ARTIFACT}/${artifact}; this page is not resuming the installed package's own function.`,
			);
		}
		assert(
			!entrySource.includes(`../artifacts/${RULE_ARTIFACT}/template.js`),
			`the eager entry names the template.js module; this page inlines the template and must not ship it.`,
		);

		// ── C3. no fallback in the graph, none on the wire ─────────────────
		const reachable = await reachableChunks(entryUrl);
		const branch = reachable.filter((chunk) => chunk.kind === 'unclassified');
		assert(
			branch.length === 0,
			`C3 — the page can reach ${branch.length} chunk(s) that are neither the entry, a handler, the region resolver, nor the store partition — a fallback branch is in the graph:\n${branch
				.map((chunk) => `  ${chunk.url} — named by ${chunk.namedBy}`)
				.join('\n')}`,
		);
		assert(
			!load.some((request) => /fallback/i.test(pathOf(request))),
			`C3 — a fallback chunk was fetched on load:\n${describe(load)}`,
		);
		const regions = await regionsChunk(entryUrl);
		assert(
			!load.some((request) => request.url === regions),
			`C3 — the keyed-region resolver ${regions} was fetched by a page with no list and no event:\n${describe(scripts(load))}`,
		);
		assert(
			load.every((request) => request.url === entryUrl || kindOf(request) !== 'script'),
			`C3 — a script other than the entry was requested on load:\n${describe(scripts(load))}`,
		);
		receipt.note(
			`C3 — no fallback: the ${reachable.length} reachable chunks are the entry plus the region resolver (unfetched). No unclassified node, no /fallback/ request, one script on load.`,
		);

		// ── C2. live attrs === artifact compute(page provides) ─────────────
		const roleCompute = artifactCompute(entrySource, 'role');
		const ariaCompute = artifactCompute(entrySource, 'aria-orientation');
		const dataCompute = artifactCompute(entrySource, 'data-orientation');
		const expectedRole = attrValue(roleCompute({ tagName: () => RULE_TAG_NAME_CONTRACT }));
		const expectedAria = attrValue(ariaCompute({ orientation: RULE_ORIENTATION_PROVIDE }));
		const expectedData = attrValue(dataCompute({ orientation: RULE_ORIENTATION_PROVIDE }));
		const d0Gap = roleCapturesD0(entrySource) && !cellsName(entrySource, 'd0');
		const residual = d0Gap
			? ' Role captures cell d0 (tagName) which is not in the shipped cells array — T045 named residual; a throw `has no cell d0 for slot tagName` means role apply never ran.'
			: '';

		const live = await page.content();
		const liveInner = mountInner(live, RULE_ARTIFACT, 'the resumed page');
		const liveHr = hrOpenTag(liveInner);
		assert(
			liveHr !== null,
			`C2 — after resume the mount no longer holds an <hr>; the component body ran or the mount was replaced:\n${liveInner}`,
		);
		assert(
			/<hr\b/i.test(liveInner),
			`C2 — after resume the mount lost the folded <hr>:\n${liveInner}`,
		);

		const liveRole = attributeOf(liveHr, 'role');
		const liveAria = attributeOf(liveHr, 'aria-orientation');
		const liveData = attributeOf(liveHr, 'data-orientation');
		assert(
			(expectedRole === null ? !hasAttribute(liveHr, 'role') : liveRole === expectedRole),
			`C2 — live role is ${hasAttribute(liveHr, 'role') ? JSON.stringify(liveRole) : '(absent)'}, not the artifact compute result ${expectedRole === null ? '(absent)' : JSON.stringify(expectedRole)} over tagName()==="${RULE_TAG_NAME_CONTRACT}".${residual}\n${liveHr}`,
		);
		assert(
			(expectedAria === null ? !hasAttribute(liveHr, 'aria-orientation') : liveAria === expectedAria),
			`C2 — live aria-orientation is ${hasAttribute(liveHr, 'aria-orientation') ? JSON.stringify(liveAria) : '(absent)'}, not the artifact compute result ${expectedAria === null ? '(absent)' : JSON.stringify(expectedAria)} over the page's orientation provide ${JSON.stringify(RULE_ORIENTATION_PROVIDE)}.${residual}\n${liveHr}`,
		);
		assert(
			(expectedData === null ? !hasAttribute(liveHr, 'data-orientation') : liveData === expectedData),
			`C2 — live data-orientation is ${hasAttribute(liveHr, 'data-orientation') ? JSON.stringify(liveData) : '(absent)'}, not the artifact compute result ${expectedData === null ? '(absent)' : JSON.stringify(expectedData)} over the page's orientation provide ${JSON.stringify(RULE_ORIENTATION_PROVIDE)}.${residual}\n${liveHr}`,
		);
		receipt.note(
			`C2 — artifact computes over page provides: role=${expectedRole === null ? '(absent)' : JSON.stringify(expectedRole)}, aria-orientation=${JSON.stringify(expectedAria)}, data-orientation=${JSON.stringify(expectedData)}. Live <hr> matches. Values came from the shipped compute, not from a string this box painted.`,
		);

		// ── C4. ref replay before effects (spread + tag-name contract) ─────
		await expect.page.exists(page, `${RULE_MOUNT} hr`);
		await expect.page.attribute(page, `${RULE_MOUNT} hr`, 'id', RULE_REST_PROVIDE.id);
		await expect.page.attribute(page, `${RULE_MOUNT} hr`, 'role', expectedRole);
		await expect.page.attribute(page, `${RULE_MOUNT} hr`, 'aria-orientation', expectedAria);
		await expect.page.attribute(page, `${RULE_MOUNT} hr`, 'data-orientation', expectedData);
		receipt.note(
			`C4 — ref replay pin: rest-spread id="${RULE_REST_PROVIDE.id}" is on the live <hr> (spread is after flush at resumer.ts) and the role compute is the tag-name contract (fallback and host both "${RULE_TAG_NAME_CONTRACT}"). Restore ran after replay; the component body did not.`,
		);

		// ── the bill ───────────────────────────────────────────────────────
		const eagerBytes = totalBytes(eagerScripts);
		assert(
			eagerBytes < RULE_EAGER_JS_CAP_BYTES,
			`eager JS was ${eagerBytes} B, over the ${RULE_EAGER_JS_CAP_BYTES} B cap:\n${describe(eagerScripts)}`,
		);
		const entryFile = await eagerScriptBytes(url);
		receipt.note(
			`eager JS: ${entryFile.bytes} B file (baseline ${RULE_EAGER_JS_BASELINE_BYTES} B), ${eagerBytes} B on the wire, cap ${RULE_EAGER_JS_CAP_BYTES} B — ${RULE_EAGER_JS_CAP_BYTES - entryFile.bytes} B of headroom. One entry script; regions named and unfetched.`,
		);

		const final = await quietRequests(page);
		assert(
			scripts(final).length === 1 && scripts(final)[0]!.url === entryUrl,
			`the session fetched scripts beyond the entry:\n${describe(scripts(final))}`,
		);
		receipt.note(`full session request set:\n${describe(final)}`);

		await expect.page.outcome(page, {
			interactions: {},
			navigations: 0,
			consoleErrors: 0,
			failedRequests: 0,
		});
	},
);
