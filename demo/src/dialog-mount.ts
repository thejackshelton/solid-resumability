/**
 * Page-side re-export of the installed package's own functions.
 *
 * Not a JSX wrapper: the bindings are the package's `Root` / `Trigger` /
 * `Content`. The plugin classifies the defining module (see `DIALOG` in
 * `build/fixtures.mjs`); this file is what the classic path imports.
 */
export { Root as DialogRoot, Trigger as DialogTrigger, Content as DialogContent } from "@kobalte/core/dialog";
