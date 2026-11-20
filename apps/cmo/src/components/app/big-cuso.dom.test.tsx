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
    expect(container.querySelectorAll(".side .cuso-stage")).toHaveLength(1);
    expect(container.querySelector(".today-cuso")).toBeNull();
    expect(
      container.querySelector(".main .vhead img, .page-lead img"),
    ).toBeNull();
  },
);

it("heads the sidebar with the Business: its logo from DESIGN.md, its site and the switch", async () => {
  const overview = cmoOverview({
    businessName: "acme.io",
    websiteUrl: "https://acme.io",
    brandMedia: richMedia,
  });
  await act(async () =>
    root.render(
      <Sidebar
        overview={overview}
        view="today"
        onSelect={() => {}}
        name="Francis"
        email="francis@acme.io"
        manyCusos
      />,
    ),
  );
  const head = container.querySelector(".side-head");
  const logo = head?.querySelector<HTMLImageElement>(".side-logo-light");
  expect(logo?.getAttribute("src")).toBe(richMedia.logos.logo?.url);
  expect(head?.querySelector(".side-logo-dark")?.getAttribute("src")).toBe(
    richMedia.logos.dark?.url ?? richMedia.logos.logo?.url,
  );
  const site = head?.querySelector<HTMLAnchorElement>(".side-site");
  expect(site?.textContent).toBe("acme.io");
  expect(site?.getAttribute("href")).toBe("https://acme.io");
  expect(head?.querySelector(".side-switch")?.getAttribute("href")).toBe(
    "/?cusos=1",
  );
  // The old workspace card is gone.
  expect(container.querySelector(".business.card")).toBeNull();
});
