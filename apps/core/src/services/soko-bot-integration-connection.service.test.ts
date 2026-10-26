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
  listAuthConfigs: vi.fn(),
  createAuthConfig: vi.fn(),
  getToolkit: vi.fn(),
  getComposio: vi.fn(),
  env: {} as Record<string, string | undefined>,
}));
vi.mock("@/config/env", () => ({ getEnv: () => mocks.env }));
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
  getComposio: () => mocks.getComposio(),
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

function connect(userId: string, provider = "gmail") {
  return connectSokoBotIntegration({
    userId,
    workspaceId: WORKSPACE_ID,
    provider,
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
  mocks.env = {};
  mocks.getComposio.mockReturnValue({
    connectedAccounts: {
      link: mocks.link,
      get: mocks.get,
      delete: mocks.remove,
    },
    toolkits: { get: mocks.getToolkit },
    authConfigs: {
      list: mocks.listAuthConfigs,
      create: mocks.createAuthConfig,
    },
  });
  mocks.listAuthConfigs.mockResolvedValue({
    items: [
      {
        id: "auth-gmail",
        toolkit: { slug: "gmail" },
        isComposioManaged: true,
      },
    ],
  });
  mocks.createAuthConfig.mockResolvedValue({ id: "created" });
  mocks.getToolkit.mockResolvedValue({ name: "Gmail", meta: {} });
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

describe("choosing the Composio auth config", () => {
  const linkedAuthConfigId = () => mocks.link.mock.calls[0][1];

  it("reuses the managed config for other toolkits", async () => {
    await connect("connector");
    expect(linkedAuthConfigId()).toBe("auth-gmail");
    expect(mocks.createAuthConfig).not.toHaveBeenCalled();
  });

  it("creates a managed config for other toolkits when none exists", async () => {
    mocks.listAuthConfigs.mockResolvedValue({ items: [] });
    await connect("connector");
    expect(linkedAuthConfigId()).toBe("created");
    expect(mocks.createAuthConfig).toHaveBeenCalledWith("gmail", {
      type: "use_composio_managed_auth",
      name: "sokosumi-gmail",
    });
  });

  it.each([
    ["googleads", "COMPOSIO_GOOGLEADS_AUTH_CONFIG_ID", "ac_google"],
    ["metaads", "COMPOSIO_METAADS_AUTH_CONFIG_ID", "ac_meta"],
  ])(
    "links %s through the Project Ads auth config",
    async (provider, envName, id) => {
      mocks.env = { [envName]: id };
      await connect("connector", provider);
      expect(linkedAuthConfigId()).toBe(id);
      expect(mocks.listAuthConfigs).not.toHaveBeenCalled();
      expect(mocks.createAuthConfig).not.toHaveBeenCalled();
    },
  );

  it("uses the same ads auth config for a personal bot", async () => {
    mocks.env = { COMPOSIO_GOOGLEADS_AUTH_CONFIG_ID: "ac_google" };
    mocks.memberSokoBot.mockResolvedValue(PERSONAL_BOT);
    await connect("owner", "googleads");
    expect(linkedAuthConfigId()).toBe("ac_google");
  });

  it.each([
    ["googleads", "Google Ads"],
    ["metaads", "Meta Ads"],
  ])(
    "refuses %s without its auth config before any Composio client call",
    async (provider, name) => {
      mocks.getComposio.mockReturnValue(null);
      await expect(connect("connector", provider)).rejects.toMatchObject({
        kind: "NOT_CONFIGURED",
        message: `${name} connections are not configured on this environment`,
      });
      expect(mocks.getComposio).not.toHaveBeenCalled();
      expect(mocks.getToolkit).not.toHaveBeenCalled();
      expect(mocks.listAuthConfigs).not.toHaveBeenCalled();
      expect(mocks.createAuthConfig).not.toHaveBeenCalled();
      expect(mocks.link).not.toHaveBeenCalled();
      expect(mocks.botUpdate).not.toHaveBeenCalled();
      expect(mocks.upsert).not.toHaveBeenCalled();
    },
  );
});
