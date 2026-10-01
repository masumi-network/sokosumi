import { beforeEach, describe, expect, it, vi } from "vitest";

const { cmoFindUnique, cmoUpdate, subscriptionFindFirst } = vi.hoisted(() => ({
  cmoFindUnique: vi.fn(),
  cmoUpdate: vi.fn(),
  subscriptionFindFirst: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    cmoWorkspace: { findUnique: cmoFindUnique, update: cmoUpdate },
    subscription: { findFirst: subscriptionFindFirst },
  },
}));

import {
  cmoBusinessNameFromUrl,
  cmoExecutionRefusal,
  hasActiveCmoSubscription,
  saveCmoStrategy,
} from "./cmo.service";

const strategy = {
  month: "2026-10",
  summary: "Founder-led LinkedIn posts that show the product working.",
  goals: ["More demo requests"],
  pillars: ["Product stories"],
  channels: [
    {
      channel: "linkedin",
      cadence: "3 a week",
      autonomy: "autopilot" as const,
    },
    { channel: "x", cadence: "daily", autonomy: "autopilot" as const },
  ],
  calendar: [],
  reviewMode: "suggest" as const,
  weeklyReviews: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  cmoUpdate.mockImplementation(async (args) => ({ id: "cmo-1", ...args.data }));
});

describe("saveCmoStrategy", () => {
  it("keeps the owner's autonomy when Cuso rewrites the plan", async () => {
    cmoFindUnique.mockResolvedValue({
      id: "cmo-1",
      strategy: {
        ...strategy,
        channels: [
          { channel: "linkedin", cadence: "weekly", autonomy: "drafts" },
        ],
      },
    });
    await saveCmoStrategy({ sokoBotId: "bot-1" }, strategy, { byOwner: false });
    const saved = cmoUpdate.mock.calls[0]?.[0].data.strategy;
    // LinkedIn stays drafts only; a new channel starts at "ask".
    expect(saved.channels).toEqual([
      { channel: "linkedin", cadence: "3 a week", autonomy: "drafts" },
      { channel: "x", cadence: "daily", autonomy: "ask" },
    ]);
  });

  it("lets the owner set autonomy", async () => {
    cmoFindUnique.mockResolvedValue({ id: "cmo-1", strategy: null });
    await saveCmoStrategy({ userId: "user-1" }, strategy, { byOwner: true });
    const saved = cmoUpdate.mock.calls[0]?.[0].data.strategy;
    expect(saved.channels[0].autonomy).toBe("autopilot");
  });
});

describe("CMO execution gate", () => {
  it("counts only active paid plans", async () => {
    subscriptionFindFirst.mockResolvedValue(null);
    expect(await hasActiveCmoSubscription("org-1")).toBe(false);
    expect(subscriptionFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          referenceId: "org-1",
          status: { in: ["active", "trialing"] },
        }),
      }),
    );
  });

  it("leaves every non-CMO bot alone", async () => {
    expect(
      await cmoExecutionRefusal({
        sokoBotId: "bot-1",
        versionId: "v19",
        provider: "x",
        ownerPresent: false,
      }),
    ).toBeNull();
    expect(cmoFindUnique).not.toHaveBeenCalled();
  });

  it("refuses an ask channel on Cuso's own run, allows it with the owner", async () => {
    cmoFindUnique.mockResolvedValue({
      id: "cmo-1",
      organizationId: "org-1",
      strategy: {
        ...strategy,
        channels: [{ ...strategy.channels[0], autonomy: "ask" }],
      },
    });
    subscriptionFindFirst.mockResolvedValue({ id: "sub-1" });
    const gate = (ownerPresent: boolean) =>
      cmoExecutionRefusal({
        sokoBotId: "bot-1",
        versionId: "cmo-v1",
        provider: "linkedin",
        ownerPresent,
      });
    expect(await gate(false)).toMatch(/go-ahead/);
    expect(await gate(true)).toBeNull();
  });
});

describe("cmoBusinessNameFromUrl", () => {
  it("uses the domain", () => {
    expect(cmoBusinessNameFromUrl("https://www.acme.io/about")).toBe("acme.io");
    expect(cmoBusinessNameFromUrl("not a url")).toBe("not a url");
  });
});
