import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  countMock,
  projectFindUniqueMock,
  requireProjectAccessMock,
  delegationFindManyMock,
} = vi.hoisted(() => ({
  countMock: vi.fn(),
  projectFindUniqueMock: vi.fn(),
  requireProjectAccessMock: vi.fn(),
  delegationFindManyMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    sokoBotToolCall: { count: countMock },
    project: { findUnique: projectFindUniqueMock },
    sokoBotDelegation: { findMany: delegationFindManyMock },
    sokoBotEventInbox: { findMany: async () => [] },
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
  });
});
