import { expect, it } from "vitest";
import { normalizeGa4LandingOutcomes } from "@/lib/seo/native-ga4-landing";
import type { NativeStatisticsQuery } from "@/lib/seo/native-statistics";
import { landingOutcome } from "./seo-brief-landing-outcomes";

const query: NativeStatisticsQuery = {
  provider: "ga4",
  propertyId: "properties/1",
  pageUrls: ["https://one.test/start"],
  from: "2026-08-01",
  to: "2026-08-14",
  channel: "all",
};
const response = {
  dimensionHeaders: [
    { name: "landingPagePlusQueryString" },
    { name: "eventName" },
  ],
  metricHeaders: [{ name: "eventCount" }],
  rowCount: 1,
  rows: [
    {
      dimensionValues: [{ value: "/start" }, { value: "sign_up" }],
      metricValues: [{ value: "0" }],
    },
  ],
  metadata: { timeZone: "America/New_York" },
};
it("keeps an observed zero, omits absent events, and refuses incomplete or mismatched event rows", () => {
  expect(normalizeGa4LandingOutcomes(query, response)).toEqual({
    timeZone: "America/New_York",
    rows: [{ pageUrl: query.pageUrls[0], event: "sign_up", count: 0 }],
  });
  for (const patch of [
    { rowCount: 2 },
    { metricHeaders: [{ name: "keyEvents" }] },
    { metadata: { subjectToThresholding: true } },
    { metadata: { dataLossFromOtherRow: true } },
    { metadata: { samplingMetadatas: [{}] } },
    {
      rows: [
        {
          ...response.rows[0],
          dimensionValues: [{ value: "/other" }, { value: "sign_up" }],
        },
      ],
    },
    {
      rows: [
        {
          ...response.rows[0],
          dimensionValues: [{ value: "/start" }, { value: "another_event" }],
        },
      ],
    },
    { rowCount: 2, rows: [...response.rows, ...response.rows] },
  ])
    expect(() =>
      normalizeGa4LandingOutcomes(query, { ...response, ...patch }),
    ).toThrow();
});
it("compares only closed equal periods around the property's local change date with matching weekday mix and source", () => {
  // The UTC change falls on August 15 in New York, which cannot belong to either measurement.
  const changed = "2026-08-16T01:00:00Z";
  const sample = {
    dataset: "property-1",
    zone: "America/New_York",
    collectedAt: new Date("2026-09-10T12:00:00Z"),
    from: "2026-08-01",
    to: "2026-08-14",
    count: 4,
  };
  const after = { ...sample, from: "2026-08-16", to: "2026-08-29", count: 8 };
  const result = landingOutcome("purchase", [after, sample], changed);
  expect(result?.comparison).toEqual({
    before: { from: sample.from, to: sample.to, count: 4 },
    after: { from: after.from, to: after.to, count: 8 },
  });
  for (const earlier of [
    { ...sample, to: "2026-08-15" },
    { ...sample, from: "2026-08-02" },
    { ...sample, dataset: "property-2" },
    { ...sample, collectedAt: new Date("2026-08-14T16:00:00Z") },
  ])
    expect(landingOutcome("purchase", [after, earlier], changed)).toEqual({
      event: "purchase",
      latest: result!.latest,
    });
  expect(landingOutcome("purchase", [], changed)).toBeUndefined();
});
