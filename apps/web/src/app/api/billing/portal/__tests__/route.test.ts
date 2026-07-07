import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const openPersonalBillingPortalServerMock = vi.fn();
const openOrganizationBillingPortalServerMock = vi.fn();

vi.mock("@/lib/auth/auth.server", () => ({
  getSession: (...args: unknown[]) => getSessionMock(...args),
}));

vi.mock("@/lib/auth/subscription.server", () => ({
  openPersonalBillingPortalServer: (...args: unknown[]) =>
    openPersonalBillingPortalServerMock(...args),
  openOrganizationBillingPortalServer: (...args: unknown[]) =>
    openOrganizationBillingPortalServerMock(...args),
}));

describe("GET /api/billing/portal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects unauthenticated users to sign in", async () => {
    getSessionMock.mockResolvedValue(null);

    const { GET } = await import("../route");
    const response = await GET(
      new NextRequest(
        "https://app.sokosumi.test/api/billing/portal?returnPath=%2Faccount",
      ),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://app.sokosumi.test/signin?returnUrl=%2Faccount",
    );
    expect(openPersonalBillingPortalServerMock).not.toHaveBeenCalled();
  });

  it("redirects authenticated users to the Stripe billing portal", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    openPersonalBillingPortalServerMock.mockResolvedValue({
      ok: true,
      data: { url: "https://billing.stripe.com/session/test" },
    });

    const { GET } = await import("../route");
    const response = await GET(
      new NextRequest(
        "https://app.sokosumi.test/api/billing/portal?returnPath=%2Faccount",
      ),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://billing.stripe.com/session/test",
    );
    expect(openPersonalBillingPortalServerMock).toHaveBeenCalledWith({
      returnPath: "/account",
    });
  });

  it("opens the organization billing portal when organizationId is provided", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    openOrganizationBillingPortalServerMock.mockResolvedValue({
      ok: true,
      data: { url: "https://billing.stripe.com/session/org" },
    });

    const { GET } = await import("../route");
    const response = await GET(
      new NextRequest(
        "https://app.sokosumi.test/api/billing/portal?returnPath=%2Forganizations%2Facme&organizationId=org-1",
      ),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://billing.stripe.com/session/org",
    );
    expect(openOrganizationBillingPortalServerMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      returnPath: "/organizations/acme",
    });
  });

  it("redirects back to the safe return path when portal creation fails", async () => {
    const { CommonErrorCode } = await import("@/lib/actions/errors");
    getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    openPersonalBillingPortalServerMock.mockResolvedValue({
      ok: false,
      error: { code: CommonErrorCode.INTERNAL_SERVER_ERROR },
    });

    const { GET } = await import("../route");
    const response = await GET(
      new NextRequest(
        "https://app.sokosumi.test/api/billing/portal?returnPath=%2Faccount",
      ),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://app.sokosumi.test/account",
    );
  });
});
