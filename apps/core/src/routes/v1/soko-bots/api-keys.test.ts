import { beforeEach, describe, expect, it, vi } from "vitest";

import { OpenAPIHonoWithAuth } from "@/lib/hono";

import { mountSokoBotApiKeyRoutes } from "./api-keys";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const {
  apiKeyFindManyMock,
  botFindFirstMock,
  memberFindFirstMock,
  prismaTransactionMock,
} = vi.hoisted(() => ({
  apiKeyFindManyMock: vi.fn(),
  botFindFirstMock: vi.fn(),
  memberFindFirstMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    coworkerApiKey: { findMany: apiKeyFindManyMock },
    sokoBot: { findFirst: botFindFirstMock },
    member: { findFirst: memberFindFirstMock },
    $transaction: prismaTransactionMock,
  },
}));

const BOT_ID = "01960001-0001-7001-8001-000000000099";
const WORKSPACE_ID = "workspace_1";
const OWNED_BOT = {
  id: BOT_ID,
  userId: "owner_123",
  workspaceId: WORKSPACE_ID,
};
const SHARED_BOT = { id: BOT_ID, userId: null, workspaceId: WORKSPACE_ID };
const LIVE = { archivedAt: null, deletedAt: null };

function createRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "agentkey_123",
    sokoBotId: BOT_ID,
    name: "CLI key",
    keyStart: "sokoBot_abcdefgh",
    expiresAt: null,
    revokedAt: null,
    createdAt: new Date("2026-09-02T10:00:00.000Z"),
    updatedAt: new Date("2026-09-02T10:00:00.000Z"),
    ...overrides,
  };
}

function createApp(
  authenticationMethod: "session" | "api_key" | "oauth" = "session",
  firstPartyClient?: boolean,
) {
  const app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId: "owner_123",
      organizationId: null,
      role: "user",
      authenticationMethod,
      ...(firstPartyClient ? { firstPartyClient } : {}),
    });
    return await next();
  });
  mountSokoBotApiKeyRoutes(app);
  return app;
}

describe("Soko Bot API keys", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    botFindFirstMock.mockResolvedValue(OWNED_BOT);
  });

  it("creates a sokoBot-prefixed key for an owned live bot", async () => {
    const tx = {
      sokoBot: {
        findFirst: vi.fn().mockResolvedValue(OWNED_BOT),
      },
      coworkerApiKey: {
        create: vi.fn().mockResolvedValue(createRecord()),
      },
    };
    prismaTransactionMock.mockImplementation(async (run) => await run(tx));

    const response = await createApp().request(
      `http://localhost/${BOT_ID}/api-keys`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "CLI key" }),
      },
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      data: {
        id: "agentkey_123",
        token: expect.stringMatching(/^sokoBot_/),
        name: "CLI key",
        expiresAt: null,
      },
    });
    expect(tx.sokoBot.findFirst).toHaveBeenCalledWith({
      where: { id: BOT_ID, ...LIVE },
      select: { id: true, userId: true, workspaceId: true },
    });
    expect(tx.coworkerApiKey.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          coworkerId: null,
          sokoBotId: BOT_ID,
        }),
      }),
    );
  });

  it("lists only keys owned by that bot without exposing hashes", async () => {
    apiKeyFindManyMock.mockResolvedValue([createRecord()]);

    const response = await createApp().request(
      `http://localhost/${BOT_ID}/api-keys`,
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data[0]).toMatchObject({
      sokoBotId: BOT_ID,
      keyStart: "sokoBot_abcdefgh",
    });
    expect(body.data[0].keyHash).toBeUndefined();
    expect(apiKeyFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sokoBotId: BOT_ID, sokoBot: LIVE },
      }),
    );
  });

  it("returns 404 when listing keys for a bot the user does not own", async () => {
    botFindFirstMock.mockResolvedValue(null);

    const response = await createApp().request(
      `http://localhost/${BOT_ID}/api-keys`,
    );

    expect(response.status).toBe(404);
    expect(apiKeyFindManyMock).not.toHaveBeenCalled();
  });

  it("returns 404 for another member's personal bot", async () => {
    botFindFirstMock.mockResolvedValue({ ...OWNED_BOT, userId: "other_user" });

    const response = await createApp().request(
      `http://localhost/${BOT_ID}/api-keys`,
    );

    expect(response.status).toBe(404);
    expect(apiKeyFindManyMock).not.toHaveBeenCalled();
  });

  it.each([
    ["owner", 200],
    ["admin", 200],
    ["member", 403],
  ] as const)("lets a shared bot's %s list keys: %i", async (role, status) => {
    botFindFirstMock.mockResolvedValue(SHARED_BOT);
    memberFindFirstMock.mockResolvedValue({ role });
    apiKeyFindManyMock.mockResolvedValue([]);

    const response = await createApp().request(
      `http://localhost/${BOT_ID}/api-keys`,
    );

    expect(response.status).toBe(status);
    expect(apiKeyFindManyMock).toHaveBeenCalledTimes(status === 200 ? 1 : 0);
  });

  it("hides a shared bot from a non-member", async () => {
    botFindFirstMock.mockResolvedValue(SHARED_BOT);
    memberFindFirstMock.mockResolvedValue(null);

    const response = await createApp().request(
      `http://localhost/${BOT_ID}/api-keys`,
    );

    expect(response.status).toBe(404);
  });

  it("updates only an owned bot key", async () => {
    const updated = createRecord({ name: "Rotated CLI key" });
    const tx = {
      sokoBot: { findFirst: vi.fn().mockResolvedValue(OWNED_BOT) },
      coworkerApiKey: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findFirst: vi.fn().mockResolvedValue(updated),
      },
    };
    prismaTransactionMock.mockImplementation(async (run) => await run(tx));

    const response = await createApp().request(
      `http://localhost/${BOT_ID}/api-keys/agentkey_123`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Rotated CLI key" }),
      },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { id: "agentkey_123", name: "Rotated CLI key" },
    });
    expect(tx.coworkerApiKey.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "agentkey_123",
          sokoBotId: BOT_ID,
          sokoBot: LIVE,
        }),
      }),
    );
  });

  it("revokes an owned bot key", async () => {
    const revoked = createRecord({
      revokedAt: new Date("2026-09-02T11:00:00.000Z"),
    });
    const tx = {
      sokoBot: { findFirst: vi.fn().mockResolvedValue(OWNED_BOT) },
      coworkerApiKey: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findFirst: vi.fn().mockResolvedValue(revoked),
      },
    };
    prismaTransactionMock.mockImplementation(async (run) => await run(tx));

    const response = await createApp().request(
      `http://localhost/${BOT_ID}/api-keys/agentkey_123`,
      { method: "DELETE" },
    );

    expect(response.status).toBe(200);
    expect((await response.json()).data.revokedAt).not.toBeNull();
    expect(tx.coworkerApiKey.updateMany).toHaveBeenCalledWith({
      where: {
        id: "agentkey_123",
        sokoBotId: BOT_ID,
        revokedAt: null,
        sokoBot: LIVE,
      },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it.each(["oauth", "api_key"] as const)(
    "refuses to mint a key for a %s actor",
    async (authenticationMethod) => {
      // A third-party OAuth client could otherwise mint a personal-assistant
      // key that keeps working after its consent is revoked. Reading key
      // metadata stays open; issuing and revoking need a person present.
      const app = createApp(authenticationMethod);

      const response = await app.request(`/${BOT_ID}/api-keys`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "minted" }),
      });

      expect(response.status).toBe(403);
      // Refused before any write is attempted, not after.
      expect(prismaTransactionMock).not.toHaveBeenCalled();
    },
  );

  it("refuses to mint a key for a first-party OAuth client", async () => {
    // A stolen CMO or Apple token must not turn into a key that outlives it.
    const app = createApp("oauth", true);

    const response = await app.request(`/${BOT_ID}/api-keys`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "minted" }),
    });

    expect(response.status).toBe(403);
    expect(prismaTransactionMock).not.toHaveBeenCalled();
  });

  it("still lists keys for a non-interactive actor", async () => {
    apiKeyFindManyMock.mockResolvedValue([]);
    const app = createApp("api_key");

    const response = await app.request(`/${BOT_ID}/api-keys`);

    expect(response.status).toBe(200);
  });
});
