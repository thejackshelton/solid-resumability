import { createContext, useContext } from "solid-js";

/**
 * Guard-throw context helper and the near-misses the grammar refuses.
 * Structural only — no library helper name.
 */

export const BoxContext = createContext({ label: "x" });

export function useBox() {
  const x = useContext(BoxContext);
  if (x == null) throw new Error("missing");
  return x;
}

export function useBoxVoid() {
  const x = useContext(BoxContext);
  if (x === void 0) throw new Error("missing");
  return x;
}

export function useBoxExtra() {
  const x = useContext(BoxContext);
  const unused = 0;
  if (x == null) throw new Error("missing");
  return x;
}

export function useBoxDifferent() {
  const x = useContext(BoxContext);
  if (x == null) throw new Error("missing");
  return BoxContext;
}

export function useBoxNoThrow() {
  const x = useContext(BoxContext);
  if (x == null) return x;
  return x;
}
