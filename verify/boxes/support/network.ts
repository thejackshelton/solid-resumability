import type { BrowserNetworkRequest, PageHandle } from '@async/witness';

// Witness records a completed request the moment CDP reports
// `Network.loadingFinished`, and appends it to the page record. `networkRequests()`
// hands back a copy of that append-only list, so a diff around an interaction is
// `after.slice(before.length)` — no timestamp sorting and no identity guessing.
//
// `encodedDataLength` is CDP's total for the response *including* its headers.
// Against the no-compression static server in `servers/static-server.mjs` that
// makes every number here the raw file size plus roughly 150 bytes of headers:
// an over-count, never an under-count, so a cap cleared with these numbers is
// cleared with room to spare.

export type RequestKind = 'document' | 'stylesheet' | 'script' | 'other';

export function pathOf(request: BrowserNetworkRequest): string {
	return request.url.startsWith('data:')
		? `data: (${request.url.length} chars)`
		: new URL(request.url).pathname;
}

/**
 * True when the request left the machine. CDP reports `data:` URLs through the
 * same Network events as real fetches: the TodoMVC stylesheet paints its toggle
 * checkbox with an inline SVG, so rendering the first todo "requests" it. Those
 * bytes were already counted inside the stylesheet that carries them, and
 * `dropInlineAssets` refuses to drop any that claim otherwise.
 */
export function isOverTheWire(request: BrowserNetworkRequest): boolean {
	return request.url.startsWith('http://') || request.url.startsWith('https://');
}

/** Removes inline `data:` assets, failing if one carries wire bytes. */
export function dropInlineAssets(
	requests: readonly BrowserNetworkRequest[],
): BrowserNetworkRequest[] {
	for (const request of requests) {
		if (!isOverTheWire(request) && (request.encodedDataLength ?? 0) > 0) {
			throw new Error(
				`${request.url.slice(0, 80)} is not an http(s) URL yet reports ${request.encodedDataLength} wire bytes.`,
			);
		}
	}
	return requests.filter(isOverTheWire);
}

export function kindOf(request: BrowserNetworkRequest): RequestKind {
	const path = pathOf(request);
	if (path.endsWith('.js') || path.endsWith('.mjs')) return 'script';
	if (path.endsWith('.css')) return 'stylesheet';
	if (path.endsWith('.html')) return 'document';
	return 'other';
}

export function scripts(requests: readonly BrowserNetworkRequest[]): BrowserNetworkRequest[] {
	return requests.filter((request) => kindOf(request) === 'script');
}

/**
 * Sums the wire bytes of the given requests. A null `encodedDataLength` would
 * be a silent hole in the accounting, so it fails instead of counting as zero.
 */
export function totalBytes(requests: readonly BrowserNetworkRequest[]): number {
	let total = 0;
	for (const request of requests) {
		if (request.encodedDataLength === null) {
			throw new Error(`no encodedDataLength recorded for ${request.url}; byte total is unsound.`);
		}
		total += request.encodedDataLength;
	}
	return total;
}

/** One line per request: `200 script 10.9 kB /fixtures/assets/fixtures-CRsXp66V.js`. */
export function describe(requests: readonly BrowserNetworkRequest[]): string {
	if (requests.length === 0) return '(none)';
	return requests
		.map(
			(request) =>
				`${request.status ?? '---'} ${kindOf(request)} ${request.encodedDataLength ?? '?'}B ${pathOf(request)}`,
		)
		.join('\n');
}

export type QuietOptions = {
	/** Consecutive equal-length samples that count as quiescence. */
	readonly samples?: number;
	readonly intervalMs?: number;
	readonly timeoutMs?: number;
};

/**
 * Polls the completed-request list until it stops growing, then returns the
 * requests that crossed the wire.
 *
 * Absence of a request is only provable against a quiet network: a snapshot
 * taken the instant after a click could miss a fetch that is still in flight.
 * Sampling until the list holds still is the bound that makes "nothing new
 * arrived" mean something, and it never waits longer than it has to. Quiescence
 * is judged on the unfiltered list so an inline asset still counts as activity.
 *
 * Filtering preserves the append-only shape of the list, so `arrivedSince`
 * keeps working on what this returns.
 */
export async function quietRequests(
	page: PageHandle,
	options: QuietOptions = {},
): Promise<BrowserNetworkRequest[]> {
	const samples = options.samples ?? 3;
	const intervalMs = options.intervalMs ?? 100;
	const timeoutMs = options.timeoutMs ?? 10_000;
	const deadline = Date.now() + timeoutMs;

	let latest = await page.networkRequests();
	let stable = 1;
	while (stable < samples) {
		if (Date.now() > deadline) {
			throw new Error(
				`network never went quiet within ${timeoutMs}ms; last count ${latest.length}.`,
			);
		}
		await new Promise((resolve) => setTimeout(resolve, intervalMs));
		const next = await page.networkRequests();
		stable = next.length === latest.length ? stable + 1 : 1;
		latest = next;
	}
	return dropInlineAssets(latest);
}

/** The requests that completed after `before` was taken. */
export function arrivedSince(
	before: readonly BrowserNetworkRequest[],
	after: readonly BrowserNetworkRequest[],
): BrowserNetworkRequest[] {
	return after.slice(before.length);
}

/**
 * Box-level assertion. Witness's `expect` covers DOM and page-evidence claims;
 * network claims have no verb, so they are raised as box errors — the receipt
 * records the message, and the box fails.
 */
export function assert(condition: boolean, message: string): asserts condition {
	if (!condition) {
		throw new Error(message);
	}
}
