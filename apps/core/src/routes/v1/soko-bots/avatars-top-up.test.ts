import { Hono } from "hono";
import type { RequestIdVariables } from "hono/request-id";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getSokoBotAvailabilityMock,
  userFindUniqueMock,
  listAvailableAvatarsMock,
  topUpAvailableAvatarsMock,
} = vi.hoisted(() => ({
  getSokoBotAvailabilityMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
  listAvailableAvatarsMock: vi.fn(),
  topUpAvailableAvatarsMock: vi.fn(),
}));

vi.mock("@sentry/node", () => ({ captureException: vi.fn() }));

vi.mock("@/lib/external-service-errors", () => ({
  captureExternalServiceError: vi.fn(),
}));

vi.mock("@/services/soko-bot-availability.service", () => ({
  getSokoBotAvailability: getSokoBotAvailabilityMock,
  setSokoBotDisabled: vi.fn(),
}));

vi.mock("@/services/soko-bot-avatar.service", () => ({
  listAvailableAvatars: listAvailableAvatarsMock,
  topUpAvailableAvatars: topUpAvailableAvatarsMock,
  claimAvatar: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: { user: { findUnique: userFindUniqueMock } },
}));

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

import { errorHandler } from "@/helpers/error-handler";

import app from "./index";

type TestVariables = RequestIdVariables & {
  authContext: {
    actor: "user";
    userId: string;
    organizationId: string | null;
    role: string;
  };
};

function createApp() {
  const parent = new Hono<{ Variables: TestVariables }>();
  parent.use("*", async (c, next) => {
    c.set("requestId", "req_avatar_top_up");
    c.set("authContext", {
      actor: "user",
      userId: "11111111-1111-4111-8111-111111111111",
      organizationId: null,
      role: "user",
    });
    await next();
  });
  parent.onError(errorHandler);
  parent.route("/", app);
  return parent;
}

/**
 * Generation writes rows and bills FAL. It must never hang off the GET: a GET
 * is cacheable by intermediaries, and a cross-site top-level navigation
 * carries the Core session cookie because Better Auth issues it SameSite=Lax.
 */
describe("Soko Bot avatar top-up", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSokoBotAvailabilityMock.mockResolvedValue({ disabled: false });
    userFindUniqueMock.mockResolvedValue({
      email: "picker@nmkr.io",
      emailVerified: true,
    });
    listAvailableAvatarsMock.mockResolvedValue([]);
    topUpAvailableAvatarsMock.mockResolvedValue([]);
  });

  it("never generates on the read, even when asked to", async () => {
    const response = await createApp().request(
      "http://localhost/avatars?take=6&topUp=true",
    );

    expect(response.status).toBe(200);
    expect(topUpAvailableAvatarsMock).not.toHaveBeenCalled();
    expect(listAvailableAvatarsMock).toHaveBeenCalledWith(6, {
      excludeIds: [],
    });
  });

  it("generates on the POST", async () => {
    const response = await createApp().request(
      "http://localhost/avatars/top-up",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ take: 6, excludeIds: [] }),
      },
    );

    expect(response.status).toBe(200);
    expect(topUpAvailableAvatarsMock).toHaveBeenCalledWith(6, {
      excludeIds: [],
    });
  });

  it("applies the schema defaults to a body-less top-up", async () => {
    // The route declares `body: { required: true }`. Without it,
    // @hono/zod-openapi skips body validation ENTIRELY when the request
    // carries no JSON content-type, `take` reaches the service undefined,
    // Prisma reads that as "no limit", and the whole unclaimed pool comes
    // back instead of one capped page. With it, the defaults apply.
    const response = await createApp().request(
      "http://localhost/avatars/top-up",
      { method: "POST" },
    );

    expect(response.status).toBe(200);
    expect(topUpAvailableAvatarsMock).toHaveBeenCalledWith(6, {
      excludeIds: [],
    });
  });

  it("refuses a take above the page cap", async () => {
    const response = await createApp().request(
      "http://localhost/avatars/top-up",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ take: 13 }),
      },
    );

    expect(response.status).toBe(422);
    expect(topUpAvailableAvatarsMock).not.toHaveBeenCalled();
  });
});
