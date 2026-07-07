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

// `Sec-Fetch-*` is a forbidden request header the fetch runtime refuses to set
// programmatically, so the portal navigation guard cannot be exercised through
// real request headers in tests. Default requests to a same-origin navigation
// by stubbing the header getter; individual tests can override the value.
function createPortalRequest(
  url: string,
  secFetchSite: string | null = "same-origin",
): NextRequest {
  const request = new NextRequest(url);
  vi.spyOn(request.headers, "get").mockImplementation((name) =>
    name.toLowerCase() === "sec-fetch-site" ? secFetchSite : null,
  );
  return request;
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
      "https://app.sokosumi.test/signin?returnUrl=%2Fapi%2Fbilling%2Fportal%3FreturnPath%3D%252Faccount",
    );
    expect(openPersonalBillingPortalServerMock).not.toHaveBeenCalled();
  });

  it("returns to the org portal route after sign in for organization portals", async () => {
    getSessionMock.mockResolvedValue(null);

    const { GET } = await import("../route");
    const response = await GET(
      createPortalRequest(
        "https://app.sokosumi.test/api/billing/portal?returnPath=%2Forganizations%2Facme&organizationId=org-1",
      ),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://app.sokosumi.test/signin?returnUrl=%2Fapi%2Fbilling%2Fportal%3FreturnPath%3D%252Forganizations%252Facme%26organizationId%3Dorg-1",
    );
    expect(openOrganizationBillingPortalServerMock).not.toHaveBeenCalled();
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

  it("redirects to sign in when portal creation returns unauthenticated", async () => {
    const { CommonErrorCode } = await import("@/lib/actions/errors");
    getSessionMock.mockResolvedValue({ user: { id: "user-1" } });
    openPersonalBillingPortalServerMock.mockResolvedValue({
      ok: false,
      error: { code: CommonErrorCode.UNAUTHENTICATED },
    });

    const { GET } = await import("../route");
    const response = await GET(
      createPortalRequest(
        "https://app.sokosumi.test/api/billing/portal?returnPath=%2Faccount",
      ),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://app.sokosumi.test/signin?returnUrl=%2Fapi%2Fbilling%2Fportal%3FreturnPath%3D%252Faccount",
    );
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

  it("rejects cross-site navigation without creating a portal session", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "user-1" } });

    const { GET } = await import("../route");
    const response = await GET(
      createPortalRequest(
        "https://app.sokosumi.test/api/billing/portal?returnPath=%2Faccount",
        "cross-site",
      ),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://app.sokosumi.test/account?billingPortalError=general",
    );
    expect(getSessionMock).not.toHaveBeenCalled();
    expect(openPersonalBillingPortalServerMock).not.toHaveBeenCalled();
    expect(openOrganizationBillingPortalServerMock).not.toHaveBeenCalled();
  });

  it("rejects navigation without a Sec-Fetch-Site header", async () => {
    getSessionMock.mockResolvedValue({ user: { id: "user-1" } });

    const { GET } = await import("../route");
    const response = await GET(
      createPortalRequest(
        "https://app.sokosumi.test/api/billing/portal?returnPath=%2Faccount",
        null,
      ),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://app.sokosumi.test/account?billingPortalError=general",
    );
    expect(getSessionMock).not.toHaveBeenCalled();
    expect(openPersonalBillingPortalServerMock).not.toHaveBeenCalled();
  });
});
