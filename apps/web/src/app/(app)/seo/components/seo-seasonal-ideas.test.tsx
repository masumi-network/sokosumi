import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, expect, it } from "vitest";
import messages from "../../../../../messages/en.json";
import { SeoSeasonalIdeas } from "./seo-seasonal-ideas";
import { seoTestWorkspace } from "./seo-test-fixture";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

type Idea = NonNullable<SeoWorkspaceModel["data"]["seasonalIdeas"]>[number];
const data = seoTestWorkspace();
const winter: Idea = {
  keyword: "sail storage",
  audience: "boat owners",
  country: "DE",
  language: "de",
  url: data.pages[0].url,
  asOf: new Date("2026-11-01T00:00:00Z"),
  pageQuote: "Learn about sail storage for the winter.",
  action: "investigate_angle",
  event: null,
  limitations: ["timing_uncertain"],
  comparison: null,
  windows: [
    {
      targetPeriod: "2026-12",
      historicalPeriod: "2025-12",
      historicalVolume: 80,
      baselineMedian: 15,
    },
  ],
};
const holiday: Idea = {
  ...winter,
  keyword: "festive boat tour",
  audience: "festival visitors",
  country: "IN",
  language: "en",
  pageQuote: "Join our Diwali boat tour on the river.",
  event: {
    name: "Diwali",
    scope: "Uttarakhand government offices",
    date: new Date("2026-11-08T00:00:00Z"),
  },
  windows: [],
  comparison: {
    leadMonth: { period: "2025-09", volume: 5 },
    eventMonth: { period: "2025-10", volume: 10 },
    baselineMedian: 12,
    status: "no_observed_rise",
  },
};
function page(ideas?: Idea[], keywordSearch = "") {
  return (
    <NextIntlClientProvider
      locale="en"
      messages={messages}
      timeZone="America/Los_Angeles"
    >
      <SeoSeasonalIdeas
        model={
          {
            data: { ...data, seasonalIdeas: ideas },
            keywordSearch,
          } as SeoWorkspaceModel
        }
      />
    </NextIntlClientProvider>
  );
}
afterEach(cleanup);

it("shows the month to plan for and opens the source figures on demand", async () => {
  const user = userEvent.setup();
  const view = render(page([winter], "sail"));
  expect(screen.getByRole("heading", { name: winter.keyword })).toBeVisible();
  expect(screen.getByText("Plan for December 2026")).toBeVisible();
  const summary = screen.getByText("Page and demand evidence");
  expect(summary.closest("details")).not.toHaveAttribute("open");
  await user.click(summary);
  expect(summary.closest("details")).toHaveAttribute("open");
  expect(screen.getByText(winter.pageQuote)).toBeVisible();
  expect(
    screen.getByText(
      /For December 2026, review December 2025: 80 estimated local searches/,
    ),
  ).toBeVisible();
  expect(screen.getByText(/earlier three-month median was 15/)).toBeVisible();
  view.rerender(page([winter], "unrelated"));
  expect(screen.queryByRole("heading")).toBeNull();
  view.rerender(page());
  expect(screen.queryByRole("heading")).toBeNull();
});

it("identifies the comparison months when a full preceding baseline is unavailable", async () => {
  const referenceMonths = [
    "2026-03",
    "2026-04",
    "2026-05",
    "2026-06",
    "2026-07",
    "2026-08",
  ];
  const user = userEvent.setup();
  render(
    page([{ ...winter, windows: [{ ...winter.windows[0], referenceMonths }] }]),
  );
  await user.click(screen.getByText("Page and demand evidence"));
  expect(
    screen.getByText(
      /The median was 15 across the other observed months \(March 2026.*August 2026\)/,
    ),
  ).toBeVisible();
  expect(screen.queryByText(/earlier three-month median/)).toBeNull();
});

it("finds a local event by name and preserves its date and demand result across time zones", () => {
  render(page([holiday], "Diwali"));
  expect(screen.getByText("Diwali · Nov 8, 2026")).toBeVisible();
  expect(screen.getByText("Uttarakhand government offices")).toBeVisible();
  expect(screen.getByText(/Audit on Nov 1, 2026/)).toBeVisible();
  expect(
    screen.getByText(
      "Local searches did not rise above the earlier median last year.",
    ),
  ).toBeVisible();
});

it("shows the available estimate even when history cannot support a seasonal comparison", async () => {
  const user = userEvent.setup();
  render(
    page([
      {
        ...holiday,
        limitations: ["demand_unverified"],
        comparison: {
          leadMonth: { period: "2025-09", volume: null },
          eventMonth: { period: "2025-10", volume: 0 },
          baselineMedian: null,
          status: "insufficient",
        },
      },
    ]),
  );
  expect(
    screen.getByText("Check local demand before deciding when to publish."),
  ).toBeVisible();
  await user.click(screen.getByText("Page and demand evidence"));
  expect(
    screen.getByText(/October 2025: 0.*too little data to compare demand/),
  ).toBeVisible();
  expect(screen.queryByText(/September 2025/)).toBeNull();
});
