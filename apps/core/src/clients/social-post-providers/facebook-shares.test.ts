import { describe, expect, it } from "vitest";

import { facebookInsightShareCount } from "./facebook-shares";

function insight(overrides: {
  name?: string;
  total?: unknown;
  first?: unknown;
}): Record<string, unknown> {
  return {
    data: [
      {
        name: overrides.name ?? "post_activity_by_action_type",
        total_value:
          overrides.total === undefined
            ? undefined
            : { value: overrides.total },
        values:
          overrides.first === undefined
            ? undefined
            : [{ value: overrides.first }],
      },
    ],
  };
}

describe("facebookInsightShareCount", () => {
  it("reads shares from the Insights action breakdown", () => {
    expect(facebookInsightShareCount(insight({ total: { share: 4 } }))).toBe(4);
    expect(facebookInsightShareCount(insight({ total: { shares: 7 } }))).toBe(
      7,
    );
  });

  it("falls back to the first values bucket when the total is missing", () => {
    expect(facebookInsightShareCount(insight({ first: { share: 3 } }))).toBe(3);
  });

  it("accepts a whole-number string and rejects a fraction", () => {
    expect(facebookInsightShareCount(insight({ total: { share: "12" } }))).toBe(
      12,
    );
    expect(
      facebookInsightShareCount(insight({ total: { share: "12.5" } })),
    ).toBeNull();
  });

  it("skips other metrics and missing payloads", () => {
    expect(
      facebookInsightShareCount(
        insight({ name: "post_impressions", total: { share: 9 } }),
      ),
    ).toBeNull();
    expect(facebookInsightShareCount(null)).toBeNull();
    expect(facebookInsightShareCount({ data: [] })).toBeNull();
    expect(
      facebookInsightShareCount(insight({ total: { share: -1 } })),
    ).toBeNull();
  });
});
