/**
 * Page-side re-export of the installed package's own function.
 *
 * Not a JSX wrapper: the binding is the package's `Root` (`ButtonRoot`).
 * The plugin classifies the defining module (see `CLICK` in
 * `build/fixtures.mjs`); this file is what the classic path imports.
 */
export { Root as ButtonRoot } from "@kobalte/core/button";
