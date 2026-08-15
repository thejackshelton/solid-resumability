// The component another module mounts. Substituting it would mean rewriting
// two modules at once, which this phase declines rather than half-supports.

import { createContext, useContext } from "solid-js";
import { createShelf } from "../shared/shelf-store";

export const DepotContext = createContext<ReturnType<typeof createShelf>>();

export function DepotToolbar() {
  const [, { shelveBook }] = useContext(DepotContext);
  return (
    <div class="depot-toolbar">
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
