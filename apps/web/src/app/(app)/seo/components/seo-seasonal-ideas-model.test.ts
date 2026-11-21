import { expect, it } from "vitest";
import { seasonalIdeaTiming } from "./seo-seasonal-ideas-model";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

type Idea = NonNullable<SeoWorkspaceModel["data"]["seasonalIdeas"]>[number];
const window = (targetPeriod: string) => ({
  targetPeriod,
  historicalPeriod: `${Number(targetPeriod.slice(0, 4)) - 1}${targetPeriod.slice(4)}`,
  historicalVolume: 90,
  baselineMedian: 20,
});
const idea: Idea = {
  keyword: "sail storage",
  audience: "boat owners",
  url: "https://example.com/",
  asOf: new Date("2026-10-01T00:00:00Z"),
  country: "DE",
  language: "de",
  pageQuote: "Learn about sail storage for the winter.",
  action: "improve_existing_page",
  limitations: ["timing_uncertain"],
  event: null,
  comparison: null,
  windows: [window("2026-11"), window("2026-12")],
};
const event = {
  ...idea,
  windows: [],
  event: {
    name: "Christmas",
    scope: "Federal holiday",
    date: new Date("2026-12-25T00:00:00Z"),
  },
};

it("drops a planned month once it has ended in the selected market", () => {
  expect(
    seasonalIdeaTiming(idea, new Date("2026-11-30T22:59:00Z")),
  ).toMatchObject({ upcoming: ["2026-11", "2026-12"], passed: false });
  expect(
    seasonalIdeaTiming(idea, new Date("2026-11-30T23:00:00Z")),
  ).toMatchObject({
    upcoming: ["2026-12"],
    passedMonths: ["2026-11"],
    passed: false,
  });
  expect(
    seasonalIdeaTiming(idea, new Date("2027-01-15T00:00:00Z")),
  ).toMatchObject({ upcoming: [], passed: true });
});

it("keeps an event current until its market day has ended", () => {
  expect(
    seasonalIdeaTiming(event, new Date("2026-12-25T22:59:00Z")).passed,
  ).toBe(false);
  expect(
    seasonalIdeaTiming(event, new Date("2026-12-25T23:00:00Z")).passed,
  ).toBe(true);
  expect(
    seasonalIdeaTiming(
      { ...event, country: "US" },
      new Date("2026-12-25T23:00:00Z"),
    ).passed,
  ).toBe(false);
  expect(
    seasonalIdeaTiming(
      { ...event, country: "IN" },
      new Date("2026-12-25T18:30:00Z"),
    ).passed,
  ).toBe(true);
});

it("shows the latest year of measured months", () => {
  const observedMonths = Array.from({ length: 15 }, (_, i) => ({
    period: `20${25 + Math.floor((i + 7) / 12)}-${String(((i + 7) % 12) + 1).padStart(2, "0")}`,
    volume: i,
  }));
  const shown = seasonalIdeaTiming(
    { ...idea, observedMonths },
    new Date("2026-11-01T00:00:00Z"),
  ).observed;
  expect(shown).toHaveLength(12);
  expect(shown[0]).toEqual({ period: "2025-11", volume: 3 });
  expect(shown.at(-1)).toEqual({ period: "2026-10", volume: 14 });
});
