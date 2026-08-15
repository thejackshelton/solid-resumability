// A composition two deep with a shared child, which is the shape the
// derivation's visited set exists for.
//
// `Trunk` addresses `Branch` AND `Leaf`; `Branch` addresses `Leaf` as well. So
// `Leaf` is reached twice by two different routes, at two different depths, and
// must be emitted exactly once — the same guarantee that ends the walk if a
// tree ever comes back with a genuine cycle in it. A true mutual pair cannot be
// written: the classifier refuses the second hop by name, which leaves the
// inner component holding an unaddressable component element and therefore not
// provable, so the outer one has nothing to claim. This is the deepest tangle
// source can actually express.
//
// Each declares a cell of its own on purpose: a component that only composes is
// refused `no-signal-source`, and a fixture refused for the wrong reason proves
// nothing about the right one.
import { createSignal } from "solid-js";

export function Leaf() {
  const [leaf, setLeaf] = createSignal(0);

  return (
    <div>
      <span data-testid="grove-leaf-label">{"leaf: " + leaf()}</span>
      <button data-testid="grove-leaf-inc" onClick={() => setLeaf(leaf() + 1)}>
        +
      </button>
    </div>
  );
}

export function Branch() {
  const [branch, setBranch] = createSignal(0);

  return (
    <div>
      <span data-testid="grove-branch-label">{"branch: " + branch()}</span>
      <button data-testid="grove-branch-inc" onClick={() => setBranch(branch() + 1)}>
        +
      </button>
      <Leaf />
    </div>
  );
}

export function Trunk() {
  const [trunk, setTrunk] = createSignal(0);

  return (
    <div>
      <span data-testid="grove-trunk-label">{"trunk: " + trunk()}</span>
      <button data-testid="grove-trunk-inc" onClick={() => setTrunk(trunk() + 1)}>
        +
      </button>
      <Branch />
      <Leaf />
    </div>
  );
}
