// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { FixtureApp } from "../../app/design-system/app/fixture-app";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Element.prototype.scrollIntoView = vi.fn();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

const tabs = () =>
  [...container.querySelectorAll<HTMLElement>(".tabbar > .tab")].map(
    (tab) => tab.textContent,
  );

it("puts Today, Cuso, Calendar, Results and More under the thumb", async () => {
  await act(async () => root.render(<FixtureApp view="today" />));
  expect(tabs()).toEqual(["2Today", "Cuso", "Calendar", "Results", "More"]);
  expect(container.querySelector(".tabbar .tab.active")?.textContent).toBe(
    "2Today",
  );
});

it("opens every other page from More, and closes on a pick or Escape", async () => {
  await act(async () => root.render(<FixtureApp view="today" />));
  const more = container.querySelector<HTMLButtonElement>(".tabbar button.tab");
  await act(async () => more?.click());
  expect(more?.getAttribute("aria-expanded")).toBe("true");
  const links = [
    ...container.querySelectorAll<HTMLAnchorElement>(".tabbar-more a"),
  ];
  expect(links.map((link) => link.textContent)).toEqual([
    "Strategy",
    "SEO",
    "Competitors",
    "Brand Brain",
    "Channels",
    "Settings",
  ]);
  expect(container.querySelector(".tabbar-more")?.textContent).toContain(
    "Sign out",
  );

  await act(async () =>
    links.find((l) => l.textContent === "Channels")?.click(),
  );
  expect(container.querySelector(".tabbar-more")).toBeNull();
  // A page under More marks More as where you are.
  expect(container.querySelector(".tabbar .tab.active")?.textContent).toBe(
    "More",
  );

  await act(async () => more?.click());
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  });
  expect(container.querySelector(".tabbar-more")).toBeNull();
});
