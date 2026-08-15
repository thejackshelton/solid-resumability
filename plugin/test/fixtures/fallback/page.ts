// A page module shaped like the one this stage exists for: resume what has
// artifacts, and reach the ordinary renderer through ONE dynamic import for
// anything that does not. The static import beside it is the control — a
// module the branch also needs, reached the ordinary way, which omission must
// leave exactly where it is.

import { hosts } from './hosts.ts';

export async function mount(pending: string[]): Promise<number> {
  if (pending.length === 0) return hosts().length;

  const { renderFallback } = await import('./renderer.ts');
  for (const name of pending) renderFallback(name);
  return pending.length;
}
