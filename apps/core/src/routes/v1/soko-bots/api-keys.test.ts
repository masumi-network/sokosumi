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

const { apiKeyFindManyMock, botFindFirstMock, prismaTransactionMock } =
  vi.hoisted(() => ({
    apiKeyFindManyMock: vi.fn(),
    botFindFirstMock: vi.fn(),
    prismaTransactionMock: vi.fn(),
  }));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    coworkerApiKey: { findMany: apiKeyFindManyMock },
    sokoBot: { findFirst: botFindFirstMock },
    $transaction: prismaTransactionMock,
  },
}));

const BOT_ID = "01960001-0001-7001-8001-000000000099";

function createRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "agentkey_123",
    orchestratorId: BOT_ID,
    name: "CLI key",
    keyStart: "orchestrator_abcdefgh",
    expiresAt: null,
    revokedAt: null,
    createdAt: new Date("2026-09-02T10:00:00.000Z"),
    updatedAt: new Date("2026-09-02T10:00:00.000Z"),
    ...overrides,
  };
}

function createApp() {
  const app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId: "owner_123",
      organizationId: null,
      role: "user",
    });
    return await next();
  });
  mountSokoBotApiKeyRoutes(app);
  return app;
}

describe("Soko Bot API keys", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    botFindFirstMock.mockResolvedValue({ id: BOT_ID });
  });

  it("creates an orchestrator-prefixed key for an owned live bot", async () => {
    const tx = {
      sokoBot: {
        findFirst: vi.fn().mockResolvedValue({ id: BOT_ID }),
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
        token: expect.stringMatching(/^orchestrator_/),
        name: "CLI key",
        expiresAt: null,
      },
    });
    expect(tx.sokoBot.findFirst).toHaveBeenCalledWith({
      where: {
        id: BOT_ID,
        userId: "owner_123",
        archivedAt: null,
        deletedAt: null,
      },
      select: { id: true },
    });
    expect(tx.coworkerApiKey.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          coworkerId: null,
          orchestratorId: BOT_ID,
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
      orchestratorId: BOT_ID,
      keyStart: "orchestrator_abcdefgh",
    });
    expect(body.data[0].keyHash).toBeUndefined();
    expect(apiKeyFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          orchestratorId: BOT_ID,
          orchestrator: {
            userId: "owner_123",
            archivedAt: null,
            deletedAt: null,
          },
        },
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

  it("updates only an owned bot key", async () => {
    const updated = createRecord({ name: "Rotated CLI key" });
    const tx = {
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
          orchestratorId: BOT_ID,
          orchestrator: expect.objectContaining({ userId: "owner_123" }),
        }),
      }),
    );
  });

  it("revokes an owned bot key", async () => {
    const revoked = createRecord({
      revokedAt: new Date("2026-09-02T11:00:00.000Z"),
    });
    const tx = {
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
        orchestratorId: BOT_ID,
        revokedAt: null,
        orchestrator: {
          userId: "owner_123",
          archivedAt: null,
          deletedAt: null,
        },
      },
      data: { revokedAt: expect.any(Date) },
    });
  });
});
