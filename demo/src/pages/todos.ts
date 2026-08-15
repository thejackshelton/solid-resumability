/**
 * Entry point of the todos page — identical in both variants.
 *
 * `app/src/app.tsx` and its two modules are imported unchanged from the frozen
 * corpus; the build swaps exactly one of their imports (`./api`) for the demo
 * mock, and adds one stylesheet on top of the app's own. All five of the app's
 * components are classified `fallback`, so there is nothing here for the
 * resume path to do and this page is the same bytes in both builds.
 */

import { render } from "@solidjs/web";

// The app's own stylesheet, imported rather than linked because the demo's
// vite root is `demo/` and the file lives in `app/`. Byte-identical content.
import "../../../app/src/app.css";
// Demo-only overlay: see `src/styles/todos-overlay.css`.
import "../styles/todos-overlay.css";

import { App } from "../../../app/src/app";

render(App as never, document.getElementById("root")!);
