/**
 * Page-side re-export of the installed package's own functions.
 *
 * Not a JSX wrapper: the bindings are the package's `Root` / `List` /
 * `Trigger` / `Content`. The classic path imports this file; the
 * provider module imports the library directly so the eager entry never
 * names it.
 */
export { Content as TabsContent, List as TabsList, Root as TabsRoot, Trigger as TabsTrigger } from "@kobalte/core/tabs";
