import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import {
  applyUserRouteMiddleware,
  type UserRouteVariables,
} from "@/routes/v1/users/user-route-context";

import { ANNOUNCED_FEATURES } from "@/schemas/badge-campaign.schema";

import mountPostUserBadgeCampaignSeen from "./[campaignId]/seen/post";
import mountGetUserBadgeCampaigns from "./get";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const {
  campaignFindManyMock,
  campaignFindUniqueMock,
  seenCreateManyMock,
  userFindUniqueMock,
} = vi.hoisted(() => ({
  campaignFindManyMock: vi.fn(),
  campaignFindUniqueMock: vi.fn(),
  seenCreateManyMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    user: { findUnique: userFindUniqueMock },
    badgeCampaign: {
      findMany: campaignFindManyMock,
      findUnique: campaignFindUniqueMock,
    },
    badgeCampaignSeen: { createMany: seenCreateManyMock },
  },
}));

const SESSION_USER: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: null,
  role: "user",
};
const NOW = new Date("2026-10-01T12:00:00.000Z");
const SIGNED_UP_AT = new Date("2026-03-01T00:00:00.000Z");
const CAMPAIGN_ID = "01960001-0001-7001-8001-000000000001";

function createApp() {
  const app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", SESSION_USER);
    return await next();
  });
  app.onError(errorHandler);

  const userByIdApp = new OpenAPIHonoWithAuth<UserRouteVariables>();
  applyUserRouteMiddleware(userByIdApp);
  mountGetUserBadgeCampaigns(userByIdApp);
  mountPostUserBadgeCampaignSeen(userByIdApp);
  app.route("/:id", userByIdApp);
  return app;
}

describe("users/{id}/badge-campaigns", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    userFindUniqueMock.mockResolvedValue({
      id: "user_123",
      createdAt: SIGNED_UP_AT,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the live campaigns that started after sign-up and are not seen", async () => {
    campaignFindManyMock.mockResolvedValueOnce([
      {
        id: CAMPAIGN_ID,
        feature: "DRIVE",
        endsAt: new Date("2026-10-22T00:00:00Z"),
      },
    ]);

    const response = await createApp().request(
      "http://localhost/me/badge-campaigns",
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({
      badgeCampaigns: [
        {
          id: CAMPAIGN_ID,
          feature: "DRIVE",
          endsAt: "2026-10-22T00:00:00.000Z",
        },
      ],
    });
    expect(campaignFindManyMock).toHaveBeenCalledWith({
      where: {
        feature: {
          in: [...ANNOUNCED_FEATURES],
        },
        startsAt: { lte: NOW, gt: SIGNED_UP_AT },
        endsAt: { gt: NOW },
        seenBy: { none: { userId: "user_123" } },
      },
      select: { id: true, feature: true, endsAt: true },
    });
  });

  it("refuses another user's badges", async () => {
    const response = await createApp().request(
      "http://localhost/other_user/badge-campaigns",
    );

    expect(response.status).toBe(403);
    expect(campaignFindManyMock).not.toHaveBeenCalled();
  });

  it("records the campaign as seen, idempotently", async () => {
    campaignFindUniqueMock.mockResolvedValueOnce({ id: CAMPAIGN_ID });
    seenCreateManyMock.mockResolvedValueOnce({ count: 0 });

    const response = await createApp().request(
      `http://localhost/me/badge-campaigns/${CAMPAIGN_ID}/seen`,
      { method: "POST" },
    );

    expect(response.status).toBe(204);
    expect(seenCreateManyMock).toHaveBeenCalledWith({
      data: [{ userId: "user_123", campaignId: CAMPAIGN_ID }],
      skipDuplicates: true,
    });
  });

  it("returns 404 when marking a missing campaign seen", async () => {
    campaignFindUniqueMock.mockResolvedValueOnce(null);

    const response = await createApp().request(
      `http://localhost/me/badge-campaigns/${CAMPAIGN_ID}/seen`,
      { method: "POST" },
    );

    expect(response.status).toBe(404);
    expect(seenCreateManyMock).not.toHaveBeenCalled();
  });
});
