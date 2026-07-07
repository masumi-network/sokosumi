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

function createPortalRequest(
  url: string,
  headers: Record<string, string> = {},
): NextRequest {
  return new NextRequest(url, { headers });
}

describe("GET /api/billing/portal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects unauthenticated users to sign in", async () => {
    getSessionMock.mockResolvedValue(null);

    const { GET } = await import("../route");
    const response = await GET(
      createPortalRequest(
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
      createPortalRequest(
        "https://app.sokosumi.test/api/billing/portal?returnPath=%2Faccount",
        { "Sec-Fetch-Site": "same-origin" },
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
      createPortalRequest(
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

  it("redirects back with billingPortalError when portal creation fails", async () => {
    const { CommonErrorCode } = await import("@/lib/actions/errors");
    getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    openPersonalBillingPortalServerMock.mockResolvedValue({
      ok: false,
      error: { code: CommonErrorCode.INTERNAL_SERVER_ERROR },
    });

    const { GET } = await import("../route");
    const response = await GET(
      createPortalRequest(
        "https://app.sokosumi.test/api/billing/portal?returnPath=%2Faccount",
      ),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://app.sokosumi.test/account?billingPortalError=general",
    );
  });

  it("redirects back with unauthorized billingPortalError when access is denied", async () => {
    const { CommonErrorCode } = await import("@/lib/actions/errors");
    getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    openOrganizationBillingPortalServerMock.mockResolvedValue({
      ok: false,
      error: { code: CommonErrorCode.UNAUTHORIZED },
    });

    const { GET } = await import("../route");
    const response = await GET(
      createPortalRequest(
        "https://app.sokosumi.test/api/billing/portal?returnPath=%2Forganizations%2Facme&organizationId=org-1",
      ),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://app.sokosumi.test/organizations/acme?billingPortalError=unauthorized",
    );
  });

  it("sanitizes malicious returnPath values", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    openPersonalBillingPortalServerMock.mockResolvedValue({
      ok: false,
      error: { code: "INTERNAL_SERVER_ERROR" },
    });

    const { GET } = await import("../route");
    const response = await GET(
      createPortalRequest(
        "https://app.sokosumi.test/api/billing/portal?returnPath=https%3A%2F%2Fevil.com",
      ),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://app.sokosumi.test/billing?tab=subscription&billingPortalError=general",
    );
    expect(openPersonalBillingPortalServerMock).toHaveBeenCalledWith({
      returnPath: "/billing?tab=subscription",
    });
  });

  it("rejects non-Stripe portal URLs", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    openPersonalBillingPortalServerMock.mockResolvedValue({
      ok: true,
      data: { url: "https://evil.com/phish" },
    });

    const { GET } = await import("../route");
    const response = await GET(
      createPortalRequest(
        "https://app.sokosumi.test/api/billing/portal?returnPath=%2Faccount",
      ),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://app.sokosumi.test/account?billingPortalError=general",
    );
  });

  it("rejects empty organizationId when the parameter is present", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "user-1" } });

    const { GET } = await import("../route");
    const response = await GET(
      createPortalRequest(
        "https://app.sokosumi.test/api/billing/portal?returnPath=%2Forganizations%2Facme&organizationId=",
      ),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://app.sokosumi.test/organizations/acme?billingPortalError=general",
    );
    expect(openOrganizationBillingPortalServerMock).not.toHaveBeenCalled();
  });
});
