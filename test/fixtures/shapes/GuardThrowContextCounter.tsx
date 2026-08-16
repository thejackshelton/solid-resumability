import { useBoxDifferent, useBoxExtra, useBoxNoThrow } from "./guard-throw-context";

/**
 * Counters for the guard-throw context-helper grammar. Each one keeps
 * every clause except one. Nothing here names a library component.
 */

export function GuardThrowExtraStatement() {
  useBoxExtra();
  return <p class="extra">ok</p>;
}

export function GuardThrowDifferentBinding() {
  useBoxDifferent();
  return <p class="different">ok</p>;
}

export function GuardThrowNoThrow() {
  useBoxNoThrow();
  return <p class="nothrow">ok</p>;
}
