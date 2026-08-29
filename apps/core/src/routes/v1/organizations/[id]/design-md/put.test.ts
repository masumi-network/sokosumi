import { HTTPException } from "hono/http-exception";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const {
  organizationFindUniqueMock,
  memberFindUniqueMock,
  updateOrganizationByIdMock,
  uploadDesignMdContentMock,
} = vi.hoisted(() => ({
  organizationFindUniqueMock: vi.fn(),
  memberFindUniqueMock: vi.fn(),
  updateOrganizationByIdMock: vi.fn(),
  uploadDesignMdContentMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    organization: { findUnique: organizationFindUniqueMock },
    member: { findUnique: memberFindUniqueMock },
  },
}));

vi.mock("@sokosumi/database/repositories", () => ({
  organizationRepository: {
    updateOrganizationById: (...args: unknown[]) =>
      updateOrganizationByIdMock(...args),
  },
}));

vi.mock("@/lib/design-md-blob", () => ({
  uploadDesignMdContent: (...args: unknown[]) =>
    uploadDesignMdContentMock(...args),
}));

const USER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: null,
  role: "user",
};

let mountPutOrganizationDesignMd: (app: OpenAPIHonoWithAuth) => void;

function createApp(
  authContext: AuthenticationContext | null = USER_AUTH_CONTEXT,
) {
  const app = new OpenAPIHonoWithAuth();

  app.use("*", async (c, next) => {
    c.set("requestId", "req_123");
    if (!authContext) {
      throw new HTTPException(401, { message: "Unauthorized" });
    }
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  mountPutOrganizationDesignMd(app);
  return app;
}

function setMembership(role: string | null, metadata: unknown) {
  organizationFindUniqueMock.mockResolvedValue({ id: "org_123", metadata });
  memberFindUniqueMock.mockResolvedValue(role ? { role } : null);
}

function putDesignMd(
  id: string,
  body: { content: string | null; extractionId: string | null },
  authContext: AuthenticationContext | null = USER_AUTH_CONTEXT,
) {
  return createApp(authContext).request(`http://localhost/${id}/design-md`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  const module = await import("./put");
  mountPutOrganizationDesignMd = module.default;
});

describe("PUT /organizations/{id}/design-md", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when the organization does not exist", async () => {
    organizationFindUniqueMock.mockResolvedValue(null);
    const response = await putDesignMd("missing", {
      content: "# Brand",
      extractionId: null,
    });
    expect(response.status).toBe(404);
    expect(uploadDesignMdContentMock).not.toHaveBeenCalled();
    expect(updateOrganizationByIdMock).not.toHaveBeenCalled();
  });

  it("returns 403 when the user is not a member", async () => {
    setMembership(null, JSON.stringify({}));
    const response = await putDesignMd("org_123", {
      content: "# Brand",
      extractionId: null,
    });
    expect(response.status).toBe(403);
    expect(uploadDesignMdContentMock).not.toHaveBeenCalled();
    expect(updateOrganizationByIdMock).not.toHaveBeenCalled();
  });

  it("returns 403 for a member who is not an owner or admin", async () => {
    setMembership("member", JSON.stringify({}));
    const response = await putDesignMd("org_123", {
      content: "# Brand",
      extractionId: null,
    });
    expect(response.status).toBe(403);
    expect(updateOrganizationByIdMock).not.toHaveBeenCalled();
  });

  it("uploads the content and persists the URL for an owner", async () => {
    setMembership("owner", JSON.stringify({ invoiceEmail: "b@acme.example" }));
    uploadDesignMdContentMock.mockResolvedValueOnce(
      "https://blob.example/org.md",
    );
    const response = await putDesignMd("org_123", {
      content: "# Brand",
      extractionId: "55",
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(uploadDesignMdContentMock).toHaveBeenCalledWith({
      content: "# Brand",
      owner: { kind: "organization", id: "org_123" },
      extractionId: "55",
    });
    expect(updateOrganizationByIdMock).toHaveBeenCalledWith(
      "org_123",
      { metadata: expect.stringContaining("https://blob.example/org.md") },
      expect.anything(),
    );
    expect(body.data.designMd).toEqual({
      url: "https://blob.example/org.md",
      extractionId: "55",
    });
  });

  it("clears the DESIGN.md for an admin when content is null", async () => {
    setMembership(
      "admin",
      JSON.stringify({ designMdUrl: "https://blob.example/old.md" }),
    );
    const response = await putDesignMd("org_123", {
      content: null,
      extractionId: null,
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(uploadDesignMdContentMock).not.toHaveBeenCalled();
    expect(updateOrganizationByIdMock).toHaveBeenCalled();
    expect(body.data.designMd).toBeNull();
  });

  it("returns 503 when storage fails", async () => {
    setMembership("owner", JSON.stringify({}));
    uploadDesignMdContentMock.mockResolvedValueOnce(null);
    const response = await putDesignMd("org_123", {
      content: "# Brand",
      extractionId: null,
    });

    expect(response.status).toBe(503);
    expect(updateOrganizationByIdMock).not.toHaveBeenCalled();
  });

  it("rejects coworker context even with X-Context-User-Id", async () => {
    setMembership("owner", JSON.stringify({}));

    const response = await putDesignMd(
      "org_123",
      { content: "# Brand", extractionId: null },
      {
        actor: "coworker",
        coworkerId: "coworker_1",
        vendorId: "vendor_1",
        context: { userId: "user_123", organizationId: "org_123" },
      },
    );

    expect(response.status).toBe(403);
    expect(organizationFindUniqueMock).not.toHaveBeenCalled();
    expect(uploadDesignMdContentMock).not.toHaveBeenCalled();
    expect(updateOrganizationByIdMock).not.toHaveBeenCalled();
  });
});
