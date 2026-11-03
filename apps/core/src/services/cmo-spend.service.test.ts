import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({ default: {} }));

import { planChecks } from "./cmo-spend.service";

const save = (minutesAgo: number, review?: Record<string, unknown>) => ({
  createdAt: new Date(Date.UTC(2026, 9, 26, 12, 0) - minutesAgo * 60_000),
  result: review ? { saved: "strategy", review } : { saved: "strategy" },
});

describe("planChecks", () => {
  it("counts reviewed saves and keeps the newest one sent back", () => {
    const checks = planChecks([
      save(1, { save: 2, mainOffer: "ok", problems: [] }),
      save(2, {
        save: 1,
        mainOffer: "drift",
        problems: ["the plan drifts from the main offer"],
      }),
      save(3, {
        save: 1,
        mainOffer: "unavailable",
        problems: ["mix is empty"],
      }),
      save(4),
    ]);
    expect(checks).toEqual({
      checked: 3,
      withProblems: 2,
      drifted: 1,
      unavailable: 1,
      last: {
        at: "2026-10-26T11:58:00.000Z",
        problems: ["the plan drifts from the main offer"],
      },
    });
  });

  it("reads saves from before the review as unchecked", () => {
    expect(planChecks([save(1), save(2)])).toMatchObject({
      checked: 0,
      last: null,
    });
  });
});
