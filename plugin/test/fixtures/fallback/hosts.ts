// Reached statically, and therefore none of omission's business: the stage
// rewrites one branch, not every specifier that happens to be nearby.

export function hosts(): string[] {
  return ['a', 'b'];
}
