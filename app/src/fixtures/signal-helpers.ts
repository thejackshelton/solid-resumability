// Helper module for the escape fixtures: everything defined here is, by
// construction, outside the analysed component's module.

export type Accessor<T> = () => T;
export type Setter<T> = (value: T) => void;

export function formatCount(read: Accessor<number>): string {
  return `count: ${read()}`;
}

export function makeIncrement(read: Accessor<number>, write: Setter<number>): () => void {
  return () => write(read() + 1);
}
