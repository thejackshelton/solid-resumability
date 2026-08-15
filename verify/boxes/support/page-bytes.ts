// Reads a built page's eager script bytes straight off the static server, so a
// box can quote the other variant's number without opening a second browser
// page. The browser-observed totals in the boxes are the load-bearing figures;
// this is the file size the server reports for the same asset, which is the
// same number minus the response headers CDP counts.

const MODULE_SCRIPT_SRC = /<script[^>]+type="module"[^>]*\ssrc="([^"]+)"/g;

export type EagerScripts = {
	readonly urls: readonly string[];
	/** Raw file bytes, headers excluded. */
	readonly bytes: number;
};

/** Fetches the page and totals the `Content-Length` of its eager module scripts. */
export async function eagerScriptBytes(pageUrl: string): Promise<EagerScripts> {
	const response = await fetch(pageUrl);
	if (!response.ok) {
		throw new Error(`${pageUrl} returned HTTP ${response.status}.`);
	}
	const html = await response.text();
	const urls = [...html.matchAll(MODULE_SCRIPT_SRC)].map(
		(match) => new URL(match[1]!, pageUrl).href,
	);
	if (urls.length === 0) {
		throw new Error(`${pageUrl} declares no module scripts; the page shape changed.`);
	}
	let bytes = 0;
	for (const url of urls) {
		const head = await fetch(url, { method: 'HEAD' });
		const length = head.headers.get('content-length');
		if (!head.ok || length === null) {
			throw new Error(`${url} returned HTTP ${head.status} without a content-length.`);
		}
		bytes += Number(length);
	}
	return { urls, bytes };
}
