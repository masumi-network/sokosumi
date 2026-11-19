import { expect, it } from "vitest";
import {
  readSeasonalInsight,
  seasonalIdeaAction,
} from "./project-seo-seasonal";

const page = "https://example.com/storage";
const months = [
  { year: 2025, month: 11, search_volume: 40 },
  { year: 2025, month: 12, search_volume: 90 },
  { year: 2026, month: 10, search_volume: 30 },
];
const insight = {
  keyword: "sail storage",
  audience: "boat owners",
  url: page,
  asOf: "2026-11-01",
  country: "DE",
  language: "de",
  pageQuote: "Learn about sail storage for the winter.",
  action: "investigate_angle",
  limitations: ["timing_uncertain"],
  event: null,
  comparison: null,
  windows: [],
  reviewers: ["first"],
  demand: {
    status: "observed",
    keyword: "sail storage",
    record: "a".repeat(64),
    months,
  },
};

it("keeps the measured history of a query without a qualifying rise and drops reviewer and record fields", () => {
  const idea = readSeasonalInsight(insight);
  expect(idea?.observedMonths).toEqual([
    { period: "2025-11", volume: 40 },
    { period: "2025-12", volume: 90 },
    { period: "2026-10", volume: 30 },
  ]);
  expect(JSON.stringify(idea)).not.toMatch(/reviewers|first|record|aaaa/);
});

it("takes monthly history only from the worker's demand for the same query before the audit month", () => {
  const without = readSeasonalInsight({
    ...insight,
    demand: undefined,
    observedMonths: [{ period: "2025-12", volume: 9000 }],
  });
  expect(without).not.toBeNull();
  expect(without?.observedMonths).toBeUndefined();
  for (const demand of [
    { ...insight.demand, keyword: "boat storage" },
    { ...insight.demand, status: "unverified" },
    {
      ...insight.demand,
      months: [...months, { year: 2026, month: 11, search_volume: 5 }],
    },
    {
      ...insight.demand,
      months: [...months, { year: 2023, month: 10, search_volume: 5 }],
    },
    { ...insight.demand, months: [...months, months[0]] },
    {
      ...insight.demand,
      months: [{ year: 2025, month: 12, search_volume: -1 }],
    },
  ]) {
    const idea = readSeasonalInsight({ ...insight, demand });
    expect(idea?.keyword).toBe("sail storage");
    expect(idea?.observedMonths).toBeUndefined();
  }
  expect(
    readSeasonalInsight({
      ...insight,
      demand: {
        ...insight.demand,
        months: [{ year: 2023, month: 11, search_volume: 5 }],
      },
    })?.observedMonths,
  ).toEqual([{ period: "2023-11", volume: 5 }]);
});

const supported = readSeasonalInsight({
  ...insight,
  action: "improve_existing_page",
  windows: [
    {
      targetPeriod: "2026-12",
      historicalPeriod: "2025-12",
      historicalVolume: 90,
      baselineMedian: 35,
    },
  ],
})!;

it("offers a page update only for a supported idea, with the same ID on a repeat audit", () => {
  const action = seasonalIdeaAction(supported);
  expect(action).toMatchObject({
    id: expect.stringMatching(/^seasonal:[a-f0-9]{64}$/),
    pageUrl: page,
    kind: "opportunity",
    title: 'Update the page for "sail storage" before 2026-12',
    evidence: [
      'Page quote: "Learn about sail storage for the winter."',
      "2025-12: 90 estimated searches in DE/de; comparison median 35 (DataForSEO)",
    ],
  });
  expect(
    seasonalIdeaAction({
      ...supported,
      audience: "sailors",
      asOf: "2026-12-01",
      url: page + "#top",
      keyword: "Sail Storage",
    })?.id,
  ).toBe(action?.id);
  const nextYear = { ...supported.windows[0], targetPeriod: "2027-12" };
  expect(
    seasonalIdeaAction({ ...supported, windows: [nextYear] })?.id,
  ).not.toBe(action?.id);
  expect(seasonalIdeaAction({ ...supported, country: "AT" })?.id).not.toBe(
    action?.id,
  );
  for (const idea of [
    { ...supported, action: "investigate_angle" as const },
    { ...supported, origin: "market_history" as const },
    {
      ...supported,
      limitations: ["timing_uncertain", "offer_unverified"] as const,
    },
    {
      ...supported,
      windows: [{ ...supported.windows[0], historicalVolume: 44 }],
    },
  ])
    expect(
      seasonalIdeaAction({ ...idea, limitations: [...idea.limitations] }),
    ).toBeNull();
});

it("offers an event update only after a material rise around last year's date", () => {
  const event = {
    ...supported,
    windows: [],
    event: { name: "Christmas", scope: "Federal holiday", date: "2026-12-25" },
    comparison: {
      status: "above_baseline" as const,
      leadMonth: { period: "2025-11", volume: 40 },
      eventMonth: { period: "2025-12", volume: 90 },
      baselineMedian: 20,
    },
  };
  expect(seasonalIdeaAction(event)?.title).toBe(
    'Update the page for "sail storage" before Christmas on 2026-12-25',
  );
  expect(
    seasonalIdeaAction({
      ...event,
      comparison: {
        ...event.comparison,
        leadMonth: { period: "2025-11", volume: 29 },
        eventMonth: { period: "2025-12", volume: 25 },
      },
    }),
  ).toBeNull();
});
