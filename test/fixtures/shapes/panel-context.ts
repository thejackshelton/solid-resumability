import { createContext, useContext } from "solid-js";

/**
 * The context S5's leaf reads through, and the LOCAL WRAPPER that is the whole
 * point of the shape.
 *
 * `usePanel` is an ordinary convenience: one place that knows which context
 * carries the panel handle. It is also the thing that makes a leaf's context
 * read invisible to the pass, because the leaf's own module then imports no
 * `useContext` from Solid at all and the search for one comes back empty.
 */
export interface PanelHandle {
  id: string;
  release: () => void;
}

export const PanelContext = createContext<PanelHandle>();

export function usePanel(): PanelHandle {
  return useContext(PanelContext);
}
