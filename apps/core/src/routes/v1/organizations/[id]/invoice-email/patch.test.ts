import { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";

const {
  organizationFindUniqueMock,
  memberFindUniqueMock,
  updateOrganizationInvoiceEmailMock,
} = vi.hoisted(() => ({
  organizationFindUniqueMock: vi.fn(),
  memberFindUniqueMock: vi.fn(),
  updateOrganizationInvoiceEmailMock: vi.fn(),
}));

vi.mock("@/middleware/auth", () => ({
  requireUserContext: (authContext: AuthenticationContext | null) => {
    if (!authContext || authContext.actor !== "user") {
      throw new HTTPException(403, {
        message: "User authentication required",
      });
    }
    return { source: "session" as const, ...authContext };
  },
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    organization: { findUnique: organizationFindUniqueMock },
    member: { findUnique: memberFindUniqueMock },
  },
}));

vi.mock("@sokosumi/database/repositories", () => ({
  organizationRepository: {
    updateOrganizationInvoiceEmail: (...args: unknown[]) =>
      updateOrganizationInvoiceEmailMock(...args),
  },
}));

const USER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: null,
  role: "user",
};

let mountPatchOrganizationInvoiceEmail: (app: OpenAPIHonoWithAuth) => void;

function createApp(
  authContext: AuthenticationContext | null = USER_AUTH_CONTEXT,
) {
  const app = new OpenAPIHono<{
    Variables: AuthVariables & { requestId: string };
  }>();

  app.use("*", async (c, next) => {
    c.set("requestId", "req_123");
    if (!authContext) {
      throw new HTTPException(401, { message: "Unauthorized" });
    }
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  mountPatchOrganizationInvoiceEmail(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

function setMembership(role: string | null, metadata: unknown) {
  organizationFindUniqueMock.mockResolvedValue({ id: "org_123", metadata });
  memberFindUniqueMock.mockResolvedValue(role ? { role } : null);
}

function patchInvoiceEmail(id: string, body: { invoiceEmail: string | null }) {
  return createApp().request(`http://localhost/${id}/invoice-email`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  const module = await import("./patch");
  mountPatchOrganizationInvoiceEmail = module.default;
});

describe("PATCH /organizations/{id}/invoice-email", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when the organization does not exist", async () => {
    organizationFindUniqueMock.mockResolvedValue(null);
    const response = await patchInvoiceEmail("missing", {
      invoiceEmail: "billing@acme.example",
    });
    expect(response.status).toBe(404);
    expect(updateOrganizationInvoiceEmailMock).not.toHaveBeenCalled();
  });

  it("returns 403 when the user is not a member", async () => {
    setMembership(null, JSON.stringify({}));
    const response = await patchInvoiceEmail("org_123", {
      invoiceEmail: "billing@acme.example",
    });
    expect(response.status).toBe(403);
    expect(updateOrganizationInvoiceEmailMock).not.toHaveBeenCalled();
  });

  it("returns 403 for a member who is not an owner or admin", async () => {
    setMembership("member", JSON.stringify({}));
    const response = await patchInvoiceEmail("org_123", {
      invoiceEmail: "billing@acme.example",
    });
    expect(response.status).toBe(403);
    expect(updateOrganizationInvoiceEmailMock).not.toHaveBeenCalled();
  });

  it("returns 400 when the invoice email is not a valid email", async () => {
    setMembership("owner", JSON.stringify({}));
    const response = await patchInvoiceEmail("org_123", {
      invoiceEmail: "not-an-email",
    });
    expect(response.status).toBe(400);
    expect(updateOrganizationInvoiceEmailMock).not.toHaveBeenCalled();
  });

  it("persists the invoice email for an owner", async () => {
    setMembership("owner", JSON.stringify({}));
    updateOrganizationInvoiceEmailMock.mockResolvedValueOnce({
      id: "org_123",
      metadata: JSON.stringify({ invoiceEmail: "billing@acme.example" }),
    });
    const response = await patchInvoiceEmail("org_123", {
      invoiceEmail: "billing@acme.example",
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(updateOrganizationInvoiceEmailMock).toHaveBeenCalledWith(
      "org_123",
      "billing@acme.example",
      expect.anything(),
    );
    expect(body.data.invoiceEmail).toBe("billing@acme.example");
  });

  it("clears the invoice email for an admin when invoiceEmail is null", async () => {
    setMembership(
      "admin",
      JSON.stringify({ invoiceEmail: "old@acme.example" }),
    );
    updateOrganizationInvoiceEmailMock.mockResolvedValueOnce({
      id: "org_123",
      metadata: null,
    });
    const response = await patchInvoiceEmail("org_123", {
      invoiceEmail: null,
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(updateOrganizationInvoiceEmailMock).toHaveBeenCalledWith(
      "org_123",
      null,
      expect.anything(),
    );
    expect(body.data.invoiceEmail).toBeNull();
  });
});
