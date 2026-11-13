import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ findFirst: vi.fn() }));

vi.mock("@/lib/db/prisma", () => ({
  default: { cmoSubscription: { findFirst: m.findFirst } },
}));

import { cmoSubscriptionBilling } from "./cmo-subscription.service";

const PROJECT_ID = "0190a000-0000-7000-8000-000000000001";

beforeEach(() => {
  vi.resetAllMocks();
});

describe("cmoSubscriptionBilling", () => {
  it("reads the Project's subscription that has not ended", async () => {
    m.findFirst.mockResolvedValue({
      tier: "growth",
      interval: "month",
      status: "active",
      currentPeriodEnd: new Date("2027-01-13T10:00:00.000Z"),
      cancelAtPeriodEnd: true,
    });

    await expect(cmoSubscriptionBilling(PROJECT_ID)).resolves.toEqual({
      tier: "growth",
      interval: "month",
      status: "active",
      periodEnd: new Date("2027-01-13T10:00:00.000Z"),
      cancelAtPeriodEnd: true,
    });
    expect(m.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId: PROJECT_ID, endedAt: null },
      }),
    );
  });

  it("is empty once the subscription ended, so the checkout is offered again", async () => {
    m.findFirst.mockResolvedValue(null);

    await expect(cmoSubscriptionBilling(PROJECT_ID)).resolves.toEqual({
      tier: null,
      interval: null,
      status: null,
      periodEnd: null,
      cancelAtPeriodEnd: false,
    });
  });
});
