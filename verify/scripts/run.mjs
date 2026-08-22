#!/usr/bin/env node
// One command, whole verification: build what has to be built, serve the built
// demo over HTTP, drive a real Chrome across it with witness, tear the servers
// down, and exit with witness's own code.
//
// Two build trees are involved and neither is this project's:
//
//   - witness (/../witness) ships no `dist/` in git, so the runner builds it if
//     it is missing. That build output is gitignored there, which is what keeps
//     running this suite from dirtying the witness checkout.
//   - the demo builds on Vite 7 and witness runs on Vite 8. Nothing here loads
//     both: the demo is built by its own toolchain in a child process, and the
//     boxes only ever see the finished bytes over HTTP.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import path from 'pathe';
import { fileURLToPath } from 'node:url';
import { PAGES, PORTS, VARIANTS } from '../config.ts';
import { startStaticServer } from '../servers/static-server.mjs';

const VERIFY_ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const REPO_ROOT = path.resolve(VERIFY_ROOT, '..');
const DEMO_ROOT = path.join(REPO_ROOT, 'demo');
const DEMO_DIST = path.join(DEMO_ROOT, 'dist');
const WITNESS_ROOT = path.resolve(REPO_ROOT, '..', 'witness');

/** Inputs whose mtime decides whether `demo/dist` still describes the source. */
const DEMO_INPUTS = [
	path.join(REPO_ROOT, 'src'),
	path.join(REPO_ROOT, 'app', 'src'),
	// The demo builds through `unplugin-solid-resumability`, linked from
	// `plugin/`: the pass, the substitution, the group module, the page rewrites
	// and the captured first paint are all its. Without it on this list a plugin
	// change would leave `demo/dist` stale and the witness would verify
	// yesterday's build against today's source and call it green.
	path.join(REPO_ROOT, 'plugin', 'src'),
	path.join(DEMO_ROOT, 'src'),
	path.join(DEMO_ROOT, 'build'),
	path.join(DEMO_ROOT, 'scripts'),
	path.join(DEMO_ROOT, 'index.html'),
];

function log(message) {
	process.stdout.write(`verify: ${message}\n`);
}

function run(command, args, cwd) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { cwd, stdio: 'inherit', shell: false });
		child.on('error', reject);
		child.on('close', (code) => {
			if (code === 0) {
				resolve();
				return;
			}
			reject(new Error(`${command} ${args.join(' ')} (in ${cwd}) exited ${code}.`));
		});
	});
}

/** Newest mtime under a file or directory tree; 0 when it does not exist. */
async function newestMtime(target) {
	let stats;
	try {
		stats = await stat(target);
	} catch {
		return 0;
	}
	if (!stats.isDirectory()) {
		return stats.mtimeMs;
	}
	let newest = stats.mtimeMs;
	for (const entry of await readdir(target, { withFileTypes: true })) {
		if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
		newest = Math.max(newest, await newestMtime(path.join(target, entry.name)));
	}
	return newest;
}

/** Oldest mtime under a directory tree; 0 when it does not exist or is empty. */
async function oldestMtime(target) {
	let stats;
	try {
		stats = await stat(target);
	} catch {
		return 0;
	}
	if (!stats.isDirectory()) {
		return stats.mtimeMs;
	}
	const entries = await readdir(target, { withFileTypes: true });
	if (entries.length === 0) {
		return 0;
	}
	let oldest = Number.POSITIVE_INFINITY;
	for (const entry of entries) {
		const value = await oldestMtime(path.join(target, entry.name));
		if (value === 0) return 0;
		oldest = Math.min(oldest, value);
	}
	return oldest === Number.POSITIVE_INFINITY ? 0 : oldest;
}

async function ensureWitnessBuilt() {
	if (existsSync(path.join(WITNESS_ROOT, 'dist', 'witness.mjs'))) {
		return;
	}
	if (!existsSync(WITNESS_ROOT)) {
		throw new Error(`no witness checkout at ${WITNESS_ROOT}; this suite consumes it as file:../../witness.`);
	}
	log('witness dist/ is missing; building it (gitignored output, no tracked change)');
	await run('pnpm', ['-C', WITNESS_ROOT, 'install'], WITNESS_ROOT);
	await run('pnpm', ['-C', WITNESS_ROOT, 'build'], WITNESS_ROOT);
}

async function ensureVerifyInstalled() {
	if (existsSync(path.join(VERIFY_ROOT, 'node_modules', '@async', 'witness'))) {
		return;
	}
	log('installing verify dependencies');
	await run('pnpm', ['install'], VERIFY_ROOT);
}

async function ensureDemoBuilt() {
	const built = await oldestMtime(DEMO_DIST);
	if (built === 0) {
		log('demo/dist is missing; building the demo');
		await run('pnpm', ['run', 'build'], DEMO_ROOT);
		return;
	}
	let newestInput = 0;
	for (const input of DEMO_INPUTS) {
		newestInput = Math.max(newestInput, await newestMtime(input));
	}
	if (newestInput > built) {
		log('demo/dist is older than its sources; rebuilding the demo');
		await run('pnpm', ['run', 'build'], DEMO_ROOT);
		return;
	}
	log('demo/dist is current');
}

/** Confirms a served page answers before any browser is launched. */
async function pollReady(url, timeoutMs = 10_000) {
	const deadline = Date.now() + timeoutMs;
	let lastError = 'no attempt made';
	while (Date.now() < deadline) {
		try {
			const response = await fetch(url, { method: 'HEAD' });
			if (response.ok) return;
			lastError = `HTTP ${response.status}`;
		} catch (error) {
			lastError = error instanceof Error ? error.message : String(error);
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw new Error(`${url} was not reachable within ${timeoutMs}ms: ${lastError}`);
}

async function main() {
	await ensureWitnessBuilt();
	await ensureVerifyInstalled();
	await ensureDemoBuilt();

	const servers = [];
	try {
		for (const variant of VARIANTS) {
			const root = path.join(DEMO_DIST, variant);
			if (!existsSync(root)) {
				throw new Error(`${root} does not exist after the demo build.`);
			}
			servers.push(await startStaticServer({ root, port: PORTS[variant] }));
			log(`serving ${root} on http://127.0.0.1:${PORTS[variant]}`);
		}
		// PAGES includes /click/click.html (T056). The loop polls every
		// registered page on both variants before witness launches.
		for (const variant of VARIANTS) {
			for (const page of Object.values(PAGES)) {
				await pollReady(`http://127.0.0.1:${PORTS[variant]}${page}`);
			}
		}

		const witnessBin = path.join(VERIFY_ROOT, 'node_modules', '.bin', 'witness');
		const code = await new Promise((resolve, reject) => {
			const child = spawn(witnessBin, process.argv.slice(2), {
				cwd: VERIFY_ROOT,
				stdio: 'inherit',
				shell: false,
			});
			child.on('error', reject);
			child.on('close', (exitCode) => resolve(exitCode ?? 1));
		});
		return code;
	} finally {
		await Promise.all(servers.map((server) => server.close()));
	}
}

main().then(
	(code) => {
		process.exitCode = code;
	},
	(error) => {
		process.stderr.write(`verify: ${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 2;
	},
);
