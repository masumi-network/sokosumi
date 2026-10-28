import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cusoFind,
  messageFindFirst,
  messageFindMany,
  messageUpdate,
  messageUpsert,
  projectUpdateMany,
  resetCmoServiceMocks,
  revised,
  seedStrategy,
  sokoBotFindUnique,
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
  listCmoReports,
  reportCmoUpdate,
  revertCmoUpdate,
} from "./cmo-reports.service";

beforeEach(resetCmoServiceMocks);

const MESSAGE_ID = "0196a000-0000-7000-8000-000000000001";
const HIRE = {
  sokoBotId: "bot-1",
  projectId: "project-1",
  workspaceId: "ws-1",
};

function cuso() {
  return {
    id: "bot-1",
    workspaceId: "ws-1",
    projectId: "project-1",
    sharedRoomId: "room-1",
    versionId: "cmo-v1",
  };
}

/** A report card in Cuso's shared room, as report_update writes it. */
function reportMessage(report: Record<string, unknown>) {
  return {
    id: MESSAGE_ID,
    createdAt: new Date("2026-10-05T09:03:00Z"),
    metadata: {
      cmo_report: {
        kind: "weekly",
        headline: "Week 1",
        done: [],
        upNext: [],
        changes: [],
        ...report,
      },
      result_preview_snapshots: [{ kept: true }],
    },
  };
}

describe("report_update", () => {
  it("posts the report as a result card in Cuso's shared room", async () => {
    sokoBotFindUnique.mockResolvedValue(cuso());
    const record = await reportCmoUpdate({
      sokoBotId: "bot-1",
      turnId: "turn-1",
      toolCallId: "call-1",
      update: {
        kind: "daily",
        headline: "Three posts scheduled",
        done: ["Drafted Monday's post"],
        upNext: ["Answer comments"],
        changes: [],
      },
    });
    const { where, create } = messageUpsert.mock.calls[0]?.[0];
    // A retried tool call finds its card instead of posting a second one.
    expect(where).toEqual({
      roomId_clientMessageId: {
        roomId: "room-1",
        clientMessageId: "cmo-report:turn-1:call-1",
      },
    });
    expect(create).toMatchObject({
      roomId: "room-1",
      senderSokoBotId: "bot-1",
      content: "Three posts scheduled",
    });
    expect(create.metadata.result_preview_snapshots).toEqual([
      expect.objectContaining({
        workspaceId: "ws-1",
        reference: { kind: "cmo_report", id: create.id },
        data: expect.objectContaining({
          kind: "cmo_report",
          title: "Three posts scheduled",
          status: "Daily",
          details: [
            { label: "Done", value: "Drafted Monday's post" },
            { label: "Up next", value: "Answer comments" },
          ],
        }),
      }),
    ]);
    expect(record).toMatchObject({ id: create.id, kind: "daily" });
    expect(record.previousVersionId).toBeUndefined();
  });

  it("makes the newest report the Project's latest update, unless Project memory holds it", async () => {
    sokoBotFindUnique.mockResolvedValue(cuso());
    await reportCmoUpdate({
      sokoBotId: "bot-1",
      turnId: "turn-1",
      toolCallId: "call-1",
      update: {
        kind: "weekly",
        headline: "Week 1",
        done: [],
        upNext: [],
        changes: ["Two more LinkedIn posts a week"],
        results: "No provider metrics yet.",
      },
    });
    const { where, data } = projectUpdateMany.mock.calls[0]?.[0];
    expect(where).toEqual({
      id: "project-1",
      OR: [
        { contextMdUpdatingSince: null },
        { contextMdUpdatingSince: { lt: expect.any(Date) } },
      ],
    });
    expect(data.latestUpdateMd).toBe(
      [
        "# Weekly report",
        "",
        "## TL;DR",
        "",
        "Week 1",
        "",
        "## Results",
        "",
        "No provider metrics yet.",
        "",
        "## Changes",
        "",
        "- Two more LinkedIn posts a week",
      ].join("\n"),
    );
    expect(data.latestUpdateMdUpdatedAt).toBeInstanceOf(Date);
  });

  it("refuses a Cuso without a shared room", async () => {
    sokoBotFindUnique.mockResolvedValue({ ...cuso(), sharedRoomId: null });
    await expect(
      reportCmoUpdate({
        sokoBotId: "bot-1",
        turnId: "turn-1",
        toolCallId: "call-1",
        update: {
          kind: "daily",
          headline: "Today",
          done: [],
          upNext: [],
          changes: [],
        },
      }),
    ).rejects.toThrow();
    expect(messageUpsert).not.toHaveBeenCalled();
  });
});

describe("reports from the room", () => {
  it("reads Cuso's report cards, newest first", async () => {
    messageFindMany.mockResolvedValue([
      reportMessage({ previousVersionId: "strategy-0" }),
    ]);
    const reports = await listCmoReports("bot-1", 60);
    const query = messageFindMany.mock.calls[0]?.[0];
    expect(query.where).toMatchObject({
      senderSokoBotId: "bot-1",
      deletedAt: null,
      room: { sharedSokoBot: { id: "bot-1" } },
    });
    expect(query.orderBy).toEqual({ createdAt: "desc" });
    expect(reports).toEqual([
      expect.objectContaining({
        id: MESSAGE_ID,
        at: "2026-10-05T09:03:00.000Z",
        headline: "Week 1",
        previousVersionId: "strategy-0",
      }),
    ]);
  });
});

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
    sokoBotFindUnique.mockResolvedValue(cuso());
    const record = await reportCmoUpdate({
      sokoBotId: "bot-1",
      turnId: "turn-1",
      toolCallId: "call-1",
      update: weekly,
    });
    expect(record).toMatchObject({
      previousVersionId: before.id,
      versionId: review.id,
    });

    // The owner approved the review's version, then reverts from the card.
    Object.assign(before, { approvedAt: null });
    Object.assign(review, { approvedAt: new Date("2026-10-05T09:00:00Z") });
    cusoFind.mockResolvedValue(HIRE);
    messageFindFirst.mockResolvedValue(
      reportMessage({ previousVersionId: before.id, versionId: review.id }),
    );
    await revertCmoUpdate({ userId: "user-1", updateId: MESSAGE_ID });
    expect(messageFindFirst.mock.calls[0]?.[0].where).toMatchObject({
      id: MESSAGE_ID,
      senderSokoBotId: "bot-1",
      room: { sharedSokoBot: { id: "bot-1" } },
    });
    expect(strategyRows.filter((row) => row.approvedAt)).toEqual([
      expect.objectContaining({ id: before.id, approvedByUserId: "user-1" }),
    ]);
    // The card records the revert and keeps its preview.
    const { where, data } = messageUpdate.mock.calls[0]?.[0];
    expect(where).toEqual({ id: MESSAGE_ID });
    expect(data.metadata.cmo_report.revertedAt).toBeTruthy();
    expect(data.metadata.result_preview_snapshots).toEqual([{ kept: true }]);
  });

  it("discards the review's version while it still waits for approval", async () => {
    const before = seedStrategy(strategy, {
      approvedAt: new Date("2026-10-01T09:00:00Z"),
      approvedByUserId: "user-2",
    });
    const review = seedStrategy(revised, { turnId: "turn-1" });
    cusoFind.mockResolvedValue(HIRE);
    messageFindFirst.mockResolvedValue(
      reportMessage({ previousVersionId: before.id, versionId: review.id }),
    );

    await revertCmoUpdate({ userId: "user-1", updateId: MESSAGE_ID });

    expect(strategyRows).toEqual([
      expect.objectContaining({ id: before.id, approvedByUserId: "user-2" }),
    ]);
    const { data } = messageUpdate.mock.calls[0]?.[0];
    expect(data.metadata.cmo_report.revertedAt).toBeTruthy();
  });

  it("leaves the card unreverted when the review's version is gone", async () => {
    const before = seedStrategy(strategy, {
      approvedAt: new Date("2026-10-01T09:00:00Z"),
    });
    cusoFind.mockResolvedValue(HIRE);
    messageFindFirst.mockResolvedValue(
      reportMessage({ previousVersionId: before.id, versionId: "gone" }),
    );

    await expect(
      revertCmoUpdate({ userId: "user-1", updateId: MESSAGE_ID }),
    ).rejects.toThrow("Nothing to revert");
    expect(messageUpdate).not.toHaveBeenCalled();
  });

  it("offers no revert when the review wrote no new version", async () => {
    seedStrategy(strategy, { approvedAt: new Date("2026-10-01T09:00:00Z") });
    sokoBotFindUnique.mockResolvedValue(cuso());
    const record = await reportCmoUpdate({
      sokoBotId: "bot-1",
      turnId: "turn-1",
      toolCallId: "call-1",
      update: weekly,
    });
    expect(record.previousVersionId).toBeUndefined();
  });

  it("reverts a card only once", async () => {
    const before = seedStrategy(strategy);
    cusoFind.mockResolvedValue(HIRE);
    messageFindFirst.mockResolvedValue(
      reportMessage({
        previousVersionId: before.id,
        versionId: before.id,
        revertedAt: "2026-10-05T10:00:00Z",
      }),
    );
    await revertCmoUpdate({ userId: "user-1", updateId: MESSAGE_ID });
    expect(strategyRows).toHaveLength(1);
    expect(messageUpdate).not.toHaveBeenCalled();
  });

  it("finds nothing to revert on a card without a previous version", async () => {
    cusoFind.mockResolvedValue(HIRE);
    messageFindFirst.mockResolvedValue(reportMessage({ kind: "daily" }));
    await expect(
      revertCmoUpdate({ userId: "user-1", updateId: MESSAGE_ID }),
    ).rejects.toThrow("Nothing to revert");
  });
});
