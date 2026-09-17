import { Composio } from "@composio/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  bot: vi.fn(),
  find: vi.fn(),
  upsert: vi.fn(),
  updateMany: vi.fn(),
  findMany: vi.fn(),
  deleteRow: vi.fn(),
  link: vi.fn(),
  get: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    sokoBot: { findFirst: mocks.bot },
    sokoBotIntegration: {
      findUnique: mocks.find,
      upsert: mocks.upsert,
      updateMany: mocks.updateMany,
      findMany: mocks.findMany,
      delete: mocks.deleteRow,
    },
  },
}));
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
vi.mock("@/config/env", () => ({
  getEnv: () => ({ COMPOSIO_API_KEY: "ak_test" }),
}));

import {
  activeIntegrationsForBot,
  connectSokoBotIntegration,
  disconnectSokoBotIntegration,
  fetchInboxMessages,
  finalizeSokoBotIntegration,
  revokeAllSokoBotIntegrations,
} from "./soko-bot-integrations.service";

const input = {
  userId: "owner",
  workspaceId: "workspace",
  provider: "gmail",
  returnUrl: "https://app.example/return?provider=gmail",
};
const existing = {
  id: "integration",
  sokoBotId: "bot",
  provider: "gmail",
  composioAccountId: "selected",
  pendingComposioAccountId: null,
  status: "ACTIVE",
  cursor: { since: "old" },
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
  mocks.bot.mockResolvedValue({ id: "bot" });
  mocks.find.mockResolvedValue(existing);
  mocks.link.mockImplementation(async (_user, _config, options) => {
    // SDK 0.18.1 rejects even ONE existing ACTIVE account without this option.
    if (!options.allowMultiple)
      throw new Error(
        "Multiple connected accounts found for user sokobot:bot in auth config auth-gmail. Please use the allowMultiple option to allow multiple connected accounts.",
      );
    return { id: "replacement", redirectUrl: "https://connect.example/oauth" };
  });
  mocks.get.mockResolvedValue({
    id: "replacement",
    status: "ACTIVE",
    toolkit: { slug: "gmail" },
    isDisabled: false,
  });
  mocks.updateMany.mockResolvedValue({ count: 1 });
  mocks.remove.mockResolvedValue({});
});

describe("Soko Bot OAuth replacement", () => {
  it("starts OAuth despite an existing active account and preserves its selection until completion", async () => {
    await expect(connectSokoBotIntegration(input)).resolves.toEqual({
      redirectUrl: "https://connect.example/oauth",
    });
    expect(mocks.link).toHaveBeenCalledWith("sokobot:bot", "auth-gmail", {
      callbackUrl: input.returnUrl,
      allowMultiple: true,
    });
    expect(mocks.upsert.mock.calls[0][0].update).toMatchObject({
      pendingComposioAccountId: "replacement",
    });
    expect(mocks.upsert.mock.calls[0][0].update).not.toHaveProperty(
      "composioAccountId",
    );
    expect(mocks.upsert.mock.calls[0][0].update).not.toHaveProperty("status");
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("does not persist a broken OAuth response", async () => {
    mocks.link.mockResolvedValue({ id: "replacement", redirectUrl: null });
    await expect(connectSokoBotIntegration(input)).rejects.toThrow(
      "no redirect URL",
    );
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("switches only to the pending ID after verification and resets mailbox ingest state", async () => {
    mocks.find.mockResolvedValue({
      ...existing,
      pendingComposioAccountId: "replacement",
    });
    await expect(finalizeSokoBotIntegration(input)).resolves.toBe("ACTIVE");
    expect(mocks.get).toHaveBeenCalledWith("replacement");
    expect(mocks.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "integration",
          composioAccountId: "selected",
          pendingComposioAccountId: "replacement",
        },
        data: expect.objectContaining({
          composioAccountId: "replacement",
          pendingComposioAccountId: null,
          status: "ACTIVE",
          lastIngestAt: null,
          lastErrorAt: null,
        }),
      }),
    );
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith("selected");
    expect(mocks.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.remove.mock.invocationCallOrder[0],
    );
  });

  it.each(["INITIATED", "INITIALIZING", "FAILED", "REVOKED", "EXPIRED"])(
    "preserves a working account when replacement is %s",
    async (status) => {
      mocks.find.mockResolvedValue({
        ...existing,
        pendingComposioAccountId: "replacement",
      });
      mocks.get.mockResolvedValue({
        id: "replacement",
        status,
        toolkit: { slug: "gmail" },
        isDisabled: false,
      });
      await finalizeSokoBotIntegration(input);
      expect(mocks.updateMany).not.toHaveBeenCalled();
      expect(mocks.remove).not.toHaveBeenCalled();
    },
  );

  it("rejects a stale finalizer without deleting either account", async () => {
    mocks.find.mockResolvedValue({
      ...existing,
      pendingComposioAccountId: "replacement",
    });
    mocks.updateMany.mockResolvedValue({ count: 0 });
    await expect(finalizeSokoBotIntegration(input)).rejects.toThrow("changed");
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("rejects a different toolkit", async () => {
    mocks.get.mockResolvedValue({
      id: "selected",
      status: "ACTIVE",
      toolkit: { slug: "outlook" },
      isDisabled: false,
    });
    await expect(finalizeSokoBotIntegration(input)).rejects.toThrow("provider");
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    connectSokoBotIntegration,
    finalizeSokoBotIntegration,
    disconnectSokoBotIntegration,
  ])(
    "requires the requester's bot in the current workspace",
    async (operation) => {
      mocks.bot.mockResolvedValue(null);
      await expect(operation(input)).rejects.toThrow("Soko Bot not found");
      expect(mocks.bot).toHaveBeenCalledWith({
        where: { userId: "owner", workspaceId: "workspace", archivedAt: null },
        select: { id: true },
      });
      expect(mocks.link).not.toHaveBeenCalled();
      expect(mocks.get).not.toHaveBeenCalled();
      expect(mocks.remove).not.toHaveBeenCalled();
    },
  );

  it("executes only the selected account, never the pending replacement", async () => {
    mocks.findMany.mockResolvedValue([
      { ...existing, pendingComposioAccountId: "replacement" },
    ]);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ successful: true, data: { messages: [] } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const [integration] = await activeIntegrationsForBot("bot", "email");
    await fetchInboxMessages(integration, { limit: 1 });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      user_id: "sokobot:bot",
      connected_account_id: "selected",
    });
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sokoBotId: "bot", status: "ACTIVE" },
      }),
    );
  });

  it("disconnects both selected and pending accounts", async () => {
    mocks.find.mockResolvedValue({
      ...existing,
      pendingComposioAccountId: "replacement",
    });
    await disconnectSokoBotIntegration(input);
    expect(mocks.remove.mock.calls).toEqual([["selected"], ["replacement"]]);
  });

  it("includes pending replacements when deleting a bot", async () => {
    mocks.findMany.mockResolvedValue([
      { ...existing, pendingComposioAccountId: "replacement" },
    ]);
    expect(await revokeAllSokoBotIntegrations("bot")).toEqual({
      revoked: 1,
      failed: [],
    });
    expect(mocks.remove.mock.calls).toEqual([["selected"], ["replacement"]]);
  });
});

it("attempts both account revocations and reports a provider once on partial failure", async () => {
  mocks.findMany.mockResolvedValue([
    { ...existing, pendingComposioAccountId: "replacement" },
  ]);
  mocks.remove.mockRejectedValue(new Error("upstream unavailable"));
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    expect(await revokeAllSokoBotIntegrations("bot")).toEqual({
      revoked: 0,
      failed: ["gmail"],
    });
    expect(mocks.remove.mock.calls).toEqual([["selected"], ["replacement"]]);
  } finally {
    log.mockRestore();
  }
});

describe("OAuth retries and failures", () => {
  it("selects the latest persisted retry, including when an older OAuth callback arrives", async () => {
    let pendingId: string | null = null;
    mocks.find.mockImplementation(async () => ({
      ...existing,
      pendingComposioAccountId: pendingId,
    }));
    mocks.upsert.mockImplementation(async ({ update }) => {
      pendingId = update.pendingComposioAccountId;
    });
    mocks.link.mockResolvedValueOnce({
      id: "attempt-one",
      redirectUrl: "https://connect.example/one",
    });
    mocks.link.mockResolvedValueOnce({
      id: "attempt-two",
      redirectUrl: "https://connect.example/two",
    });
    await connectSokoBotIntegration(input);
    await connectSokoBotIntegration(input);
    expect(mocks.remove).not.toHaveBeenCalled();
    // The callback has only a provider, so it must check the current persisted
    // attempt, never adopt an account ID supplied by a browser or list order.
    mocks.get.mockResolvedValue({
      id: "attempt-two",
      status: "INITIATED",
      toolkit: { slug: "gmail" },
    });
    expect(await finalizeSokoBotIntegration(input)).toBe("PENDING");
    expect(mocks.updateMany).not.toHaveBeenCalled();
    mocks.get.mockResolvedValue({
      id: "attempt-two",
      status: "ACTIVE",
      toolkit: { slug: "gmail" },
      isDisabled: false,
    });
    expect(await finalizeSokoBotIntegration(input)).toBe("ACTIVE");
    expect(mocks.get.mock.calls).toEqual([["attempt-two"], ["attempt-two"]]);
    expect(mocks.remove.mock.calls).toEqual([["selected"]]);
  });

  it("creates the initial pending selection when there is no local connection", async () => {
    mocks.find.mockResolvedValue(null);
    await connectSokoBotIntegration(input);
    expect(mocks.upsert.mock.calls[0][0].create).toMatchObject({
      sokoBotId: "bot",
      provider: "gmail",
      composioAccountId: "replacement",
      status: "PENDING",
    });
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it.each(["PENDING", "FAILED", "REVOKED"])(
    "retries a local %s connection without losing its account",
    async (status) => {
      mocks.find.mockResolvedValue({ ...existing, status });
      await connectSokoBotIntegration(input);
      expect(mocks.upsert.mock.calls[0][0].update).toHaveProperty(
        "pendingComposioAccountId",
        "replacement",
      );
      expect(mocks.upsert.mock.calls[0][0].update).not.toHaveProperty(
        "composioAccountId",
      );
      expect(mocks.remove).not.toHaveBeenCalled();
    },
  );

  it.each(["ACTIVE", "FAILED", "REVOKED", "INITIATED"])(
    "still finalizes a pre-migration or first connection in state %s",
    async (status) => {
      mocks.get.mockResolvedValue({
        id: "selected",
        status,
        toolkit: { slug: "gmail" },
        isDisabled: false,
      });
      expect(await finalizeSokoBotIntegration(input)).toBe(
        status === "INITIATED" ? "PENDING" : status,
      );
      expect(mocks.updateMany.mock.calls[0][0].data).not.toHaveProperty(
        "cursor",
      );
      expect(mocks.remove).not.toHaveBeenCalled();
    },
  );

  it("keeps the working selection if persistence fails", async () => {
    mocks.upsert.mockRejectedValue(new Error("database unavailable"));
    await expect(connectSokoBotIntegration(input)).rejects.toThrow(
      "database unavailable",
    );
    expect(mocks.remove).not.toHaveBeenCalled();
    mocks.find.mockResolvedValue({
      ...existing,
      pendingComposioAccountId: "replacement",
    });
    mocks.updateMany.mockRejectedValue(new Error("database unavailable"));
    await expect(finalizeSokoBotIntegration(input)).rejects.toThrow(
      "database unavailable",
    );
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("does not replace the selected account on an upstream status error", async () => {
    mocks.find.mockResolvedValue({
      ...existing,
      pendingComposioAccountId: "replacement",
    });
    mocks.get.mockRejectedValue(new Error("upstream unavailable"));
    await expect(finalizeSokoBotIntegration(input)).rejects.toThrow(
      "upstream unavailable",
    );
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("does not promote a disabled replacement", async () => {
    mocks.find.mockResolvedValue({
      ...existing,
      pendingComposioAccountId: "replacement",
    });
    mocks.get.mockResolvedValue({
      id: "replacement",
      status: "ACTIVE",
      toolkit: { slug: "gmail" },
      isDisabled: true,
    });
    expect(await finalizeSokoBotIntegration(input)).toBe("FAILED");
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("keeps the successfully persisted replacement if old-account cleanup fails", async () => {
    mocks.find.mockResolvedValue({
      ...existing,
      pendingComposioAccountId: "replacement",
    });
    mocks.remove.mockRejectedValue(new Error("cleanup unavailable"));
    expect(await finalizeSokoBotIntegration(input)).toBe("ACTIVE");
    expect(mocks.updateMany).toHaveBeenCalledOnce();
  });
});

describe("installed Composio link contract", () => {
  it.each([
    ["no accounts", []],
    ["one active", ["ACTIVE"]],
    ["multiple active", ["ACTIVE", "ACTIVE"]],
    ["abandoned and revoked", ["INITIATED", "FAILED", "REVOKED"]],
    ["mixed", ["ACTIVE", "INITIATED", "FAILED", "REVOKED"]],
  ])(
    "connects with %s without choosing or deleting an upstream account",
    async (_name, statuses) => {
      const transport = vi.fn(async () =>
        Response.json({
          connected_account_id: "new-from-sdk",
          redirect_url: "https://connect.example/oauth",
        }),
      );
      vi.stubGlobal("fetch", transport);
      const sdk = new Composio({
        apiKey: "ak_test",
        baseURL: "https://composio.example",
        allowTracking: false,
        disableVersionCheck: true,
      });
      const list = vi.spyOn(sdk.connectedAccounts, "list").mockResolvedValue({
        items: statuses
          .filter((status) => status === "ACTIVE")
          .map((_, index) => ({
            id: `upstream-${index}`,
            status: "ACTIVE",
            statusReason: null,
            authConfig: {
              id: "auth-gmail",
              isComposioManaged: true,
              isDisabled: false,
            },
            toolkit: { slug: "gmail" },
            isDisabled: false,
            createdAt: "2026-01-01",
            updatedAt: "2026-01-01",
          })),
        totalPages: 1,
        nextCursor: null,
      });
      if (statuses.includes("ACTIVE")) {
        await expect(
          sdk.connectedAccounts.link("sokobot:bot", "auth-gmail", {
            allowMultiple: false,
          }),
        ).rejects.toThrow("Multiple connected accounts found");
        expect(transport).not.toHaveBeenCalled();
      }
      mocks.link.mockImplementation(
        sdk.connectedAccounts.link.bind(sdk.connectedAccounts),
      );
      await expect(connectSokoBotIntegration(input)).resolves.toEqual({
        redirectUrl: "https://connect.example/oauth",
      });
      expect(list).toHaveBeenCalledWith(
        {
          userIds: ["sokobot:bot"],
          authConfigIds: ["auth-gmail"],
          statuses: ["ACTIVE"],
        },
        undefined,
      );
      expect(
        mocks.upsert.mock.calls[0][0].update.pendingComposioAccountId,
      ).toBe("new-from-sdk");
      expect(mocks.remove).not.toHaveBeenCalled();
    },
  );
});
