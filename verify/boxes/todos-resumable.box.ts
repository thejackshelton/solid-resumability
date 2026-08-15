import { box } from '@async/witness';
import {
	TODOS_EAGER_JS_CAP_BYTES,
	TODOS_GROUP_GZ_CAP,
	TODOS_GROUP_RAW_CAP,
	pageUrl,
} from '../config.ts';
import { groupChunk, handlerChunks, isHandlerChunk, regionsChunk } from './support/chunks.ts';
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

// The claim under test is that a real application's framework is not in the
// browser until the user touches the page, and that the page works anyway.
//
// Nothing on the page can be trusted to report that about itself, so the proof
// is network-shaped: what Chrome requested, when, and how many bytes it
// weighed. The load set is one document, one stylesheet and ONE script. The
// group chunk that carries `@solidjs/web`, `@solidjs/signals`, the four
// component bodies (two the pass cannot prove, two it proves but may not
// substitute — what flips their guard is a store write, and the store is the
// group's) and the store they share arrives on the first touch, in one
// request, and the application is whole afterwards — that arrival is the
// FIRST-TOUCH BOOT, and what it starts is GROUP ACTIVATION: the group's
// modules run, its components render for the first time, and the store is
// born. Nothing is being replayed or re-rendered on top of existing state,
// because nothing of the group ran before.
// What the served document held was a DEFERRED RENDER — markup captured from
// a real render at build time, standing in for components that have not
// executed.
//
// Four facts together are the claim, and the last one is what makes the first
// three mean something rather than describing a broken page:
//   - the load set contains no group chunk and no handler chunk, and its one
//     script is under the eager cap;
//   - the first touch fetches exactly ONE new script, and it is the group;
//   - a repeat touch fetches nothing, because activation happens once;
//   - after the group activates the application is fully usable — add, toggle
//     and clear all drive the live store.
//
// The prerendered shell is what stands in for the group until then: the
// document carries the first paint (the resumed component's markup plus the
// app's loading paragraph), so the page is painted with zero component bodies
// executed in the browser.

const NEW_TODO = 'input.new-todo';
const SHELL = 'p.loading';

export default box(
	{
		name: 'resumable todos: one entry script on load, the whole framework on the first touch',
		modes: ['dev'],
		tags: ['network', 'resumable'],
	},
	async ({ browser, expect, receipt }) => {
		const page = await browser.visit(pageUrl('resumable', 'todos'));
		await expect.page.exists(page, NEW_TODO);
		// The served first paint, before anything has been fetched or run: the
		// resumed component's input and the app's loading paragraph, both from
		// the document.
		await expect.page.exists(page, SHELL);
		const load = await quietRequests(page);

		receipt.note(`resumable todos load set:\n${describe(load)}`);

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

		const entry = eagerScripts[0]!;
		const eagerBytes = totalBytes(eagerScripts);
		const classic = await eagerScriptBytes(pageUrl('classic', 'todos'));
		receipt.note(
			`eager JS on load: resumable ${eagerBytes} B on the wire (cap ${TODOS_EAGER_JS_CAP_BYTES} B) against classic ${classic.bytes} B of entry bundle. The one eager chunk is the resume bootstrap plus one component's structure and wiring; the framework and the other four component bodies are behind the group's dynamic import.`,
		);
		assert(
			eagerBytes <= TODOS_EAGER_JS_CAP_BYTES,
			`eager JS was ${eagerBytes} B, over the ${TODOS_EAGER_JS_CAP_BYTES} B cap:\n${describe(eagerScripts)}`,
		);

		// The chunks the entry can ask for, read out of the shipped bytes rather
		// than named here.
		const group = await groupChunk(entry.url);
		const chunks = await handlerChunks(entry.url);
		const headerChunk = chunks.url('app.Header', 's0');
		const regions = await regionsChunk(entry.url);

		assert(
			!load.some((request) => request.url === group),
			`the group chunk was in the load set, so the framework was fetched before any interaction:\n${describe(load)}`,
		);
		assert(
			!load.some((request) => isHandlerChunk(pathOf(request))),
			`a handler chunk was requested before any interaction:\n${describe(load)}`,
		);
		assert(
			load.every((request) => request.url === entry.url || kindOf(request) !== 'script'),
			`a script other than the entry was requested on load:\n${describe(scripts(load))}`,
		);

		// ── the first touch ────────────────────────────────────────────────
		// A pointer press on the shell — the region the deferred group owns.
		// Nothing on the page is listening to it except the deferral loader's
		// capture-phase listeners, and what they do is start one import. This
		// is the first-touch boot: one request, then activation.
		const beforeTouch = await quietRequests(page);
		await page.click(SHELL);
		// The group has activated when the shell it replaced is gone: the
		// loading paragraph belongs to a `<Loading>` fallback that only
		// resolves once the component bodies are executing.
		await expect.page.count(page, SHELL, 0);
		const afterTouch = await quietRequests(page);

		const touchArrivals = arrivedSince(beforeTouch, afterTouch);
		assert(
			touchArrivals.length === 1 && touchArrivals[0]!.url === group,
			`the first touch should fetch exactly ${group}; observed:\n${describe(touchArrivals)}`,
		);
		receipt.note(
			`first touch fetched ${pathOf(touchArrivals[0]!)} (${touchArrivals[0]!.encodedDataLength} B on the wire) — the framework, four component bodies and the store, in ONE request. That one request is the gate: activation is atomic, so a group arriving in pieces would be a group observable half-started. Build-side ceilings on the same chunk are ${TODOS_GROUP_RAW_CAP} B raw / ${TODOS_GROUP_GZ_CAP} B gz (demo/scripts/check-zero-eager.mjs); they are regression tripwires, not budgets — no split of this payload is smaller than the payload.`,
		);

		// ── the application, after activation ──────────────────────────────
		// The first keystroke pulls the resumed component's own handler chunk:
		// the two lazy paths are independent, and the group's activation is not
		// an event for the component that was resumed at load.
		const title = 'witness drove this todo';
		await page.type(NEW_TODO, title, { redact: false });
		await page.press(NEW_TODO, 'Enter');

		await expect.page.count(page, 'ul.todo-list li', 1);
		await expect.page.text(page, 'ul.todo-list li:last-child label', title);
		await expect.page.text(page, '.todo-count', '1 item left');

		const afterAdd = await quietRequests(page);
		const addArrivals = arrivedSince(afterTouch, afterAdd);
		assert(
			addArrivals.length === 1 && addArrivals[0]!.url === headerChunk,
			`adding a todo should fetch exactly the resumed component's handler chunk ${headerChunk}; observed:\n${describe(addArrivals)}`,
		);
		receipt.note(
			`first keystroke fetched ${pathOf(addArrivals[0]!)} (${addArrivals[0]!.encodedDataLength} B).`,
		);

		// A repeat touch on the region that fetched the group: the capture
		// listeners were removed when activation committed and the import is a
		// settled promise, so there is nothing left to fetch. The label carries
		// no handler of its own, so what is measured is the loader, not a click
		// that happened to be cheap.
		await page.click('ul.todo-list li label');
		const afterRepeat = await quietRequests(page);
		assert(
			arrivedSince(afterAdd, afterRepeat).length === 0,
			`a repeat touch on the group's own DOM fetched something:\n${describe(arrivedSince(afterAdd, afterRepeat))}`,
		);

		// Two handlers that exist only because the group activated: the toggle
		// is `TodoItem`'s, the clear is `Footer`'s, and both drive the same
		// live store the resumed component just dispatched into.
		await page.click('ul.todo-list li input.toggle');
		await expect.page.count(page, 'ul.todo-list li.completed', 1);
		await expect.page.text(page, '.todo-count', '0 items left');

		await page.click('button.clear-completed');
		await expect.page.count(page, 'ul.todo-list li', 0);
		await expect.page.count(page, '.todo-count', 0);

		const afterUse = await quietRequests(page);
		assert(
			arrivedSince(afterRepeat, afterUse).length === 0,
			`using the activated application fetched more code:\n${describe(arrivedSince(afterRepeat, afterUse))}`,
		);
		receipt.note(`full session request set:\n${describe(afterUse)}`);
		assert(
			scripts(afterUse).length === 3,
			`expected 3 script requests in the whole session (entry, group, handler); observed:\n${describe(scripts(afterUse))}`,
		);

		// The fourth chunk the entry NAMES and this session never asks for: the
		// keyed-region resolver. The resumer imports it only for an event that
		// came through a region container, and this page's one list belongs to a
		// component the group renders — so the eager chunk carries the decision
		// and none of the resolution. A page that paid for a list it does not
		// have would show up here as a fourth script.
		assert(
			!afterUse.some((request) => request.url === regions),
			`the keyed-region resolver ${regions} was fetched by a page with no resumed list:\n${describe(scripts(afterUse))}`,
		);
		receipt.note(
			`the entry names ${new URL(regions).pathname} — the keyed-region resolver — and no request in this session is for it: 3 scripts, none of them the resolver. The eager chunk keeps the decision (is this event inside a region container?) and imports the answer only when one says yes.`,
		);

		await expect.page.outcome(page, {
			interactions: { type: 1, press: 1, click: 4 },
			navigations: 0,
			failedRequests: 0,
		});
	},
);
