import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";
import {
  type UserRouteVariables,
  usersPathUserContextMiddleware,
} from "@/routes/v1/users/user-route-context";

import mountPutUserDesignMd from "./put";

const { userFindUniqueMock, getUserByIdMock, updateUserMetadataMock } =
  vi.hoisted(() => ({
    userFindUniqueMock: vi.fn(),
    getUserByIdMock: vi.fn(),
    updateUserMetadataMock: vi.fn(),
  }));

vi.mock("@/lib/db/prisma", () => ({
  default: { user: { findUnique: userFindUniqueMock } },
}));

vi.mock("@sokosumi/database/repositories", () => ({
  userRepository: {
    getUserById: (...args: unknown[]) => getUserByIdMock(...args),
    updateUserMetadata: (...args: unknown[]) => updateUserMetadataMock(...args),
  },
}));

const SESSION_USER: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: null,
  role: "user",
};

function createApp(authContext: AuthenticationContext = SESSION_USER) {
  const app = new OpenAPIHono<{ Variables: AuthVariables }>();
  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  const userByIdApp = new OpenAPIHono<{
    Variables: AuthVariables & UserRouteVariables;
  }>();
  userByIdApp.use("*", usersPathUserContextMiddleware);
  mountPutUserDesignMd(
    userByIdApp as unknown as OpenAPIHonoWithAuth<UserRouteVariables>,
  );
  app.route("/:id", userByIdApp);
  return app;
}

function putDesignMd(
  path: string,
  body: { url: string | null; extractionId: string | null },
) {
  return createApp().request(`http://localhost/${path}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PUT /users/{id}/design-md", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns 403 when the caller may not access the target user", async () => {
    const response = await putDesignMd("other_user/design-md", {
      url: "https://blob.example/design.md",
      extractionId: null,
    });
    expect(response.status).toBe(403);
    expect(updateUserMetadataMock).not.toHaveBeenCalled();
  });

  it("persists the DESIGN.md and returns the stored values", async () => {
    userFindUniqueMock.mockResolvedValueOnce({ id: "user_123" });
    getUserByIdMock.mockResolvedValueOnce({ metadata: JSON.stringify({}) });

    const response = await putDesignMd("me/design-md", {
      url: "https://blob.example/design.md",
      extractionId: "123",
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(updateUserMetadataMock).toHaveBeenCalledWith(
      "user_123",
      expect.stringContaining("https://blob.example/design.md"),
      expect.anything(),
    );
    expect(body.data.designMd).toEqual({
      url: "https://blob.example/design.md",
      extractionId: "123",
    });
  });

  it("clears the DESIGN.md and returns null when url is null", async () => {
    userFindUniqueMock.mockResolvedValueOnce({ id: "user_123" });
    getUserByIdMock.mockResolvedValueOnce({
      metadata: JSON.stringify({
        designMdUrl: "https://blob.example/old.md",
        designMdExtractionId: "9",
      }),
    });

    const response = await putDesignMd("me/design-md", {
      url: null,
      extractionId: null,
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(updateUserMetadataMock).toHaveBeenCalled();
    expect(body.data.designMd).toBeNull();
  });

  it("returns 404 when the user is not found", async () => {
    userFindUniqueMock.mockResolvedValueOnce({ id: "user_123" });
    getUserByIdMock.mockResolvedValueOnce(null);

    const response = await putDesignMd("me/design-md", {
      url: "https://blob.example/design.md",
      extractionId: null,
    });

    expect(response.status).toBe(404);
    expect(updateUserMetadataMock).not.toHaveBeenCalled();
  });
});
