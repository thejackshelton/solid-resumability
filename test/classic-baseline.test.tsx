import { afterEach, describe, expect, it } from "vitest";
import { render } from "@solidjs/web";
import { flush } from "solid-js";

import { CounterA } from "../src/fixtures/CounterA";
import { CounterB } from "../src/fixtures/CounterB";

/**
 * The no-breakage baseline: both fixtures are ordinary Solid components and
 * must render and update correctly under completely unmodified solid-js.
 * Every later packet has to keep this suite green.
 */

const disposers: Array<() => void> = [];

function mount(component: () => unknown) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const dispose = render(component as never, host);
  disposers.push(() => {
    dispose();
    host.remove();
  });
  return host;
}

afterEach(() => {
  while (disposers.length) disposers.pop()!();
});

function click(host: HTMLElement, testId: string) {
  const button = host.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
  expect(button, `missing button ${testId}`).toBeTruthy();
  button!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  // Solid 2.0 schedules effects; flush the graph so the DOM is settled.
  flush();
}

function label(host: HTMLElement, testId: string) {
  return host.querySelector(`[data-testid="${testId}"]`)?.textContent;
}

describe("classic solid-js baseline", () => {
  it("renders Fixture A and drives the shared signal from both handlers", () => {
    const host = mount(CounterA);

    expect(label(host, "a-label")).toBe("count: 0");

    click(host, "a-inc");
    expect(label(host, "a-label")).toBe("count: 1");

    click(host, "a-inc");
    click(host, "a-inc");
    expect(label(host, "a-label")).toBe("count: 3");

    // The decrement handler closes over the *same* signal as increment.
    click(host, "a-dec");
    expect(label(host, "a-label")).toBe("count: 2");

    click(host, "a-dec");
    click(host, "a-dec");
    expect(label(host, "a-label")).toBe("count: 0");

    click(host, "a-dec");
    expect(label(host, "a-label")).toBe("count: -1");
  });

  it("renders Fixture B and drives the escaped signal from both handlers", () => {
    const host = mount(CounterB);

    expect(label(host, "b-label")).toBe("count: 0");

    click(host, "b-inc");
    expect(label(host, "b-label")).toBe("count: 1");

    click(host, "b-inc");
    click(host, "b-inc");
    expect(label(host, "b-label")).toBe("count: 3");

    click(host, "b-dec");
    expect(label(host, "b-label")).toBe("count: 2");

    click(host, "b-dec");
    click(host, "b-dec");
    expect(label(host, "b-label")).toBe("count: 0");

    click(host, "b-dec");
    expect(label(host, "b-label")).toBe("count: -1");
  });

  it("keeps the two fixtures independent when mounted together", () => {
    const a = mount(CounterA);
    const b = mount(CounterB);

    click(a, "a-inc");
    click(a, "a-inc");
    click(b, "b-dec");

    expect(label(a, "a-label")).toBe("count: 2");
    expect(label(b, "b-label")).toBe("count: -1");
  });
});
