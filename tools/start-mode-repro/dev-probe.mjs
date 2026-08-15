/**
 * The dev half of the reproduction: bring the server up, ask it for the page,
 * print what it served, put it down again.
 *
 * `pnpm dev` is where a page rewrite is supposed to show without a build, and
 * it is the arm T001's second prediction is about — `appType: 'custom'`
 * un-registers `indexHtmlMiddleware`, which is the sole caller of
 * `createDevHtmlTransformFn`, which is the sole thing that runs
 * `transformIndexHtml` hooks in dev. So the observation this script makes is
 * the served bytes: a page that came up carrying `/src/classic-entry.ts` and an
 * empty mount is a page the hook never reached.
 *
 * Usage: node dev-probe.mjs plain|start
 */

import { createServer } from "vite";

const arm = process.argv[2];
if (arm !== "plain" && arm !== "start") {
  console.error("usage: node dev-probe.mjs plain|start");
  process.exit(2);
}

const { default: config } = await import(`./vite.${arm}.config.mjs`);

const server = await createServer({ ...config, configFile: false });
await server.listen();

const url = server.resolvedUrls?.local?.[0] ?? `http://localhost:${server.config.server.port}/`;
console.log(`[repro] dev server listening at ${url}`);

for (const path of ["", "index.html"]) {
  const target = new URL(path, url).href;
  try {
    // A browser's own Accept header, and it is load-bearing rather than
    // cosmetic: start mode's dev middleware only claims a request whose accept
    // list contains `text/html` (@solidjs/vite-plugin@3.0.0-next.28
    // dist/esm/index.mjs:1815-1823), so a bare `fetch()` sending `*/*` falls
    // through to Vite's 404 and would libel the plugin.
    const response = await fetch(target, {
      headers: { accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
    });
    const body = await response.text();
    console.log(`[repro] GET ${target} -> ${response.status} ${response.headers.get("content-type")}`);
    console.log(`[repro] ---- served document begins ----`);
    console.log(body);
    console.log(`[repro] ---- served document ends ----`);
    console.log(
      `[repro] served carries classic entry: ${body.includes("/src/classic-entry.ts")}; ` +
        `resumable entry: ${body.includes("/src/resumable-entry.ts")}; ` +
        `inlined template: ${body.includes("data-testid=\"counter-label\"")}`,
    );
  } catch (error) {
    console.log(`[repro] GET ${target} -> threw ${error?.name}: ${error?.message}`);
  }
}

// Let the dep scanner finish before pulling the server down. Closing on top of
// an in-flight scan makes esbuild print pages of "the server is being restarted
// or closed" — noise that has nothing to do with the question and would sit in
// the transcript looking like evidence.
await server.waitForRequestsIdle?.();
await new Promise((settle) => setTimeout(settle, 1500));

await server.close();
console.log(`[repro] dev server closed`);

// A dev server holds handles a `close()` does not always release (the file
// watcher and the optimizer's own workers among them), and this probe has said
// everything it came to say. Exiting explicitly keeps the reproduction from
// hanging the verification run.
process.exit(0);
