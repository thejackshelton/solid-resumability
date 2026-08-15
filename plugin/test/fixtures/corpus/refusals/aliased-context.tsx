// The context is imported under a local alias, so the name the analysis knows
// it by is not a name this module has. Synthesizing the claim argument from
// the analysis would emit an identifier nothing here binds.

import { useContext } from "solid-js";
import { AisleContext as Aisle } from "./aisle-context";
import { createShelf } from "../shared/shelf-store";

function AisleToolbar() {
  const [, { shelveBook }] = useContext(Aisle);
  return (
    <div class="aisle-toolbar">
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

export function AislePage() {
  return (
    <Aisle value={createShelf()}>
      <section class="aisle">
        <AisleToolbar />
      </section>
    </Aisle>
  );
}
