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
  turnFindMany,
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
// Reverting to an approved month restarts its production in the background;
// `cmo-production.service.test.ts` covers that run.
vi.mock("@/services/cmo-production.service", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/services/cmo-production.service")
  >()),
  kickCmoProduction: vi.fn(),
}));

import { cmoReportForOwner } from "@/helpers/cmo-report-card";
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
  it("files a production run's report as production, whatever kind Cuso gave it", async () => {
    sokoBotFindUnique.mockResolvedValue(cuso());
    await reportCmoUpdate({
      sokoBotId: "bot-1",
      turnId: "turn-1",
      toolCallId: "call-1",
      production: true,
      update: {
        kind: "request",
        headline: "16 of 40 posts have copy",
        done: [],
        upNext: [],
        changes: [],
      },
    });
    const { create } = messageUpsert.mock.calls[0]?.[0];
    expect(create.metadata.cmo_report.kind).toBe("production");
    // Sokosumi's chat shows the round as its headline alone.
    expect(create.metadata.result_preview_snapshots[0].data).toMatchObject({
      title: "16 of 40 posts have copy",
      status: "Production",
      details: [],
    });
  });

  it("rewrites the turn's card when the same turn reports again", async () => {
    sokoBotFindUnique.mockResolvedValue(cuso());
    messageFindMany.mockResolvedValue([
      {
        id: MESSAGE_ID,
        clientMessageId: "cmo-report:turn-1:call-1",
        metadata: reportMessage({ kind: "request" }).metadata,
      },
    ]);
    messageUpdate.mockImplementation(async (args) => ({
      id: args.where.id,
      createdAt: new Date("2026-10-05T09:03:00Z"),
      metadata: args.data.metadata,
    }));

    const record = await reportCmoUpdate({
      sokoBotId: "bot-1",
      turnId: "turn-1",
      toolCallId: "call-2",
      update: {
        kind: "request",
        headline: "Video and X draft ready",
        done: ["Checked the draft again"],
        upNext: [],
        changes: [],
      },
    });

    expect(messageUpsert).not.toHaveBeenCalled();
    expect(messageUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: MESSAGE_ID },
        data: expect.objectContaining({ content: "Video and X draft ready" }),
      }),
    );
    expect(record).toMatchObject({ id: MESSAGE_ID, turnId: "turn-1" });
  });

  it("rewrites the card its background run filed instead of relaying it", async () => {
    // Local e2e, 2026-11-25: the run carded "Saturday's X draft features the
    // gift set", then the chat turn carded "Saturday's X post now features it".
    sokoBotFindUnique.mockResolvedValue(cuso());
    turnFindMany.mockResolvedValue([{ id: "run-1" }]);
    messageFindMany.mockResolvedValue([
      {
        id: MESSAGE_ID,
        clientMessageId: "cmo-report:run-1:call-9",
        metadata: reportMessage({ kind: "production" }).metadata,
      },
    ]);
    messageUpdate.mockImplementation(async (args) => ({
      id: args.where.id,
      createdAt: new Date("2026-10-05T09:03:00Z"),
      metadata: args.data.metadata,
    }));

    await reportCmoUpdate({
      sokoBotId: "bot-1",
      turnId: "turn-1",
      toolCallId: "call-2",
      update: {
        kind: "request",
        headline: "Saturday's X post now features the gift set",
        done: [],
        upNext: [],
        changes: [],
      },
    });

    expect(messageUpsert).not.toHaveBeenCalled();
    expect(messageUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: MESSAGE_ID } }),
    );
  });

  it("posts a second card for the same turn's report of another kind", async () => {
    sokoBotFindUnique.mockResolvedValue(cuso());
    messageFindMany.mockResolvedValue([
      {
        id: MESSAGE_ID,
        clientMessageId: "cmo-report:turn-1:call-1",
        metadata: reportMessage({ kind: "weekly" }).metadata,
      },
    ]);

    await reportCmoUpdate({
      sokoBotId: "bot-1",
      turnId: "turn-1",
      toolCallId: "call-2",
      update: {
        kind: "request",
        headline: "Paused Instagram",
        done: [],
        upNext: [],
        changes: [],
      },
    });

    expect(messageUpsert).toHaveBeenCalledTimes(1);
    expect(messageUpdate).not.toHaveBeenCalled();
  });

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

  it("shows a chat change that waits for approval as proposed, not done", async () => {
    // Run 01a2186c: the card said the Friday posts moved; none had.
    seedStrategy(strategy, { approvedAt: new Date("2026-11-01T09:00:00Z") });
    seedStrategy(revised, { authorTurnId: "turn-1" });
    sokoBotFindUnique.mockResolvedValue(cuso());
    const update = {
      kind: "request" as const,
      headline: "Your Friday posts moved to Thursday",
      results: "Upcoming content now matches the new cadence.",
      done: ["Moved the Friday posts to Thursday"],
      upNext: [],
      changes: ["More X, less LinkedIn"],
    };
    const record = await reportCmoUpdate({
      sokoBotId: "bot-1",
      turnId: "turn-1",
      toolCallId: "call-1",
      update,
    });
    expect(record.awaitsApproval).toBe(true);
    const { create } = messageUpsert.mock.calls[0]?.[0];
    // Core's words lead; none of Cuso's claims reads as done.
    expect(create.content).toBe("A strategy change waits for your approval");
    expect(create.metadata.result_preview_snapshots[0].data).toMatchObject({
      title: "A strategy change waits for your approval",
      status: "Waits for your approval",
      summary: null,
      details: [
        {
          label: "Not yet",
          value:
            "Your upcoming posts change once you approve the new strategy.",
        },
        { label: "Proposed", value: "Your Friday posts moved to Thursday" },
        {
          label: "Proposed",
          value: "Upcoming content now matches the new cadence.",
        },
        { label: "Proposed", value: "More X, less LinkedIn" },
        { label: "Proposed", value: "Moved the Friday posts to Thursday" },
      ],
    });
    const markdown: string =
      projectUpdateMany.mock.calls[0]?.[0].data.latestUpdateMd;
    expect(markdown).toContain(
      "## TL;DR\n\nA strategy change waits for your approval",
    );
    expect(markdown).not.toContain("## Done");
    expect(markdown).not.toContain("## Results");
    // CMO's own update list ticks nothing off either.
    expect(cmoReportForOwner(record)).toMatchObject({
      headline: "A strategy change waits for your approval",
      done: [],
      changes: [],
      results: undefined,
    });

    // A request that saved no new version, or Cuso claiming the flag, is a report as before.
    messageUpsert.mockClear();
    const plain = await reportCmoUpdate({
      sokoBotId: "bot-1",
      turnId: "turn-2",
      toolCallId: "call-1",
      update: { ...update, awaitsApproval: true } as typeof update,
    });
    expect(plain.awaitsApproval).toBeUndefined();
    expect(
      messageUpsert.mock.calls[0]?.[0].create.metadata
        .result_preview_snapshots[0].data.status,
    ).toBe("Request");
  });

  it("keeps waiting for approval when the chat rewrites its run's card", async () => {
    // The background run wrote the version; the parent chat turn rewrites
    // the run's card.
    seedStrategy(strategy, { approvedAt: new Date("2026-11-01T09:00:00Z") });
    const proposed = seedStrategy(revised, { authorTurnId: "run-1" });
    sokoBotFindUnique.mockResolvedValue(cuso());
    turnFindMany.mockResolvedValue([{ id: "run-1" }]);
    messageFindMany.mockResolvedValue([
      {
        id: MESSAGE_ID,
        clientMessageId: "cmo-report:run-1:call-9",
        metadata: reportMessage({ kind: "request", awaitsApproval: true })
          .metadata,
      },
    ]);
    messageUpdate.mockImplementation(async (args) => ({
      id: args.where.id,
      createdAt: new Date("2026-10-05T09:03:00Z"),
      metadata: args.data.metadata,
    }));
    const update = {
      kind: "request" as const,
      headline: "Fridays are off now",
      done: [],
      upNext: [],
      changes: [],
    };
    const record = await reportCmoUpdate({
      sokoBotId: "bot-1",
      turnId: "turn-1",
      toolCallId: "call-2",
      update,
    });
    expect(record.awaitsApproval).toBe(true);
    const { data } = messageUpdate.mock.calls[0]?.[0];
    expect(data.content).toBe("A strategy change waits for your approval");
    expect(data.metadata.result_preview_snapshots[0].data.status).toBe(
      "Waits for your approval",
    );

    // Once the owner approved the run's version, the rewrite is a report.
    Object.assign(proposed, { approvedAt: new Date("2026-11-26T09:00:00Z") });
    messageUpdate.mockClear();
    await reportCmoUpdate({
      sokoBotId: "bot-1",
      turnId: "turn-1",
      toolCallId: "call-3",
      update,
    });
    expect(
      messageUpdate.mock.calls[0]?.[0].data.metadata.result_preview_snapshots[0]
        .data.status,
    ).toBe("Request");
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
    const review = seedStrategy(revised, { authorTurnId: "turn-1" });
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
    await revertCmoUpdate({
      projectId: "project-1",
      userId: "user-1",
      updateId: MESSAGE_ID,
    });
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
    const review = seedStrategy(revised, { authorTurnId: "turn-1" });
    cusoFind.mockResolvedValue(HIRE);
    messageFindFirst.mockResolvedValue(
      reportMessage({ previousVersionId: before.id, versionId: review.id }),
    );

    await revertCmoUpdate({
      projectId: "project-1",
      userId: "user-1",
      updateId: MESSAGE_ID,
    });

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
      revertCmoUpdate({
        projectId: "project-1",
        userId: "user-1",
        updateId: MESSAGE_ID,
      }),
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
    await revertCmoUpdate({
      projectId: "project-1",
      userId: "user-1",
      updateId: MESSAGE_ID,
    });
    expect(strategyRows).toHaveLength(1);
    expect(messageUpdate).not.toHaveBeenCalled();
  });

  it("finds nothing to revert on a card without a previous version", async () => {
    cusoFind.mockResolvedValue(HIRE);
    messageFindFirst.mockResolvedValue(reportMessage({ kind: "daily" }));
    await expect(
      revertCmoUpdate({
        projectId: "project-1",
        userId: "user-1",
        updateId: MESSAGE_ID,
      }),
    ).rejects.toThrow("Nothing to revert");
  });
});
