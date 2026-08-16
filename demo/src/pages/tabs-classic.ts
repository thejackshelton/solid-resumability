// Entry point of the tabs page, classic variant. `tabs.html` names this
// file; the resumable build rewrites that one attribute to point at
// `tabs-resumable.ts` instead.
import { render } from "@solidjs/web";

import { TabsContent, TabsList, TabsRoot, TabsTrigger } from "../tabs-mount.ts";

const live = document.querySelector<HTMLElement>("[data-tabs-live]");
if (!live) throw new Error("tabs: the served page has no [data-tabs-live] region");

render(
  () =>
    TabsRoot({
      defaultValue: "profile",
      children: () => [
        TabsList({
          children: () => [
            TabsTrigger({ value: "profile", children: () => "Profile" }),
            TabsTrigger({ value: "settings", children: () => "Settings" }),
          ],
        }),
        TabsContent({ value: "profile", children: () => "Profile panel" }),
        TabsContent({ value: "settings", children: () => "Settings panel" }),
      ],
    }),
  live,
);
