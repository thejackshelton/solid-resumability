import { useBox, useBoxVoid } from "./guard-throw-context";

/**
 * First-party hosts for the guard-throw context-helper grammar.
 * Static markup; the helper is the only declared source. Nothing here
 * names a library component.
 */

export function GuardThrowContextHost() {
  useBox();
  return <p class="seen">ok</p>;
}

/** Second instantiation: the same shape, class the build did not see first. */
export function GuardThrowContextUnseen() {
  useBox();
  return <p class="unseen">ok</p>;
}

/** Dist-shaped void test, same grammar. */
export function GuardThrowContextVoidHost() {
  useBoxVoid();
  return <p class="void">ok</p>;
}
