import { beforeEach, describe, expect, it, vi } from "vitest";

const connectionMock = vi.fn(async () => undefined);
const isLockedMock = vi.fn<() => Promise<boolean>>();

vi.mock("next/cache", () => ({ cacheLife: () => undefined }));
vi.mock("next/server", () => ({ connection: () => connectionMock() }));
vi.mock("@/lib/auth/is-organization-product-locked", () => ({
  isOrganizationProductLocked: () => isLockedMock(),
}));
vi.mock("@/components/billing/organization-product-seat-required", () => ({
  OrganizationProductSeatRequired: () => null,
}));

const { OrganizationProductLayout } = await import(
  "./organization-product-layout"
);
const { OrganizationProductSeatRequired } = await import(
  "@/components/billing/organization-product-seat-required"
);

describe("OrganizationProductLayout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isLockedMock.mockReset();
  });

  // connection() would drop the page under it from every link prefetch.
  it("renders the page without deferring to the request", async () => {
    isLockedMock.mockResolvedValue(false);

    const result = await OrganizationProductLayout({ children: "page" });

    expect(result).toBe("page");
    expect(connectionMock).not.toHaveBeenCalled();
  });

  // A prefetch would keep the outage as the error page the click opens.
  it("renders a failed lock check fresh on the click", async () => {
    isLockedMock
      .mockRejectedValueOnce(new Error("Core answered 503"))
      .mockResolvedValueOnce(true);

    const result = await OrganizationProductLayout({ children: "page" });

    expect(connectionMock).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ type: OrganizationProductSeatRequired });
  });
});
