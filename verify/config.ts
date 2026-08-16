// Shared constants for the orchestrator (`scripts/run.mjs`, plain Node) and
// the boxes (loaded through Vite). Data only: no filesystem and no Node
// builtins, so both loaders can read this file unchanged.

/** Fixed ports, one static server per demo build variant. */
export const PORTS = {
	resumable: 4319,
	classic: 4320,
} as const;

export type Variant = keyof typeof PORTS;

export const VARIANTS: readonly Variant[] = ['resumable', 'classic'];

/**
 * Each server is rooted at `demo/dist/<variant>/`, so the built pages' relative
 * asset URLs (`./assets/...`, from `base: './'`) resolve under the page's own
 * directory exactly as they do in the dist tree.
 */
export const ORIGINS = {
	resumable: `http://127.0.0.1:${PORTS.resumable}`,
	classic: `http://127.0.0.1:${PORTS.classic}`,
} as const;

export const PAGES = {
	fixtures: '/fixtures/fixtures.html',
	todos: '/todos/todos.html',
	rule: '/rule/rule.html',
	click: '/click/click.html',
} as const;

export function pageUrl(variant: Variant, page: keyof typeof PAGES): string {
	return `${ORIGINS[variant]}${PAGES[page]}`;
}

/**
 * Eager-JS ceiling for the resumable fixtures page, in bytes on the wire. The
 * classic build of the same page ships a single ~33 kB entry, so a cap below
 * that is only clearable by a build that does not ship component bodies.
 *
 * Measured against 16,705 B at the carrier landing (T015): the roster added a
 * fifth component, its structure, wiring and template, and the region's own
 * eager half, and the page still clears this cap by 3,295 B. The cap has not
 * moved and is not to be moved to fit a build.
 */
export const FIXTURES_EAGER_JS_CAP_BYTES = 20_000;

/**
 * The fixtures page's five components, as the boxes drive them.
 *
 * Shared here rather than restated per box because the two fixtures boxes make
 * the SAME page do the same things and disagree only about which build served
 * it. A registry one of them owned would drift the moment the other stopped
 * reading it.
 *
 * `artifactId` is the emitted directory the resumable entry names in its lazy
 * import map (`PropsPair.PropsPairParent`, not `PropsPairParent`) and is what
 * `support/chunks.ts` resolves a chunk URL from — read out of the shipped bytes
 * rather than spelled here, so a rehash is not a red suite.
 */
export type ExtraChunk = 'regions' | 'store';

export type Fixture = {
	readonly component: string;
	readonly artifactId: string;
	readonly handlerId: string;
	readonly button: string;
	readonly readout: string;
	readonly afterFirst: string;
	readonly afterRepeat: string;
	/**
	 * What this fixture's FIRST click fetches BESIDES its own handler chunk.
	 *
	 * Empty for four of the five: a click on a flat component is one chunk, and
	 * that is the page's whole story. The roster is where the itemization earns
	 * its keep — its first dispatch is a region dispatch, so it also fetches the
	 * keyed-region resolver, and it is a dispatch whose action slot names a
	 * store nothing has created yet, so it also fetches the store partition. The
	 * trigger is stated per chunk here so no box has to justify a count.
	 */
	readonly alsoFetches: readonly ExtraChunk[];
};

/** The roster's served order — `demo/fixtures.html`, top to bottom. */
export const ROSTER_SERVED_ORDER = ['alan', 'grace', 'ada'] as const;

/** The roster's store order — `ROSTER_MEMBERS` in `demo/src/roster-store.ts`. */
export const ROSTER_SEED_ORDER = ['ada', 'grace', 'alan'] as const;

/** The carried mount, by the artifact id the build stamped into the markup. */
export const ROSTER_MOUNT = '[data-resume="KeyedRoster.RosterList"]';

/** The region container: the `<ul>` whose children the resume path calls items. */
export const ROSTER_CONTAINER = `${ROSTER_MOUNT} ul.roster`;

/** The readout cell — inside the panel, OUTSIDE the region. */
export const ROSTER_READOUT = `${ROSTER_MOUNT} p.last`;

/** The drop button of the nth item as SERVED, counting from 1. */
export function rosterDropButton(position: number): string {
	return `${ROSTER_CONTAINER} > li.member:nth-child(${position}) button.drop`;
}

export const FIXTURES: readonly Fixture[] = [
	{
		component: 'ProvableCounter',
		artifactId: 'ProvableCounter',
		handlerId: 's0',
		button: '[data-testid="provable-counter-inc"]',
		readout: '[data-testid="provable-counter-label"]',
		afterFirst: 'count: 1',
		afterRepeat: 'count: 2',
		alsoFetches: [],
	},
	{
		component: 'ProvableStepper',
		artifactId: 'ProvableStepper',
		handlerId: 's0',
		button: '[data-testid="provable-stepper-up"]',
		readout: '[data-testid="provable-stepper-total"]',
		afterFirst: '20',
		afterRepeat: '25',
		alsoFetches: [],
	},
	{
		component: 'ProvableGreeting',
		artifactId: 'ProvableGreeting',
		handlerId: 's0',
		button: '[data-testid="provable-greeting-solid"]',
		readout: '[data-testid="provable-greeting-text"]',
		// This handler sets a constant, so the repeat click is proved by the
		// interaction tally at the end rather than by a second text change.
		afterFirst: 'hello, solid',
		afterRepeat: 'hello, solid',
		alsoFetches: [],
	},
	{
		component: 'PropsPairParent',
		artifactId: 'PropsPair.PropsPairParent',
		handlerId: 's0',
		button: '[data-testid="props-pair-inc"]',
		readout: '[data-testid="props-pair-label"]',
		afterFirst: '1',
		afterRepeat: '2',
		alsoFetches: [],
	},
	{
		/**
		 * The carrier. Clicked by POSITION and answered by IDENTITY: the third
		 * item as served is Ada, who is the store's FIRST member, because the
		 * document serves the seed order reversed. The readout names whoever the
		 * store's own list resolved, so a dispatch that had counted siblings
		 * would say `dropped alan` here and the box would go red on the text.
		 *
		 * Nothing is removed by the click and the repeat click says the same
		 * thing again — `drop` returns a line, the readout shows it, and the
		 * list stays exactly as the document served it. `fixtures-region.box.ts`
		 * is where that invariance is asserted byte for byte; here the roster is
		 * one more fixture, and what it adds to this box is its chunk bill.
		 */
		component: 'RosterList',
		artifactId: 'KeyedRoster.RosterList',
		handlerId: 's0',
		button: rosterDropButton(3),
		readout: ROSTER_READOUT,
		afterFirst: 'dropped ada',
		afterRepeat: 'dropped ada',
		alsoFetches: ['regions', 'store'],
	},
];

/**
 * The eager entry's size BEFORE the addressed pair landed, in file bytes.
 *
 * Quoted, not measured: it is the figure the tranche recorded for the same page
 * one component-pair ago (T008's measurement, T009's ruling), and the box that
 * reads it prints old, new and the delta side by side. It is a reported number
 * rather than an asserted one — what is asserted is the cap above, which has
 * not moved and is not to be moved to fit a build.
 */
export const FIXTURES_EAGER_JS_BEFORE_COMPOSED_BYTES = 16_502;

/**
 * Where the addressed pair's 1,755 B went, attributed in SHIPPED bytes by
 * reading the built chunk (T009's split, re-measured after the recorded-prop
 * first-paint binding: entry 18,166 B → 18,257 B).
 *
 * The split is the reason the box states a bill instead of a total. Less than
 * half of it is the pair — the two components' own structure and wiring. The
 * rest is the REGISTRY INDEXING those artifacts: the namespace wrapper an eager
 * `import.meta.glob` hands the registry per module, the static glob keys, and
 * the lazy glob entries. That layer is paid by every component on this page,
 * addressed or not, which is why `indexing` is named here and named again in
 * the box: when the registry work lands, the number moves for a reason already
 * written down rather than one argued afterwards.
 */
export const COMPOSED_PAIR_EAGER_BYTES = {
	/** The whole delta the pair cost the entry chunk. */
	total: 1_755,
	/** The two components' own structure + wiring — the addressed pair itself. */
	payload: 861,
	/** Module-namespace wrappers, one per eager glob module. */
	namespaceWrappers: 422,
	/** The eager glob's own keys. */
	staticGlobKeys: 238,
	/** The lazy glob's `() => import(...)` entries. */
	lazyGlobEntries: 234,
	/** Everything above that is not payload: the indexing this pair paid for. */
	indexing: 894,
} as const;

/**
 * The whole page's registry-indexing layer, in shipped bytes (T009).
 *
 * 3,327 B of an 18,257 B entry — 18.2% — and none of it is a cost of
 * addressing: `ProvableGreeting` pays the identical per-component share and it
 * claims nothing. Recorded as a named debt so a later re-baseline cannot turn
 * it into the page's normal cost.
 */
export const FIXTURES_INDEXING_LAYER_BYTES = 3_327;

/**
 * The addressed pair, by the addresses the BUILD stamped into the markup.
 *
 * Deliberately NOT a sixth entry in `FIXTURES` above. Both fixtures boxes
 * iterate that array — their counts, their chunk census and their prose are
 * written against its five members — so a pair appended there would move three
 * boxes to witness one. The pair gets its own constants exactly as the roster
 * got its own selectors, and exactly one box reads them.
 *
 * `artifactId` is the emitted directory the entry names in its lazy import map
 * and is what the child's mount carries as `data-resume`. That those two
 * strings are the same string is not assumed here — it is asserted in the box,
 * because "the child resumes on ITS OWN address" is precisely the claim that
 * the address in the document is the artifact the build emitted for it.
 *
 * Nothing in `demo/fixtures.html` names the child. Its mount, its address and
 * its markup are derived by the plugin from `ComposedCounter.tsx` and written
 * into the parent's hole, which is why the child is addressed here by the id
 * the build chose rather than by anything a page author typed.
 */
export type Composed = {
	/** The name the ordinary path knows the component by (`data-component`). */
	readonly component: string;
	/** The emitted artifact directory (`data-resume`, and the lazy import key). */
	readonly artifactId: string;
	readonly handlerId: string;
	/** The mount, addressed the way the resumer finds it. */
	readonly mount: string;
	readonly button: string;
	readonly readout: string;
};

export const COMPOSED_OUTER: Composed = {
	component: 'ComposedOuter',
	artifactId: 'ComposedCounter.ComposedOuter',
	handlerId: 's0',
	mount: '[data-resume="ComposedCounter.ComposedOuter"]',
	button: '[data-testid="composed-outer-inc"]',
	readout: '[data-testid="composed-outer-label"]',
};

export const COMPOSED_INNER: Composed = {
	component: 'ComposedInner',
	artifactId: 'ComposedCounter.ComposedInner',
	handlerId: 's0',
	mount: '[data-resume="ComposedCounter.ComposedInner"]',
	button: '[data-testid="composed-inner-inc"]',
	readout: '[data-testid="composed-inner-label"]',
};

/**
 * The one v1 recorded literal the addressed child is handed. First-paint
 * markup, not a resume overlay: the value is baked into the child's own
 * template by classify-with-record and arrives in the served document.
 */
export const COMPOSED_RECORDED = {
	name: 'kind',
	value: 'seed',
	/** The child's first-paint node that carries the recorded value. */
	testid: 'composed-inner-kind',
} as const;

/**
 * The parent's hole, as its own template emits it — two attributes, empty —
 * before inline-template fill writes the child's painted markup inside.
 */
export const COMPOSED_HOLE_BEFORE_FILL =
	'<div data-resume="ComposedCounter.ComposedInner" data-component="ComposedInner"></div>';

/**
 * Eager-JS ceiling for the resumable todos page, in bytes on the wire.
 *
 * Set just above the honest post-T054 CDP wire observation of 15,696 B
 * (file bytes 15,488; CDP transfer accounting adds ~208 B of response
 * headers). WP-B element-projection restore grew the resumer; that growth
 * is part of the honest eager payload. Headroom is for jitter only. The
 * smallest framework leak (`solid-js/dist` alone, ~9,500 B minified) still
 * cannot fit, so a build that quietly fused the group back in cannot clear
 * the cap.
 */
export const TODOS_EAGER_JS_CAP_BYTES = 16_000;

/**
 * Ceilings for the todos page's fallback group — the one chunk the first touch
 * fetches — raw and gzipped. Kept in step with `GROUP_RAW_CAP_BYTES` /
 * `GROUP_GZIP_CAP_BYTES` in `demo/scripts/check-zero-eager.mjs`, which is what
 * enforces them against the built file; the box quotes them beside what it
 * actually saw arrive on the wire.
 *
 * These are tripwires, not budgets. The group is 94.9% framework by rendered
 * bytes and it activates atomically — every module of it runs before any
 * member handler does — so no chunk boundary drawn inside it removes a byte
 * from the first touch. Three splits were built and measured (T004): three-way
 * 63,401 B raw / 24,546 B gz, two-way 62,571 / 23,433, single 62,368 / 23,096.
 * Every split is LARGER than no split, because a gzip stream cannot share its
 * dictionary across a boundary. What shrinks this number is provable coverage:
 * each component the comptime pass proves leaves the group, and the fixtures
 * page — whose entry carries no framework at all — is what that ends in.
 *
 * So the caps sit just above the shipped figures: they catch a dependency
 * walking in. If they are ever missed, the answer is not to move them.
 */
export const TODOS_GROUP_RAW_CAP = 63_000;
export const TODOS_GROUP_GZ_CAP = 23_500;

/**
 * Eager-JS ceiling for the resumable rule page, in bytes on the wire.
 *
 * Own page, own cap: ceiling is parity with fixtures (20,000 B) and is not
 * to be moved to fit a build. The recorded baseline is the last measured
 * eager file size (T045: 13,445 B), not a diff.
 */
export const RULE_EAGER_JS_CAP_BYTES = 20_000;

/** Last recorded rule-page eager file bytes (T045). Reported, not asserted. */
export const RULE_EAGER_JS_BASELINE_BYTES = 13_445;

/**
 * The rule page's one mount: the installed package's own SeparatorRoot,
 * addressed by the artifact directory the build stamped into the markup.
 *
 * `artifactId` is what `data-resume` carries and what the eager entry names
 * in its glob map. The box asserts those two strings are the same string.
 */
export const RULE_ARTIFACT = 'QhqEt4aD.SeparatorRoot';
export const RULE_COMPONENT = 'SeparatorRoot';
export const RULE_MOUNT = `[data-resume="${RULE_ARTIFACT}"]`;

/**
 * Identities the page publishes at the mount site (`demo/src/rule-page.ts`).
 *
 * These are the caller's own props object and rest projection — not attribute
 * values the page or the box paints. The box feeds them to the artifact's
 * own compute and asserts the live DOM against that result.
 */
export const RULE_ORIENTATION_PROVIDE = { orientation: 'vertical' } as const;
export const RULE_REST_PROVIDE = { id: 'rule-root' } as const;

/**
 * The tag-name effect contract for this folded intrinsic: createTagName's
 * fallback is `"hr"`, and the served host is `<hr>`, so a ref-replay that
 * ran before the effect (or the initial cell) reads `"hr"` either way.
 */
export const RULE_TAG_NAME_CONTRACT = 'hr';

/**
 * Eager-JS ceiling for the resumable click page, in bytes on the wire.
 *
 * Own page, own cap: ceiling is parity with fixtures (20,000 B) and is not
 * to be moved to fit a build. The recorded baseline is the first measured
 * eager file size (T055: 16,449 B), not a diff.
 */
export const CLICK_EAGER_JS_CAP_BYTES = 20_000;

/** First recorded click-page eager file bytes (T055). Reported, not asserted. */
export const CLICK_EAGER_JS_BASELINE_BYTES = 16_449;

/**
 * The click page's one mount: the installed package's own ButtonRoot,
 * addressed by the artifact directory the build stamped into the markup.
 *
 * `artifactId` is what `data-resume` carries and what the eager entry names
 * in its glob map. The box asserts those two strings are the same string.
 */
export const CLICK_ARTIFACT = 'DvspU6cJ.ButtonRoot';
export const CLICK_COMPONENT = 'ButtonRoot';
export const CLICK_MOUNT = `[data-resume="${CLICK_ARTIFACT}"]`;

/**
 * The five attributes ButtonRoot was refused-then-admitted for. Served
 * markup must carry none of them; after resume each must equal the
 * artifact's own compute over live-resolved slots.
 */
export const CLICK_COMPUTED_ATTRS = ['type', 'role', 'tabindex', 'disabled', 'aria-disabled'] as const;

/**
 * Identities the page publishes at the mount site (`demo/src/click-page.ts`).
 *
 * These are the caller's own props object and rest projection — not attribute
 * values the page or the box paints. The box feeds them to the artifact's
 * own compute and asserts the live DOM against that result.
 */
export const CLICK_MERGED_PROPS = { type: 'button' } as const;
export const CLICK_REST_PROVIDE = { id: 'click-root' } as const;

/** Page-owned sentinel outside the mount. The click handler sets `data-clicked="1"`. */
export const CLICK_SENTINEL = '[data-click-sentinel]';
export const CLICK_SENTINEL_ATTR = 'data-clicked';
export const CLICK_SENTINEL_AFTER = '1';
