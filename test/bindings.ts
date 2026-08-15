import type { BindingInfo, TextBindingInfo } from "../src/comptime/types.ts";

/**
 * The text arm of a binding, asserted rather than assumed.
 *
 * `BindingInfo` gained an attribute arm and a class arm, so a test that reads
 * `expression` or `initialText` is a test ABOUT a text binding and now says so.
 * The throw is the point: it fails where the assumption broke, not three
 * assertions later on an `undefined`.
 */
export function textBinding(binding: BindingInfo): TextBindingInfo {
  if (binding.kind !== "text") {
    throw new Error(`expected a text binding, got a ${binding.kind} one`);
  }
  return binding;
}
