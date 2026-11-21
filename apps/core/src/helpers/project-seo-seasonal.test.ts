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

it("keeps an earlier seasonal cycle only when both local rises are in the underlying monthly history", () => {
  const window = {
    targetPeriod: "2026-12",
    historicalPeriod: "2025-12",
    historicalVolume: 90,
    baselineMedian: 20,
  };
  const earlierCycle = {
    historicalPeriod: "2024-12",
    historicalVolume: 60,
    baselineMedian: 30,
  };
  const months = [2024, 2025].flatMap((year) =>
    [8, 9, 10, 11, 12].map((month) => ({
      year,
      month,
      search_volume:
        month === 12 ? (year === 2024 ? 60 : 90) : year === 2024 ? 30 : 20,
    })),
  );
  const idea = {
    ...insight,
    action: "improve_existing_page",
    marketBasis: "vendor_scenario",
    windows: [{ ...window, earlierCycle }],
    demand: { ...insight.demand, months },
  };
  const parsed = readSeasonalInsight(idea)!;
  expect(parsed.windows[0]?.earlierCycle).toEqual(earlierCycle);
  expect(seasonalIdeaAction(parsed)).toBeNull();
  expect(
    readSeasonalInsight({
      ...idea,
      demand: { ...idea.demand, months: months.slice(5) },
    })?.windows,
  ).toEqual([window]);
  const edition = {
    previousEventDate: "2024-12-25",
    leadMonth: { period: "2024-11", volume: 30 },
    eventMonth: { period: "2024-12", volume: 60 },
    baselineMedian: 30,
    baselineMonths: [8, 9, 10].map((m) => ({
      period: "2024-" + String(m).padStart(2, "0"),
      volume: 30,
    })),
  };
  const event = {
    ...idea,
    event: { name: "Christmas", scope: "local", date: "2026-12-25" },
    comparison: {
      status: "above_baseline",
      leadMonth: { period: "2025-11", volume: 20 },
      eventMonth: { period: "2025-12", volume: 90 },
      baselineMedian: 20,
      earlierEdition: edition,
    },
  };
  expect(readSeasonalInsight(event)?.comparison?.earlierEdition).toEqual(
    edition,
  );
  expect(
    readSeasonalInsight({
      ...event,
      demand: { ...idea.demand, months: months.slice(5) },
    })?.comparison?.earlierEdition,
  ).toBeUndefined();
});

it("accepts a later recurring peak and rejects handpicked comparison months from another cycle", () => {
  const months = Array.from({ length: 36 }, (_, i) => {
    const d = new Date(Date.UTC(2023, 10 + i, 1));
    const month = d.getUTCMonth() + 1;
    return {
      year: d.getUTCFullYear(),
      month,
      search_volume: [1, 2, 5].includes(month) ? 110 : 20,
    };
  });
  const references = (year: number) =>
    [9, 10, 11, 12, 1, 2, 3, 4].map(
      (month) =>
        (month > 4 ? year - 1 : year) + "-" + String(month).padStart(2, "0"),
    );
  const historical = (year: number) => ({
    historicalPeriod: year + "-05",
    historicalVolume: 110,
    baselineMedian: 20,
    referenceMonths: references(year),
  });
  const earlierCycle = historical(2025);
  const window = { targetPeriod: "2027-05", ...historical(2026), earlierCycle };
  const february = {
    targetPeriod: "2027-02",
    historicalPeriod: "2026-02",
    historicalVolume: 110,
    baselineMedian: 20,
  };
  const idea = {
    ...insight,
    windows: [february, window],
    demand: { ...insight.demand, months },
  };
  const imported = (windows: unknown[], rows = months) =>
    readSeasonalInsight({
      ...idea,
      windows,
      demand: { ...idea.demand, months: rows },
    })?.windows;
  expect(imported(idea.windows)).toEqual(idea.windows);
  expect(imported([window])).toEqual([]);
  expect(imported([february, { ...window, earlierCycle: undefined }])).toEqual([
    february,
  ]);
  const mixed = { ...earlierCycle, referenceMonths: references(2026) };
  expect(imported([february, { ...window, earlierCycle: mixed }])).toEqual([
    february,
  ]);
  const noDip = months.map((row) =>
    row.year === 2025 && [3, 4].includes(row.month)
      ? { ...row, search_volume: 110 }
      : row,
  );
  expect(imported(idea.windows, noDip)).toEqual([february]);
  const plateau = months.map((row) => ({
    ...row,
    search_volume:
      row.month === 5 ? 250 : row.month < 5 || row.month === 12 ? 100 : 10,
  }));
  const winter = { ...february, historicalVolume: 100, baselineMedian: 10 };
  const spring = {
    ...window,
    historicalVolume: 250,
    baselineMedian: 100,
    earlierCycle: {
      ...earlierCycle,
      historicalVolume: 250,
      baselineMedian: 100,
    },
  };
  expect(imported([winter, spring], plateau)).toEqual([winter]);
});

it("keeps a checked editorial instruction in the task, and a keep decision never becomes work", () => {
  const plan = {
    disposition: "clarify" as const,
    readerTask: "Store a sail for winter",
    passage: insight.pageQuote,
    nextStep: "Add a drying step before the storage instructions.",
  };
  const idea = readSeasonalInsight({
    ...insight,
    ...supported,
    contentPlan: plan,
    demand: insight.demand,
  })!;
  expect(seasonalIdeaAction(idea)?.title).toBe(plan.nextStep);
  expect(
    seasonalIdeaAction({
      ...idea,
      contentPlan: { ...plan, disposition: "keep" },
    }),
  ).toBeNull();
});

it("imports a first March peak after two quiet winters and requires its underlying observations for a test", () => {
  const months = Array.from({ length: 36 }, (_, i) => {
    const d = new Date(Date.UTC(2023, 10 + i, 1));
    const month = d.getUTCMonth() + 1;
    return {
      year: d.getUTCFullYear(),
      month,
      search_volume: month === 3 ? 100 : 15,
    };
  });
  const cycle = (year: number) => ({
    historicalPeriod: year + "-03",
    historicalVolume: 100,
    baselineMedian: 15,
    referenceMonths: months
      .filter(
        (row) =>
          (row.year === year - 1 && row.month >= 7) ||
          (row.year === year && row.month < 3),
      )
      .map((row) => row.year + "-" + String(row.month).padStart(2, "0")),
  });
  const contentPlan = {
    disposition: "inspect",
    readerTask: "Choose a repair method",
    passage: insight.pageQuote,
    nextStep: "Draft a guide to sail repairs.",
    experiment: {
      hypothesis: "Owners may be preparing their boats for spring.",
      targetQueries: ["spring sail repairs"],
      successCheck: "Compare visits from repair queries after publication.",
    },
  };
  const raw = {
    ...insight,
    contentPlan,
    windows: [
      { targetPeriod: "2027-03", ...cycle(2026), earlierCycle: cycle(2025) },
    ],
    demand: { ...insight.demand, months },
  };
  const idea = readSeasonalInsight(raw)!;
  expect(seasonalIdeaAction(idea)?.title).toBe(contentPlan.nextStep);
  expect(
    seasonalIdeaAction(readSeasonalInsight({ ...raw, demand: undefined })!),
  ).toBeNull();
});

it("requires a measured baseline before promoting a calendar hypothesis", () => {
  const event = { name: "Christmas", date: "2026-12-25", scope: "Germany" };
  const plan = {
    disposition: "inspect",
    readerTask: "Plan winter repairs",
    passage: insight.pageQuote,
    nextStep: "Draft a winter repair guide.",
    experiment: {
      hypothesis: "Owners may be preparing for winter repairs.",
      targetQueries: ["winter sail repairs"],
      successCheck: "Compare repair queries after publication.",
    },
  };
  const old = [8, 9, 10, 11, 12].map((month) => ({
    year: 2025,
    month,
    search_volume: month === 12 ? 80 : 20,
  }));
  const raw = {
    ...insight,
    event,
    contentPlan: plan,
    demand: { ...insight.demand, months: old },
    comparison: {
      status: "above_baseline",
      leadMonth: { period: "2025-11", volume: 20 },
      eventMonth: { period: "2025-12", volume: 80 },
      baselineMedian: 20,
    },
  };
  expect(seasonalIdeaAction(readSeasonalInsight(raw)!)?.title).toBe(
    plan.nextStep,
  );
  expect(
    seasonalIdeaAction(
      readSeasonalInsight({
        ...raw,
        demand: { ...raw.demand, months: old.slice(1) },
      })!,
    ),
  ).toBeNull();
});
