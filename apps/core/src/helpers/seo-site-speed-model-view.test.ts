import { describe, expect, it } from "vitest";

import { fitToolResult } from "@/lib/soko-bot/tool-result-fit";

import { modelSiteSpeed } from "./seo-site-speed-model-view";

const WEEKS = 400;
const week = (i: number) =>
  new Date(Date.UTC(2019, 0, 6 + 7 * i)).toISOString().slice(0, 10);

function siteSpeed() {
  const weeks = Array.from({ length: WEEKS }, (_, i) => week(i));
  return {
    rows: [
      {
        url: "https://example.test/",
        audited: true,
        cause: "audited",
        tier: "full",
        devices: [
          {
            pageUrl: "https://example.test/",
            testedUrl: "https://example.test/",
            device: "mobile",
            lab: { status: "missing" },
            field: {
              status: "measured",
              level: "url",
              url: "https://example.test/",
              p75: { lcp: 1000, cls: 0, fcp: null, inp: 50, ttfb: null },
              period: { first: "2026-10-01", last: "2026-10-28" },
              history: {
                status: "comparable",
                weeks,
                lcp: weeks.map((_, i) => 1000 + i),
                inp: weeks.map((_, i) => (i % 3 === 0 ? null : 2000 + i)),
              },
            },
          },
        ],
      },
    ],
    dropped: 0,
  } as unknown as Parameters<typeof modelSiteSpeed>[0];
}

describe("modelSiteSpeed", () => {
  it("keeps each History value with its week when a long tool result is cut", () => {
    const fitted = fitToolResult("get_seo_workspace", {
      siteSpeed: modelSiteSpeed(siteSpeed()),
    } as never) as {
      result: {
        siteSpeed: {
          rows: {
            devices: {
              field: {
                history: {
                  weeks: { week: string; lcp: number; inp: number | null }[];
                };
              };
            }[];
          }[];
        };
      };
      omitted: Record<string, number>;
    };
    const kept = fitted.result.siteSpeed.rows[0].devices[0].field.history.weeks;
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThan(WEEKS);
    expect(kept[0].week).toBe(week(WEEKS - 1));
    for (const entry of kept) {
      const i = WEEKS - 1 - kept.indexOf(entry);
      expect(entry).toEqual({
        week: week(i),
        lcp: 1000 + i,
        inp: i % 3 === 0 ? null : 2000 + i,
      });
    }
  });
});
