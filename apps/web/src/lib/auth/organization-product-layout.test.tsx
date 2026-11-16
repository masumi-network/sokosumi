import { redirect } from "next/navigation";
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
  it("keeps a failed lock check out of the prefetch", async () => {
    isLockedMock.mockRejectedValue(new Error("Core answered 503"));

    await expect(
      OrganizationProductLayout({ children: "page" }),
    ).rejects.toThrow("Core answered 503");

    expect(connectionMock).toHaveBeenCalledOnce();
    expect(isLockedMock).toHaveBeenCalledOnce();
  });

  // A signed-out prefetch must still carry the sign-in redirect.
  it("keeps a sign-in redirect from the lock check", async () => {
    isLockedMock.mockImplementation(async () => redirect("/signin"));

    await expect(
      OrganizationProductLayout({ children: "page" }),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(connectionMock).not.toHaveBeenCalled();
  });
});
