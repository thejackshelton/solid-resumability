// Entry point of the rule page, classic variant. `rule.html` names this
// file; the resumable build rewrites that one attribute to point at
// `rule-resumable.ts` instead.
import { render } from "@solidjs/web";

import { SeparatorRoot } from "../rule-mount.ts";

for (const host of document.querySelectorAll<HTMLElement>("[data-component]")) {
  host.replaceChildren();
  render(() => SeparatorRoot({ orientation: "vertical", id: "rule-root" }), host);
}
