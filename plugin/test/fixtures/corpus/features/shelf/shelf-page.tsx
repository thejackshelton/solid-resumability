// The synthetic corpus case: a different component name, a different context
// name and a deeper directory than the application this pipeline was extracted
// from. A substituter shaped to the analysis passes both; one shaped to that
// application passes only its own.

import { createContext, useContext } from "solid-js";
import { createShelf } from "../../shared/shelf-store";

const ShelfContext = createContext<ReturnType<typeof createShelf>>();

function ShelfToolbar() {
  const [, { shelveBook }] = useContext(ShelfContext);
  return (
    <div class="shelf-toolbar">
      <button
        class="shelve"
        onClick={() => {
          shelveBook("untitled");
        }}
      >
        Shelve
      </button>
    </div>
  );
}

export function ShelfPage() {
  return (
    <ShelfContext value={createShelf()}>
      <section class="shelf">
        <ShelfToolbar />
      </section>
    </ShelfContext>
  );
}
