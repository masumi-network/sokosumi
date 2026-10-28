import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cmoFindUnique,
  cmoUpdate,
  resetCmoServiceMocks,
  revised,
  strategy,
} from "@/test-fixtures/cmo-service";

vi.mock(
  "@/lib/db/prisma",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks.prisma,
);
vi.mock(
  "@/services/social-posts.service",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks.socialPosts,
);
vi.mock(
  "@/services/soko-bot-shared-create.service",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks.sharedCreate,
);
vi.mock(
  "@/services/soko-bot-control-plane.service",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks.controlPlane,
);
vi.mock(
  "@/helpers/organization-workspace",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks
      .organizationWorkspace,
);
vi.mock(
  "@/helpers/user-workspaces",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks
      .userWorkspaces,
);
vi.mock(
  "@/helpers/subscription",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks.subscription,
);
vi.mock(
  "@/services/soko-bot-billing.service",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks.billing,
);
vi.mock(
  "@vercel/functions",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks
      .vercelFunctions,
);
vi.mock(
  "@/services/soko-bot-integration-connection.service",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks
      .integrationConnection,
);
vi.mock("@/config/env", async (importOriginal) =>
  (await import("@/test-fixtures/cmo-service")).cmoServiceMocks.env(
    await importOriginal<typeof import("@/config/env")>(),
  ),
);

import {
  parseCmoUpdates,
  reportCmoUpdate,
  revertCmoUpdate,
} from "./cmo-reports.service";

beforeEach(resetCmoServiceMocks);

describe("weekly change and revert", () => {
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

  it("keeps entries already handed to Social when reverting", async () => {
    const postId = "6b1f6a52-0d4e-4f55-9b0e-2f1d2c3b4a5e";
    const newPostId = "7c2a7b63-1e5f-4a66-8c1f-3a2e3d4c5b6f";
    const scheduled = {
      ...strategy.calendar[0]!,
      status: "scheduled" as const,
      socialPostId: postId,
    };
    const added = {
      id: "n",
      date: "2026-10-22",
      channel: "linkedin",
      title: "Added by the review",
      format: "post",
      status: "scheduled" as const,
      socialPostId: newPostId,
    };
    const update = {
      id: "u-1",
      at: "2026-10-05T09:03:00Z",
      kind: "weekly" as const,
      headline: "Week 1",
      done: [],
      upNext: [],
      changes: [],
      previousStrategy: strategy,
    };
    cmoFindUnique.mockResolvedValue({
      id: "cmo-1",
      strategy: {
        ...revised,
        calendar: [scheduled, strategy.calendar[1]!, added],
      },
      strategyUpdatedAt: new Date(),
      strategyHistory: null,
      updates: [update],
    });
    await revertCmoUpdate({ userId: "user-1", updateId: "u-1" });
    const calendar = cmoUpdate.mock.calls[0]?.[0].data.strategy.calendar;
    expect(
      calendar.map((entry: { id: string; socialPostId?: string }) => [
        entry.id,
        entry.socialPostId,
      ]),
    ).toEqual([
      ["b", undefined],
      ["c", undefined],
      ["a", postId],
      ["n", newPostId],
    ]);
  });

  it("keeps entries the owner paused when reverting", async () => {
    const update = {
      id: "u-1",
      at: "2026-10-05T09:03:00Z",
      kind: "weekly" as const,
      headline: "Week 1",
      done: [],
      upNext: [],
      changes: [],
      previousStrategy: strategy,
    };
    cmoFindUnique.mockResolvedValue({
      id: "cmo-1",
      strategy: {
        ...revised,
        calendar: strategy.calendar.map((entry) =>
          entry.id === "b" ? { ...entry, status: "skipped" as const } : entry,
        ),
      },
      strategyUpdatedAt: new Date(),
      strategyHistory: null,
      updates: [update],
    });
    await revertCmoUpdate({ userId: "user-1", updateId: "u-1" });
    const calendar = cmoUpdate.mock.calls[0]?.[0].data.strategy.calendar;
    expect(
      calendar.find((entry: { id: string }) => entry.id === "b").status,
    ).toBe("skipped");
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
