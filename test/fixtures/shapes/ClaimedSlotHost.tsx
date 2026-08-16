// @ts-nocheck — counters name unresolved identifiers on purpose.
import { createSignal, useContext } from "solid-js";

import { ShelfContext } from "./object-store-context";

/**
 * First-party hosts for claimed-child slot-valued, proven-handler, and
 * ref-array records. A child that owns a cell (so inlining cannot take
 * it) and rest-spreads its props. Nothing here names a library.
 */

function relay(event: Event, next?: (event: Event) => void) {
  if (next) next(event);
}

function SlotInner(props: Record<string, unknown>) {
  const [n, setN] = createSignal(0);
  return <button class="slot" {...props} />;
}

export function SlotValuedHost() {
  const ctx = useContext(ShelfContext);
  return <SlotInner aria-expanded={ctx.isOpen() ? "true" : "false"} />;
}

export function SlotValuedUnseen() {
  const ctx = useContext(ShelfContext);
  return <SlotInner aria-expanded={ctx.isOpen() ? "open" : "shut"} />;
}

export function SlotValuedMixedFree() {
  const ctx = useContext(ShelfContext);
  return <SlotInner aria-expanded={ctx.isOpen() ? unbound : "false"} />;
}

export function SlotValuedRefusedStore() {
  let ctx = useContext(ShelfContext);
  ctx = { isOpen: () => false, toggle: () => {}, setAnchor: () => {} };
  return <SlotInner aria-expanded={ctx.isOpen() ? "true" : "false"} />;
}

export function SlotValuedTwiceHost() {
  const ctx = useContext(ShelfContext);
  return (
    <div>
      <SlotInner aria-expanded={ctx.isOpen() ? "true" : "false"} />
      <SlotInner aria-expanded={ctx.isOpen() ? "yes" : "no"} />
    </div>
  );
}

export function ProvenHandlerHost() {
  const ctx = useContext(ShelfContext);
  const onClick = (e: Event) => {
    relay(e);
    ctx.toggle();
  };
  return <SlotInner onClick={onClick} />;
}

export function ProvenHandlerExtra() {
  const ctx = useContext(ShelfContext);
  const onClick = (e: Event) => {
    relay(e);
    ctx.toggle();
    extra();
  };
  return <SlotInner onClick={onClick} />;
}

export function ProvenHandlerFree() {
  const ctx = useContext(ShelfContext);
  const onClick = (e: Event) => {
    relay(e, stray);
    ctx.toggle();
  };
  return <SlotInner onClick={onClick} />;
}

export function ProvenHandlerUnresolvedCallee() {
  const ctx = useContext(ShelfContext);
  const onClick = (e: Event) => {
    missingHelper(e);
    ctx.toggle();
  };
  return <SlotInner onClick={onClick} />;
}

export function RefArrayHost(props: { handle?: unknown }) {
  const ctx = useContext(ShelfContext);
  return <SlotInner ref={[ctx.setAnchor, props.handle]} />;
}

export function RefArrayComputed(props: { handle?: unknown }) {
  const ctx = useContext(ShelfContext);
  const key = "setAnchor";
  return <SlotInner ref={[ctx[key], props.handle]} />;
}

export function RefArrayNonSlot(props: { handle?: unknown }) {
  const ctx = useContext(ShelfContext);
  return <SlotInner ref={[ctx.setAnchor, 1]} />;
}

export function RefArraySpread(props: { handle?: unknown }) {
  const ctx = useContext(ShelfContext);
  return <SlotInner ref={[...[ctx.setAnchor], props.handle]} />;
}

/** Live pairing the gate mounts. Not a classify target. */
export function SlotValuedUnseenLive() {
  return <button class="unseen-slot">ok</button>;
}

/** First-instantiation live pairing the lying variant republishes. */
export function SlotValuedSeenLive() {
  return <button class="seen-slot">ok</button>;
}
