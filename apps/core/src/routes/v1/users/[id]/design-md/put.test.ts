import { beforeEach, describe, expect, it, vi } from "vitest";

import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import {
  type UserRouteVariables,
  usersPathUserContextMiddleware,
} from "@/routes/v1/users/user-route-context";

import mountPutUserDesignMd from "./put";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const {
  userFindUniqueMock,
  getUserByIdMock,
  updateUserMetadataMock,
  uploadDesignMdContentMock,
} = vi.hoisted(() => ({
  userFindUniqueMock: vi.fn(),
  getUserByIdMock: vi.fn(),
  updateUserMetadataMock: vi.fn(),
  uploadDesignMdContentMock: vi.fn(),
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

vi.mock("@/lib/design-md-blob", () => ({
  uploadDesignMdContent: (...args: unknown[]) =>
    uploadDesignMdContentMock(...args),
}));

const SESSION_USER: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: null,
  role: "user",
};

function createApp(authContext: AuthenticationContext = SESSION_USER) {
  const app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  const userByIdApp = new OpenAPIHonoWithAuth<UserRouteVariables>();
  userByIdApp.use("*", usersPathUserContextMiddleware);
  mountPutUserDesignMd(userByIdApp);
  app.route("/:id", userByIdApp);
  return app;
}

function putDesignMd(
  path: string,
  body: { content: string | null; extractionId: string | null },
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
      content: "# Brand",
      extractionId: null,
    });
    expect(response.status).toBe(403);
    expect(uploadDesignMdContentMock).not.toHaveBeenCalled();
    expect(updateUserMetadataMock).not.toHaveBeenCalled();
  });

  it("uploads the content and persists the resulting URL", async () => {
    userFindUniqueMock.mockResolvedValueOnce({ id: "user_123" });
    getUserByIdMock.mockResolvedValueOnce({ metadata: JSON.stringify({}) });
    uploadDesignMdContentMock.mockResolvedValueOnce(
      "https://blob.example/design.md",
    );

    const response = await putDesignMd("me/design-md", {
      content: "# Brand",
      extractionId: "123",
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(uploadDesignMdContentMock).toHaveBeenCalledWith({
      content: "# Brand",
      owner: { kind: "user", id: "user_123" },
      extractionId: "123",
    });
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

  it("clears the DESIGN.md and returns null when content is null", async () => {
    userFindUniqueMock.mockResolvedValueOnce({ id: "user_123" });
    getUserByIdMock.mockResolvedValueOnce({
      metadata: JSON.stringify({
        designMdUrl: "https://blob.example/old.md",
        designMdExtractionId: "9",
      }),
    });

    const response = await putDesignMd("me/design-md", {
      content: null,
      extractionId: null,
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(uploadDesignMdContentMock).not.toHaveBeenCalled();
    expect(updateUserMetadataMock).toHaveBeenCalled();
    expect(body.data.designMd).toBeNull();
  });

  it("returns 422 when the content is empty", async () => {
    userFindUniqueMock.mockResolvedValueOnce({ id: "user_123" });

    const response = await putDesignMd("me/design-md", {
      content: "   ",
      extractionId: null,
    });

    expect(response.status).toBe(422);
    expect(updateUserMetadataMock).not.toHaveBeenCalled();
  });

  it("returns 503 when storage fails", async () => {
    userFindUniqueMock.mockResolvedValueOnce({ id: "user_123" });
    getUserByIdMock.mockResolvedValueOnce({ metadata: JSON.stringify({}) });
    uploadDesignMdContentMock.mockResolvedValueOnce(null);

    const response = await putDesignMd("me/design-md", {
      content: "# Brand",
      extractionId: null,
    });

    expect(response.status).toBe(503);
    expect(updateUserMetadataMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the user is not found", async () => {
    userFindUniqueMock.mockResolvedValueOnce({ id: "user_123" });
    getUserByIdMock.mockResolvedValueOnce(null);

    const response = await putDesignMd("me/design-md", {
      content: "# Brand",
      extractionId: null,
    });

    expect(response.status).toBe(404);
    expect(uploadDesignMdContentMock).not.toHaveBeenCalled();
    expect(updateUserMetadataMock).not.toHaveBeenCalled();
  });
});
