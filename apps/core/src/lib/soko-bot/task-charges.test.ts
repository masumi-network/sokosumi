import { beforeEach, describe, expect, it, vi } from "vitest";

const { findManyMock } = vi.hoisted(() => ({ findManyMock: vi.fn() }));

vi.mock("@/lib/db/prisma", () => ({
  default: { taskEvent: { findMany: findManyMock } },
}));

import { roundCredits, taskCreditsCharged } from "./task-charges";

describe("taskCreditsCharged", () => {
  beforeEach(() => findManyMock.mockReset());

  it("sums each Task's debits and reads only debits", async () => {
    findManyMock.mockResolvedValue([
      { taskId: "a", transaction: { amount: -1_000_000_000_000n } },
      { taskId: "a", transaction: { amount: -500_000_000_000n } },
      { taskId: "b", transaction: { amount: -20_000_000_000n } },
    ]);
    const charged = await taskCreditsCharged(["a", "b", "c"]);
    expect(charged.get("a")).toBe(150);
    expect(charged.get("b")).toBe(2);
    expect(charged.has("c")).toBe(false);
    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          taskId: { in: ["a", "b", "c"] },
          transaction: { amount: { lt: 0 } },
        },
      }),
    );
  });

  it("asks nothing for no Tasks", async () => {
    expect((await taskCreditsCharged([])).size).toBe(0);
    expect(findManyMock).not.toHaveBeenCalled();
  });

  it("rounds to cents a person reads", () => {
    expect(roundCredits(421.30999999)).toBe(421.31);
  });
});
