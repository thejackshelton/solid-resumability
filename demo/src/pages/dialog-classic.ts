// Entry point of the dialog page, classic variant. `dialog.html` names this
// file; the resumable build rewrites that one attribute to point at
// `dialog-resumable.ts` instead.
import { render } from "@solidjs/web";

import { DialogContent, DialogRoot, DialogTrigger } from "../dialog-mount.ts";

const live = document.querySelector<HTMLElement>("[data-dialog-live]");
if (!live) throw new Error("dialog: the served page has no [data-dialog-live] region");

render(
  () =>
    DialogRoot({
      children: () => [
        DialogTrigger({ children: () => "Open" }),
        DialogContent({ children: () => "Dialog content" }),
      ],
    }),
  live,
);
