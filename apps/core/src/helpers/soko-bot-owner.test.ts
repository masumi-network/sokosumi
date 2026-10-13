import { beforeEach, describe, expect, it, vi } from "vitest";

const { botFindUniqueMock } = vi.hoisted(() => ({
  botFindUniqueMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: { sokoBot: { findUnique: botFindUniqueMock } },
}));

import {
  loadSokoBotPersona,
  personalOwnerUserId,
  sokoBotAuthorLabel,
  sokoBotOwnerName,
  sokoBotOwnerOf,
  sokoBotPersonaOf,
  sokoBotTurnAudience,
  sokoBotTurnReaderOf,
} from "./soko-bot-owner";

const PROJECT_ID = "01960001-0001-7001-8001-000000000010";

describe("sokoBotOwnerOf", () => {
  it("reads a bot with a user as personal", () => {
    expect(sokoBotOwnerOf({ userId: "user-1", projectId: null })).toEqual({
      kind: "personal",
      userId: "user-1",
    });
  });

  it("reads a bot with a project and no user as a project bot", () => {
    expect(sokoBotOwnerOf({ userId: null, projectId: PROJECT_ID })).toEqual({
      kind: "shared",
      scope: "project",
      projectId: PROJECT_ID,
    });
  });

  it("reads a bot with neither as a workspace bot", () => {
    expect(sokoBotOwnerOf({ userId: null, projectId: null })).toEqual({
      kind: "shared",
      scope: "workspace",
      projectId: null,
    });
  });
});

describe("personalOwnerUserId", () => {
  it("is the owner for a personal bot", () => {
    expect(personalOwnerUserId({ userId: "user-1" })).toBe("user-1");
  });

  it("is null, never undefined, for a shared bot", () => {
    expect(personalOwnerUserId({ userId: null })).toBeNull();
  });
});

describe("sokoBotOwnerName", () => {
  it("names a personal bot's owner", () => {
    expect(
      sokoBotOwnerName({ userId: "user-1", user: { name: "Ana Lima" } }),
    ).toBe("Ana Lima");
  });

  it("names nobody for a shared bot, even if a user row came along", () => {
    expect(
      sokoBotOwnerName({ userId: null, user: { name: "Ana Lima" } }),
    ).toBeNull();
  });
});

describe("sokoBotTurnAudience", () => {
  const packet = (kind: string) => ({
    packet: { trigger: { askedBy: { kind } } },
  });

  it.each(["OWNER", "TEAMMATE", "ASSISTANT"] as const)(
    "keeps a personal bot's %s audience",
    (kind) => {
      expect(
        sokoBotTurnAudience({
          sokoBot: { userId: "user-1" },
          contextSnapshot: packet(kind),
        }),
      ).toBe(kind);
    },
  );

  it("reads a shared bot's OWNER packet as TEAMMATE", () => {
    expect(
      sokoBotTurnAudience({
        sokoBot: { userId: null },
        contextSnapshot: packet("OWNER"),
      }),
    ).toBe("TEAMMATE");
  });

  it.each([
    ["TEAMMATE", "TEAMMATE"],
    ["ASSISTANT", "ASSISTANT"],
    ["garbage", "TEAMMATE"],
  ] as const)("reads a shared bot's %s packet as %s", (kind, expected) => {
    expect(
      sokoBotTurnAudience({
        sokoBot: { userId: null },
        contextSnapshot: packet(kind),
      }),
    ).toBe(expected);
  });

  it("reads a shared bot with no snapshot or no audience as TEAMMATE", () => {
    expect(
      sokoBotTurnAudience({ sokoBot: { userId: null }, contextSnapshot: null }),
    ).toBe("TEAMMATE");
    expect(
      sokoBotTurnAudience({
        sokoBot: { userId: null },
        contextSnapshot: { packet: {} },
      }),
    ).toBe("TEAMMATE");
  });

  it("keeps a personal bot's missing audience unclassified", () => {
    expect(
      sokoBotTurnAudience({
        sokoBot: { userId: "user-1" },
        contextSnapshot: null,
      }),
    ).toBeUndefined();
  });
});

describe("sokoBotTurnReaderOf", () => {
  const packet = { trigger: { askedBy: { kind: "OWNER" } } };
  const turn = {
    sokoBotId: "bot-1",
    userId: "member",
    contextSnapshot: { packet },
  };

  it("reads a personal turn as its owner with no scope", () => {
    expect(
      sokoBotTurnReaderOf({
        ...turn,
        sokoBot: { userId: "member", workspaceId: "ws", projectId: null },
      }),
    ).toEqual({ userId: "member", audience: "OWNER", sharedScope: null });
  });

  it("reads a shared turn as a teammate within the bot's scope", () => {
    expect(
      sokoBotTurnReaderOf({
        ...turn,
        sokoBot: { userId: null, workspaceId: "ws", projectId: "p-1" },
      }),
    ).toEqual({
      userId: "member",
      audience: "TEAMMATE",
      sharedScope: { sokoBotId: "bot-1", workspaceId: "ws", projectId: "p-1" },
    });
  });
});

describe("sokoBotAuthorLabel", () => {
  it("signs a personal bot with its owner", () => {
    expect(
      sokoBotAuthorLabel({
        name: "Jarvis",
        userId: "user-1",
        user: { name: "Andreas" },
      }),
    ).toBe("Jarvis, Andreas's assistant");
  });

  it("falls back when a personal bot's owner has no name", () => {
    expect(
      sokoBotAuthorLabel({
        name: null,
        userId: "user-1",
        user: { name: null },
      }),
    ).toBe("Soko Bot, another person's assistant");
  });

  it("signs a shared bot as the team's", () => {
    expect(
      sokoBotAuthorLabel({ name: "Scout", userId: null, user: null }),
    ).toBe("Scout, a shared team assistant");
  });
});

describe("sokoBotPersonaOf", () => {
  it("keeps the owner for a personal bot", () => {
    expect(
      sokoBotPersonaOf({ name: "Jarvis", userId: "u", user: { name: "Ana" } }),
    ).toEqual({ name: "Jarvis", ownerName: "Ana" });
  });

  it("marks a shared bot and gives it no owner", () => {
    expect(
      sokoBotPersonaOf({ name: "Scout", userId: null, user: null }),
    ).toEqual({ name: "Scout", ownerName: null, shared: true });
  });
});

describe("loadSokoBotPersona", () => {
  beforeEach(() => {
    botFindUniqueMock.mockReset();
  });

  it("loads the persona by bot id", async () => {
    botFindUniqueMock.mockResolvedValue({
      name: "Scout",
      userId: null,
      user: null,
    });
    await expect(loadSokoBotPersona("bot-1")).resolves.toEqual({
      name: "Scout",
      ownerName: null,
      shared: true,
    });
    expect(botFindUniqueMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "bot-1" } }),
    );
  });

  it("has no name and no owner for a missing bot", async () => {
    botFindUniqueMock.mockResolvedValue(null);
    await expect(loadSokoBotPersona("bot-1")).resolves.toEqual({
      name: null,
      ownerName: null,
    });
  });
});
