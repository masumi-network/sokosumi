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
  approveCmoStrategy,
  cmoBusinessNameFromUrl,
  cmoExecutionRefusal,
  cmoUpNext,
  hasActiveCmoSubscription,
  parseCmoUpdates,
  reportCmoUpdate,
  revertCmoUpdate,
  saveCmoStrategy,
} from "./cmo.service";

const strategy = {
  month: "2026-10",
  summary: "Founder-led LinkedIn posts that show the product working.",
  goals: ["More demo requests"],
  pillars: ["Product stories"],
  channels: [{ channel: "linkedin", cadence: "3 a week" }],
  calendar: [
    {
      id: "a",
      date: "2026-10-20",
      channel: "linkedin",
      title: "Customer story",
      format: "post",
      status: "draft" as const,
    },
    {
      id: "b",
      date: "2026-10-02",
      channel: "linkedin",
      title: "Old post",
      format: "post",
      status: "draft" as const,
    },
    {
      id: "c",
      date: "2026-10-08",
      channel: "linkedin",
      title: "Published",
      format: "post",
      status: "published" as const,
    },
  ],
  previews: [],
};
const revised = { ...strategy, summary: "Twice the LinkedIn posts." };

beforeEach(() => {
  vi.clearAllMocks();
  cmoUpdate.mockImplementation(async (args) => ({ id: "cmo-1", ...args.data }));
});

describe("strategy approval → execution gate", () => {
  const workspace = (approvedAt: Date | null) => ({
    id: "cmo-1",
    organizationId: "org-1",
    strategy,
    strategyApprovedAt: approvedAt,
  });

  it("leaves every non-CMO bot alone", async () => {
    expect(
      await cmoExecutionRefusal({ sokoBotId: "bot-1", versionId: "v19" }),
    ).toBeNull();
    expect(cmoFindUnique).not.toHaveBeenCalled();
  });

  it("refuses before the owner approves, even when subscribed", async () => {
    cmoFindUnique.mockResolvedValue(workspace(null));
    subscriptionFindFirst.mockResolvedValue({ id: "sub-1" });
    expect(
      await cmoExecutionRefusal({ sokoBotId: "bot-1", versionId: "cmo-v1" }),
    ).toMatch(/approved/);
  });

  it("refuses without a subscription after approval", async () => {
    cmoFindUnique.mockResolvedValue(workspace(new Date()));
    subscriptionFindFirst.mockResolvedValue(null);
    expect(
      await cmoExecutionRefusal({ sokoBotId: "bot-1", versionId: "cmo-v1" }),
    ).toMatch(/subscribe/);
  });

  it("executes once approved and subscribed, with no per-post approval", async () => {
    cmoFindUnique.mockResolvedValue(workspace(new Date()));
    subscriptionFindFirst.mockResolvedValue({ id: "sub-1" });
    expect(
      await cmoExecutionRefusal({ sokoBotId: "bot-1", versionId: "cmo-v1" }),
    ).toBeNull();
  });

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
});

describe("approveCmoStrategy", () => {
  it("approves once and keeps the first approval time", async () => {
    const first = new Date("2026-10-01T09:00:00Z");
    cmoFindUnique.mockResolvedValue({
      id: "cmo-1",
      strategy,
      strategyApprovedAt: first,
    });
    await approveCmoStrategy("user-1");
    expect(cmoUpdate.mock.calls[0]?.[0].data.strategyApprovedAt).toBe(first);
  });

  it("needs a strategy", async () => {
    cmoFindUnique.mockResolvedValue({ id: "cmo-1", strategy: null });
    await expect(approveCmoStrategy("user-1")).rejects.toThrow(/no strategy/i);
  });
});

describe("weekly change and revert", () => {
  it("keeps the replaced strategy with the turn that replaced it", async () => {
    cmoFindUnique.mockResolvedValue({
      id: "cmo-1",
      strategy,
      strategyUpdatedAt: new Date("2026-10-01T09:00:00Z"),
      strategyHistory: null,
    });
    await saveCmoStrategy({ sokoBotId: "bot-1" }, revised, {
      turnId: "turn-1",
    });
    const history = cmoUpdate.mock.calls[0]?.[0].data.strategyHistory;
    expect(history).toEqual([
      expect.objectContaining({ turnId: "turn-1", strategy }),
    ]);
  });

  it("lets a weekly report revert to the strategy before its turn", async () => {
    cmoFindUnique.mockResolvedValue({
      id: "cmo-1",
      updates: null,
      strategyHistory: [
        {
          savedAt: "2026-10-05T09:02:00Z",
          turnId: "turn-1",
          strategy: revised,
        },
        { savedAt: "2026-10-05T09:01:00Z", turnId: "turn-1", strategy },
        { savedAt: "2026-10-01T09:00:00Z", turnId: null, strategy: {} },
      ],
    });
    const record = await reportCmoUpdate({
      sokoBotId: "bot-1",
      turnId: "turn-1",
      update: {
        kind: "weekly",
        headline: "Week 1",
        done: [],
        upNext: [],
        changes: ["Two more LinkedIn posts a week"],
        results: "No provider metrics yet.",
      },
    });
    // The oldest save of the turn holds the strategy before the review.
    expect(record.previousStrategy).toEqual(strategy);

    cmoUpdate.mockClear();
    cmoFindUnique.mockResolvedValue({
      id: "cmo-1",
      strategy: revised,
      strategyUpdatedAt: new Date(),
      strategyHistory: null,
      updates: [record],
    });
    await revertCmoUpdate({ userId: "user-1", updateId: record.id });
    expect(cmoUpdate.mock.calls[0]?.[0].data.strategy).toMatchObject({
      summary: strategy.summary,
    });
    const updates = parseCmoUpdates(cmoUpdate.mock.calls[1]?.[0].data.updates);
    expect(updates[0]?.revertedAt).toBeTruthy();
  });

  it("does not offer a revert for a daily report", async () => {
    cmoFindUnique.mockResolvedValue({
      id: "cmo-1",
      updates: null,
      strategyHistory: [{ savedAt: "x", turnId: "turn-2", strategy }],
    });
    const record = await reportCmoUpdate({
      sokoBotId: "bot-1",
      turnId: "turn-2",
      update: {
        kind: "daily",
        headline: "Today",
        done: ["Drafted Monday's post"],
        upNext: [],
        changes: [],
      },
    });
    expect(record.previousStrategy).toBeUndefined();
  });
});

describe("cmoUpNext", () => {
  it("lists open entries from today on, soonest first", () => {
    const items = cmoUpNext(
      { ...strategy, channels: [], goals: ["x"] },
      new Date("2026-10-05T10:00:00Z"),
    );
    expect(items.map((item) => item.id)).toEqual(["a"]);
  });
});

describe("cmoBusinessNameFromUrl", () => {
  it("uses the domain", () => {
    expect(cmoBusinessNameFromUrl("https://www.acme.io/about")).toBe("acme.io");
    expect(cmoBusinessNameFromUrl("not a url")).toBe("not a url");
  });
});
