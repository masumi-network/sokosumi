// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { FixtureApp } from "../../app/design-system/app/fixture-app";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Element.prototype.scrollIntoView = vi.fn();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const scroller = () => {
  const found = container.querySelector<HTMLElement>(".main .scroll");
  if (!found) throw new Error("No page");
  return found;
};

it("opens every page at its top, wherever the last one was scrolled to", async () => {
  await act(async () => root.render(<FixtureApp view="strategy" />));
  scroller().scrollTop = 900;
  for (const page of ["Calendar", "Results", "SEO"]) {
    await act(async () => {
      [...container.querySelectorAll<HTMLElement>(".nav a")]
        .find((link) => link.textContent === page)
        ?.click();
    });
    expect(
      container.querySelector(".nav [aria-current=page]")?.textContent,
    ).toBe(page);
    expect(scroller().scrollTop).toBe(0);
    scroller().scrollTop = 900;
  }
});
