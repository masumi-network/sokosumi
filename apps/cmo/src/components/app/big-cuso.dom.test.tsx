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
  expect(head?.querySelector(".brand-name span")?.textContent).toBe("acme.io");
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

it("lists the daily pages; the brand's pages open from its name", async () => {
  const opened: string[] = [];
  const render = (view: "seo" | "channels") =>
    act(async () =>
      root.render(
        <Sidebar
          overview={cmoOverview({ websiteUrl: "https://acme.io" })}
          view={view}
          onSelect={(next) => opened.push(next)}
          name="Francis"
          email="francis@acme.io"
        />,
      ),
    );
  await render("seo");
  const labels = [...container.querySelectorAll(".nav-main a")].map(
    (link) => link.querySelector(".nav-label")?.textContent,
  );
  expect(labels).toEqual(["Today", "Chat", "Calendar", "Results", "SEO"]);
  expect(container.querySelector(".nav-group")).toBeNull();
  const brand = container.querySelector<HTMLButtonElement>(".brand-button");
  expect(brand?.getAttribute("aria-haspopup")).toBe("menu");
  expect(brand?.getAttribute("aria-expanded")).toBe("false");
  expect(brand?.hasAttribute("data-active")).toBe(false);

  // From the keyboard (a click with no pointer), the first page takes focus.
  await act(async () =>
    brand?.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 })),
  );
  const menu = container.querySelector('[role="menu"]');
  expect(brand?.getAttribute("aria-expanded")).toBe("true");
  expect(
    [...(menu?.querySelectorAll('[role="menuitem"]') ?? [])].map(
      (item) => item.textContent,
    ),
  ).toEqual([
    "Strategy",
    "Brand Brain",
    "Competitors",
    "Channels",
    "Open acme.io",
  ]);
  // The first page takes focus; the arrows move through the menu.
  expect(document.activeElement?.textContent).toBe("Strategy");
  await act(async () => {
    menu?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
    );
  });
  expect(document.activeElement?.textContent).toBe("Open acme.io");
  // Escape closes it and gives focus back to the brand.
  await act(async () => {
    menu?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  });
  expect(container.querySelector('[role="menu"]')).toBeNull();
  expect(document.activeElement).toBe(brand);

  await act(async () => brand?.click());
  await act(async () =>
    container
      .querySelector<HTMLAnchorElement>('[role="menu"] a[href="/channels"]')
      ?.click(),
  );
  expect(opened).toEqual(["channels"]);
  expect(container.querySelector('[role="menu"]')).toBeNull();

  // On one of the brand's pages its name reads as the page you are on.
  await render("channels");
  expect(
    container.querySelector(".brand-button")?.hasAttribute("data-active"),
  ).toBe(true);
});

it("shows the person as a plain avatar: their picture, else their initial", async () => {
  const render = (image: string | null) =>
    act(async () =>
      root.render(
        <Sidebar
          overview={cmoOverview()}
          view="today"
          onSelect={() => {}}
          name="Patrick"
          email="patrick@example.com"
          image={image}
        />,
      ),
    );
  await render(null);
  const initialOnly = container.querySelector(".who-button .avatar-initial");
  expect(initialOnly?.textContent).toBe("P");
  expect(container.querySelector(".who-button img")).toBeNull();
  await render("https://example.com/me.png");
  const photo = container.querySelector<HTMLImageElement>(".who-button img");
  expect(photo?.getAttribute("src")).toBe("https://example.com/me.png");
  expect(photo?.getAttribute("alt")).toBe("");
  expect(container.querySelector(".avatar-initial")).toBeNull();
});
