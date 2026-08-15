/**
 * One config factory, one flag, two arms.
 *
 * The whole reproduction turns on a single boolean. `reproConfig({ start })`
 * hands both arms the SAME resumability options, the SAME page declaration, the
 * same root and the same component; the only difference between what the plain
 * arm builds and what the start arm builds is whether `@solidjs/vite-plugin` is
 * called as `solid()` or as `solid({ start: true })`. Anything the two arms do
 * differently is therefore attributable to that flag and to nothing else, which
 * is the only property that makes the contrast worth recording.
 *
 * Two things in here are instrumentation rather than configuration, and both
 * are transparent: `announceHooks` wraps the resumability plugin's own hooks in
 * a function that PRINTS and then delegates to the original — it changes no
 * argument, no return value and no ordering — and `observeResolvedConfig` is a
 * `configResolved` reader that writes nothing back. Neither shapes the outcome;
 * they only make it audible on stdout, so the transcript carries the evidence
 * instead of a claim about it.
 */

import { existsSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import solid from "@solidjs/vite-plugin";
import resumability from "unplugin-solid-resumability/vite";

export const ROOT = dirname(fileURLToPath(import.meta.url));

/**
 * The resumability declaration, identical on both arms.
 *
 * One provable component, one page, two of the three HTML features the plugin
 * can perform on a page: the entry swap and the template inlining. Both are
 * `transformIndexHtml` work — which is exactly the hook T001 predicted start
 * mode never calls.
 */
export function reproOptions() {
  return {
    root: ROOT,
    artifactDir: join(ROOT, "artifacts"),
    mounts: [
      { component: "Counter", source: "src/Counter.tsx", artifact: "Counter", page: "index" },
    ],
    pages: [
      {
        id: "index",
        html: "index.html",
        entry: { from: "/src/classic-entry.ts", to: "/src/resumable-entry.ts" },
        inlineTemplates: true,
        prerender: false,
      },
    ],
  };
}

/** Wraps every hook that decides this question in a printing pass-through. */
function announceHooks(plugins) {
  for (const plugin of plugins) {
    const hook = plugin.transformIndexHtml;
    if (hook) {
      const handler = typeof hook === "function" ? hook : hook.handler;
      const wrapped = function (...args) {
        const request = args[1] ?? {};
        console.log(
          `[repro] HOOK FIRED  ${plugin.name}.transformIndexHtml  ` +
            `path=${JSON.stringify(request.path ?? null)} ` +
            `filename=${JSON.stringify(request.filename ?? null)}`,
        );
        return handler.apply(this, args);
      };
      plugin.transformIndexHtml = typeof hook === "function" ? wrapped : { ...hook, handler: wrapped };
    }

    if (typeof plugin.closeBundle === "function") {
      const original = plugin.closeBundle;
      plugin.closeBundle = function (...args) {
        console.log(`[repro] HOOK FIRED  ${plugin.name}.closeBundle`);
        return original.apply(this, args);
      };
    }
  }
  return plugins;
}

/** Reads the resolved config back and prints the facts under test. */
function observeResolvedConfig(arm) {
  return {
    name: "repro:observe",
    enforce: "post",
    configResolved(config) {
      const client = config.environments?.client?.build ?? {};
      console.log(`[repro] arm=${arm} command=${config.command}`);
      console.log(`[repro] resolved appType = ${JSON.stringify(config.appType)}`);
      console.log(
        `[repro] resolved client input = ${JSON.stringify(client.rollupOptions?.input ?? null)}`,
      );
      console.log(`[repro] resolved client outDir = ${JSON.stringify(client.outDir ?? null)}`);
      console.log(`[repro] resolved build.outDir = ${JSON.stringify(config.build?.outDir ?? null)}`);
      console.log(
        `[repro] plugins carrying transformIndexHtml: ` +
          JSON.stringify(config.plugins.filter((p) => p.transformIndexHtml).map((p) => p.name)),
      );
    },
  };
}

/**
 * The ordering probe: is the built document on disk when `closeBundle` fires?
 *
 * This reads the same two facts the prerender stage reads, at the same moment
 * the prerender stage reads them, and computes the same path it computes —
 * `plugin/src/stages/prerender.ts:853-877` resolves `distDir` from
 * `config.build.outDir` in `configResolved` and fires in `closeBundle`, and
 * `prerender.ts:354` then looks for `join(input.htmlDir ?? input.distDir,
 * basename(page.html))`. If that file is absent at that instant, the throw at
 * `prerender.ts:355-363` is `PageDocumentMissing`.
 *
 * It is a READER. It writes nothing, returns nothing, and changes no ordering;
 * the real prerender stage is not registered here, because registering it would
 * mean declaring a group, and a group needs a substitution — machinery this
 * reproduction deliberately does not carry, since none of it is what the
 * question turns on. What the question turns on is whether the document is
 * there yet, and that is what this measures, on both arms, side by side.
 */
function probeDocumentAtCloseBundle(arm, htmlName) {
  let distDir;

  return {
    name: "repro:document-at-closebundle",
    apply: "build",

    configResolved(config) {
      const outDir = config.build?.outDir ?? "dist";
      distDir = isAbsolute(outDir) ? outDir : resolve(config.root ?? ROOT, outDir);
    },

    closeBundle() {
      const documentPath = join(distDir, basename(htmlName));
      console.log(
        `[repro] closeBundle  arm=${arm}  distDir=${distDir}\n` +
          `[repro]   the prerender stage would look for ${documentPath}\n` +
          `[repro]   exists at closeBundle: ${existsSync(documentPath)}`,
      );
      process.on("exit", () => {
        console.log(
          `[repro] at process exit  ${documentPath} exists: ${existsSync(documentPath)}`,
        );
        const startDocument = join(ROOT, "dist/client/index.html");
        console.log(
          `[repro] at process exit  ${startDocument} exists: ${existsSync(startDocument)}`,
        );
      });
    },
  };
}

/**
 * @param {{ start: boolean }} arm
 */
export function reproConfig({ start }) {
  const label = start ? "start" : "plain";

  return {
    root: ROOT,
    logLevel: "info",
    plugins: [
      ...announceHooks(resumability(reproOptions())),
      start ? solid({ start: true }) : solid(),
      observeResolvedConfig(label),
      probeDocumentAtCloseBundle(label, "index.html"),
    ],
    server: { port: start ? 5399 : 5398, strictPort: false },
    build: {
      outDir: `dist/${label}`,
      emptyOutDir: true,
      manifest: true,
      target: "es2022",
      minify: false,
      sourcemap: false,
      rollupOptions: start ? {} : { input: { index: join(ROOT, "index.html") } },
    },
  };
}
