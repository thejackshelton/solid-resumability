// The glue a rewritten module imports: the function its mount point calls to
// publish the live store and claim the element already carrying the resumed
// component. Consumer code — the plugin only needs to know its name and where
// it lives.

export function claimShelfToolbar(shelf: unknown): unknown {
  return shelf;
}
