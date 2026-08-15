// Mounts a component declared in another module.

import { createShelf } from "../shared/shelf-store";
import { DepotContext, DepotToolbar } from "./depot-toolbar";

export function DepotPage() {
  return (
    <DepotContext value={createShelf()}>
      <section class="depot">
        <DepotToolbar />
      </section>
    </DepotContext>
  );
}
