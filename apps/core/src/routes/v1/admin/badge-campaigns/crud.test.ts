import { createMiddleware } from "hono/factory";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type {
  AuthenticationContext,
  UserAuthenticationContext,
} from "@/middleware/auth";
import { requireAdminAuthContext } from "@/middleware/auth";

import mountDeleteAdminBadgeCampaign from "./[id]/delete";
import mountEndAdminBadgeCampaign from "./[id]/end/post";
import mountPatchAdminBadgeCampaign from "./[id]/patch";
import mountListAdminBadgeCampaigns from "./get";
import mountCreateAdminBadgeCampaign from "./post";

const {
  createMock,
  findFirstMock,
  findManyMock,
  findUniqueMock,
  updateMock,
  transactionMock,
  executeMock,
  authContextState,
} = vi.hoisted(() => ({
  authContextState: { current: null as AuthenticationContext | null },
  createMock: vi.fn(),
  findFirstMock: vi.fn(),
  findManyMock: vi.fn(),
  findUniqueMock: vi.fn(),
  updateMock: vi.fn(),
  transactionMock: vi.fn(),
  executeMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: transactionMock,
    badgeCampaign: {
      findMany: findManyMock,
      // A write or invariant read outside the callback is a regression.
      create: vi.fn(() => {
        throw new Error("write outside transaction");
      }),
      findFirst: vi.fn(() => {
        throw new Error("overlap outside transaction");
      }),
      findUnique: vi.fn(() => {
        throw new Error("lifecycle read outside transaction");
      }),
    },
  },
}));

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  return {
    ...actual,
    authMiddleware: async (
      c: { set: (key: string, value: unknown) => void },
      next: () => Promise<unknown>,
    ) => {
      c.set("isAuthenticated", true);
      c.set("authContext", authContextState.current);
      return await next();
    },
  };
});

const ADMIN: UserAuthenticationContext = {
  actor: "user",
  userId: "user_admin",
  organizationId: null,
  role: "admin",
};
const NOW = new Date("2026-10-01T12:00:00.000Z");
const CAMPAIGN_ID = "01960001-0001-7001-8001-000000000001";

function campaignRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CAMPAIGN_ID,
    feature: "DRIVE",
    startsAt: new Date("2026-10-05T00:00:00.000Z"),
    endsAt: new Date("2026-10-26T00:00:00.000Z"),
    createdById: "user_admin",
    createdAt: new Date("2026-10-01T00:00:00.000Z"),
    updatedAt: new Date("2026-10-01T00:00:00.000Z"),
    ...overrides,
  };
}

function createApp() {
  const app = new OpenAPIHonoWithAuth();
  app.use(
    "*",
    createMiddleware(async (c, next) => {
      requireAdminAuthContext(c.var.authContext);
      await next();
    }),
  );
  app.onError(errorHandler);
  mountListAdminBadgeCampaigns(app);
  mountCreateAdminBadgeCampaign(app);
  mountPatchAdminBadgeCampaign(app);
  mountDeleteAdminBadgeCampaign(app);
  mountEndAdminBadgeCampaign(app);
  return app;
}

function jsonRequest(method: string, path: string, body: unknown) {
  return createApp().request(`http://localhost${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("admin badge campaigns", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    authContextState.current = ADMIN;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    findFirstMock.mockResolvedValue(null);
    executeMock.mockResolvedValue(1);
    transactionMock.mockImplementation(async (callback) =>
      callback({
        $queryRaw: vi.fn().mockResolvedValue([]),
        $executeRaw: executeMock,
        badgeCampaign: {
          create: createMock,
          findFirst: findFirstMock,
          findUnique: findUniqueMock,
          update: updateMock,
          findUniqueOrThrow: updateMock,
        },
      }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("lists campaigns, latest start first", async () => {
    findManyMock.mockResolvedValueOnce([campaignRow()]);

    const response = await createApp().request("http://localhost/");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual([
      {
        id: CAMPAIGN_ID,
        feature: "DRIVE",
        startsAt: "2026-10-05T00:00:00.000Z",
        endsAt: "2026-10-26T00:00:00.000Z",
        createdAt: "2026-10-01T00:00:00.000Z",
      },
    ]);
    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ startsAt: "desc" }] }),
    );
  });

  it("rejects non-admins", async () => {
    authContextState.current = { ...ADMIN, role: "user" };

    const response = await createApp().request("http://localhost/");

    expect(response.status).toBe(403);
  });

  it("creates a campaign attributed to the admin", async () => {
    createMock.mockResolvedValueOnce(campaignRow());

    const response = await jsonRequest("POST", "/", {
      feature: "DRIVE",
      startsAt: "2026-10-05T00:00:00.000Z",
      endsAt: "2026-10-26T00:00:00.000Z",
    });

    expect(response.status).toBe(200);
    expect(createMock).toHaveBeenCalledWith({
      data: {
        feature: "DRIVE",
        startsAt: new Date("2026-10-05T00:00:00.000Z"),
        endsAt: new Date("2026-10-26T00:00:00.000Z"),
        createdById: "user_admin",
      },
    });
  });

  it("checks overlap and writes inside a Serializable transaction", async () => {
    createMock.mockResolvedValueOnce(campaignRow());
    const response = await jsonRequest("POST", "/", {
      feature: "DRIVE",
      startsAt: "2026-10-05T00:00:00.000Z",
      endsAt: "2026-10-26T00:00:00.000Z",
    });
    expect(response.status).toBe(200);
    expect(transactionMock).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
    });
  });

  it("rejects a campaign that ends before it starts", async () => {
    const response = await jsonRequest("POST", "/", {
      feature: "DRIVE",
      startsAt: "2026-10-26T00:00:00.000Z",
      endsAt: "2026-10-05T00:00:00.000Z",
    });

    expect(response.status).toBe(422);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("rejects an unknown feature", async () => {
    const response = await jsonRequest("POST", "/", {
      feature: "CALENDAR",
      startsAt: "2026-10-05T00:00:00.000Z",
      endsAt: "2026-10-26T00:00:00.000Z",
    });

    expect(response.status).toBe(422);
  });

  it("rejects a campaign overlapping another for the same feature", async () => {
    findFirstMock.mockResolvedValueOnce({ id: "other" });

    const response = await jsonRequest("POST", "/", {
      feature: "DRIVE",
      startsAt: "2026-10-05T00:00:00.000Z",
      endsAt: "2026-10-26T00:00:00.000Z",
    });

    expect(response.status).toBe(409);
    expect(findFirstMock).toHaveBeenCalledWith({
      where: {
        feature: "DRIVE",
        startsAt: { lt: new Date("2026-10-26T00:00:00.000Z") },
        endsAt: { gt: new Date("2026-10-05T00:00:00.000Z") },
      },
      select: { id: true },
    });
    expect(createMock).not.toHaveBeenCalled();
  });

  it("moves a campaign's dates, ignoring itself in the overlap check", async () => {
    findUniqueMock.mockResolvedValueOnce(campaignRow());
    updateMock.mockResolvedValueOnce(
      campaignRow({ endsAt: new Date("2026-10-01T12:00:00.000Z") }),
    );

    const response = await jsonRequest("PATCH", `/${CAMPAIGN_ID}`, {
      startsAt: "2026-09-20T00:00:00.000Z",
      endsAt: "2026-10-01T12:00:00.000Z",
    });

    expect(response.status).toBe(200);
    expect(findFirstMock).toHaveBeenCalledWith({
      where: {
        feature: "DRIVE",
        startsAt: { lt: new Date("2026-10-01T12:00:00.000Z") },
        endsAt: { gt: new Date("2026-09-20T00:00:00.000Z") },
        id: { not: CAMPAIGN_ID },
      },
      select: { id: true },
    });
    expect(executeMock).toHaveBeenCalledWith(
      expect.any(Array),
      new Date("2026-09-20T00:00:00.000Z"),
      NOW,
      NOW,
      CAMPAIGN_ID,
      new Date("2026-09-20T00:00:00.000Z"),
    );
  });

  it("returns 404 when patching a missing campaign", async () => {
    findUniqueMock.mockResolvedValueOnce(null);

    const response = await jsonRequest("PATCH", `/${CAMPAIGN_ID}`, {
      startsAt: "2026-10-05T00:00:00.000Z",
      endsAt: "2026-10-26T00:00:00.000Z",
    });

    expect(response.status).toBe(404);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("deletes a campaign that has not started", async () => {
    findUniqueMock.mockResolvedValueOnce(campaignRow());

    const response = await createApp().request(
      `http://localhost/${CAMPAIGN_ID}`,
      { method: "DELETE" },
    );

    expect(response.status).toBe(204);
    expect(executeMock).toHaveBeenCalledWith(expect.any(Array), CAMPAIGN_ID);
  });

  it("rejects deletion when the start arrives at the write boundary", async () => {
    findUniqueMock.mockResolvedValueOnce(campaignRow());
    executeMock.mockResolvedValueOnce(0);
    const response = await createApp().request(
      `http://localhost/${CAMPAIGN_ID}`,
      { method: "DELETE" },
    );
    expect(response.status).toBe(409);
  });

  it("refuses to delete a campaign that has started", async () => {
    findUniqueMock.mockResolvedValueOnce(
      campaignRow({ startsAt: new Date("2026-09-30T00:00:00.000Z") }),
    );

    const response = await createApp().request(
      `http://localhost/${CAMPAIGN_ID}`,
      { method: "DELETE" },
    );

    expect(response.status).toBe(409);
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("refuses to move a started campaign's start into the future", async () => {
    findUniqueMock.mockResolvedValueOnce(
      campaignRow({ startsAt: new Date("2026-09-30T00:00:00.000Z") }),
    );

    const response = await jsonRequest("PATCH", `/${CAMPAIGN_ID}`, {
      startsAt: "2026-10-05T00:00:00.000Z",
      endsAt: "2026-10-26T00:00:00.000Z",
    });

    expect(response.status).toBe(409);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("ends a live campaign at Core's clock", async () => {
    findUniqueMock.mockResolvedValueOnce(
      campaignRow({ startsAt: new Date("2026-09-30T00:00:00.000Z") }),
    );
    updateMock.mockResolvedValueOnce(
      campaignRow({
        startsAt: new Date("2026-09-30T00:00:00.000Z"),
        endsAt: NOW,
      }),
    );

    const response = await createApp().request(
      `http://localhost/${CAMPAIGN_ID}/end`,
      { method: "POST" },
    );

    expect(response.status).toBe(200);
    expect(executeMock).toHaveBeenCalledWith(
      expect.any(Array),
      NOW,
      NOW,
      CAMPAIGN_ID,
    );
  });

  it("refuses to end a campaign that is not running", async () => {
    findUniqueMock.mockResolvedValueOnce(campaignRow());

    const response = await createApp().request(
      `http://localhost/${CAMPAIGN_ID}/end`,
      { method: "POST" },
    );

    expect(response.status).toBe(409);
    expect(updateMock).not.toHaveBeenCalled();
  });
});
