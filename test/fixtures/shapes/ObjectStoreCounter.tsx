import { createContext, useContext } from "solid-js";

import { ShelfContext } from "./object-store-context";

/**
 * Counters for whole-bound object-shaped context. Each one keeps every
 * clause except one. Nothing here names a library component.
 */

export function ObjectStoreReassigned() {
  let ctx = useContext(ShelfContext);
  ctx = { isOpen: () => false, toggle: () => {}, setAnchor: () => {} };
  return <button class="reassigned">ok</button>;
}

export function ObjectStoreComputed() {
  const ctx = useContext(ShelfContext);
  const key = "toggle";
  return <button class="computed">{ctx[key] ? "ok" : "no"}</button>;
}

export function ObjectStoreBareEscape() {
  const ctx = useContext(ShelfContext);
  void ctx;
  return <button class="bare">ok</button>;
}

export function ObjectStoreRefCapture() {
  const ctx = useContext(ShelfContext);
  const r = (_el: unknown) => {};
  return <div class="ref" ref={[ctx.setAnchor, r]} />;
}

const SpreadContext = createContext({ toggle: () => {} });
const spreadBase = { toggle: () => {} };

export function ObjectStoreSpreadProvider() {
  const ctx = useContext(SpreadContext);
  return <button class="spread">ok</button>;
}

export function ObjectStoreSpreadShell() {
  return (
    <SpreadContext value={{ ...spreadBase }}>
      <span />
    </SpreadContext>
  );
}

const TwoContext = createContext({ toggle: () => {} });
const twoValue = { toggle: () => {} };

export function ObjectStoreTwoProviders() {
  const ctx = useContext(TwoContext);
  return <button class="two">ok</button>;
}

export function ObjectStoreTwoProviderA() {
  return (
    <TwoContext value={twoValue}>
      <span />
    </TwoContext>
  );
}

export function ObjectStoreTwoProviderB() {
  return (
    <TwoContext value={twoValue}>
      <span />
    </TwoContext>
  );
}

const BuiltContext = createContext({ toggle: () => {} });

function buildValue() {
  return { toggle: () => {} };
}

export function ObjectStorePageBuilt() {
  const ctx = useContext(BuiltContext);
  return <button class="built">ok</button>;
}

export function ObjectStorePageBuiltShell() {
  return (
    <BuiltContext value={buildValue()}>
      <span />
    </BuiltContext>
  );
}
