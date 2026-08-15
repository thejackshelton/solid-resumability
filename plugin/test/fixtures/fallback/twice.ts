// Two dynamic imports of one specifier: the shape the stage refuses, because
// which of them is THE fallback branch is not decidable from a specifier.

export async function first(): Promise<unknown> {
  return import('./renderer.ts');
}

export async function second(): Promise<unknown> {
  return import('./renderer.ts');
}
