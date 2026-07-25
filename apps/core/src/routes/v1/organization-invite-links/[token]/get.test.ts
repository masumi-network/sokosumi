import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import mountResolveInviteLink from "./get";

const { getInviteLinkByTokenMock, orgFindUniqueMock } = vi.hoisted(() => ({
  getInviteLinkByTokenMock: vi.fn(),
  orgFindUniqueMock: vi.fn(),
}));

vi.mock("@sokosumi/database/repositories", () => ({
  organizationInviteLinkRepository: {
    getInviteLinkByToken: (...args: unknown[]) =>
      getInviteLinkByTokenMock(...args),
  },
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    organization: {
      findUnique: (...args: unknown[]) => orgFindUniqueMock(...args),
    },
  },
}));

const NOW = Date.now();

function liveLink(overrides: Record<string, unknown> = {}) {
  return {
    id: "link_1",
    token: "tok_live",
    organizationId: "org_1",
    role: "member",
    createdByUserId: "owner_1",
    createdAt: new Date(NOW - 1000),
    expiresAt: new Date(NOW + 7 * 24 * 60 * 60 * 1000),
    revokedAt: null,
    maxUses: null,
    useCount: 0,
    ...overrides,
  };
}

function createApp() {
  const app = new OpenAPIHono();
  mountResolveInviteLink(app);
  return app;
}

describe("GET /organization-invite-links/{token} (public)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    orgFindUniqueMock.mockResolvedValue({
      name: "Acme",
      slug: "acme",
      logo: "https://cdn/acme.png",
    });
  });

  it("returns the org preview for a live link, no auth required", async () => {
    getInviteLinkByTokenMock.mockResolvedValue(liveLink());

    const app = createApp();
    const response = await app.request("http://localhost/tok_live");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.status).toBe("valid");
    expect(body.data.organization).toEqual({
      name: "Acme",
      slug: "acme",
      logo: "https://cdn/acme.png",
    });
  });

  it("hides the org for an expired link", async () => {
    getInviteLinkByTokenMock.mockResolvedValue(
      liveLink({ expiresAt: new Date(NOW - 1000) }),
    );

    const app = createApp();
    const response = await app.request("http://localhost/tok_expired");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.status).toBe("expired");
    expect(body.data.organization).toBeNull();
    // Never query the org for a dead link.
    expect(orgFindUniqueMock).not.toHaveBeenCalled();
  });

  it("hides the org for a revoked link", async () => {
    getInviteLinkByTokenMock.mockResolvedValue(
      liveLink({ revokedAt: new Date(NOW - 500) }),
    );

    const app = createApp();
    const response = await app.request("http://localhost/tok_revoked");
    const body = await response.json();

    expect(body.data.status).toBe("revoked");
    expect(body.data.organization).toBeNull();
  });

  it("reports not_found for an unknown token", async () => {
    getInviteLinkByTokenMock.mockResolvedValue(null);

    const app = createApp();
    const response = await app.request("http://localhost/tok_missing");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.status).toBe("not_found");
    expect(body.data.organization).toBeNull();
  });
});
