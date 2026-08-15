/**
 * The resumable variant of the todos page.
 *
 * The classic entry renders the app. This one does not render anything: the
 * page is served with its first paint in the document (captured at build time
 * by the plugin's prerender stage, `plugin/src/stages/prerender.ts`), and all
 * this entry does is take that markup
 * over — resume `Header` against the served mount, and install the listeners
 * that will import the rest of the page on the first interaction. See
 * `src/todos-resume.ts` for what that costs and `src/todos-group.ts` for what
 * it defers.
 *
 * `render` is not imported here, and neither is `App`: on this page they are
 * inside the deferred group, and the whole claim is that nothing fetches them
 * until a user does something.
 */

// The app's own stylesheet, imported rather than linked because the demo's
// vite root is `demo/` and the file lives in `app/`. Byte-identical content.
import "../../../app/src/app.css";
// Demo-only overlay: see `src/styles/todos-overlay.css`.
import "../styles/todos-overlay.css";

import { bootstrap } from "../todos-resume.ts";

const root = document.getElementById("root")!;
const page = bootstrap(root);

if (import.meta.env.DEV && !page) {
  // The dev server has no prerendered shell: the capture that produces one
  // runs over the built output, which does not exist yet. Render the group
  // directly so the page is still the page. Compiled away in the build, where
  // an empty `#root` would be a broken build rather than a missing step.
  void import("../todos-group.ts").then((module) => module.execute(root));
}
