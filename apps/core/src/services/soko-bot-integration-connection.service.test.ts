import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  memberSokoBot: vi.fn(),
  memberRole: vi.fn(),
  botUpdate: vi.fn(),
  lockIntegration: vi.fn(),
  find: vi.fn(),
  upsert: vi.fn(),
  updateMany: vi.fn(),
  deleteRow: vi.fn(),
  link: vi.fn(),
  get: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("@/helpers/soko-bot-resolver", () => ({
  ME_SOKO_BOT: { kind: "me" },
  memberSokoBot: mocks.memberSokoBot,
}));
vi.mock("@/lib/db/prisma", () => {
  const client = {
    member: { findFirst: mocks.memberRole },
    sokoBot: { update: mocks.botUpdate },
    $queryRaw: mocks.lockIntegration,
    sokoBotIntegration: {
      findUnique: mocks.find,
      upsert: mocks.upsert,
      updateMany: mocks.updateMany,
      delete: mocks.deleteRow,
    },
  };
  return {
    default: {
      ...client,
      $transaction: (operation: (tx: typeof client) => unknown) =>
        operation(client),
    },
  };
});
vi.mock("@/clients/composio.client", () => ({
  getComposio: () => ({
    connectedAccounts: {
      link: mocks.link,
      get: mocks.get,
      delete: mocks.remove,
    },
    toolkits: { get: async () => ({ name: "Gmail", meta: {} }) },
    authConfigs: {
      list: async () => ({
        items: [
          {
            id: "auth-gmail",
            toolkit: { slug: "gmail" },
            isComposioManaged: true,
          },
        ],
      }),
    },
  }),
}));

import {
  connectSokoBotIntegration,
  disconnectSokoBotIntegration,
  finalizeSokoBotIntegration,
} from "./soko-bot-integration-connection.service";

const WORKSPACE_ID = "workspace";
const SHARED_BOT = { id: "bot", userId: null, workspaceId: WORKSPACE_ID };
const PERSONAL_BOT = { id: "bot", userId: "owner", workspaceId: WORKSPACE_ID };
const BY_ID = { kind: "id", sokoBotId: "bot" } as const;
const ROLES: Record<string, string> = {
  connector: "member",
  other: "member",
  admin: "admin",
  orgOwner: "owner",
};

function connect(userId: string) {
  return connectSokoBotIntegration({
    userId,
    workspaceId: WORKSPACE_ID,
    provider: "gmail",
    returnUrl: "https://app.example/return",
    selector: BY_ID,
  });
}

function finalize(userId: string) {
  return finalizeSokoBotIntegration({
    userId,
    workspaceId: WORKSPACE_ID,
    provider: "gmail",
    selector: BY_ID,
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.memberSokoBot.mockResolvedValue(SHARED_BOT);
  mocks.memberRole.mockImplementation(
    async (args: { where: { userId: string } }) => {
      const role = ROLES[args.where.userId];
      return role ? { role } : null;
    },
  );
  mocks.botUpdate.mockResolvedValue({ id: "bot" });
  mocks.find.mockResolvedValue({
    id: "integration",
    composioAccountId: "selected",
    pendingComposioAccountId: null,
    connectorUserId: "connector",
  });
  mocks.link.mockResolvedValue({
    id: "replacement",
    redirectUrl: "https://connect.example/oauth",
  });
  mocks.get.mockResolvedValue({
    id: "replacement",
    status: "ACTIVE",
    toolkit: { slug: "gmail" },
    isDisabled: false,
  });
  mocks.updateMany.mockResolvedValue({ count: 1 });
  mocks.remove.mockResolvedValue({});
  mocks.deleteRow.mockResolvedValue({
    composioAccountId: "selected",
    pendingComposioAccountId: null,
  });
});

describe("connecting a shared Soko Bot's integration", () => {
  it("resolves the bot by id and records the connecting member", async () => {
    mocks.find.mockResolvedValue(null);
    await expect(connect("other")).resolves.toEqual({
      redirectUrl: "https://connect.example/oauth",
    });
    expect(mocks.memberSokoBot).toHaveBeenCalledWith(
      "other",
      WORKSPACE_ID,
      BY_ID,
    );
    expect(mocks.upsert.mock.calls[0][0].create).toMatchObject({
      connectorUserId: "other",
      status: "PENDING",
    });
    expect(mocks.memberRole).not.toHaveBeenCalled();
  });

  it("rechecks the shared bot under its lock without an owner filter", async () => {
    mocks.find.mockResolvedValue(null);
    await connect("other");
    const where = mocks.botUpdate.mock.calls[0][0].where;
    expect(where).toEqual({
      id: "bot",
      workspaceId: WORKSPACE_ID,
      archivedAt: null,
      deletedAt: null,
    });
  });

  it.each(["connector", "admin", "orgOwner"])(
    "lets %s replace the connected account",
    async (caller) => {
      await expect(connect(caller)).resolves.toEqual({
        redirectUrl: "https://connect.example/oauth",
      });
      expect(mocks.upsert.mock.calls[0][0].update).toMatchObject({
        pendingComposioAccountId: "replacement",
      });
    },
  );

  it.each(["other", "stranger"])(
    "refuses %s replacing someone else's account and drops the new authorization",
    async (caller) => {
      await expect(connect(caller)).rejects.toMatchObject({ status: 403 });
      expect(mocks.upsert).not.toHaveBeenCalled();
      expect(mocks.remove).toHaveBeenCalledWith("replacement");
    },
  );
});

describe("finalizing a shared Soko Bot's integration", () => {
  it("promotes a replacement only for the connector or an admin, and hands it over", async () => {
    mocks.find.mockResolvedValue({
      id: "integration",
      composioAccountId: "selected",
      pendingComposioAccountId: "replacement",
      connectorUserId: "connector",
    });
    await expect(finalize("other")).rejects.toMatchObject({ status: 403 });
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();

    await expect(finalize("admin")).resolves.toBe("ACTIVE");
    expect(mocks.updateMany.mock.calls[0][0].data).toMatchObject({
      composioAccountId: "replacement",
      connectorUserId: "admin",
    });
  });

  it("lets any member finish a first connection and keeps its connector", async () => {
    mocks.find.mockResolvedValue({
      id: "integration",
      composioAccountId: "replacement",
      pendingComposioAccountId: null,
      connectorUserId: "connector",
    });
    await expect(finalize("other")).resolves.toBe("ACTIVE");
    expect(mocks.updateMany.mock.calls[0][0].data).not.toHaveProperty(
      "connectorUserId",
    );
    expect(mocks.memberRole).not.toHaveBeenCalled();
  });
});

describe("disconnecting a shared Soko Bot's integration", () => {
  it("lets any member disconnect, whoever connected it", async () => {
    await disconnectSokoBotIntegration({
      userId: "other",
      workspaceId: WORKSPACE_ID,
      provider: "gmail",
      selector: BY_ID,
    });
    expect(mocks.deleteRow).toHaveBeenCalledOnce();
    expect(mocks.remove).toHaveBeenCalledWith("selected");
    expect(mocks.memberRole).not.toHaveBeenCalled();
  });
});

describe("a personal Soko Bot", () => {
  it("keeps the owner filter and never reads a role", async () => {
    mocks.memberSokoBot.mockResolvedValue(PERSONAL_BOT);
    mocks.find.mockResolvedValue({
      id: "integration",
      composioAccountId: "selected",
      pendingComposioAccountId: null,
      connectorUserId: null,
    });
    await connectSokoBotIntegration({
      userId: "owner",
      workspaceId: WORKSPACE_ID,
      provider: "gmail",
      returnUrl: "https://app.example/return",
    });
    expect(mocks.memberSokoBot).toHaveBeenCalledWith("owner", WORKSPACE_ID, {
      kind: "me",
    });
    expect(mocks.botUpdate.mock.calls[0][0].where).toMatchObject({
      userId: "owner",
    });
    expect(mocks.memberRole).not.toHaveBeenCalled();
  });
});
