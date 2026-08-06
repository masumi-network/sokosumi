import { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor.js";

const { uploadDesignMdContentMock } = vi.hoisted(() => ({
  uploadDesignMdContentMock: vi.fn(),
}));

vi.mock("@/lib/design-md-blob", () => ({
  uploadDesignMdContent: (...args: unknown[]) =>
    uploadDesignMdContentMock(...args),
}));

vi.mock("@/middleware/auth", () => ({
  requireUserContext: (authContext: AuthenticationContext | null) => {
    if (!authContext || authContext.actor !== "user") {
      throw new HTTPException(403, { message: "User authentication required" });
    }
    return { source: "session" as const, ...authContext };
  },
  requireOwnerUserContext: (authContext: AuthenticationContext | null) => {
    if (!authContext) {
      throw new HTTPException(403, {
        message: "User authentication required",
      });
    }
    if (authContext.actor === "coworker") {
      throw new HTTPException(403, {
        message: "Coworker authentication cannot perform this owner action",
      });
    }
    if (authContext.actor === "user") {
      return { source: "session" as const, ...authContext };
    }
    if (
      authContext.actor === "orchestrator" &&
      "context" in authContext &&
      authContext.context
    ) {
      return {
        source: "context" as const,
        userId: authContext.context.userId,
        organizationId: authContext.context.organizationId,
      };
    }
    throw new HTTPException(403, {
      message:
        "Context headers (X-Context-User-Id) are required for this resource",
    });
  },
}));

const USER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: null,
  role: "user",
};

const COWORKER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "coworker",
  coworkerId: "cow_123",
  vendorId: TEST_VENDOR_ID,
};

let mountPostWorkspaceDesignMdAdHoc: (app: OpenAPIHonoWithAuth) => void;

function createApp(authContext: AuthenticationContext = USER_AUTH_CONTEXT) {
  const app = new OpenAPIHono<{
    Variables: AuthVariables & { requestId: string };
  }>();
  app.use("*", async (c, next) => {
    c.set("requestId", "req_123");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });
  mountPostWorkspaceDesignMdAdHoc(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

function postAdHoc(
  body: { content: string; extractionId: string | null },
  authContext?: AuthenticationContext,
) {
  return createApp(authContext).request("http://localhost/design-md/adhoc", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  const module = await import("./post");
  mountPostWorkspaceDesignMdAdHoc = module.default;
});

describe("POST /workspaces/design-md/adhoc", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stores the content under the caller's ad hoc blob path and never touches a profile", async () => {
    uploadDesignMdContentMock.mockResolvedValueOnce(
      "https://blob.example/design-md/adhoc/user_123/hash.md",
    );

    const response = await postAdHoc({
      content: "# Competitor Brand",
      extractionId: "77",
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(uploadDesignMdContentMock).toHaveBeenCalledWith({
      content: "# Competitor Brand",
      owner: { kind: "adhoc", id: "user_123" },
      extractionId: "77",
    });
    expect(body.data.designMd).toEqual({
      url: "https://blob.example/design-md/adhoc/user_123/hash.md",
      extractionId: "77",
    });
  });

  it("does not require organization owner/admin — any authenticated user may call it", async () => {
    uploadDesignMdContentMock.mockResolvedValueOnce(
      "https://blob.example/design-md/adhoc/user_123/hash.md",
    );

    const response = await postAdHoc(
      { content: "# Brand", extractionId: null },
      { ...USER_AUTH_CONTEXT, organizationId: "org_1" },
    );

    expect(response.status).toBe(200);
  });

  it("returns 403 for coworker authentication", async () => {
    const response = await postAdHoc(
      { content: "# Brand", extractionId: null },
      COWORKER_AUTH_CONTEXT,
    );
    expect(response.status).toBe(403);
  });

  it("returns 400 for empty content", async () => {
    const response = await postAdHoc({ content: "   ", extractionId: null });
    expect(response.status).toBe(400);
    expect(uploadDesignMdContentMock).not.toHaveBeenCalled();
  });

  it("returns 503 when storage fails", async () => {
    uploadDesignMdContentMock.mockResolvedValueOnce(null);

    const response = await postAdHoc({
      content: "# Brand",
      extractionId: null,
    });

    expect(response.status).toBe(503);
  });
});
