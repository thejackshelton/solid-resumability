/**
 * The live TabsRoot, behind the tabs page's one provider `import()`.
 *
 * A miss on the store registry starts that import. This module mounts the
 * library's own body into the page-owned live region and publishes the
 * context value that body created — by identity, under the page-owned
 * store id. The page never constructs a context object, listState,
 * SelectionManager, or DomCollectionProvider.
 */

import { render } from "@solidjs/web";
import { Content as TabsContent, List as TabsList, Root as TabsRoot, Trigger as TabsTrigger, useTabsContext } from "@kobalte/core/tabs";

import { stores, TABS_STORE_ID } from "./tabs-page.ts";

let provided = false;
let mounted = false;

function TabsGlue() {
  const context = useTabsContext();
  stores.provide(TABS_STORE_ID, context);
  provided = true;
  return [
    TabsList({
      children: () => [
        TabsTrigger({ value: "profile", children: () => "Profile" }),
        TabsTrigger({ value: "settings", children: () => "Settings" }),
      ],
    }),
    TabsContent({ value: "profile", children: () => "Profile panel" }),
    TabsContent({ value: "settings", children: () => "Settings panel" }),
  ];
}

export function mountProvider(root: ParentNode = document): void {
  if (mounted) return;
  const live = root.querySelector<HTMLElement>("[data-tabs-live]");
  if (!live) throw new Error("tabs: the served page has no [data-tabs-live] region");
  render(
    () =>
      TabsRoot({
        defaultValue: "profile",
        children: () => TabsGlue(),
      }),
    live,
  );
  mounted = true;
  if (!provided) {
    throw new Error("tabs: the live TabsRoot did not run the page-owned glue");
  }
}
