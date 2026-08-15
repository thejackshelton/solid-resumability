// Helper module for the escape fixtures whose helpers are deliberately impure.
//
// `signal-helpers.ts` next door holds helpers that `summaries.ts` *can* prove,
// which is why the components using it flipped provable in T007. Everything
// here does IO instead, and IO cannot avoid naming a global — so no summary is
// ever produced for these, and an accessor handed to one of them is an escape
// into a black box.

export type Accessor<T> = () => T;
export type Setter<T> = (value: T) => void;

export function logCount(read: Accessor<number>): void {
  console.log("count", read());
}

export function makeNoisyIncrement(read: Accessor<number>, write: Setter<number>): () => void {
  return () => {
    console.log("step", read());
    write(read() + 1);
  };
}
