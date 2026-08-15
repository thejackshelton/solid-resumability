import { box } from '@async/witness';
import { FIXTURES_EAGER_JS_CAP_BYTES, pageUrl } from '../config.ts';
import { arrivedSince, assert, describe, kindOf, pathOf, quietRequests, scripts, totalBytes } from './support/network.ts';

// The control. Same four components, same source, built the ordinary way: the
// component bodies are in the entry bundle, so the page pays for all of them
// before the user does anything and then never touches the network again.
//
// This box is what stops the resumable box's numbers from being a trick. A
// suite that only measured the resumable build could be measuring a page that
// does less; running the identical interactions here shows the same
// behaviour reached from a bigger eager bundle and zero lazy fetches.

const INTERACTIONS: ReadonlyArray<{
	readonly component: string;
	readonly button: string;
	readonly readout: string;
	readonly before: string;
	readonly after: string;
}> = [
	{
		component: 'ProvableCounter',
		button: '[data-testid="provable-counter-inc"]',
		readout: '[data-testid="provable-counter-label"]',
		before: 'count: 0',
		after: 'count: 1',
	},
	{
		component: 'ProvableStepper',
		button: '[data-testid="provable-stepper-up"]',
		readout: '[data-testid="provable-stepper-total"]',
		before: '15',
		after: '20',
	},
	{
		component: 'ProvableGreeting',
		button: '[data-testid="provable-greeting-solid"]',
		readout: '[data-testid="provable-greeting-text"]',
		before: 'hello, world',
		after: 'hello, solid',
	},
	{
		component: 'PropsPairParent',
		button: '[data-testid="props-pair-inc"]',
		readout: '[data-testid="props-pair-label"]',
		before: '0',
		after: '1',
	},
];

export default box(
	{
		name: 'classic fixtures: the whole component set is eager and nothing is fetched per action',
		modes: ['dev'],
		tags: ['network', 'classic'],
	},
	async ({ browser, expect, receipt }) => {
		const page = await browser.visit(pageUrl('classic', 'fixtures'));
		const load = await quietRequests(page);

		receipt.note(`classic fixtures load set:\n${describe(load)}`);

		const eagerScripts = scripts(load);
		const eagerBytes = totalBytes(eagerScripts);
		assert(
			eagerScripts.length === 1,
			`expected a single eager bundle; observed:\n${describe(eagerScripts)}`,
		);
		assert(
			eagerBytes > FIXTURES_EAGER_JS_CAP_BYTES,
			`the classic build shipped ${eagerBytes} B of eager JS, at or under the ${FIXTURES_EAGER_JS_CAP_BYTES} B cap the resumable build is held to — the two builds are no longer distinguishable by load weight.`,
		);
		receipt.note(
			`eager JS on load: classic ${eagerBytes} B on the wire, against the ${FIXTURES_EAGER_JS_CAP_BYTES} B cap the resumable build clears.`,
		);
		assert(
			load
				.filter((request) => kindOf(request) === 'other')
				.every((request) => pathOf(request) === '/favicon.ico'),
			`unexpected non-asset requests on load:\n${describe(load)}`,
		);

		for (const interaction of INTERACTIONS) {
			await expect.page.text(page, interaction.readout, interaction.before);
			await page.click(interaction.button);
			await expect.page.text(page, interaction.readout, interaction.after);
		}

		const after = await quietRequests(page);
		const perAction = arrivedSince(load, after);
		assert(
			perAction.length === 0,
			`the classic build fetched something per action, which it has nothing to fetch:\n${describe(perAction)}`,
		);
		receipt.note(
			`${INTERACTIONS.length} interactions, 0 network requests: all behaviour was already in the entry bundle.`,
		);

		await expect.page.outcome(page, {
			interactions: { click: INTERACTIONS.length },
			navigations: 0,
			consoleErrors: 0,
			failedRequests: 0,
		});
	},
);
