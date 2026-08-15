// The ordinary renderer, standing in for a framework: the thing behind the
// branch, and the whole reason the branch is a dynamic import.

export function renderFallback(name: string): string {
  return `rendered ${name} the ordinary way`;
}
