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

// A signal and a commitment are different moments, and this is the box that
// keeps them different in a real browser.
//
// The loader starts the group's transfer on the earliest real interaction
// SIGNAL — a pointer press in the already-live resumed subtree, which says the
// rest of the page is about to be needed without being an event the group owns.
// It executes the group only on the event that COMMITS: an interaction with
// the group's own DOM, or a resumed dispatch that needs a store only the group
// can create.
//
// Three things are asserted, and together they are the whole accounting rule
// for these bytes:
//   - the transfer begins on the signal, strictly before the committing event
//     exists — the chunk has landed while the user has only pressed the
//     pointer down on the input;
//   - nothing of the group has executed while it sits there: the served shell
//     is still the page, which is only true while no component body has run
//     (the loading paragraph belongs to a fallback that resolves the instant
//     the group's `App` executes);
//   - the commit costs no second request. The module record the signal created
//     is what answers it, so a signal followed by a commit is ONE request for
//     the group, not two.
//
// Those bytes are therefore transferred-not-executed: they are not eager (no
// byte moved before the user touched the page) and they are not free (they are
// reported at their full weight, under their own trigger).
//
// Idle and load-time prefetch stay refused by the design, and the load-set
// assertion below is where that is checked: a page that has not been touched
// has fetched nothing but its own bootstrap.

const NEW_TODO = 'input.new-todo';
const SHELL = 'p.loading';

export default box(
	{
		name: 'resumable todos: the pointer signal buys the transfer, the commit buys the execution',
		modes: ['dev'],
		tags: ['network', 'resumable'],
	},
	async ({ browser, expect, receipt }) => {
		const page = await browser.visit(pageUrl('resumable', 'todos'));
		await expect.page.exists(page, NEW_TODO);
		await expect.page.exists(page, SHELL);
		const load = await quietRequests(page);

		const eagerScripts = scripts(load);
		assert(
			eagerScripts.length === 1,
			`expected exactly one script on load; observed:\n${describe(eagerScripts)}`,
		);
		const entry = eagerScripts[0]!;
		const group = await groupChunk(entry.url);
		const headerChunk = (await handlerChunks(entry.url)).url('app.Header', 's0');

		assert(
			!load.some((request) => request.url === group || isHandlerChunk(pathOf(request))),
			`the untouched page fetched a deferred chunk, so something prefetches on load rather than on a signal:\n${describe(load)}`,
		);
		receipt.note(`untouched page load set:\n${describe(load)}`);

		// ── the signal ─────────────────────────────────────────────────────
		// A pointer press inside the resumed subtree. It belongs to the
		// resumed component, which is already live, so it commits nothing: no
		// event of the group's is captured, and no handler binds, so no
		// dispatch can miss the store the group creates.
		await page.click(NEW_TODO);
		const afterSignal = await quietRequests(page);
		const signalArrivals = arrivedSince(load, afterSignal);
		assert(
			signalArrivals.length === 1 && signalArrivals[0]!.url === group,
			`the pointer signal should transfer exactly the group chunk; observed:\n${describe(signalArrivals)}`,
		);
		const prefetched = signalArrivals[0]!.encodedDataLength ?? 0;
		receipt.note(
			`pointer signal transferred ${pathOf(signalArrivals[0]!)} (${prefetched} B on the wire), before any committing event. These bytes are transferred, not executed: they are reported under their own trigger and never inside the eager total.`,
		);

		// ── still not executed ─────────────────────────────────────────────
		// The network has been quiet for several samples, so the chunk has
		// been in the browser for a while. The served shell is still the page:
		// the loading paragraph is a `<Loading>` fallback that resolves as soon
		// as the group's components run, and the list section only exists once
		// they have.
		await expect.page.exists(page, SHELL);
		await expect.page.count(page, 'section.main', 0);
		await expect.page.count(page, '.todo-count', 0);
		receipt.note(
			'after the transfer landed the page is still the prerendered shell — the loading paragraph is unreplaced and no component of the group has run.',
		);

		// ── the commit ─────────────────────────────────────────────────────
		// An interaction with the group's own DOM. What it costs is the
		// execution, not the transfer: the import site is a single thunk, so
		// the commit is answered from the module record the signal created.
		await page.click(SHELL);
		await expect.page.count(page, SHELL, 0);
		const afterCommit = await quietRequests(page);
		assert(
			arrivedSince(afterSignal, afterCommit).length === 0,
			`the commit made a second request for a chunk the signal had already fetched:\n${describe(arrivedSince(afterSignal, afterCommit))}`,
		);
		receipt.note('the commit executed the group and fetched nothing: one request across signal and commit.');

		// The page the two moments produced is a working application, which is
		// what makes the accounting a measurement rather than a description of
		// a page that never ran.
		const title = 'committed after the transfer';
		await page.type(NEW_TODO, title, { redact: false });
		await page.press(NEW_TODO, 'Enter');
		await expect.page.count(page, 'ul.todo-list li', 1);
		await expect.page.text(page, 'ul.todo-list li:last-child label', title);

		const afterAdd = await quietRequests(page);
		const addArrivals = arrivedSince(afterCommit, afterAdd);
		assert(
			addArrivals.length === 1 && addArrivals[0]!.url === headerChunk,
			`adding a todo should fetch exactly the resumed component's handler chunk; observed:\n${describe(addArrivals)}`,
		);
		receipt.note(`full session request set:\n${describe(afterAdd)}`);

		await expect.page.outcome(page, {
			interactions: { type: 1, press: 1, click: 2 },
			navigations: 0,
			failedRequests: 0,
		});
	},
);
