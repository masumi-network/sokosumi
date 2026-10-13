import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  PersonalSokoBotAuthenticationContext,
  SharedSokoBotAuthenticationContext,
} from "@/middleware/auth";

interface BotFixture {
  id: string;
  userId: string | null;
  projectId: string | null;
  workspaceId: string;
  archivedAt: Date | null;
  deletedAt: Date | null;
}

interface WorkspaceFixture {
  id: string;
  userId: string | null;
  organizationId: string | null;
}

const ORG_WS = "ws_org";
const OTHER_ORG_WS = "ws_other";
const PERSONAL_WS = "ws_personal";

const workspaces: Record<string, WorkspaceFixture> = {
  [ORG_WS]: { id: ORG_WS, userId: null, organizationId: "org_1" },
  [OTHER_ORG_WS]: { id: OTHER_ORG_WS, userId: null, organizationId: "org_2" },
  [PERSONAL_WS]: { id: PERSONAL_WS, userId: "owner", organizationId: null },
};

let members: Array<{ organizationId: string; userId: string }> = [];

function bot(overrides: Partial<BotFixture> & { id: string }): BotFixture {
  return {
    userId: null,
    projectId: null,
    workspaceId: ORG_WS,
    archivedAt: null,
    deletedAt: null,
    ...overrides,
  };
}

const bots: BotFixture[] = [
  bot({ id: "personal", userId: "owner" }),
  bot({ id: "archived-personal", userId: "archiver", archivedAt: new Date() }),
  bot({ id: "project", projectId: "project_1" }),
  bot({ id: "workspace" }),
  bot({ id: "archived-shared", archivedAt: new Date() }),
  bot({ id: "deleted-shared", deletedAt: new Date() }),
  bot({ id: "deleted-personal", userId: "owner", deletedAt: new Date() }),
  bot({ id: "orphan-shared", workspaceId: PERSONAL_WS }),
  bot({ id: "archived-own", userId: "owner", archivedAt: new Date() }),
];

type Where = Record<string, unknown>;

function matchWorkspace(workspace: WorkspaceFixture, where: Where): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === "id") return workspace.id === value;
    if (key === "userId") return workspace.userId === value;
    if (key === "OR") {
      return (value as Where[]).some((branch) =>
        matchWorkspace(workspace, branch),
      );
    }
    if (key === "organization") {
      const userId = (value as { members: { some: { userId: string } } })
        .members.some.userId;
      return members.some(
        (member) =>
          member.organizationId === workspace.organizationId &&
          member.userId === userId,
      );
    }
    throw new Error(`Unexpected workspace filter ${key}`);
  });
}

function matchBot(row: BotFixture, where: Where): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === "workspace") {
      return matchWorkspace(workspaces[row.workspaceId], value as Where);
    }
    if (key in row) return row[key as keyof BotFixture] === value;
    throw new Error(`Unexpected bot filter ${key}`);
  });
}

const { findFirstMock } = vi.hoisted(() => ({ findFirstMock: vi.fn() }));

vi.mock("@/lib/db/prisma", () => ({
  default: { sokoBot: { findFirst: findFirstMock } },
}));

import {
  memberSokoBot,
  resolveBotForRequest,
  type SokoBotSelector,
} from "./soko-bot-resolver";

const ME: SokoBotSelector = { kind: "me" };
const byId = (sokoBotId: string): SokoBotSelector => ({
  kind: "id",
  sokoBotId,
});
const user = (userId: string) => ({ actor: "user" as const, userId });

function personalKey(
  sokoBotId: string,
  userId: string,
): PersonalSokoBotAuthenticationContext {
  return {
    actor: "sokoBot",
    scope: "personal",
    sokoBotId,
    userId,
    workspaceId: ORG_WS,
    organizationId: "org_1",
  };
}

function sharedKey(sokoBotId: string): SharedSokoBotAuthenticationContext {
  return {
    actor: "sokoBot",
    scope: "workspace",
    sokoBotId,
    userId: null,
    workspaceId: ORG_WS,
    organizationId: "org_1",
    projectId: null,
  };
}

beforeEach(() => {
  members = [
    { organizationId: "org_1", userId: "owner" },
    { organizationId: "org_1", userId: "member" },
    { organizationId: "org_2", userId: "stranger" },
  ];
  findFirstMock.mockReset();
  findFirstMock.mockImplementation(
    async (args: { where: Where; include?: unknown }) => {
      const found = bots.find((row) => matchBot(row, args.where));
      if (!found) return null;
      return args.include
        ? {
            ...found,
            workspace: {
              organizationId: workspaces[found.workspaceId].organizationId,
            },
          }
        : { ...found };
    },
  );
});

describe("resolveBotForRequest: me", () => {
  it("finds the member's personal bot with today's query", async () => {
    const resolved = await resolveBotForRequest(user("owner"), ORG_WS, ME);

    expect(resolved).toMatchObject({
      bot: { id: "personal" },
      viewerUserId: "owner",
    });
    expect(findFirstMock).toHaveBeenCalledWith({
      where: { userId: "owner", workspaceId: ORG_WS, archivedAt: null },
    });
  });

  it("finds nothing for a member without a bot", async () => {
    await expect(
      resolveBotForRequest(user("member"), ORG_WS, ME),
    ).resolves.toBeNull();
  });

  it("finds nothing for an archived personal bot", async () => {
    await expect(
      resolveBotForRequest(user("archiver"), ORG_WS, ME),
    ).resolves.toBeNull();
  });

  it("lets a personal key reach only its own bot", async () => {
    await expect(
      resolveBotForRequest(personalKey("personal", "owner"), ORG_WS, ME),
    ).resolves.toMatchObject({
      bot: { id: "personal" },
      viewerUserId: "owner",
    });
    await expect(
      resolveBotForRequest(personalKey("other-bot", "owner"), ORG_WS, ME),
    ).resolves.toBeNull();
  });

  it("gives a shared key no personal bot", async () => {
    await expect(
      resolveBotForRequest(sharedKey("workspace"), ORG_WS, ME),
    ).resolves.toBeNull();
    expect(findFirstMock).not.toHaveBeenCalled();
  });
});

describe("resolveBotForRequest: personal bot by id", () => {
  it("lets the owner reach it", async () => {
    await expect(
      resolveBotForRequest(user("owner"), ORG_WS, byId("personal")),
    ).resolves.toMatchObject({
      bot: { id: "personal", userId: "owner" },
      viewerUserId: "owner",
    });
  });

  it("lets the owner reach it while archived", async () => {
    await expect(
      resolveBotForRequest(user("owner"), ORG_WS, byId("archived-own")),
    ).resolves.toMatchObject({
      bot: { id: "archived-own", userId: "owner" },
      viewerUserId: "owner",
    });
  });

  it("hides it from another member", async () => {
    await expect(
      resolveBotForRequest(user("member"), ORG_WS, byId("personal")),
    ).resolves.toBeNull();
  });

  it("hides it from another workspace", async () => {
    await expect(
      resolveBotForRequest(user("owner"), OTHER_ORG_WS, byId("personal")),
    ).resolves.toBeNull();
  });

  it("hides a deleted bot", async () => {
    await expect(
      resolveBotForRequest(user("owner"), ORG_WS, byId("deleted-personal")),
    ).resolves.toBeNull();
  });
});

describe("resolveBotForRequest: shared bot by id", () => {
  it.each(["project", "workspace"])(
    "lets a member reach a %s bot",
    async (id) => {
      await expect(
        resolveBotForRequest(user("member"), ORG_WS, byId(id)),
      ).resolves.toMatchObject({
        bot: { id, userId: null },
        viewerUserId: "member",
      });
    },
  );

  it("hides it from someone outside the Organization", async () => {
    await expect(
      resolveBotForRequest(user("stranger"), ORG_WS, byId("workspace")),
    ).resolves.toBeNull();
  });

  it("hides it from a member who left", async () => {
    members = members.filter((member) => member.userId !== "member");

    await expect(
      resolveBotForRequest(user("member"), ORG_WS, byId("workspace")),
    ).resolves.toBeNull();
  });

  it("hides it from another workspace", async () => {
    await expect(
      resolveBotForRequest(user("member"), OTHER_ORG_WS, byId("workspace")),
    ).resolves.toBeNull();
  });

  it("hides a deleted bot but keeps an archived one", async () => {
    await expect(
      resolveBotForRequest(user("member"), ORG_WS, byId("deleted-shared")),
    ).resolves.toBeNull();
    await expect(
      resolveBotForRequest(user("member"), ORG_WS, byId("archived-shared")),
    ).resolves.toMatchObject({ bot: { id: "archived-shared" } });
  });

  it("refuses a shared bot outside an Organization workspace", async () => {
    await expect(
      resolveBotForRequest(user("owner"), PERSONAL_WS, byId("orphan-shared")),
    ).resolves.toBeNull();
  });
});

describe("resolveBotForRequest: keys by id", () => {
  it("lets a shared key resolve itself with no viewer", async () => {
    await expect(
      resolveBotForRequest(sharedKey("workspace"), ORG_WS, byId("workspace")),
    ).resolves.toMatchObject({
      bot: { id: "workspace", userId: null },
      viewerUserId: null,
    });
  });

  it("never lets a shared key resolve another bot", async () => {
    await expect(
      resolveBotForRequest(sharedKey("workspace"), ORG_WS, byId("project")),
    ).resolves.toBeNull();
    expect(findFirstMock).not.toHaveBeenCalled();
  });

  it("refuses a shared key outside an Organization workspace", async () => {
    await expect(
      resolveBotForRequest(
        sharedKey("orphan-shared"),
        PERSONAL_WS,
        byId("orphan-shared"),
      ),
    ).resolves.toBeNull();
  });

  it("refuses a shared key whose id names a personal bot", async () => {
    await expect(
      resolveBotForRequest(sharedKey("personal"), ORG_WS, byId("personal")),
    ).resolves.toBeNull();
  });

  it("lets a personal key resolve itself as its owner", async () => {
    await expect(
      resolveBotForRequest(
        personalKey("personal", "owner"),
        ORG_WS,
        byId("personal"),
      ),
    ).resolves.toMatchObject({
      bot: { id: "personal" },
      viewerUserId: "owner",
    });
  });

  it("never lets a personal key resolve another bot", async () => {
    await expect(
      resolveBotForRequest(
        personalKey("personal", "owner"),
        ORG_WS,
        byId("workspace"),
      ),
    ).resolves.toBeNull();
  });
});

describe("memberSokoBot", () => {
  it("returns the row a member resolves", async () => {
    await expect(memberSokoBot("owner", ORG_WS, ME)).resolves.toMatchObject({
      id: "personal",
    });
    await expect(memberSokoBot("member", ORG_WS, ME)).resolves.toBeNull();
  });

  it("uses the client it is given", async () => {
    const txFindFirst = vi.fn().mockResolvedValue(null);
    const tx = { sokoBot: { findFirst: txFindFirst } };

    await memberSokoBot("owner", ORG_WS, ME, tx as never);

    expect(txFindFirst).toHaveBeenCalledOnce();
    expect(findFirstMock).not.toHaveBeenCalled();
  });
});
