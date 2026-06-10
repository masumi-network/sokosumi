import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { lookupPendingInvitationMock } = vi.hoisted(() => ({
  lookupPendingInvitationMock: vi.fn(),
}));

vi.mock("@/helpers/invitation", () => ({
  lookupPendingInvitationById: (...args: unknown[]) =>
    lookupPendingInvitationMock(...args),
}));

let mountGetInvitationById: (app: OpenAPIHono) => void;

function createApp() {
  const app = new OpenAPIHono();
  app.use("*", async (c, next) => {
    c.set("requestId", "req_123");
    return await next();
  });
  mountGetInvitationById(app);
  return app;
}

beforeAll(async () => {
  const module = await import("./get");
  mountGetInvitationById = module.default;
});

describe("GET /invitations/{id} (public)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    "not_found",
    "expired",
    "inviter_not_found",
  ] as const)("passes through the %s outcome with a 200", async (kind) => {
    lookupPendingInvitationMock.mockResolvedValue({ kind });
    const response = await createApp().request("http://localhost/inv_x");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({ kind });
  });

  it("returns the resolved invitation on the ok path", async () => {
    lookupPendingInvitationMock.mockResolvedValue({
      kind: "ok",
      invitation: {
        id: "inv_1",
        organizationId: "org_1",
        email: "jane@example.com",
        role: "member",
        status: "pending",
        expiresAt: new Date("2999-01-01T00:00:00.000Z"),
        inviterId: "user_1",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        organization: { id: "org_1", name: "Acme", slug: "acme" },
        inviter: { id: "user_1", email: "owner@example.com" },
      },
    });

    const response = await createApp().request("http://localhost/inv_1");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.kind).toBe("ok");
    expect(body.data.invitation).toMatchObject({
      id: "inv_1",
      organization: { name: "Acme", slug: "acme" },
      inviter: { email: "owner@example.com" },
    });
    expect(lookupPendingInvitationMock).toHaveBeenCalledWith("inv_1");
  });
});
