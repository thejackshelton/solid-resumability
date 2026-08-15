/**
 * Demo stand-in for `app/src/api.ts`.
 *
 * The real module is a *fault injector*: it sleeps 400 ms per call and rejects
 * roughly a third of all saves at random, so the app's `<Loading>` fallbacks,
 * optimistic rollbacks and per-todo retry buttons are visible without anyone
 * having to break anything. That suits the app and defeats a measurement: a
 * random rejection would change what a page does between two runs.
 *
 * This file re-implements the same six methods, with the same signatures
 * and the same `localStorage` persistence, minus the delay and minus the
 * random failure. `app/src/api.ts` is not edited, not copied over and not
 * patched: the build swaps the module (see `apiMock()` in
 * `demo/build/plugins.mjs`), which is the only difference between the todos
 * page here and the todos page in `app/`.
 */

export interface Todo {
  id: string;
  title: string;
  completed: boolean;
}

const KEY = "TODOS";

function getTodos(): Todo[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]") as Todo[];
  } catch {
    return [];
  }
}

/** Resolved, not deferred: no timers, so a click settles on the microtask queue. */
function saveTodos(todos: Todo[]): Promise<void> {
  localStorage.setItem(KEY, JSON.stringify(todos));
  return Promise.resolve();
}

/** Test seam: the demo page never calls this, the todos test always does. */
export function resetTodos(seed: Todo[] = []): void {
  localStorage.setItem(KEY, JSON.stringify(seed));
}

export const api = {
  getTodos(): Promise<Todo[]> {
    return Promise.resolve(getTodos());
  },
  async addTodo(todo: Todo): Promise<Todo> {
    const newTodo = { ...todo };
    const todos = getTodos();
    const index = todos.findIndex(t => t.id > newTodo.id);
    if (index > -1) todos.splice(index, 0, newTodo);
    else todos.push(newTodo);
    await saveTodos(todos);
    return newTodo;
  },
  async removeTodo(todoId: string): Promise<void> {
    return saveTodos(getTodos().filter(t => t.id !== todoId));
  },
  async toggleTodo(todoId: string, completed: boolean): Promise<Todo> {
    let found: Todo | undefined;
    const todos = getTodos().map(t => {
      if (t.id !== todoId) return t;
      return (found = { ...t, completed });
    });
    if (!found) throw "Failed to Save";
    await saveTodos(todos);
    return found;
  },
  async toggleAll(ids: string[], completed: boolean): Promise<void> {
    const set = new Set(ids);
    return saveTodos(getTodos().map(t => (set.has(t.id) ? { ...t, completed } : t)));
  },
  async clearCompleted(ids: string[]): Promise<void> {
    const set = new Set(ids);
    return saveTodos(getTodos().filter(t => !set.has(t.id)));
  }
};
