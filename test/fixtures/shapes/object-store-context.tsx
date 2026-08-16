import { createContext, useContext } from "solid-js";

/**
 * First-party object-shaped context, the guard-throw helper that returns
 * it, and the single visible provider. Structural only — no library name.
 */

type ShelfValue = {
  isOpen: () => boolean;
  toggle: () => void;
  setAnchor: (_el: unknown) => void;
};

export const ShelfContext = createContext<ShelfValue>({
  isOpen: () => false,
  toggle: () => {},
  setAnchor: (_el: unknown) => {},
});

const shelfValue: ShelfValue = {
  isOpen: () => false,
  toggle: () => {},
  setAnchor: (_el: unknown) => {},
};

export function ShelfProvider() {
  return (
    <ShelfContext value={shelfValue}>
      <span />
    </ShelfContext>
  );
}

export function useShelf() {
  const x = useContext(ShelfContext);
  if (x == null) throw new Error("missing");
  return x;
}
