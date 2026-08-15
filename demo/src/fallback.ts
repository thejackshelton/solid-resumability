/**
 * The fallback path: ordinary Solid, for components the comptime pass refused.
 *
 * Nothing imports this statically. It exists behind the one dynamic
 * `import()` in `resumable-page.ts`, so the entire classic runtime — the
 * renderer plus every component body — is a chunk the browser fetches only if
 * the page actually contains something unprovable. On the fixtures page it
 * never does; on the todos page it would be the whole page.
 */

import { render } from "@solidjs/web";

import { COMPONENTS } from "./components.ts";

export function renderFallback(host: HTMLElement, name: string): () => void {
  const component = COMPONENTS[name];
  if (!component) throw new Error(`demo: no component named ${name}`);
  return render(component as never, host);
}
