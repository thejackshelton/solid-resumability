/**
 * The accessor S6's guard reads, and the module the analyzed set never contains.
 *
 * `armed` is module-scope mutable state, so `gateOpen` has no value a build could
 * fold even if this file WERE analyzed: what it answers depends on whether
 * something called `arm()` first, and when. That second property is what keeps
 * S6's terminal claim from resting on the file-set edge alone.
 */
let armed = false;

export function arm(): void {
  armed = true;
}

export function gateOpen(): boolean {
  return armed;
}
