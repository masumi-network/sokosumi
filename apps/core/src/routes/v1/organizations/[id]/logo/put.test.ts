import { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { LIMITS } from "@/config/constants";
import { formatZodErrorMessage, unprocessableEntity } from "@/helpers/error";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";

const {
  getEnvMock,
  prismaMemberFindUniqueMock,
  prismaOrganizationFindUniqueMock,
  prismaOrganizationUpdateMock,
  uploadOrganizationLogoMock,
} = vi.hoisted(() => ({
  getEnvMock: vi.fn(),
  prismaMemberFindUniqueMock: vi.fn(),
  prismaOrganizationFindUniqueMock: vi.fn(),
  prismaOrganizationUpdateMock: vi.fn(),
  uploadOrganizationLogoMock: vi.fn(),
}));

vi.mock("@/config/env", () => ({
  getEnv: getEnvMock,
}));

vi.mock("@/middleware/auth", () => ({
  requireUserAuthContext: (authContext: AuthenticationContext | null) => {
    if (!authContext || authContext.actor !== "user") {
      throw new HTTPException(403, {
        message: "User authentication required",
      });
    }

    return authContext;
  },
}));

vi.mock("@/lib/blob", () => ({
  uploadOrganizationLogo: uploadOrganizationLogoMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    organization: {
      findUnique: prismaOrganizationFindUniqueMock,
      update: prismaOrganizationUpdateMock,
    },
    member: {
      findUnique: prismaMemberFindUniqueMock,
    },
  },
}));

const USER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: null,
};

const COWORKER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "coworker",
  coworkerId: "cow_123",
};

let mountPutOrganizationLogo: (app: OpenAPIHonoWithAuth) => void;

function mockPrismaResolve(
  organization: Record<string, unknown> | null,
  member: Record<string, unknown> | null,
) {
  prismaOrganizationFindUniqueMock.mockResolvedValue(organization);
  prismaMemberFindUniqueMock.mockResolvedValue(member);
}

function createOrganization(overrides: Record<string, unknown> = {}) {
  return {
    id: "org_123",
    createdAt: new Date("2026-03-16T09:00:00.000Z"),
    name: "Acme",
    slug: "acme",
    logo: null,
    metadata: null,
    stripeCustomerId: null,
    invoiceEmail: null,
    ...overrides,
  };
}

function createApp(
  authContext: AuthenticationContext | null = USER_AUTH_CONTEXT,
) {
  const app = new OpenAPIHono<{
    Variables: AuthVariables & { requestId: string };
  }>({
    defaultHook: (result) => {
      if (!result.success && result.error) {
        throw unprocessableEntity(formatZodErrorMessage(result.error));
      }
    },
  });

  app.use("*", async (c, next) => {
    c.set("requestId", "req_123");

    if (!authContext) {
      throw new HTTPException(401, {
        message: "Unauthorized",
      });
    }

    c.set("isAuthenticated", true);
    c.set("authContext", authContext);

    return await next();
  });

  mountPutOrganizationLogo(app as unknown as OpenAPIHonoWithAuth);

  return app;
}

function createImageFormData(
  file = new File(["logo"], "logo.png", {
    type: "image/png",
  }),
) {
  const formData = new FormData();
  formData.set("file", file);
  return formData;
}

beforeAll(async () => {
  const module = await import("./put");
  mountPutOrganizationLogo = module.default;
});

describe("PUT /organizations/{id}/logo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getEnvMock.mockReturnValue({
      BLOB_READ_WRITE_TOKEN: "blob-token",
    });
    uploadOrganizationLogoMock.mockResolvedValue(
      "https://blob.example/organizations/org_123/logo",
    );
  });

  it("returns 422 when file is missing", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/org_123/logo", {
      method: "PUT",
      body: new FormData(),
    });

    expect(response.status).toBe(422);
    expect(uploadOrganizationLogoMock).not.toHaveBeenCalled();
  });

  it("returns 422 when file is not a File instance", async () => {
    const app = createApp();
    const formData = createImageFormData("not-a-file" as unknown as File);

    const response = await app.request("http://localhost/org_123/logo", {
      method: "PUT",
      body: formData,
    });

    expect(response.status).toBe(422);
    expect(uploadOrganizationLogoMock).not.toHaveBeenCalled();
  });

  it("returns 422 when file is empty", async () => {
    const app = createApp();
    const formData = createImageFormData(
      new File([], "logo.png", { type: "image/png" }),
    );

    const response = await app.request("http://localhost/org_123/logo", {
      method: "PUT",
      body: formData,
    });

    expect(response.status).toBe(422);
    expect(uploadOrganizationLogoMock).not.toHaveBeenCalled();
  });

  it("returns 422 when multiple files are provided", async () => {
    const app = createApp();
    const formData = new FormData();
    formData.append("file", new File(["a"], "a.png", { type: "image/png" }));
    formData.append("file", new File(["b"], "b.png", { type: "image/png" }));

    const response = await app.request("http://localhost/org_123/logo", {
      method: "PUT",
      body: formData,
    });

    expect(response.status).toBe(422);
    expect(uploadOrganizationLogoMock).not.toHaveBeenCalled();
  });

  it("returns 422 when file exceeds maximum size", async () => {
    const app = createApp();
    const formData = createImageFormData(
      new File(
        [new Uint8Array(LIMITS.ORGANIZATION_LOGO_MAX_SIZE_BYTES + 1)],
        "logo.png",
        {
          type: "image/png",
        },
      ),
    );

    const response = await app.request("http://localhost/org_123/logo", {
      method: "PUT",
      body: formData,
    });

    expect(response.status).toBe(422);
    expect(uploadOrganizationLogoMock).not.toHaveBeenCalled();
  });

  it("returns 422 when file type is unsupported", async () => {
    const app = createApp();
    const formData = createImageFormData(
      new File(["logo"], "logo.txt", { type: "text/plain" }),
    );

    const response = await app.request("http://localhost/org_123/logo", {
      method: "PUT",
      body: formData,
    });

    expect(response.status).toBe(422);
    expect(uploadOrganizationLogoMock).not.toHaveBeenCalled();
  });

  it("returns 401 when the request is unauthenticated", async () => {
    const app = createApp(null);

    const response = await app.request("http://localhost/org_123/logo", {
      method: "PUT",
      body: createImageFormData(),
    });

    expect(response.status).toBe(401);
  });

  it("returns 403 for coworker authentication", async () => {
    const app = createApp(COWORKER_AUTH_CONTEXT);

    const response = await app.request("http://localhost/org_123/logo", {
      method: "PUT",
      body: createImageFormData(),
    });

    expect(response.status).toBe(403);
  });

  it("returns 403 when the member role is insufficient", async () => {
    mockPrismaResolve(createOrganization(), {
      id: "member_123",
      role: "member",
      userId: "user_123",
      organizationId: "org_123",
      createdAt: new Date("2026-03-16T09:00:00.000Z"),
    });

    const app = createApp();

    const response = await app.request("http://localhost/org_123/logo", {
      method: "PUT",
      body: createImageFormData(),
    });

    expect(response.status).toBe(403);
    expect(prismaOrganizationUpdateMock).not.toHaveBeenCalled();
    expect(uploadOrganizationLogoMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the organization does not exist", async () => {
    mockPrismaResolve(null, null);

    const app = createApp();

    const response = await app.request("http://localhost/missing-org/logo", {
      method: "PUT",
      body: createImageFormData(),
    });

    expect(response.status).toBe(404);
    expect(prismaMemberFindUniqueMock).not.toHaveBeenCalled();
    expect(uploadOrganizationLogoMock).not.toHaveBeenCalled();
  });

  it("returns 413 when the multipart request exceeds the body limit", async () => {
    const app = createApp();
    const response = await app.request(
      new Request("http://localhost/org_123/logo", {
        method: "PUT",
        headers: {
          "Content-Type": "multipart/form-data; boundary=test-boundary",
          "Content-Length": String(
            LIMITS.ORGANIZATION_LOGO_MAX_SIZE_BYTES + 512 * 1024,
          ),
        },
        body: "--test-boundary--",
      }),
    );

    expect(response.status).toBe(413);
  });

  it("returns 503 when blob storage is not configured", async () => {
    getEnvMock.mockReturnValue({
      BLOB_READ_WRITE_TOKEN: undefined,
    });

    mockPrismaResolve(createOrganization(), {
      id: "member_123",
      role: "owner",
      userId: "user_123",
      organizationId: "org_123",
      createdAt: new Date("2026-03-16T09:00:00.000Z"),
    });

    const app = createApp();

    const response = await app.request("http://localhost/org_123/logo", {
      method: "PUT",
      body: createImageFormData(),
    });

    expect(response.status).toBe(503);
    expect(prismaOrganizationUpdateMock).not.toHaveBeenCalled();
    expect(uploadOrganizationLogoMock).not.toHaveBeenCalled();
  });

  it("uploads the logo, updates the organization, and returns the payload", async () => {
    mockPrismaResolve(createOrganization(), {
      id: "member_123",
      role: "owner",
      userId: "user_123",
      organizationId: "org_123",
      createdAt: new Date("2026-03-16T09:00:00.000Z"),
    });
    prismaOrganizationUpdateMock.mockResolvedValue(
      createOrganization({
        logo: "https://blob.example/organizations/org_123/logo",
      }),
    );

    const app = createApp();
    const response = await app.request("http://localhost/org_123/logo", {
      method: "PUT",
      body: createImageFormData(),
    });

    expect(response.status).toBe(200);
    expect(uploadOrganizationLogoMock).toHaveBeenCalledWith(
      "org_123",
      expect.any(File),
      "blob-token",
    );
    expect(prismaOrganizationUpdateMock).toHaveBeenCalledWith({
      where: { id: "org_123" },
      data: {
        logo: "https://blob.example/organizations/org_123/logo",
      },
    });

    const body = await response.json();
    expect(body.data).toMatchObject({
      id: "org_123",
      role: "owner",
      logo: "https://blob.example/organizations/org_123/logo",
    });
  });
});
