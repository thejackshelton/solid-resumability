/**
 * A locator is a path of child indices from the component's root element: `"/"`
 * is the root, `"/1"` its second element child, `"/1/0"` that child's first.
 * `test/parity.test.tsx` proves the served markup is byte-identical to what
 * `render()` produces, which is what makes an index-based address safe — no
 * whitespace-only text nodes and no framework marker nodes to shift indices.
 */

export function locate(root: Element, locator: string): Element {
  const segments = locator.split("/").filter(Boolean);

  let node: Element = root;
  for (const segment of segments) {
    const index = Number(segment);
    const next = node.children[index];
    if (!next) {
      throw new Error(`resume: locator ${locator} does not address a node (no child ${index} of <${node.tagName.toLowerCase()}>)`);
    }
    node = next;
  }
  return node;
}
