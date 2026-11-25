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
                cls: [0.05, 0.05, 0.05],
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
      /Checked on mobile only: 72% of the site’s visitors use it\. Visitors: 72% phone · 25% desktop · 3% tablet/,
    ),
  ).toBeVisible();
  fireEvent.click(screen.getByText(/^Mobile · Real visitors ·/));
  expect(
    screen.getByText(
      /Largest item appears \(LCP\): 4\.2 s in the week to Oct 18, 2026, 3 s in the week to Nov 1, 2026\./,
    ),
  ).toBeVisible();
  // One week with a value is no trend: a sentence stands in for the line.
  expect(
    screen.getByText(/INP\): Too few weeks with data to show a trend\./),
  ).toBeVisible();
  expect(document.querySelectorAll("figure svg")).toHaveLength(2);

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
