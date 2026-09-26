import {
  Composio,
  ComposioToolFetchError,
  ComposioToolkitFetchError,
  ComposioToolkitNotFoundError,
  ComposioToolNotFoundError,
} from "@composio/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  bot: vi.fn(),
  botUpdate: vi.fn(),
  transaction: vi.fn(),
  lockIntegration: vi.fn(),
  find: vi.fn(),
  upsert: vi.fn(),
  updateMany: vi.fn(),
  findMany: vi.fn(),
  deleteRow: vi.fn(),
  link: vi.fn(),
  get: vi.fn(),
  remove: vi.fn(),
  toolkitGet: vi.fn(),
  getRawComposioTools: vi.fn(),
}));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: mocks.transaction,
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
    toolkits: { get: mocks.toolkitGet },
    tools: { getRawComposioTools: mocks.getRawComposioTools },
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
  listIntegrationTools,
  revokeSokoBotIntegrationAccounts,
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
  mocks.botUpdate.mockResolvedValue({ id: "bot" });
  mocks.transaction.mockImplementation(async (operation) =>
    operation({
      $queryRaw: mocks.lockIntegration,
      sokoBot: { update: mocks.botUpdate },
      sokoBotIntegration: { upsert: mocks.upsert, findUnique: mocks.find },
    }),
  );
  mocks.deleteRow.mockResolvedValue(existing);
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
  mocks.toolkitGet.mockResolvedValue({ name: "Gmail", meta: {} });
  mocks.getRawComposioTools.mockResolvedValue([]);
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

  it("cleans up a broken OAuth response without changing the selected account", async () => {
    mocks.link.mockResolvedValue({ id: "replacement", redirectUrl: null });
    await expect(connectSokoBotIntegration(input)).rejects.toThrow(
      "no redirect URL",
    );
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith("replacement");
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
    mocks.deleteRow.mockResolvedValue({
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
    expect(
      await revokeSokoBotIntegrationAccounts("bot", [
        { ...existing, pendingComposioAccountId: "replacement" },
      ]),
    ).toEqual({
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
    expect(
      await revokeSokoBotIntegrationAccounts("bot", [
        { ...existing, pendingComposioAccountId: "replacement" },
      ]),
    ).toEqual({
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
    expect(mocks.remove.mock.calls).toEqual([["attempt-one"]]);
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
    expect(mocks.remove.mock.calls).toEqual([["attempt-one"], ["selected"]]);
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
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith("replacement");
    mocks.remove.mockClear();
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

describe("connection lifecycle races", () => {
  it("captures the latest pending account at disconnect's atomic deletion", async () => {
    // The earlier read would have captured the old pending ID. Atomic deletion
    // returns a concurrent reconnect's newly persisted ID instead.
    mocks.find.mockResolvedValue({
      ...existing,
      pendingComposioAccountId: "older",
    });
    mocks.deleteRow.mockResolvedValue({
      ...existing,
      pendingComposioAccountId: "newer",
    });
    await disconnectSokoBotIntegration(input);
    expect(mocks.find).not.toHaveBeenCalled();
    expect(mocks.remove.mock.calls).toEqual([["selected"], ["newer"]]);
    expect(mocks.deleteRow.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.remove.mock.invocationCallOrder[0],
    );
  });

  it("does not erase a reconnect persisted during disconnect's remote cleanup", async () => {
    mocks.remove.mockImplementationOnce(async () => {
      await connectSokoBotIntegration(input);
    });
    await disconnectSokoBotIntegration(input);
    expect(mocks.deleteRow).toHaveBeenCalledOnce();
    expect(mocks.deleteRow.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.upsert.mock.invocationCallOrder[0],
    );
    expect(mocks.remove.mock.calls).toEqual([["selected"]]);
  });

  it("revalidates the bot under its write lock before persisting authorization", async () => {
    await connectSokoBotIntegration(input);
    expect(mocks.botUpdate).toHaveBeenCalledWith({
      where: {
        id: "bot",
        userId: "owner",
        workspaceId: "workspace",
        archivedAt: null,
        deletedAt: null,
      },
      data: { updatedAt: expect.any(Date) },
      select: { id: true },
    });
    expect(mocks.botUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.upsert.mock.invocationCallOrder[0],
    );
  });

  it("cleans up only the new authorization if bot deletion wins persistence", async () => {
    mocks.botUpdate.mockRejectedValue(new Error("bot was deleted"));
    await expect(connectSokoBotIntegration(input)).rejects.toThrow(
      "bot was deleted",
    );
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith("replacement");
  });

  it("leaves upstream accounts untouched if atomic disconnection fails", async () => {
    mocks.deleteRow.mockRejectedValue(new Error("database unavailable"));
    await expect(disconnectSokoBotIntegration(input)).rejects.toThrow(
      "database unavailable",
    );
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("treats an already removed integration as disconnected", async () => {
    mocks.deleteRow.mockRejectedValue({ code: "P2025" });
    await expect(disconnectSokoBotIntegration(input)).resolves.toBeUndefined();
    expect(mocks.remove).not.toHaveBeenCalled();
  });
});

it("does not revoke a pending account promoted before the connection row lock", async () => {
  mocks.lockIntegration.mockImplementation(async () => {
    // A finalizer won before this transaction locked the integration.
    mocks.find.mockResolvedValue({
      ...existing,
      composioAccountId: "promoted",
      pendingComposioAccountId: null,
    });
  });
  await connectSokoBotIntegration(input);
  expect(mocks.lockIntegration.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.find.mock.invocationCallOrder[0],
  );
  expect(mocks.remove).not.toHaveBeenCalled();
});

it("cleans up the exact pending ID superseded by serialized concurrent connections", async () => {
  let pendingId: string | null = "original-pending";
  let transactionTail = Promise.resolve();
  mocks.transaction.mockImplementation((operation) => {
    const run = transactionTail.then(() =>
      operation({
        $queryRaw: mocks.lockIntegration,
        sokoBot: { update: mocks.botUpdate },
        sokoBotIntegration: { upsert: mocks.upsert, findUnique: mocks.find },
      }),
    );
    transactionTail = run.then(() => undefined);
    return run;
  });
  mocks.find.mockImplementation(async () => ({
    ...existing,
    pendingComposioAccountId: pendingId,
  }));
  mocks.upsert.mockImplementation(async ({ update }) => {
    pendingId = update.pendingComposioAccountId;
  });
  mocks.link.mockResolvedValueOnce({
    id: "first",
    redirectUrl: "https://connect.example/first",
  });
  mocks.link.mockResolvedValueOnce({
    id: "second",
    redirectUrl: "https://connect.example/second",
  });
  await Promise.all([
    connectSokoBotIntegration(input),
    connectSokoBotIntegration(input),
  ]);
  expect(pendingId).toBe("second");
  expect(mocks.remove.mock.calls.flat().sort()).toEqual([
    "first",
    "original-pending",
  ]);
  expect(mocks.remove).not.toHaveBeenCalledWith("selected");
  expect(mocks.remove).not.toHaveBeenCalledWith("second");
});

const githubIntegration = {
  id: "integration",
  sokoBotId: "bot",
  provider: {
    id: "github",
    name: "GitHub",
    kinds: [] as const,
    logoUrl: "",
    tools: {},
  },
  composioAccountId: "acc",
  cursor: null,
};

describe("Composio 401/5xx vs not-found", () => {
  it("does not treat a toolkit fetch 401 as a missing toolkit during connect", async () => {
    mocks.toolkitGet.mockRejectedValue(
      new ComposioToolkitFetchError("Unable to retrieve toolkit", {
        cause: { status: 401 },
      }),
    );
    await expect(connectSokoBotIntegration(input)).rejects.toMatchObject({
      message: expect.stringContaining("Composio (toolkit):"),
      kind: "UPSTREAM",
    });
    expect(mocks.link).not.toHaveBeenCalled();
  });

  it("does not treat a toolkit fetch 5xx as a missing toolkit during connect", async () => {
    mocks.toolkitGet.mockRejectedValue(
      new ComposioToolkitFetchError("Unable to retrieve toolkit", {
        cause: { status: 503 },
      }),
    );
    await expect(connectSokoBotIntegration(input)).rejects.toMatchObject({
      kind: "UPSTREAM",
    });
    expect(mocks.link).not.toHaveBeenCalled();
  });

  it("still connects when Composio reports the toolkit slug as not found", async () => {
    mocks.toolkitGet.mockRejectedValue(
      new ComposioToolkitNotFoundError("Toolkit with slug gmail not found"),
    );
    await expect(connectSokoBotIntegration(input)).resolves.toEqual({
      redirectUrl: "https://connect.example/oauth",
    });
    expect(mocks.upsert.mock.calls[0][0].create).toMatchObject({
      name: "Gmail",
    });
  });

  it("maps a tool list 401 to an upstream error, not not-found", async () => {
    mocks.getRawComposioTools.mockRejectedValue(
      new ComposioToolFetchError("Unable to retrieve tool", {
        cause: { status: 401 },
      }),
    );
    await expect(
      listIntegrationTools(githubIntegration, { limit: 10 }),
    ).rejects.toMatchObject({
      message: expect.stringContaining("Composio (list tools):"),
      kind: "UPSTREAM",
    });
  });

  it("maps a genuine tool-not-found error as NOT_FOUND", async () => {
    mocks.getRawComposioTools.mockRejectedValue(
      new ComposioToolNotFoundError("Tool with slug GITHUB_X not found"),
    );
    await expect(
      listIntegrationTools(githubIntegration, { limit: 10 }),
    ).rejects.toMatchObject({ kind: "NOT_FOUND" });
  });
});
