/**
 * One capture: the page's first paint, taken by running its built group in a
 * headless document.
 *
 * ── Why a capture and not server rendering ────────────────────────────────
 * A server renderer emits markup for a *tree*, and it emits it with the
 * markers its own client half claims against. What this pipeline serves is
 * markup a proven component's locators address directly, with nothing claiming
 * anything — so the two are not the same bytes, and the framework would have to
 * be taught about ours for them to be. Running the code instead asks no such
 * favour: the shell is an output of the same module, at the same state, as the
 * render that will replace it on the first interaction, which is what makes the
 * replacement invisible.
 *
 * ── Why the snapshot is synchronous ───────────────────────────────────────
 * The markup is read before anything is awaited, so no microtask has run and no
 * asynchronous source behind the page's own loading boundary can have resolved.
 * What that captures is the paint a browser shows first, rather than a later
 * state that would flash back to the first one when the group renders.
 *
 * ── Why this is a module of its own ───────────────────────────────────────
 * It is the body of a child process. The caller runs it once per capture in a
 * process of its own, so each capture gets a fresh module registry, a fresh
 * document and a fresh store — and two captures that agree agree because the
 * code is deterministic, not because the second one inherited the first one's
 * memory. Everything else stays out of this file: a DOM, node's own URL helper
 * and a path normalizer, and nothing that would make a child process pay for
 * the rest of the package.
 */

import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'pathe';

// The headless DOM ships no types of its own, and a types package would be a
// dependency taken on for the sake of one constructor. What this file calls is
// declared below instead, so the surface it depends on is written down rather
// than inferred as `any`. Should the implementation ever ship types, this
// suppression is what stops compiling and says so.
// @ts-expect-error -- untyped module; `HeadlessDom` below is the contract
import { JSDOM as UntypedDom } from 'jsdom';

/** The window this file touches, and nothing else it happens to have. */
interface CaptureWindow {
  document: Document;
  DOMTokenList: { prototype: { supports: (token: string) => boolean } };
  close(): void;
}

/** One headless document, as its constructor returns it. */
interface HeadlessDom {
  window: CaptureWindow;
}

const JSDOM = UntypedDom as unknown as new (
  html: string,
  options: { url: string },
) => HeadlessDom;

/**
 * The file a capture is run as, whatever shape the package ships in.
 *
 * Derived from this module's own URL rather than from a path someone wrote
 * down, because after bundling there is no such path: this module ends up
 * inside one of the package's entry bundles, and `import.meta.url` names
 * whichever one that is. Running that file as a script takes the branch at the
 * bottom of this module, which is why the child needs no import of its own and
 * no export name that a bundler is free to rename.
 */
export const CAPTURE_MODULE_PATH = resolve(fileURLToPath(import.meta.url));

/** What tells the module at the bottom of this file that it is the child. */
export const CAPTURE_FLAG = '--unplugin-solid-resumability-capture';

/**
 * What separates the captured markup from anything the page's own code wrote
 * to standard output. The parent reads what follows the last one.
 */
export const CAPTURE_PAYLOAD_MARK = '\n<<<unplugin-solid-resumability:capture>>>';

/**
 * What one capture reports, either way.
 *
 * A refusal is reported rather than thrown out of the process because a child
 * that dies of an uncaught error says what happened by writing a runtime stack
 * to a standard error it shares with whatever started the build — text nobody
 * asked for, arriving from a process that is already exiting. What the parent
 * needs is the sentence this package wrote, which is a value; so the child
 * hands it back the same way it hands back markup, and the exit status stays
 * honest on top of that.
 */
export type CapturePayload = { html: string } | { failure: string };

/** Everything one capture needs, and nothing it could derive wrongly. */
export interface CaptureRequest {
  /** Absolute path of the built group chunk to run. */
  chunkPath: string;
  /** The document the group renders into, as markup. The target element is empty in it. */
  documentHtml: string;
  /** How the target element is addressed inside that document. */
  rootSelector: string;
  /** The export the chunk renders through. It takes the element and returns a disposer. */
  execute: string;
  /**
   * The origin the document claims.
   *
   * A build cannot know where the page will be served from, and nothing in a
   * first paint should depend on it; a document with no origin at all, though,
   * makes a relative URL throw. So: a local one, stated once.
   */
  origin?: string;
}

const DEFAULT_ORIGIN = 'http://localhost/';

/**
 * Everything the built chunk expects a browser to have.
 *
 * Copied wholesale from the window rather than listed, because the list is the
 * framework's business: a missing entry would be a capture that failed for a
 * reason having nothing to do with the page, and the failure would read as a
 * fault in the markup.
 */
function installGlobals(window: CaptureWindow): void {
  // A bundler's module-preload polyfill asks whether the `modulepreload` link
  // relation is supported, and this DOM throws for an attribute with no defined
  // tokens — which would abort the chunk's evaluation before it exported
  // anything. What the answer is does not affect what is captured.
  window.DOMTokenList.prototype.supports = () => true;

  const host = globalThis as Record<string, unknown>;
  host.window = window;
  host.document = window.document;

  for (const key of Object.getOwnPropertyNames(window)) {
    if (key in globalThis) continue;
    let value: unknown;
    try {
      value = (window as unknown as Record<string, unknown>)[key];
    } catch {
      continue;
    }
    if (value === null || (typeof value !== 'object' && typeof value !== 'function')) continue;
    try {
      Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    } catch {
      // A global the host owns and will not give up is a global the chunk can
      // have the host's copy of.
    }
  }
}

/**
 * Runs the group once and returns what the target element contains.
 *
 * Exported rather than kept private because the child process is a detail of
 * how isolation is bought, not of what a capture is: a caller that wants one
 * capture in the process it already has can call this directly, and will get
 * the same bytes for as long as its own registry is clean.
 */
export async function captureShell(request: CaptureRequest): Promise<string> {
  const dom = new JSDOM(request.documentHtml, { url: request.origin ?? DEFAULT_ORIGIN });
  installGlobals(dom.window);

  const group = (await import(pathToFileURL(request.chunkPath).href)) as Record<string, unknown>;
  const execute = group[request.execute];
  if (typeof execute !== 'function') {
    throw new Error(
      `capture: the built chunk ${request.chunkPath} exports no \`${request.execute}\` function, ` +
        'so there is nothing to render. `prerender.execute` names the export the group renders ' +
        'through; the generated group module exports `execute`.',
    );
  }

  const root = dom.window.document.querySelector(request.rootSelector);
  if (root === null) {
    throw new Error(
      `capture: the capture document has no element matching ${JSON.stringify(request.rootSelector)}, ` +
        'so the group has nowhere to render.',
    );
  }

  // Synchronous, and read before anything is awaited: an asynchronous source
  // behind the page's loading boundary has not had a microtask to resolve in.
  const dispose = (execute as (element: Element) => () => void)(root);
  const html = root.innerHTML;

  dispose();
  dom.window.close();
  return html;
}

/** A captured paint, parsed, and the handle that lets it go. */
export interface ParsedMarkup {
  /** The element the markup was parsed into. Its children are the markup. */
  container: Element;
  close(): void;
}

/**
 * Parses markup this build already captured.
 *
 * Here rather than in the stage that uses it because the headless DOM's one
 * typed contract lives in this file, and a second one somewhere else would be
 * two places to update when the implementation changes. What the caller gets is
 * a container whose children are the markup — the same relationship a mount
 * container has to the component it holds, which is what makes a locator mean
 * the same thing against it.
 */
export function parseCapturedMarkup(html: string, origin = DEFAULT_ORIGIN): ParsedMarkup {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, { url: origin });
  return {
    container: dom.window.document.body,
    close: () => dom.window.close(),
  };
}

// The child half, and the only thing that takes this branch is a process this
// package started for one capture. Importing this module never does: the guard
// asks whether this file is the script node was given, not merely whether the
// flag is on the command line.
//
// Nothing is awaited at the top level here. A module that awaits is an
// asynchronous module for everyone who imports it, and what this branch is for
// is a process that imports nothing.
if (
  process.argv[2] === CAPTURE_FLAG &&
  resolve(process.argv[1] ?? '') === CAPTURE_MODULE_PATH
) {
  const report = (payload: CapturePayload): void => {
    process.stdout.write(CAPTURE_PAYLOAD_MARK + JSON.stringify(payload));
  };

  // Both endings are handled here, and only here: this is the boundary between
  // a promise and a process, and it is the one place that knows a rejection is
  // a result to be carried rather than a fault to be raised. The refusals
  // themselves are untouched — every one of them still throws where it is
  // decided — and the status still says the capture did not happen, so a parent
  // that reads nothing but the exit code is no worse off than before. What is
  // gone is the runtime's own crash report, which said the same thing on a
  // stream the parent was not reading and on a schedule nobody controlled.
  void captureShell(JSON.parse(process.argv[3] ?? '{}') as CaptureRequest).then(
    (html) => report({ html }),
    (cause: unknown) => {
      process.exitCode = 1;
      report({ failure: cause instanceof Error ? cause.message : String(cause) });
    },
  );
}
