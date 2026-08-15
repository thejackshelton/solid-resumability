// Minimal static file server: `node:http` + `node:fs` only, no dependency of
// its own. It exists so the boxes drive the *built* demo output over real HTTP
// while witness runs on its own Vite major — nothing in this file is shared
// with the demo's build pipeline.
//
// Two properties matter for the byte accounting the boxes assert:
//
//   1. No compression, ever. `encodedDataLength` from CDP is then the raw file
//      size plus the response headers, so a cap stated in raw bytes is a
//      conservative bound rather than a flattering one.
//   2. No caching. Every request reaches the disk, so a second page load in the
//      same browser session still shows up as a request instead of a 304 or a
//      memory-cache hit that would hide it from the network evidence.

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';

const CONTENT_TYPES = new Map([
	['.html', 'text/html; charset=utf-8'],
	['.js', 'text/javascript; charset=utf-8'],
	['.mjs', 'text/javascript; charset=utf-8'],
	['.css', 'text/css; charset=utf-8'],
	['.json', 'application/json; charset=utf-8'],
	['.svg', 'image/svg+xml'],
	['.png', 'image/png'],
	['.ico', 'image/x-icon'],
	['.map', 'application/json; charset=utf-8'],
]);

/**
 * Resolves a URL path to a file inside `root`, or null when it escapes the
 * root or names a directory.
 */
function resolveFile(root, urlPath) {
	let decoded;
	try {
		decoded = decodeURIComponent(urlPath.split('?')[0] ?? '/');
	} catch {
		return null;
	}
	const resolved = path.resolve(root, `.${path.posix.normalize(decoded)}`);
	const rootWithSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
	if (resolved !== root && !resolved.startsWith(rootWithSep)) {
		return null;
	}
	return resolved;
}

/**
 * Starts a no-cache, no-compression static server for `root` on `port`.
 * Resolves once the port is accepting connections.
 */
export function startStaticServer({ root, port, host = '127.0.0.1' }) {
	const server = createServer((request, response) => {
		const filePath = resolveFile(root, request.url ?? '/');
		if (filePath === null) {
			response.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
			response.end('forbidden');
			return;
		}
		stat(filePath)
			.then((stats) => {
				if (!stats.isFile()) {
					response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
					response.end('not found');
					return;
				}
				response.writeHead(200, {
					'content-type':
						CONTENT_TYPES.get(path.extname(filePath)) ?? 'application/octet-stream',
					'content-length': String(stats.size),
					'cache-control': 'no-store, max-age=0',
				});
				if (request.method === 'HEAD') {
					response.end();
					return;
				}
				createReadStream(filePath).pipe(response);
			})
			.catch(() => {
				response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
				response.end('not found');
			});
	});

	return new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(port, host, () => {
			server.removeListener('error', reject);
			resolve({
				url: `http://${host}:${port}`,
				close: () =>
					new Promise((done) => {
						server.closeAllConnections?.();
						server.close(() => done());
					}),
			});
		});
	});
}
