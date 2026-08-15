// Shared mount / settle helpers: render into a detached host, `flush()` after
// every interaction, dispose everything in `afterEach`.

import { render } from "@solidjs/web";
import { flush } from "solid-js";
import { expect } from "vitest";

const disposers: Array<() => void> = [];

export function mount(component: () => unknown): HTMLElement {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const dispose = render(component as never, host);
  disposers.push(() => {
    dispose();
    host.remove();
  });
  return host;
}

export function unmountAll(): void {
  while (disposers.length) disposers.pop()!();
}

/**
 * Drains the microtask queue (async projections, `action` generators) plus one
 * macrotask turn (jsdom's `hashchange` dispatch), then flushes the reactive
 * graph so the DOM is settled. No fake timers: the mock API resolves
 * immediately, so a bounded number of turns is deterministic.
 */
export async function settle(turns = 12): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await Promise.resolve();
    flush();
  }
  await new Promise(resolve => setTimeout(resolve, 0));
  flush();
  for (let i = 0; i < turns; i++) {
    await Promise.resolve();
    flush();
  }
}

export function query<E extends Element = HTMLElement>(host: ParentNode, selector: string): E | null {
  return host.querySelector<E>(selector);
}

export function queryAll<E extends Element = HTMLElement>(host: ParentNode, selector: string): E[] {
  return Array.from(host.querySelectorAll<E>(selector));
}

export function get<E extends Element = HTMLElement>(host: ParentNode, selector: string): E {
  const element = host.querySelector<E>(selector);
  expect(element, `missing element for selector ${selector}`).toBeTruthy();
  return element!;
}

export function testId<E extends Element = HTMLElement>(host: ParentNode, id: string): E {
  return get<E>(host, `[data-testid="${id}"]`);
}

export function text(host: ParentNode, selector: string): string {
  return get(host, selector).textContent ?? "";
}

export function click(element: Element): void {
  element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  flush();
}

export function clickTestId(host: ParentNode, id: string): void {
  click(testId(host, id));
}

export function typeAndEnter(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  flush();
}

export function toggleCheckbox(input: HTMLInputElement): void {
  input.checked = !input.checked;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  flush();
}
