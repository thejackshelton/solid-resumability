// A store factory of the shape the pass reads: one function, one return, an
// array literal whose second slot is an object of statically named actions.
// Nothing here is evaluated by the pass — only the slot shape is read.

export function createShelf() {
  const books: string[] = [];

  const actions = {
    shelveBook(title: string) {
      books.push(title);
    },
    clearShelf() {
      books.length = 0;
    },
  };

  return [books, actions] as const;
}
