/**
 * Page-side re-export of the installed package's own function.
 *
 * Not a JSX wrapper: the binding is the package's `Root` (`SeparatorRoot`).
 * The plugin classifies the defining module (see `RULE` in
 * `build/fixtures.mjs`); this file is what the classic path imports.
 */
export { Root as SeparatorRoot } from "@kobalte/core/separator";
