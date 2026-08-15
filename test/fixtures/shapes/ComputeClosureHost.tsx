import { createSignal, merge, omit } from "solid-js";

/**
 * First-party host for the compute-closure gate. Two shapes, no library
 * name: a zero-argument call of a summarized derived accessor, and a
 * member read of a derived/rest-props result whose slot is named for the
 * member, not the object.
 */

function ownCell(get: () => number) {
  const [value, setValue] = createSignal(0);
  get();
  return value;
}

type HostProps = { mode?: string; extra?: string };

/** Honest pairing: both unclosed-compute shapes on one standalone host. */
export function ComputeClosureHost(props: HostProps = {}) {
  const [n, setN] = createSignal(0);
  const merged = merge({ mode: "wide" } as const, props);
  const others = omit(merged, "mode");
  const label = ownCell(n);
  return (
    <p data-label={label() !== 0 ? "on" : undefined} data-mode={merged.mode} {...others}>
      <button class="bump" onClick={() => setN(n() + 1)}>
        +
      </button>
    </p>
  );
}
