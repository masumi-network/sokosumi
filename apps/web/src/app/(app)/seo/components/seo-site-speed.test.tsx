import { fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { expect, it } from "vitest";
import messages from "../../../../../messages/en.json";
import { SeoSiteSpeed } from "./seo-site-speed";
import {
  seoTestSpeedDevice,
  seoTestSpeedField,
  seoTestWorkspace,
} from "./seo-test-fixture";

it("names a page's speed in words and opens its measurements", () => {
  const workspace = seoTestWorkspace();
  const url = "https://example.com/pricing";
  workspace.siteSpeed = {
    rows: [
      {
        url,
        audited: false,
        cause: "keyword",
        why: "It ranks for “battery app”.",
        tier: "reduced",
        devices: [
          seoTestSpeedDevice({
            pageUrl: url,
            testedUrl: url,
            field: seoTestSpeedField({ lcp: 3100, cls: 0.05 }, "origin"),
          }),
        ],
      },
    ],
    dropped: 0,
    observationId: "b5efedab-c394-4ce9-a089-0979e8a18fdb",
    observedAt: new Date("2026-11-11T00:26:00Z"),
  };
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <SeoSiteSpeed workspace={workspace} />
    </NextIntlClientProvider>,
  );
  const row = within(screen.getByRole("row", { name: /pricing/ }));
  expect(row.getByText("Over a limit: loading (LCP)")).toBeVisible();
  expect(row.getByText("Real visitors, whole site")).toBeVisible();
  const toggle = row.getByRole("button", { name: "/pricing" });
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute("aria-expanded", "true");
  const detail = document.getElementById(
    toggle.getAttribute("aria-controls") ?? "",
  );
  expect(detail).not.toBeNull();
  const opened = within(detail as HTMLElement);
  // Core's sentence stands alone: the cause label would say it twice.
  expect(opened.getByText("It ranks for “battery app”.")).toBeVisible();
  expect(
    opened.queryByText(messages.App.Seo.siteSpeed.cause.keyword),
  ).toBeNull();
  fireEvent.click(opened.getByText(/^Mobile · Real visitors, whole site/));
  expect(opened.getByText("Too little data")).toBeVisible();
  expect(
    opened.getByText(messages.App.Seo.pageSpeed.caveat.origin),
  ).toBeVisible();
});

it("says the trend in words, why a short check used one device and how many pages wait", () => {
  const workspace = seoTestWorkspace();
  const url = "https://example.com/pricing";
  const measured = seoTestSpeedField({ lcp: 3000, inp: 120, cls: 0.05 });
  workspace.siteSpeed = {
    rows: [
      {
        url,
        audited: true,
        tier: "reduced",
        check: {
          device: "mobile",
          basis: "crux-origin",
          mix: {
            level: "origin",
            phone: 0.72,
            desktop: 0.25,
            tablet: 0.03,
            period: null,
          },
          notChecked: null,
        },
        devices: [
          seoTestSpeedDevice({
            pageUrl: url,
            testedUrl: url,
            field: {
              ...measured,
              history: {
                status: "comparable",
                weeks: ["2026-10-18", "2026-10-25", "2026-11-01"],
                lcp: [4200, 3600, 3000],
                inp: [null, null, 120],
                cls: [0.05, null, 0.05],
              },
            },
          }),
        ],
      },
      {
        url: "https://example.com/blog",
        audited: true,
        devices: [
          seoTestSpeedDevice({
            field: {
              ...measured,
              history: { status: "incompatible_population" },
            },
          }),
        ],
      },
    ],
    dropped: 0,
    notChecked: { count: 4, reason: "limit" },
    observationId: "b5efedab-c394-4ce9-a089-0979e8a18fdb",
    observedAt: new Date("2026-11-11T00:26:00Z"),
  };
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <SeoSiteSpeed workspace={workspace} />
    </NextIntlClientProvider>,
  );
  expect(
    screen.getByText(
      "Pages not checked: 4. The audit checks a limited number of pages for speed.",
    ),
  ).toBeVisible();
  const pricing = within(screen.getByRole("row", { name: /pricing/ }));
  expect(pricing.getByText("Getting faster")).toBeVisible();
  fireEvent.click(pricing.getByRole("button"));
  expect(
    screen.getByText(
      /Short check on mobile: 72% of the site’s visitors use it\. Visitors: 72% phone · 25% desktop · 3% tablet/,
    ),
  ).toBeVisible();
  fireEvent.click(screen.getByText(/^Mobile · Real visitors ·/));
  expect(
    screen.getByText(
      /Largest item appears \(LCP\): 4\.2 s in the 28 days to Oct 18, 2026, 3 s in the 28 days to Nov 1, 2026\./,
    ),
  ).toBeVisible();
  // Review pass 18: the drawing is hidden from a screen reader, so each week's value is in a list too.
  expect(
    screen.getByText("28 days to Oct 25, 2026: 3.6 s").closest("ul"),
  ).toHaveClass("sr-only");
  // Review pass 19: a week without a value is in the list, so a reader hears the gap the chart shows.
  expect(
    screen.getByText("28 days to Oct 25, 2026: no data"),
  ).toBeInTheDocument();
  // One week with a value is no trend: a sentence stands in for the line.
  expect(
    screen.getByText(/INP\): Too few weeks with data to show a trend\./),
  ).toBeVisible();
  expect(document.querySelectorAll("figure svg")).toHaveLength(2);
  // The two CLS weeks have a week without a value between them: each is a dot, not a line.
  expect(
    document
      .querySelector('figure svg path[d*="h0"]')
      ?.getAttribute("d")
      ?.match(/h0/g),
  ).toHaveLength(2);
  expect(document.querySelectorAll('figure svg path[d*="h0"]')).toHaveLength(1);

  const blog = within(screen.getByRole("row", { name: /blog/ }));
  expect(blog.getByText("No trend yet")).toBeVisible();
  fireEvent.click(blog.getByRole("button"));
  fireEvent.click(screen.getByText(/^Mobile · Real visitors ·/));
  expect(
    screen.getByText(
      messages.App.Seo.siteSpeed.noTrend.incompatible_population,
    ),
  ).toBeVisible();
  expect(document.querySelector("figure svg")).toBeNull();
});

it("says how many pages wait, and why, when the audit tested no page", () => {
  const workspace = seoTestWorkspace();
  const table = {
    rows: [],
    dropped: 0,
    notChecked: { count: 4, reason: "quota" as const },
    observationId: "b5efedab-c394-4ce9-a089-0979e8a18fdb",
    observedAt: new Date("2026-11-11T00:26:00Z"),
  };
  workspace.siteSpeed = table;
  const view = render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <SeoSiteSpeed workspace={workspace} />
    </NextIntlClientProvider>,
  );
  expect(
    screen.getByText(
      `Pages not checked: 4. ${messages.App.Seo.siteSpeed.gap.quota}`,
    ),
  ).toBeVisible();
  expect(screen.queryByRole("table")).toBeNull();
  // No page and no count: the section says nothing.
  workspace.siteSpeed = { ...table, notChecked: { count: 0, reason: "quota" } };
  view.rerender(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <SeoSiteSpeed workspace={{ ...workspace }} />
    </NextIntlClientProvider>,
  );
  expect(view.container).toBeEmptyDOMElement();
});

it("names the audited page whose measurement a row shows after a redirect", () => {
  const workspace = seoTestWorkspace();
  const url = "https://example.com/new";
  const audited = "https://example.com/old";
  workspace.siteSpeed = {
    rows: [
      {
        url,
        audited: true,
        tier: "full",
        devices: [
          seoTestSpeedDevice({ pageUrl: audited, testedUrl: url }),
          seoTestSpeedDevice({
            device: "desktop",
            pageUrl: url,
            testedUrl: url,
          }),
        ],
      },
    ],
    dropped: 0,
    observationId: "b5efedab-c394-4ce9-a089-0979e8a18fdb",
    observedAt: new Date("2026-11-11T00:26:00Z"),
  };
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <SeoSiteSpeed workspace={workspace} />
    </NextIntlClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "/new" }));
  // Only the measurement of the other page names it.
  expect(
    screen.getAllByText(
      `The audit tested ${audited}. That address leads to this page.`,
    ),
  ).toHaveLength(1);
});

it("names no audited page when it is the row's page without its root slash", () => {
  const workspace = seoTestWorkspace();
  const url = "https://example.test/";
  const bare = "https://example.test";
  workspace.siteSpeed = {
    rows: [
      {
        url,
        audited: true,
        tier: "full",
        devices: [seoTestSpeedDevice({ pageUrl: bare, testedUrl: bare })],
      },
    ],
    dropped: 0,
    observationId: "b5efedab-c394-4ce9-a089-0979e8a18fdb",
    observedAt: new Date("2026-11-11T00:26:00Z"),
  };
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <SeoSiteSpeed workspace={workspace} />
    </NextIntlClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: /example\.test/ }));
  expect(screen.getByRole("button", { expanded: true })).toBeTruthy();
  expect(screen.queryByText(/That address leads to this page/)).toBeNull();
  // The tested address is this page too: it is not shown as a redirect target.
  expect(screen.queryByText(bare)).toBeNull();
});

it("says a checked row with no readable device has no readable measurement", () => {
  const workspace = seoTestWorkspace();
  const page = (path: string) => `https://example.com/${path}`;
  workspace.siteSpeed = {
    rows: [
      ...(["full", "reduced", "none"] as const).map((tier) => ({
        url: page(tier),
        audited: false,
        tier,
        devices: [],
      })),
      // A row from before the tiers was checked.
      { url: page("legacy"), audited: false, devices: [] },
    ],
    dropped: 0,
    observationId: "b5efedab-c394-4ce9-a089-0979e8a18fdb",
    observedAt: new Date("2026-11-11T00:26:00Z"),
  };
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <SeoSiteSpeed workspace={workspace} />
    </NextIntlClientProvider>,
  );
  const said = (tier: string) => {
    fireEvent.click(screen.getByRole("button", { name: new RegExp(tier) }));
    const text = [
      screen.queryByText("No readable measurement."),
      screen.queryByText("Not checked in this audit."),
    ].map(Boolean);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(tier) }));
    return text;
  };
  expect(said("full")).toEqual([true, false]);
  expect(said("reduced")).toEqual([true, false]);
  expect(said("none")).toEqual([false, true]);
  expect(said("legacy")).toEqual([true, false]);
});
