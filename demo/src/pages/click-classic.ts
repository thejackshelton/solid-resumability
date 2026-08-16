// Entry point of the click page, classic variant. `click.html` names this
// file; the resumable build rewrites that one attribute to point at
// `click-resumable.ts` instead.
import { render } from "@solidjs/web";

import { ButtonRoot } from "../click-mount.ts";

function onClick() {
  document.querySelector("[data-click-sentinel]")?.setAttribute("data-clicked", "1");
}

for (const host of document.querySelectorAll<HTMLElement>("[data-component]")) {
  host.replaceChildren();
  render(() => ButtonRoot({ type: "button", id: "click-root", onClick }), host);
}
