// The other half of the claim protocol, under this corpus own names: one
// function that builds a mount element from an emitted template (the capture
// path only — a shipped page finds its mounts in the document), and one that
// offers a live element to the substituted mount point that claims it.
//
// Consumer code. The plugin only needs to know the two names and where they
// live, which is what `group.glue` says.

let lent: HTMLElement | null = null;

export function buildShelfMount(html: string): HTMLElement {
  const mount = document.createElement("div");
  mount.innerHTML = html;
  return mount;
}

export function lendShelfMount(mount: HTMLElement): void {
  lent = mount;
}

export function takeShelfMount(): HTMLElement | null {
  const mount = lent;
  lent = null;
  return mount;
}
