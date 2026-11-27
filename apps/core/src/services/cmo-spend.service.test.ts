import { describe, expect, it, vi } from "vitest";

const { botFindManyMock } = vi.hoisted(() => ({
  botFindManyMock: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    sokoBot: { findMany: botFindManyMock },
    evalLane: {
      findMany: vi
        .fn()
        .mockResolvedValue([{ workspaceId: "ws_eval", cusoProjectId: null }]),
    },
  },
}));

import { cmoSpend, planChecks } from "./cmo-spend.service";

describe("cmoSpend", () => {
  it.each([
    ["exclude", { workspaceId: { notIn: ["ws_eval"] } }],
    ["only", { workspaceId: { in: ["ws_eval"] } }],
    ["include", {}],
  ] as const)(
    "with evals %s, filters eval-lane Cusos",
    async (evals, filter) => {
      await cmoSpend(new Date(), evals);

      expect(botFindManyMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: { AND: [expect.any(Object), filter] },
        }),
      );
    },
  );

  it("leaves eval-lane Cusos out by default", async () => {
    await cmoSpend(new Date());

    expect(botFindManyMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: {
          AND: [expect.any(Object), { workspaceId: { notIn: ["ws_eval"] } }],
        },
      }),
    );
  });
});

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
