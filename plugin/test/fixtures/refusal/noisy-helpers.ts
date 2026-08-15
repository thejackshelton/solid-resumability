// Deliberately impure: IO cannot avoid naming a global, so the pass produces
// no summary for either of these and an accessor handed to one is an escape
// into a black box. That is the refusal the fixture next door carries.

export type Accessor<T> = () => T;

export function reportCount(read: Accessor<number>): void {
  console.log("count", read());
}
