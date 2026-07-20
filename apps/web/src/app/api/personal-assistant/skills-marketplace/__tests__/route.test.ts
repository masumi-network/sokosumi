import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSessionMock, loadMarketplaceMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  loadMarketplaceMock: vi.fn(),
}));

vi.mock("@/lib/auth/auth.server", () => ({
  getSession: (...args: unknown[]) => getSessionMock(...args),
}));

vi.mock("@/lib/hermes/skills-marketplace-data", () => ({
  loadSkillsMarketplaceData: (...args: unknown[]) =>
    loadMarketplaceMock(...args),
}));

import { GET } from "../route";

describe("GET /api/personal-assistant/skills-marketplace", () => {
  beforeEach(() => {
    getSessionMock.mockReset();
    loadMarketplaceMock.mockReset();
  });

  it("returns 401 when unauthenticated", async () => {
    getSessionMock.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
    expect(loadMarketplaceMock).not.toHaveBeenCalled();
  });

  it("returns marketplace data for an authenticated session", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    loadMarketplaceMock.mockResolvedValue({
      marketing: [{ skillId: "s1", slug: "seo", name: "SEO" }],
      installed: [],
      preinstalled: [],
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.marketing).toHaveLength(1);
    expect(body.data.marketing[0].slug).toBe("seo");
  });

  it("returns 500 when the Core-backed load fails", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    loadMarketplaceMock.mockRejectedValue(new Error("core down"));

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe("Internal Server Error");
    expect(body.message).toBe("core down");
  });
});
