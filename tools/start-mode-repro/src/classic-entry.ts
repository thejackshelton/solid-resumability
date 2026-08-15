// The entry `index.html` names, and the one half of the entry swap the
// resumability plugin's HTML stage is asked to replace.
//
// A page that comes up carrying THIS specifier was never rewritten.
import { render } from "@solidjs/web";

import { Counter } from "./Counter.tsx";

const mount = document.querySelector('[data-resume="Counter"]');
if (mount) render(Counter as never, mount as HTMLElement);
