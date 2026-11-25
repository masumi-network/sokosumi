import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import { describe, expect, it } from "vitest";
import { seoRankHistory } from "./seo-rank-history-model";
import { seoTestKeyword } from "./seo-test-fixture";

type Keyword = ProjectSeoWorkspace["keywords"][number];
type Point = NonNullable<Keyword["positionHistory"]>[number];

const point = (
  observedAt: string,
  position: number | null,
  positionStatus: Point["positionStatus"] = position === null
    ? "not_in_range"
    : "ranked",
): Point => ({
  observedAt: new Date(observedAt),
  observationId: "observation",
  position,
  positionStatus,
  device: "desktop",
  checkedResults: 20,
});

function row(device: Keyword["device"], history?: Point[]): Keyword {
  return seoTestKeyword({
    device,
    positionHistory: history?.map((item) => ({ ...item, device })),
  });
}

describe("seoRankHistory", () => {
  it("keeps the newest read of a day, a not-found read with the results it checked, and drops a failed read", () => {
    const [series] = seoRankHistory([
      row("desktop", [
        point("2026-10-01T08:00:00Z", 9),
        point("2026-10-01T18:00:00Z", 7),
        point("2026-10-02T09:00:00Z", null),
        point("2026-10-03T09:00:00Z", null, "unavailable"),
        point("2026-10-04T09:00:00Z", 5),
        { ...point("2026-10-06T09:00:00Z", null), checkedResults: 100 },
        // A point of a Core that does not send the checked results yet.
        { ...point("2026-10-05T09:00:00Z", null), checkedResults: undefined },
      ]),
    ]);
    expect(series).toEqual({
      device: "desktop",
      points: [
        { date: "2026-10-01", value: 7 },
        { date: "2026-10-02", value: null, outside: { top: 20 } },
        { date: "2026-10-04", value: 5 },
        { date: "2026-10-05", value: null, outside: { top: null } },
        { date: "2026-10-06", value: null, outside: { top: 100 } },
      ],
    });
  });

  it("puts a read on its day in the Search Console time zone", () => {
    const rows = [
      row("desktop", [
        point("2026-10-07T09:00:00Z", 9),
        // 18:00 on 7 October in Los Angeles: the same Search Console day as the read before.
        point("2026-10-08T01:00:00Z", 7),
        point("2026-10-09T09:00:00Z", 5),
      ]),
    ];
    expect(
      seoRankHistory(rows, "America/Los_Angeles")[0].points.map(
        (item) => item.date,
      ),
    ).toEqual(["2026-10-07", "2026-10-09"]);
    expect(seoRankHistory(rows)[0].points.map((item) => item.date)).toEqual([
      "2026-10-07",
      "2026-10-08",
      "2026-10-09",
    ]);
  });

  it("has no history with one day of reads, from a result before histories existed too", () => {
    expect(
      seoRankHistory([
        row("desktop", [point("2026-10-01T08:00:00Z", 9)]),
        row("mobile"),
      ]),
    ).toEqual([]);
  });

  it("keeps the series of every device once one device has a history", () => {
    const series = seoRankHistory([
      row("mobile", [point("2026-10-01T08:00:00Z", 4)]),
      row("desktop", [
        point("2026-10-01T08:00:00Z", 9),
        point("2026-10-08T08:00:00Z", 6),
      ]),
    ]);
    expect(series.map((item) => [item.device, item.points.length])).toEqual([
      ["mobile", 1],
      ["desktop", 2],
    ]);
  });

  it("keeps one series per device for rows of one device listed for two reasons", () => {
    const series = seoRankHistory([
      row("desktop", [point("2026-10-01T08:00:00Z", 9)]),
      { ...row("desktop", [point("2026-10-08T08:00:00Z", 6)]), source: "gap" },
    ]);
    expect(series).toEqual([
      {
        device: "desktop",
        points: [
          { date: "2026-10-01", value: 9 },
          { date: "2026-10-08", value: 6 },
        ],
      },
    ]);
  });
});
