import { box } from '@async/witness';
import { pageUrl } from '../config.ts';
import { groupChunk, handlerChunks, isHandlerChunk } from './support/chunks.ts';
import {
	arrivedSince,
	assert,
	describe,
	pathOf,
	quietRequests,
	scripts,
} from './support/network.ts';

// The tear this page is designed against, driven in a real browser.
//
// The resumed component and the deferred group share one reactive source: the
// todos store, which `App` creates inside the group. A keystroke that reaches
// the resumed component before the group exists is a dispatch that names a
// store nothing has created yet. The failure modes it invites are exactly two:
// the dispatch is dropped (no todo), or it is answered twice — once by a
// waiting path and once by a replay (two todos). Either one is a torn page.
//
// So the scenario here is the hostile order: the very first thing the user
// does is type a title and press Enter, with the framework still unfetched.
// The claim is that exactly one todo appears, that it appears only after the
// group has settled, and that the second Enter — with the store now live —
// takes the ordinary path and fetches nothing at all.
//
// The chunk timings are asserted alongside, because "it worked" is only
// evidence of deferral if the deferral was really still in force: the resumed
// component's own handler chunk is absent from the load set and arrives on the
// first keydown, and the group travels on the same keystroke rather than
// before it.

const NEW_TODO = 'input.new-todo';
const SHELL = 'p.loading';

export default box(
	{
		name: 'resumable todos: Enter before the framework arrives yields exactly one todo, in order',
		modes: ['dev'],
		tags: ['network', 'resumable'],
	},
	async ({ browser, expect, receipt }) => {
		const page = await browser.visit(pageUrl('resumable', 'todos'));
		await expect.page.exists(page, NEW_TODO);
		await expect.page.exists(page, SHELL);
		const load = await quietRequests(page);

		receipt.note(`resumable todos load set (no-tear run):\n${describe(load)}`);

		const eagerScripts = scripts(load);
		assert(
			eagerScripts.length === 1,
			`expected exactly one script on load; observed:\n${describe(eagerScripts)}`,
		);
		const entry = eagerScripts[0]!;
		const group = await groupChunk(entry.url);
		const headerChunk = (await handlerChunks(entry.url)).url('app.Header', 's0');

		assert(
			!load.some((request) => request.url === group),
			`the group chunk was fetched before the first keystroke:\n${describe(load)}`,
		);
		assert(
			!load.some((request) => isHandlerChunk(pathOf(request))),
			`a handler chunk was requested before any interaction:\n${describe(load)}`,
		);

		// ── the first keystroke ────────────────────────────────────────────
		// One character, from the driver. It is a keystroke in an already-live
		// subtree, so it is the resumed component's own event: it binds that
		// component's handler (one chunk) and, because the handler's action
		// slot names a store no live value answers, it is also what commits
		// the group (one chunk). Two requests, and they are these two.
		const title = 'typed before the framework existed';
		await page.type(NEW_TODO, title.slice(0, 1), { redact: false });
		const afterFirstKey = await quietRequests(page);
		const firstKeyArrivals = arrivedSince(load, afterFirstKey);
		const fetched = new Set(firstKeyArrivals.map((request) => request.url));
		assert(
			firstKeyArrivals.length === 2 && fetched.has(headerChunk) && fetched.has(group),
			`the first keystroke should fetch exactly the handler chunk and the group; observed:\n${describe(firstKeyArrivals)}`,
		);
		receipt.note(
			`first keystroke fetched:\n${describe(firstKeyArrivals)}\n— the resumed component's handler and the deferral group, in the order the network answered them.`,
		);

		// ── the rest of the title, then Enter ──────────────────────────────
		// The typed value survives the group's render because the render
		// reuses the live mount node rather than a copy of it.
		await page.type(NEW_TODO, title.slice(1), { redact: false });
		await page.press(NEW_TODO, 'Enter');

		// Exactly one, and it carries the whole title: the dispatch waited for
		// the store rather than being dropped, and it was answered once.
		await expect.page.count(page, 'ul.todo-list li', 1);
		await expect.page.text(page, 'ul.todo-list li:last-child label', title);
		await expect.page.text(page, '.todo-count', '1 item left');
		await expect.page.count(page, SHELL, 0);

		const afterEnter = await quietRequests(page);
		assert(
			arrivedSince(afterFirstKey, afterEnter).length === 0,
			`the Enter that added the todo fetched more code:\n${describe(arrivedSince(afterFirstKey, afterEnter))}`,
		);

		// ── the second Enter ───────────────────────────────────────────────
		// The store is live now, so nothing waits: the resumer resolves the
		// action slot synchronously and dispatches by identity. The evidence
		// that this is the ordinary path is that the network stays silent.
		const second = 'and one after it';
		await page.type(NEW_TODO, second, { redact: false });
		await page.press(NEW_TODO, 'Enter');

		await expect.page.count(page, 'ul.todo-list li', 2);
		await expect.page.text(page, 'ul.todo-list li:last-child label', second);
		await expect.page.text(page, '.todo-count', '2 items left');

		const afterSecond = await quietRequests(page);
		assert(
			arrivedSince(afterEnter, afterSecond).length === 0,
			`the second Enter fetched something, so it did not take the plain path:\n${describe(arrivedSince(afterEnter, afterSecond))}`,
		);
		assert(
			scripts(afterSecond).length === 3,
			`expected 3 script requests in the whole session (entry, handler, group); observed:\n${describe(scripts(afterSecond))}`,
		);
		receipt.note(`full session request set:\n${describe(afterSecond)}`);

		await expect.page.outcome(page, {
			interactions: { type: 3, press: 2, click: 0 },
			navigations: 0,
			failedRequests: 0,
		});
	},
);
