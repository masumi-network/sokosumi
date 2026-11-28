import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

const { queryRawMock } = vi.hoisted(() => ({ queryRawMock: vi.fn() }));

vi.mock("@/lib/db/prisma", () => ({
  default: {},
  networkPrisma: () => ({ $queryRaw: queryRawMock }),
}));

import { roundCredits, taskCreditsCharged } from "./task-charges";

describe("taskCreditsCharged", () => {
  beforeEach(() => queryRawMock.mockReset());

  it("sums each Task's debits and reads only debits", async () => {
    queryRawMock.mockResolvedValue([
      { taskId: "a", amount: -1_000_000_000_000n },
      { taskId: "a", amount: -500_000_000_000n },
      { taskId: "b", amount: -20_000_000_000n },
    ]);
    const charged = await taskCreditsCharged(["a", "b", "c"]);
    expect(charged.get("a")).toBe(150);
    expect(charged.get("b")).toBe(2);
    expect(charged.has("c")).toBe(false);
    expect(queryRawMock).toHaveBeenCalledOnce();
    expectTypeOf(taskCreditsCharged).parameters.toEqualTypeOf<
      [readonly string[]]
    >();
  });

  it("asks nothing for no Tasks", async () => {
    expect((await taskCreditsCharged([])).size).toBe(0);
    expect(queryRawMock).not.toHaveBeenCalled();
  });

  it("rounds to cents a person reads", () => {
    expect(roundCredits(421.30999999)).toBe(421.31);
  });
});
