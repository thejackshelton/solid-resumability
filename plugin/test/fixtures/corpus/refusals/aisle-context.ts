// The context lives here; the module that mounts the component imports it
// under another name.

import { createContext } from "solid-js";

import type { createShelf } from "../shared/shelf-store";

export const AisleContext = createContext<ReturnType<typeof createShelf>>();
