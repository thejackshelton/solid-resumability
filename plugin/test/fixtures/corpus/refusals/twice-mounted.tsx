// The same component mounted twice. One set of artifacts describes one
// element, so which of the two the claim would take is not decidable.

import { createContext, useContext } from "solid-js";
import { createShelf } from "../shared/shelf-store";

const CaseContext = createContext<ReturnType<typeof createShelf>>();

function CaseToolbar() {
  const [, { shelveBook }] = useContext(CaseContext);
  return (
    <div class="case-toolbar">
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

export function CasePage() {
  return (
    <CaseContext value={createShelf()}>
      <section class="case">
        <CaseToolbar />
        <CaseToolbar />
      </section>
    </CaseContext>
  );
}
