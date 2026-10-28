import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cmoFindUnique,
  cmoUpdate,
  resetCmoServiceMocks,
  revised,
  seedStrategy,
  strategy,
  strategyRows,
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
  const weekly = {
    kind: "weekly" as const,
    headline: "Week 1",
    done: [],
    upNext: [],
    changes: ["Two more LinkedIn posts a week"],
    results: "No provider metrics yet.",
  };

  it("lets a weekly report revert to the version approved before its turn", async () => {
    const before = seedStrategy(strategy, {
      approvedAt: new Date("2026-10-01T09:00:00Z"),
    });
    const review = seedStrategy(revised, { turnId: "turn-1" });
    cmoFindUnique.mockResolvedValue({
      id: "cmo-1",
      projectId: "project-1",
      workspaceId: "ws-1",
      updates: null,
    });
    const record = await reportCmoUpdate({
      sokoBotId: "bot-1",
      turnId: "turn-1",
      update: weekly,
    });
    expect(record.previousVersionId).toBe(before.id);

    // The owner approved the review's version, then reverts from the card.
    Object.assign(before, { approvedAt: null });
    Object.assign(review, { approvedAt: new Date("2026-10-05T09:00:00Z") });
    cmoUpdate.mockClear();
    cmoFindUnique.mockResolvedValue({
      id: "cmo-1",
      projectId: "project-1",
      workspaceId: "ws-1",
      updates: [record],
    });
    await revertCmoUpdate({ userId: "user-1", updateId: record.id });

    expect(strategyRows.filter((row) => row.approvedAt)).toEqual([
      expect.objectContaining({ id: before.id, approvedByUserId: "user-1" }),
    ]);
    const updates = parseCmoUpdates(cmoUpdate.mock.calls[0]?.[0].data.updates);
    expect(updates[0]?.revertedAt).toBeTruthy();
  });

  it("offers no revert when the review wrote no new version", async () => {
    seedStrategy(strategy, { approvedAt: new Date("2026-10-01T09:00:00Z") });
    cmoFindUnique.mockResolvedValue({
      id: "cmo-1",
      projectId: "project-1",
      updates: null,
    });
    const record = await reportCmoUpdate({
      sokoBotId: "bot-1",
      turnId: "turn-1",
      update: weekly,
    });
    expect(record.previousVersionId).toBeUndefined();
  });

  it("does not offer a revert for a daily report", async () => {
    seedStrategy(strategy, { approvedAt: new Date("2026-10-01T09:00:00Z") });
    seedStrategy(revised, { turnId: "turn-2" });
    cmoFindUnique.mockResolvedValue({
      id: "cmo-1",
      projectId: "project-1",
      updates: null,
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
    expect(record.previousVersionId).toBeUndefined();
  });
});
