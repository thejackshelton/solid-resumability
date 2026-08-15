import { box } from '@async/witness';
import { pageUrl } from '../config.ts';
import { arrivedSince, assert, describe, quietRequests, scripts, totalBytes } from './support/network.ts';

// The control for the todos page: the same keystrokes and the same Enter,
// against the build where every handler was already shipped. Zero requests
// follow the load, which is what makes the one request the resumable build
// makes a measurement rather than noise.

const NEW_TODO = 'input.new-todo';

export default box(
	{
		name: 'classic todos: the same interactions fetch nothing, because everything was eager',
		modes: ['dev'],
		tags: ['network', 'classic'],
	},
	async ({ browser, expect, receipt }) => {
		const page = await browser.visit(pageUrl('classic', 'todos'));
		await expect.page.exists(page, NEW_TODO);
		const load = await quietRequests(page);

		receipt.note(`classic todos load set:\n${describe(load)}`);
		receipt.note(`eager JS on load: classic ${totalBytes(scripts(load))} B on the wire.`);

		const title = 'witness drove this todo';
		await page.type(NEW_TODO, title, { redact: false });
		await page.press(NEW_TODO, 'Enter');

		await expect.page.exists(page, 'ul.todo-list li');
		await expect.page.text(page, 'ul.todo-list li:last-child label', title);

		const after = await quietRequests(page);
		const perAction = arrivedSince(load, after);
		assert(
			perAction.length === 0,
			`the classic build fetched something per action, which it has nothing to fetch:\n${describe(perAction)}`,
		);

		await expect.page.outcome(page, {
			interactions: { type: 1, press: 1, click: 0 },
			navigations: 0,
			failedRequests: 0,
		});
	},
);
