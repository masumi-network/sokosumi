import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cmoFindUnique,
  cmoUpdate,
  messageFindFirst,
  messageFindMany,
  messageUpdate,
  messageUpsert,
  projectUpdateMany,
  resetCmoServiceMocks,
  revised,
  sokoBotFindUnique,
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
  listCmoReports,
  reportCmoUpdate,
  revertCmoUpdate,
} from "./cmo-reports.service";

beforeEach(resetCmoServiceMocks);

const MESSAGE_ID = "0196a000-0000-7000-8000-000000000001";

function cuso(strategyHistory: unknown = null) {
  return {
    id: "bot-1",
    workspaceId: "ws-1",
    projectId: "project-1",
    sharedRoomId: "room-1",
    cmoHire: { strategyHistory },
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
    expect(record.previousStrategy).toBeUndefined();
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
      reportMessage({ previousStrategy: strategy }),
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
        previousStrategy: strategy,
      }),
    ]);
  });
});

describe("weekly change and revert", () => {
  it("lets a weekly report revert to the strategy before its turn", async () => {
    sokoBotFindUnique.mockResolvedValue(
      cuso([
        {
          savedAt: "2026-10-05T09:02:00Z",
          turnId: "turn-1",
          strategy: revised,
        },
        { savedAt: "2026-10-05T09:01:00Z", turnId: "turn-1", strategy },
        { savedAt: "2026-10-01T09:00:00Z", turnId: null, strategy: {} },
      ]),
    );
    const record = await reportCmoUpdate({
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
    // The oldest save of the turn holds the strategy before the review.
    expect(record.previousStrategy).toEqual(strategy);

    cmoFindUnique.mockResolvedValue({
      id: "cmo-1",
      sokoBotId: "bot-1",
      strategy: revised,
      strategyUpdatedAt: new Date(),
      strategyHistory: null,
    });
    messageFindFirst.mockResolvedValue(
      reportMessage({ previousStrategy: strategy }),
    );
    await revertCmoUpdate({ userId: "user-1", updateId: MESSAGE_ID });
    expect(messageFindFirst.mock.calls[0]?.[0].where).toMatchObject({
      id: MESSAGE_ID,
      senderSokoBotId: "bot-1",
      room: { sharedSokoBot: { id: "bot-1" } },
    });
    expect(cmoUpdate.mock.calls[0]?.[0].data.strategy).toMatchObject({
      summary: strategy.summary,
    });
    // The card records the revert and keeps its preview.
    const { where, data } = messageUpdate.mock.calls[0]?.[0];
    expect(where).toEqual({ id: MESSAGE_ID });
    expect(data.metadata.cmo_report.revertedAt).toBeTruthy();
    expect(data.metadata.result_preview_snapshots).toEqual([{ kept: true }]);
  });

  it("reverts a card only once", async () => {
    cmoFindUnique.mockResolvedValue({ id: "cmo-1", sokoBotId: "bot-1" });
    messageFindFirst.mockResolvedValue(
      reportMessage({
        previousStrategy: strategy,
        revertedAt: "2026-10-05T10:00:00Z",
      }),
    );
    await revertCmoUpdate({ userId: "user-1", updateId: MESSAGE_ID });
    expect(cmoUpdate).not.toHaveBeenCalled();
    expect(messageUpdate).not.toHaveBeenCalled();
  });

  it("finds nothing to revert on a card without a previous strategy", async () => {
    cmoFindUnique.mockResolvedValue({ id: "cmo-1", sokoBotId: "bot-1" });
    messageFindFirst.mockResolvedValue(reportMessage({ kind: "daily" }));
    await expect(
      revertCmoUpdate({ userId: "user-1", updateId: MESSAGE_ID }),
    ).rejects.toThrow("Nothing to revert");
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
    cmoFindUnique.mockResolvedValue({
      id: "cmo-1",
      sokoBotId: "bot-1",
      strategy: {
        ...revised,
        calendar: [scheduled, strategy.calendar[1]!, added],
      },
      strategyUpdatedAt: new Date(),
      strategyHistory: null,
    });
    messageFindFirst.mockResolvedValue(
      reportMessage({ previousStrategy: strategy }),
    );
    await revertCmoUpdate({ userId: "user-1", updateId: MESSAGE_ID });
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
    cmoFindUnique.mockResolvedValue({
      id: "cmo-1",
      sokoBotId: "bot-1",
      strategy: {
        ...revised,
        calendar: strategy.calendar.map((entry) =>
          entry.id === "b" ? { ...entry, status: "skipped" as const } : entry,
        ),
      },
      strategyUpdatedAt: new Date(),
      strategyHistory: null,
    });
    messageFindFirst.mockResolvedValue(
      reportMessage({ previousStrategy: strategy }),
    );
    await revertCmoUpdate({ userId: "user-1", updateId: MESSAGE_ID });
    const calendar = cmoUpdate.mock.calls[0]?.[0].data.strategy.calendar;
    expect(
      calendar.find((entry: { id: string }) => entry.id === "b").status,
    ).toBe("skipped");
  });
});
