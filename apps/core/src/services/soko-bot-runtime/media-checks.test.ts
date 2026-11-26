import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  countMock,
  projectFindUniqueMock,
  requireProjectAccessMock,
  delegationFindManyMock,
  turnFindFirstMock,
  watchFindFirstMock,
  scheduleRunFindFirstMock,
  scheduleFindFirstMock,
  authoritySpendFindManyMock,
} = vi.hoisted(() => ({
  countMock: vi.fn(),
  projectFindUniqueMock: vi.fn(),
  requireProjectAccessMock: vi.fn(),
  delegationFindManyMock: vi.fn(),
  turnFindFirstMock: vi.fn(),
  watchFindFirstMock: vi.fn(),
  scheduleRunFindFirstMock: vi.fn(),
  scheduleFindFirstMock: vi.fn(),
  authoritySpendFindManyMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    sokoBotToolCall: { count: countMock, findMany: vi.fn(async () => []) },
    project: { findUnique: projectFindUniqueMock },
    sokoBotDelegation: { findMany: delegationFindManyMock },
    sokoBotEventInbox: { findMany: async () => [] },
    sokoBotTurn: { findFirst: turnFindFirstMock },
    sokoBotWatch: { findFirst: watchFindFirstMock },
    sokoBotScheduleRun: { findFirst: scheduleRunFindFirstMock },
    sokoBotSchedule: { findFirst: scheduleFindFirstMock },
    sokoBotAuthoritySpend: { findMany: authoritySpendFindManyMock },
  },
}));
vi.mock("@/lib/image-studio/access", () => ({
  requireProjectAccess: requireProjectAccessMock,
}));

import { checkTalkingVideoRequest, mayMakeMediaForOwner } from "./media-checks";
import type { RuntimeOperations } from "./operations";

const runtime = {
  mayActForOwner: vi.fn(),
  refuseCmoRunMedia: vi.fn(),
  mediaPerTurn: vi.fn(),
  requireImageProject: vi.fn(),
} as unknown as RuntimeOperations;

const authorized = {
  turn: { id: "turn-1", workspaceId: "workspace-1", userId: "user-1" },
} as unknown as Parameters<typeof checkTalkingVideoRequest>[1];

const SCRIPT =
  "Your inbox is not a to-do list. Soko Bot reads every mail and leaves only what matters unread. Try it this week.";

function request(input: Record<string, unknown> = {}) {
  return checkTalkingVideoRequest(
    runtime,
    authorized,
    {
      projectId: "project-1",
      script: SCRIPT,
      presenter: "maya",
      maxCredits: 250,
      ...input,
    },
    "call-1",
  );
}

beforeEach(() => {
  vi.mocked(runtime.mayActForOwner).mockResolvedValue(true);
  vi.mocked(runtime.mediaPerTurn).mockResolvedValue({ images: 4, videos: 2 });
  countMock.mockResolvedValue(0);
  projectFindUniqueMock.mockResolvedValue({ websiteUrl: null });
  requireProjectAccessMock.mockResolvedValue({ organizationId: null });
});

describe("checkTalkingVideoRequest", () => {
  it("quotes the script on the talking video model", async () => {
    const { credits, model } = await request();

    expect(model.id).toBe("avatar-6-turbo");
    // 112 characters is about 9 s: 45 cents of video, plus the voice and
    // timing its words.
    expect(credits).toBe(47);
  });

  it("adds the cut-out to the price when the Project has a website", async () => {
    projectFindUniqueMock.mockResolvedValue({
      websiteUrl: "https://sokosumi.com",
    });

    // 9 s of cut-out at about a cent a second on top.
    expect((await request()).credits).toBe(56);
  });

  it("adds the extras the bot asked for to the price", async () => {
    expect((await request({ music: true, broll: true })).credits).toBe(107);
  });

  it("refuses an unknown presenter and passes the owner's photo on", async () => {
    await expect(request({ presenter: "patrick" })).rejects.toThrow(
      "presenter must be owner",
    );
    // Whether the owner gave a photo with consent is settled when it starts.
    await expect(request({ presenter: "owner" })).resolves.toMatchObject({
      input: { presenter: "owner" },
    });
  });

  it("refuses a script that speaks as a customer", async () => {
    await expect(
      request({
        script: "I've been using Soko Bot for a month and it changed my life.",
      }),
    ).rejects.toThrow("cannot speak as a customer");
  });

  it("refuses a price above maxCredits", async () => {
    await expect(request({ maxCredits: 20 })).rejects.toThrow(
      "more than the 20 allowed",
    );
    await expect(request({ maxCredits: 40 })).rejects.toThrow(
      /A script of at most \d+ characters fits/,
    );
  });

  it("counts talking videos against the turn's video allowance", async () => {
    countMock.mockResolvedValue(2);

    await expect(request()).rejects.toThrow("at most 2 videos");
    expect(countMock.mock.calls[0]![0].where.capability).toEqual({
      in: ["generate_video", "generate_talking_video"],
    });
  });

  it("refuses outside an owner's chat", async () => {
    vi.mocked(runtime.mayActForOwner).mockResolvedValue(false);

    await expect(request()).rejects.toThrow("only when a person asks");
  });
});

describe("mayMakeMediaForOwner", () => {
  const ownerChat = {
    source: "CHAT",
    chainDepth: 0,
    askedByUserId: null,
    requestedByUserId: "user-1",
    parentTurnId: null,
    parentTurn: null,
  };
  const eventTurn = {
    turn: { id: "event-turn", source: "EVENT" },
  } as unknown as Parameters<typeof mayMakeMediaForOwner>[1];

  beforeEach(() => {
    vi.mocked(runtime.mayActForOwner).mockResolvedValue(false);
    delegationFindManyMock.mockReset();
  });

  it("lets the turn that carries the owner's follow-up make its images", async () => {
    // "Have CodePat review the code, then make 2-3 images and a post."
    delegationFindManyMock.mockResolvedValue([{ turn: ownerChat }]);
    await expect(
      mayMakeMediaForOwner(runtime, eventTurn),
    ).resolves.toMatchObject({
      images: undefined,
      maxCredits: undefined,
    });
    expect(delegationFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { followUpTurnId: "event-turn", followUp: { not: null } },
      }),
    );
  });

  it("counts the owner's daily schedule and the runs their chat started", async () => {
    delegationFindManyMock.mockResolvedValue([
      { turn: { ...ownerChat, source: "SCHEDULE" } },
    ]);
    await expect(
      mayMakeMediaForOwner(runtime, eventTurn),
    ).resolves.toMatchObject({
      images: undefined,
      maxCredits: undefined,
    });
    delegationFindManyMock.mockResolvedValue([
      {
        turn: { ...ownerChat, parentTurnId: "chat", parentTurn: ownerChat },
      },
    ]);
    await expect(
      mayMakeMediaForOwner(runtime, eventTurn),
    ).resolves.toMatchObject({
      images: undefined,
      maxCredits: undefined,
    });
  });

  it("refuses an event turn that carries no plan the owner asked for", async () => {
    delegationFindManyMock.mockResolvedValue([]);
    await expect(mayMakeMediaForOwner(runtime, eventTurn)).resolves.toBeNull();
    delegationFindManyMock.mockResolvedValue([
      { turn: { ...ownerChat, askedByUserId: "teammate" } },
      {
        turn: {
          ...ownerChat,
          parentTurnId: "mail-check",
          parentTurn: { ...ownerChat, source: "INGEST" },
        },
      },
    ]);
    await expect(mayMakeMediaForOwner(runtime, eventTurn)).resolves.toBeNull();
  });

  it("never looks further on other turns Core started", async () => {
    await expect(
      mayMakeMediaForOwner(runtime, {
        turn: { id: "t", source: "SCHEDULE" },
      } as unknown as Parameters<typeof mayMakeMediaForOwner>[1]),
    ).resolves.toBeNull();
    expect(delegationFindManyMock).not.toHaveBeenCalled();
  });

  it("allows matching project-scoped persisted OwnerAuthority (personal and Cuso) and refuses a different Project", async () => {
    const projectGrant = {
      version: 1,
      grantId: "grant-project-a",
      origin: "owner_chat",
      sokoBotId: "bot-1",
      workspaceId: "ws-1",
      ownerUserId: "user-1",
      rootTurnId: "root-1",
      targetScope: { kind: "project", projectId: "project-a" },
      scope: "draft_and_workspace",
      socialMode: "draft_only",
      limits: {
        grantId: "grant-project-a",
        period: "lifetime",
        images: 2,
        maxMediaCredits: 20,
      },
      stopRule: { mode: "never" },
    };
    delegationFindManyMock.mockResolvedValue([
      {
        id: "del-proj",
        authority: projectGrant,
        turn: {
          ...ownerChat,
          id: "root-1",
          sokoBotId: "bot-1",
          workspaceId: "ws-1",
          versionId: "v36",
          sokoBot: { userId: "user-1", projectId: null },
        },
      },
    ]);
    const personalWake = {
      askedByKind: "OWNER",
      turn: {
        id: "event-turn",
        sokoBotId: "bot-1",
        workspaceId: "ws-1",
        versionId: "v36",
        actingUserId: "user-1",
        source: "EVENT",
      },
    } as unknown as Parameters<typeof mayMakeMediaForOwner>[1];

    await expect(
      mayMakeMediaForOwner(runtime, personalWake, { projectId: "project-a" }),
    ).resolves.toMatchObject({ images: 2, maxCredits: 20 });

    await expect(
      mayMakeMediaForOwner(runtime, personalWake, { projectId: "project-b" }),
    ).rejects.toThrow("scoped to a different Project");

    // Project Cuso shared bot (`userId: null`, `projectId: "project-cmo"`).
    delegationFindManyMock.mockResolvedValue([
      {
        id: "del-cmo",
        authority: {
          ...projectGrant,
          grantId: "grant-cmo",
          sokoBotId: "cmo-bot",
          targetScope: { kind: "project", projectId: "project-cmo" },
          socialMode: "full",
          limits: {
            grantId: "grant-cmo",
            period: "lifetime",
            images: 3,
            maxMediaCredits: 30,
          },
        },
        turn: {
          ...ownerChat,
          id: "cmo-root",
          sokoBotId: "cmo-bot",
          workspaceId: "ws-1",
          versionId: "cmo-v24",
          sokoBot: { userId: null, projectId: "project-cmo" },
        },
      },
    ]);
    const cmoWake = {
      askedByKind: "TEAMMATE",
      turn: {
        id: "event-turn",
        sokoBotId: "cmo-bot",
        workspaceId: "ws-1",
        versionId: "cmo-v24",
        actingUserId: "user-1",
        botProjectId: "project-cmo",
        source: "EVENT",
      },
    } as unknown as Parameters<typeof mayMakeMediaForOwner>[1];

    await expect(
      mayMakeMediaForOwner(runtime, cmoWake, { projectId: "project-cmo" }),
    ).resolves.toMatchObject({ images: 3, maxCredits: 30 });
    await expect(
      mayMakeMediaForOwner(runtime, cmoWake, { projectId: "project-other" }),
    ).rejects.toThrow("scoped to a different Project");

    // Mixed Project A + Project B wake preserves both grants for historical
    // attribution while summarizing Project B's own allowance.
    delegationFindManyMock.mockResolvedValue([
      {
        id: "del-a",
        authority: {
          ...projectGrant,
          grantId: "grant-project-a",
          targetScope: { kind: "project", projectId: "project-a" },
          limits: {
            grantId: "grant-project-a",
            period: "lifetime",
            images: 1,
            maxMediaCredits: 5,
          },
        },
        turn: {
          ...ownerChat,
          id: "root-a",
          sokoBotId: "bot-1",
          workspaceId: "ws-1",
          versionId: "v36",
          sokoBot: { userId: "user-1", projectId: null },
        },
      },
      {
        id: "del-b",
        authority: {
          ...projectGrant,
          grantId: "grant-project-b",
          targetScope: { kind: "project", projectId: "project-b" },
          limits: {
            grantId: "grant-project-b",
            period: "lifetime",
            images: 1,
            maxMediaCredits: 5.5,
          },
        },
        turn: {
          ...ownerChat,
          id: "root-b",
          sokoBotId: "bot-1",
          workspaceId: "ws-1",
          versionId: "v36",
          sokoBot: { userId: "user-1", projectId: null },
        },
      },
    ]);
    const mixedAllowance = await mayMakeMediaForOwner(runtime, personalWake, {
      projectId: "project-b",
    });
    expect(mixedAllowance).toMatchObject({ images: 1, maxCredits: 5.5 });
    expect(mixedAllowance?.grants?.map((g) => g.grantId).sort()).toEqual([
      "grant-project-a",
      "grant-project-b",
    ]);

    // Two Projects authorized under ONE shared grantId keep both Projects in
    // allowedProjectIds regardless of delegation order.
    const sharedRows = [
      {
        id: "del-shared-a",
        authority: {
          ...projectGrant,
          grantId: "shared-root-grant",
          targetScope: { kind: "project", projectId: "project-a" },
          limits: {
            grantId: "shared-root-grant",
            period: "lifetime",
            images: 2,
            maxMediaCredits: 10,
          },
        },
        turn: {
          ...ownerChat,
          id: "root-shared",
          sokoBotId: "bot-1",
          workspaceId: "ws-1",
          versionId: "v36",
          sokoBot: { userId: "user-1", projectId: null },
        },
      },
      {
        id: "del-shared-b",
        authority: {
          ...projectGrant,
          grantId: "shared-root-grant",
          targetScope: { kind: "project", projectId: "project-b" },
          limits: {
            grantId: "shared-root-grant",
            period: "lifetime",
            images: 2,
            maxMediaCredits: 10,
          },
        },
        turn: {
          ...ownerChat,
          id: "root-shared",
          sokoBotId: "bot-1",
          workspaceId: "ws-1",
          versionId: "v36",
          sokoBot: { userId: "user-1", projectId: null },
        },
      },
    ];
    for (const ordered of [sharedRows, [...sharedRows].reverse()]) {
      delegationFindManyMock.mockResolvedValue(ordered);
      const allowanceB = await mayMakeMediaForOwner(runtime, personalWake, {
        projectId: "project-b",
      });
      expect(allowanceB).toMatchObject({ images: 2, maxCredits: 10 });
      expect(allowanceB?.grants).toHaveLength(1);
      expect(allowanceB?.grants?.[0]?.allowedProjectIds).toEqual([
        "project-a",
        "project-b",
      ]);
      await expect(
        mayMakeMediaForOwner(runtime, personalWake, { projectId: "project-c" }),
      ).rejects.toThrow("scoped to a different Project");
    }
  });

  it("enforces SokoBotWatch OwnerAuthority limits, expiry, Project scope, and fail-closed checks on watch wakes and talking videos", async () => {
    const WATCH_ID = "01960000-0000-7000-8000-000000000201";
    const BOT_ID = "01960000-0000-7000-8000-000000000202";
    const WS_ID = "01960000-0000-7000-8000-000000000203";
    const USER_ID = "01960000-0000-7000-8000-000000000204";
    const watchWake = {
      askedByKind: "OWNER",
      reader: { sharedScope: null },
      turn: {
        id: "turn-watch-wake",
        sokoBotId: BOT_ID,
        workspaceId: WS_ID,
        versionId: "v36",
        source: "CHAT",
        clientTurnId: `watch:${WATCH_ID}`,
        actingUserId: USER_ID,
        chainDepth: 0,
      },
    } as unknown as Parameters<typeof mayMakeMediaForOwner>[1];

    const baseWatchAuthority = {
      version: 1 as const,
      grantId: "watch-media-grant",
      origin: "owner_chat" as const,
      sokoBotId: BOT_ID,
      workspaceId: WS_ID,
      ownerUserId: USER_ID,
      rootTurnId: "root-turn-1",
      targetScope: { kind: "project" as const, projectId: "project-1" },
      scope: "draft_and_workspace" as const,
      socialMode: "draft_only" as const,
      limits: {
        grantId: "watch-media-grant",
        period: "lifetime" as const,
        images: 2,
        videos: 1,
        maxMediaCredits: 60,
      },
      stopRule: { mode: "never" as const },
    };

    const makeWatchRow = (authority: unknown) => ({
      id: WATCH_ID,
      kind: "studio_job",
      projectId: "project-1",
      sokoBotId: BOT_ID,
      authority,
      turn: {
        id: "root-turn-1",
        requestedByUserId: USER_ID,
        askedByUserId: USER_ID,
        chainDepth: 0,
        workspaceId: WS_ID,
        source: "CHAT",
        versionId: "v36",
        sokoBot: { userId: USER_ID, projectId: null },
      },
    });

    vi.mocked(runtime.mayActForOwner).mockResolvedValue(true);
    authoritySpendFindManyMock.mockResolvedValue([]);

    // 1. Live limited watch wake returns its shared grantId bucket (NOT unbounded {}).
    watchFindFirstMock.mockResolvedValueOnce(makeWatchRow(baseWatchAuthority));
    const watchAllowance = await mayMakeMediaForOwner(runtime, watchWake, {
      projectId: "project-1",
      capability: "generate_image",
    });
    expect(watchAllowance).toMatchObject({
      images: 2,
      maxCredits: 60,
      unboundedPerTurn: false,
      grants: [expect.objectContaining({ grantId: "watch-media-grant" })],
    });

    // 2. Talking video on the watch wake routes through authoritySpend preflight.
    watchFindFirstMock.mockResolvedValueOnce(makeWatchRow(baseWatchAuthority));
    const talking = await checkTalkingVideoRequest(
      runtime,
      watchWake,
      {
        projectId: "project-1",
        script: SCRIPT,
        presenter: "maya",
        maxCredits: 55,
      },
      "call-tv-1",
      "op-tv-1",
    );
    expect(talking.authoritySpend).toMatchObject({
      capability: "generate_talking_video",
      videos: 1,
      credits: 55,
      grants: [expect.objectContaining({ grantId: "watch-media-grant" })],
    });

    // 2b. Image-only CHAT watch refuses video and talking video (media-kind isolation).
    const imageOnlyWatchAuthority = {
      ...baseWatchAuthority,
      limits: {
        grantId: "watch-image-only",
        period: "lifetime" as const,
        images: 2,
      },
    };
    watchFindFirstMock.mockResolvedValueOnce(
      makeWatchRow(imageOnlyWatchAuthority),
    );
    expect(
      await mayMakeMediaForOwner(runtime, watchWake, {
        projectId: "project-1",
        capability: "generate_video",
      }),
    ).toBeNull();
    watchFindFirstMock.mockResolvedValueOnce(
      makeWatchRow(imageOnlyWatchAuthority),
    );
    expect(
      await mayMakeMediaForOwner(runtime, watchWake, {
        projectId: "project-1",
        capability: "generate_talking_video",
      }),
    ).toBeNull();

    // 3. Project mismatch, expiry, corrupt JSONB, and missing watch all fail closed.
    watchFindFirstMock.mockResolvedValueOnce(makeWatchRow(baseWatchAuthority));
    await expect(
      mayMakeMediaForOwner(runtime, watchWake, { projectId: "project-other" }),
    ).rejects.toThrow("scoped to a different Project");

    watchFindFirstMock.mockResolvedValueOnce(
      makeWatchRow({
        ...baseWatchAuthority,
        expiresAt: "2020-01-01T00:00:00.000Z",
      }),
    );
    await expect(
      mayMakeMediaForOwner(runtime, watchWake, { projectId: "project-1" }),
    ).rejects.toThrow("has expired");

    watchFindFirstMock.mockResolvedValueOnce(makeWatchRow({ invalid: true }));
    await expect(
      mayMakeMediaForOwner(runtime, watchWake, { projectId: "project-1" }),
    ).rejects.toThrow("persisted owner authorization is invalid");

    watchFindFirstMock.mockResolvedValueOnce(null);
    await expect(
      mayMakeMediaForOwner(runtime, watchWake, { projectId: "project-1" }),
    ).rejects.toThrow("Could not verify this follow-up's owner authorization");
  });

  it("enforces per_occurrence vs lifetime SokoBotSchedule media limits and media-kind isolation across runs and admin retries", async () => {
    const SCHED_ID = "01960000-0000-7000-8000-000000000301";
    const RUN_ID = "01960000-0000-7000-8000-000000000302";
    const BOT_ID = "01960000-0000-7000-8000-000000000303";
    const WS_ID = "01960000-0000-7000-8000-000000000304";
    const USER_ID = "01960000-0000-7000-8000-000000000305";
    const SLOT = new Date("2026-11-26T09:00:00.000Z");

    const perOccurrenceAuthority = {
      version: 1 as const,
      grantId: "sched-grant-1",
      origin: "owner_chat" as const,
      sokoBotId: BOT_ID,
      workspaceId: WS_ID,
      ownerUserId: USER_ID,
      rootTurnId: "root-chat-1",
      targetScope: { kind: "project" as const, projectId: "project-1" },
      scheduleId: SCHED_ID,
      scope: "owner_writes" as const,
      socialMode: "draft_only" as const,
      limits: {
        grantId: "sched-grant-1",
        period: "per_occurrence" as const,
        images: 1,
        maxMediaCredits: 25,
      },
      stopRule: { mode: "never" as const },
    };

    const scheduleTurn = {
      askedByKind: "OWNER",
      reader: { sharedScope: null },
      turn: {
        id: "turn-sched-1",
        sokoBotId: BOT_ID,
        workspaceId: WS_ID,
        versionId: "v36",
        source: "SCHEDULE",
        clientTurnId: `schedule:${SCHED_ID}:${SLOT.toISOString()}`,
        actingUserId: USER_ID,
        chainDepth: 0,
      },
    } as unknown as Parameters<typeof mayMakeMediaForOwner>[1];

    vi.mocked(runtime.mayActForOwner).mockResolvedValue(false);

    // 1. per_occurrence image-only schedule scopes grantId to slot:<ISO> and refuses videos.
    scheduleRunFindFirstMock.mockResolvedValueOnce({
      id: RUN_ID,
      scheduledFor: SLOT,
      schedule: {
        id: SCHED_ID,
        systemKey: null,
        authority: perOccurrenceAuthority,
        sokoBot: { projectId: null },
      },
    });
    const occAllowance = await mayMakeMediaForOwner(runtime, scheduleTurn, {
      projectId: "project-1",
      capability: "generate_image",
    });
    expect(occAllowance).toMatchObject({
      images: 1,
      maxCredits: 25,
      grants: [
        expect.objectContaining({
          grantId: `sched-grant-1:slot:${SLOT.toISOString()}`,
        }),
      ],
    });

    scheduleRunFindFirstMock.mockResolvedValueOnce({
      id: RUN_ID,
      scheduledFor: SLOT,
      schedule: {
        id: SCHED_ID,
        systemKey: null,
        authority: perOccurrenceAuthority,
        sokoBot: { projectId: null },
      },
    });
    expect(
      await mayMakeMediaForOwner(runtime, scheduleTurn, {
        projectId: "project-1",
        capability: "generate_video",
      }),
    ).toBeNull();

    // 2. admin-schedule-retry of the same occurrence maps to the EXACT SAME bucket grantId.
    const retryTurn = {
      ...scheduleTurn,
      turn: {
        ...scheduleTurn.turn,
        id: "turn-sched-retry-1",
        source: "ADMIN_RETRY",
        clientTurnId: `admin-schedule-retry:${RUN_ID}:op-1`,
      },
    } as unknown as Parameters<typeof mayMakeMediaForOwner>[1];
    turnFindFirstMock.mockResolvedValueOnce({
      id: "turn-sched-retry-1",
      sokoBotId: BOT_ID,
      source: "ADMIN_RETRY",
      clientTurnId: `admin-schedule-retry:${RUN_ID}:op-1`,
    });
    scheduleRunFindFirstMock.mockResolvedValueOnce({
      id: RUN_ID,
      scheduledFor: SLOT,
      schedule: {
        id: SCHED_ID,
        systemKey: null,
        authority: perOccurrenceAuthority,
        sokoBot: { projectId: null },
      },
    });
    const retryAllowance = await mayMakeMediaForOwner(runtime, retryTurn, {
      projectId: "project-1",
      capability: "generate_image",
    });
    expect(retryAllowance?.grants?.[0]?.grantId).toBe(
      `sched-grant-1:slot:${SLOT.toISOString()}`,
    );

    // 3. lifetime schedule keeps the un-suffixed grantId across all occurrences.
    scheduleRunFindFirstMock.mockResolvedValueOnce({
      id: RUN_ID,
      scheduledFor: SLOT,
      schedule: {
        id: SCHED_ID,
        systemKey: null,
        authority: {
          ...perOccurrenceAuthority,
          limits: {
            grantId: "sched-grant-1",
            period: "lifetime",
            images: 2,
            maxMediaCredits: 40,
          },
        },
        sokoBot: { projectId: null },
      },
    });
    const lifetimeAllowance = await mayMakeMediaForOwner(
      runtime,
      scheduleTurn,
      {
        projectId: "project-1",
        capability: "generate_image",
      },
    );
    expect(lifetimeAllowance?.grants?.[0]?.grantId).toBe("sched-grant-1");

    // 4b. Image-only schedule STILL refuses videos even when mayActForOwner is true (e.g. CMO bot).
    vi.mocked(runtime.mayActForOwner).mockClear();
    vi.mocked(runtime.mayActForOwner).mockResolvedValue(true);
    scheduleRunFindFirstMock.mockResolvedValueOnce({
      id: RUN_ID,
      scheduledFor: SLOT,
      schedule: {
        id: SCHED_ID,
        systemKey: null,
        authority: perOccurrenceAuthority,
        sokoBot: { projectId: null },
      },
    });
    expect(
      await mayMakeMediaForOwner(runtime, scheduleTurn, {
        projectId: "project-1",
        capability: "generate_video",
      }),
    ).toBeNull();
    expect(runtime.mayActForOwner).not.toHaveBeenCalled();
    vi.mocked(runtime.mayActForOwner).mockResolvedValue(false);

    // 4. Personal schedule without explicit limits still refuses media (no widening).
    const { limits: _omit, ...noLimitsAuthority } = perOccurrenceAuthority;
    scheduleRunFindFirstMock.mockResolvedValueOnce({
      id: RUN_ID,
      scheduledFor: SLOT,
      schedule: {
        id: SCHED_ID,
        systemKey: null,
        authority: noLimitsAuthority,
        sokoBot: { projectId: null },
      },
    });
    expect(
      await mayMakeMediaForOwner(runtime, scheduleTurn, {
        projectId: "project-1",
        capability: "generate_image",
      }),
    ).toBeNull();
  });
});
