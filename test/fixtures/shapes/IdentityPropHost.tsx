import { createSignal } from "solid-js";

/**
 * First-party hosts for the identity-prop admission.
 *
 * A child that owns a cell (so inlining cannot take it) and reads one
 * props-parameter member as measured text. Parents pass either identity-class
 * cargo or a signal getter. Nothing here names a library.
 */

function IdentityInner(props: { cargo: string }) {
  const [n, setN] = createSignal(0);
  return <span class="identity">{props.cargo}</span>;
}

function IdentityClassInner(props: { cargo: string }) {
  const [n, setN] = createSignal(0);
  return <span class={props.cargo}>ok</span>;
}

/** Counter-instantiation: a signal getter is not an identity-class binding. */
export function IdentityPropHost() {
  const [cargo, setCargo] = createSignal("nope");
  return <IdentityInner cargo={cargo as never} />;
}

/** Honest pairing: the parent forwards its own-props cargo by identity. */
export function IdentityForwardHost(props: { cargo: string }) {
  const [n, setN] = createSignal(0);
  return <IdentityInner cargo={props.cargo} />;
}

/** Identifier rest-spread of a derived/rest-props result. */
export function IdentityRestHost(props: { cargo: string; extra: string }) {
  const [n, setN] = createSignal(0);
  const { extra, ...rest } = props;
  return <IdentityInner {...rest} />;
}

/** Template-byte use: identity cargo as a class attribute. */
export function IdentityClassHost(props: { cargo: string }) {
  const [n, setN] = createSignal(0);
  return <IdentityClassInner cargo={props.cargo} />;
}

/** Two addresses of the same child with different identity records. */
export function IdentityTwiceHost(props: { cargo: string; other: string }) {
  const [n, setN] = createSignal(0);
  return (
    <div>
      <IdentityInner cargo={props.cargo} />
      <IdentityInner cargo={props.other} />
    </div>
  );
}

/** Live pairing the gate mounts. Not a classify target. */
export function IdentityUnseenLive() {
  return <IdentityForwardHost cargo="unseen-runtime-cargo" />;
}

/** First-instantiation live pairing the lying variant republishes. */
export function IdentitySeenLive() {
  return <IdentityForwardHost cargo="seen-runtime-cargo" />;
}
