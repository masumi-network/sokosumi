import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";
import {
  type UserRouteVariables,
  usersPathUserContextMiddleware,
} from "@/routes/v1/users/user-route-context";

const {
  userFindUniqueMock,
  consentFindUniqueMock,
  consentDeleteMock,
  refreshTokenUpdateManyMock,
  accessTokenDeleteManyMock,
  transactionMock,
} = vi.hoisted(() => {
  const userFindUniqueMock = vi.fn();
  const consentFindUniqueMock = vi.fn();
  const consentDeleteMock = vi.fn();
  const refreshTokenUpdateManyMock = vi.fn();
  const accessTokenDeleteManyMock = vi.fn();
  const transactionMock = vi.fn(
    async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        oauthConsent: {
          findUnique: consentFindUniqueMock,
          delete: consentDeleteMock,
        },
        oauthRefreshToken: {
          updateMany: refreshTokenUpdateManyMock,
        },
        oauthAccessToken: {
          deleteMany: accessTokenDeleteManyMock,
        },
      }),
  );

  return {
    userFindUniqueMock,
    consentFindUniqueMock,
    consentDeleteMock,
    refreshTokenUpdateManyMock,
    accessTokenDeleteManyMock,
    transactionMock,
  };
});

vi.mock("@/lib/db/prisma", () => ({
  default: {
    user: {
      findUnique: userFindUniqueMock,
    },
    $transaction: transactionMock,
  },
}));

const { default: mountDeleteUserOauthConsent } = await import("./delete");

const SESSION_USER: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: null,
  role: "user",
};

function createApp(authContext: AuthenticationContext = SESSION_USER) {
  const app = new OpenAPIHono<{
    Variables: AuthVariables;
  }>();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  const userByIdApp = new OpenAPIHono<{
    Variables: AuthVariables & UserRouteVariables;
  }>();
  userByIdApp.use("*", usersPathUserContextMiddleware);
  mountDeleteUserOauthConsent(
    userByIdApp as unknown as OpenAPIHonoWithAuth<UserRouteVariables>,
  );
  app.route("/:id", userByIdApp);
  return app;
}

function revokeRequest(
  pathUser: string,
  consentId = "consent_1",
  clientId = "client_1",
) {
  return new Request(
    `http://localhost/${pathUser}/oauth-consents/${consentId}?clientId=${clientId}`,
    { method: "DELETE" },
  );
}

describe("DELETE /users/{id}/oauth-consents/{consentId}", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userFindUniqueMock.mockResolvedValue({ id: "user_123" });
  });

  it("returns 403 when the caller may not access the target user", async () => {
    const response = await createApp().request(revokeRequest("other_user"));

    expect(response.status).toBe(403);
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("returns 400 when clientId is missing", async () => {
    const response = await createApp().request(
      new Request("http://localhost/me/oauth-consents/consent_1", {
        method: "DELETE",
      }),
    );

    expect(response.status).toBe(400);
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the consent does not exist", async () => {
    consentFindUniqueMock.mockResolvedValue(null);

    const response = await createApp().request(revokeRequest("me"));

    expect(response.status).toBe(404);
    expect(consentDeleteMock).not.toHaveBeenCalled();
    expect(refreshTokenUpdateManyMock).not.toHaveBeenCalled();
    expect(accessTokenDeleteManyMock).not.toHaveBeenCalled();
  });

  it("returns 403 when the consent belongs to another user", async () => {
    consentFindUniqueMock.mockResolvedValue({
      id: "consent_1",
      userId: "other_user",
      clientId: "client_1",
    });

    const response = await createApp().request(revokeRequest("me"));

    expect(response.status).toBe(403);
    expect(consentDeleteMock).not.toHaveBeenCalled();
  });

  it("returns 400 when the client id does not match the consent", async () => {
    consentFindUniqueMock.mockResolvedValue({
      id: "consent_1",
      userId: "user_123",
      clientId: "client_other",
    });

    const response = await createApp().request(revokeRequest("me"));

    expect(response.status).toBe(400);
    expect(consentDeleteMock).not.toHaveBeenCalled();
  });

  it("deletes the consent, revokes refresh tokens, and deletes access tokens", async () => {
    consentFindUniqueMock.mockResolvedValue({
      id: "consent_1",
      userId: "user_123",
      clientId: "client_1",
    });

    const response = await createApp().request(revokeRequest("me"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({});
    expect(consentDeleteMock).toHaveBeenCalledWith({
      where: { id: "consent_1" },
    });
    expect(refreshTokenUpdateManyMock).toHaveBeenCalledWith({
      where: {
        userId: "user_123",
        clientId: "client_1",
        revoked: null,
      },
      data: {
        revoked: expect.any(Date),
      },
    });
    expect(accessTokenDeleteManyMock).toHaveBeenCalledWith({
      where: {
        userId: "user_123",
        clientId: "client_1",
      },
    });
  });
});
