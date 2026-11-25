import { describe, expect, it, vi } from "vitest";
import {
  BRAND_QUERY_BATCH,
  BRAND_READ_BUDGET_MS,
  readBrandSplit,
} from "./site-traffic-brand";

const period = { from: "2026-11-01", to: "2026-11-03" };
const row = (
  date: string,
  query: string,
  clicks: number,
  impressions = clicks,
) => ({
  keys: [date, query],
  clicks,
  impressions,
});
const full = (date: string, prefix: string) =>
  Array.from({ length: BRAND_QUERY_BATCH }, (_, index) =>
    row(date, `${prefix} ${index}`, 1),
  );

describe("brand split of Search Console query rows", () => {
  it("adds each day's rows to the side its query belongs to, in date order", async () => {
    const split = await readBrandSplit(["Acme"], period, async () => [
      row("2026-11-02", "acme login", 5, 9),
      row("2026-11-01", "running shoes", 2, 40),
      row("2026-11-02", "ACME shoes", 1, 3),
      row("2026-11-02", "acmeshop", 4, 4),
    ]);
    expect(split).toEqual({
      limited: false,
      daily: [
        {
          date: "2026-11-01",
          branded: { clicks: 0, impressions: 0 },
          nonBranded: { clicks: 2, impressions: 40 },
        },
        {
          date: "2026-11-02",
          branded: { clicks: 6, impressions: 12 },
          nonBranded: { clicks: 4, impressions: 4 },
        },
      ],
    });
  });

  it("reads on after a full batch and stops at a short one", async () => {
    const rows = vi.fn(async (start: number) =>
      start === 0
        ? full("2026-11-01", "acme")
        : [row("2026-11-01", "shoes", 7)],
    );
    const split = await readBrandSplit(["acme"], period, rows);
    expect(rows.mock.calls.map(([start]) => start)).toEqual([
      0,
      BRAND_QUERY_BATCH,
    ]);
    expect(split.limited).toBe(false);
    expect(split.daily).toEqual([
      {
        date: "2026-11-01",
        branded: { clicks: BRAND_QUERY_BATCH, impressions: BRAND_QUERY_BATCH },
        nonBranded: { clicks: 7, impressions: 7 },
      },
    ]);
  });

  it("marks a split that stopped at the batch limit", async () => {
    const rows = vi.fn(async (start: number) =>
      full("2026-11-01", `batch ${start}`),
    );
    const split = await readBrandSplit(["acme"], period, rows);
    expect(rows).toHaveBeenCalledTimes(6);
    expect(split.limited).toBe(true);
  });

  it("refuses a date outside the period, another grouping and a repeated row", async () => {
    for (const rows of [
      [row("2026-11-04", "acme", 1)],
      [{ keys: ["2026-11-01"], clicks: 1, impressions: 1 }],
      [row("2026-11-01", "acme", 1), row("2026-11-01", "acme", 2)],
    ])
      await expect(
        readBrandSplit(["acme"], period, async () => rows),
      ).rejects.toThrow();
  });

  it("starts no new read after the time budget and marks the split", async () => {
    let clock = 0;
    const rows = vi.fn(async () => {
      clock += BRAND_READ_BUDGET_MS;
      return full("2026-11-01", `acme ${clock}`);
    });
    const split = await readBrandSplit(["acme"], period, rows, () => clock);
    expect(rows).toHaveBeenCalledTimes(1);
    expect(split.limited).toBe(true);
  });

  it("refuses a row without a query", async () => {
    await expect(
      readBrandSplit(["acme"], period, async () => [row("2026-11-01", " ", 4)]),
    ).rejects.toThrow("Unexpected brand split row");
  });
});
