// The app root `start: true` requires.
//
// `resolveEntries` in @solidjs/vite-plugin@3.0.0-next.28 (dist/esm/index.mjs
// :1251) probes `src/App.*` when no `start.app` is given and no
// `src/entry-client.*` exists, and throws without one. So this file is the
// minimum a start-mode project has to have, and it is here for that reason
// alone — the plain arm never loads it.
import { Counter } from "./Counter.tsx";

export default function App() {
  return (
    <div id="root">
      <div class="mount" data-component="Counter" data-resume="Counter">
        <Counter />
      </div>
    </div>
  );
}
