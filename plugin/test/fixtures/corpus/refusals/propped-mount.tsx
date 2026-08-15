// A mount point that carries a prop. The artifacts model no props, so a
// resumed element cannot receive one and the substituter has to say so.

import { createContext, useContext } from "solid-js";
import { createShelf } from "../shared/shelf-store";

const CrateContext = createContext<ReturnType<typeof createShelf>>();

function CrateToolbar() {
  const [, { shelveBook }] = useContext(CrateContext);
  return (
    <div class="crate-toolbar">
      <button
        onClick={() => {
          shelveBook("untitled");
        }}
      >
        Shelve
      </button>
    </div>
  );
}

export function CratePage() {
  return (
    <CrateContext value={createShelf()}>
      <section class="crate">
        <CrateToolbar tone="quiet" />
      </section>
    </CrateContext>
  );
}
