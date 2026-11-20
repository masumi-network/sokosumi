// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { FixtureApp } from "../../app/design-system/app/fixture-app";
import { VIEWS } from "../../app/design-system/app/fixtures";
import { cmoOverview } from "../../test-fixtures/cmo";
import { richMedia } from "../../test-fixtures/onboarding";
import { Sidebar } from "./sidebar";

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

it.each(VIEWS)(
  "shows one big Cuso on %s, and no other picture of him on the page",
  async (view) => {
    await act(async () => root.render(<FixtureApp view={view} />));
    expect(container.querySelectorAll(".side .cuso-figure")).toHaveLength(1);
    expect(container.querySelector(".main .cuso-figure")).toBeNull();
    expect(container.querySelector(".page-lead img")).toBeNull();
  },
);

it("heads the sidebar with the Business and the person, whose menu holds Settings", async () => {
  const overview = cmoOverview({
    businessName: "acme.io",
    websiteUrl: "https://acme.io",
    brandMedia: richMedia,
  });
  const opened: string[] = [];
  await act(async () =>
    root.render(
      <Sidebar
        overview={overview}
        view="today"
        onSelect={(view) => opened.push(view)}
        name="Francis"
        email="francis@acme.io"
        manyCusos
      />,
    ),
  );
  const head = container.querySelector(".side-head");
  const site = head?.querySelector<HTMLAnchorElement>(".side-name a");
  expect(site?.textContent).toBe("acme.io");
  expect(site?.getAttribute("href")).toBe("https://acme.io");
  const avatar = head?.querySelector<HTMLButtonElement>(".who-button");
  expect(avatar?.getAttribute("aria-label")).toBe("Account: Francis");
  await act(async () => avatar?.click());
  const menu = head?.querySelector(".ob-who-menu");
  expect(menu?.textContent).toContain("francis@acme.io");
  expect(menu?.querySelector('a[href="/?cusos=1"]')).not.toBeNull();
  const settings = menu?.querySelector<HTMLAnchorElement>(
    'a[href="/settings"]',
  );
  await act(async () => settings?.click());
  expect(opened).toEqual(["settings"]);
  // A pick closes the menu.
  expect(head?.querySelector(".ob-who-menu")).toBeNull();
});

it("lists the daily pages, then the brand's in a quiet group of their own", async () => {
  await act(async () =>
    root.render(
      <Sidebar
        overview={cmoOverview()}
        view="seo"
        onSelect={() => {}}
        name="Francis"
        email="francis@acme.io"
      />,
    ),
  );
  const labels = (selector: string) =>
    [...container.querySelectorAll(`${selector} a`)].map(
      (link) => link.querySelector(".nav-label")?.textContent,
    );
  expect(labels(".nav-main")).toEqual(["Today", "Chat", "Calendar", "Results"]);
  expect(labels(".nav-brand")).toEqual([
    "Strategy",
    "Brand Brain",
    "Competitors",
    "SEO",
    "Channels",
  ]);
  expect(container.querySelector(".nav-group")?.textContent).toBe("Your brand");
  expect(container.querySelector(".nav a.active")?.getAttribute("href")).toBe(
    "/seo",
  );
});
