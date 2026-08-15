// Deterministic stand-in for `src/api.ts`.
//
// The real module persists to `localStorage`, sleeps 400 ms per call and
// rejects ~33% of saves at random. None of that can be asserted against, so
// tests swap the whole module through `vi.mock` (see `harness.tsx`). The app
// source is never touched: this file reimplements the same six methods with
// the same shapes, resolving on the microtask queue and failing only when a
// test asks it to.

import type { Todo } from "../src/api";

export interface ApiState {
  todos: Todo[];
  /** Number of upcoming write calls that must reject. */
  failWrites: number;
  /** Call log, for asserting that an action actually reached the API. */
  calls: string[];
}

export const apiState: ApiState = { todos: [], failWrites: 0, calls: [] };

export function resetApi(seed: Todo[] = []): void {
  apiState.todos = seed.map(todo => ({ ...todo }));
  apiState.failWrites = 0;
  apiState.calls = [];
}

export function failNextWrites(count: number): void {
  apiState.failWrites = count;
}

function shouldFail(): boolean {
  if (apiState.failWrites <= 0) return false;
  apiState.failWrites -= 1;
  return true;
}

function save(todos: Todo[]): Promise<void> {
  if (shouldFail()) return Promise.reject("Failed to Save");
  apiState.todos = todos.map(todo => ({ ...todo }));
  return Promise.resolve();
}

export const mockApi = {
  getTodos(): Promise<Todo[]> {
    apiState.calls.push("getTodos");
    return Promise.resolve(apiState.todos.map(todo => ({ ...todo })));
  },
  async addTodo(todo: Todo): Promise<Todo> {
    apiState.calls.push(`addTodo:${todo.id}`);
    const newTodo = { ...todo };
    const todos = apiState.todos.map(t => ({ ...t }));
    const index = todos.findIndex(t => t.id > newTodo.id);
    if (index > -1) todos.splice(index, 0, newTodo);
    else todos.push(newTodo);
    await save(todos);
    return newTodo;
  },
  async removeTodo(todoId: string): Promise<void> {
    apiState.calls.push(`removeTodo:${todoId}`);
    return save(apiState.todos.filter(t => t.id !== todoId));
  },
  async toggleTodo(todoId: string, completed: boolean): Promise<Todo> {
    apiState.calls.push(`toggleTodo:${todoId}:${completed}`);
    let found: Todo | undefined;
    const todos = apiState.todos.map(t => {
      if (t.id !== todoId) return { ...t };
      return (found = { ...t, completed });
    });
    if (!found) throw "Failed to Save";
    await save(todos);
    return found;
  },
  async toggleAll(ids: string[], completed: boolean): Promise<void> {
    apiState.calls.push(`toggleAll:${ids.join(",")}:${completed}`);
    const set = new Set(ids);
    return save(apiState.todos.map(t => (set.has(t.id) ? { ...t, completed } : { ...t })));
  },
  async clearCompleted(ids: string[]): Promise<void> {
    apiState.calls.push(`clearCompleted:${ids.join(",")}`);
    const set = new Set(ids);
    return save(apiState.todos.filter(t => !set.has(t.id)));
  }
};
