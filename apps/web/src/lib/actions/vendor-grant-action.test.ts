import { beforeEach, describe, expect, it, vi } from "vitest";

import { CommonErrorCode } from "@/lib/actions/errors/error-codes/common";

const approveMyVendorGrantMock = vi.fn();
const denyMyVendorGrantMock = vi.fn();
const revokeMyVendorGrantMock = vi.fn();
const createMyVendorGrantMock = vi.fn();
const approveVendorGrantMock = vi.fn();
const denyVendorGrantMock = vi.fn();
const revokeVendorGrantMock = vi.fn();
const createVendorGrantMock = vi.fn();

vi.mock("@/lib/services/vendor-grant.service", () => ({
  vendorGrantService: {
    approveMyVendorGrant: (...args: unknown[]) =>
      approveMyVendorGrantMock(...args),
    denyMyVendorGrant: (...args: unknown[]) => denyMyVendorGrantMock(...args),
    revokeMyVendorGrant: (...args: unknown[]) =>
      revokeMyVendorGrantMock(...args),
    createMyVendorGrant: (...args: unknown[]) =>
      createMyVendorGrantMock(...args),
    approveVendorGrant: (...args: unknown[]) => approveVendorGrantMock(...args),
    denyVendorGrant: (...args: unknown[]) => denyVendorGrantMock(...args),
    revokeVendorGrant: (...args: unknown[]) => revokeVendorGrantMock(...args),
    createVendorGrant: (...args: unknown[]) => createVendorGrantMock(...args),
  },
}));

vi.mock("@/middleware/auth-middleware", () => ({
  withSession:
    <TArgs, TResult>(
      handler: (args: TArgs & { session: unknown }) => Promise<TResult>,
    ) =>
    async (args: TArgs) =>
      handler({ ...args, session: { user: { id: "user_1" } } }),
}));

import {
  approveMyVendorGrant,
  approveOrganizationVendorGrant,
  createMyVendorGrant,
  createOrganizationVendorGrant,
} from "@/lib/actions/vendor-grant-action";

const GRANT_ID = "11111111-1111-4111-8111-111111111111";
const VENDOR_ID = "22222222-2222-4222-8222-222222222222";
const ORGANIZATION_ID = "org_1";

describe("vendorGrantAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("approves a personal vendor grant", async () => {
    approveMyVendorGrantMock.mockResolvedValue({ id: GRANT_ID });

    const result = await approveMyVendorGrant({ grantId: GRANT_ID });

    expect(result).toEqual({ ok: true, value: { grantId: GRANT_ID } });
    expect(approveMyVendorGrantMock).toHaveBeenCalledWith(GRANT_ID);
    expect(approveVendorGrantMock).not.toHaveBeenCalled();
  });

  it("approves an organization vendor grant", async () => {
    approveVendorGrantMock.mockResolvedValue({ id: GRANT_ID });

    const result = await approveOrganizationVendorGrant({
      organizationId: ORGANIZATION_ID,
      grantId: GRANT_ID,
    });

    expect(result).toEqual({ ok: true, value: { grantId: GRANT_ID } });
    expect(approveVendorGrantMock).toHaveBeenCalledWith(
      ORGANIZATION_ID,
      GRANT_ID,
    );
    expect(approveMyVendorGrantMock).not.toHaveBeenCalled();
  });

  it("creates personal and organization vendor grants on the matching Core methods", async () => {
    createMyVendorGrantMock.mockResolvedValue({ id: GRANT_ID });
    createVendorGrantMock.mockResolvedValue({ id: GRANT_ID });

    await expect(createMyVendorGrant({ vendorId: VENDOR_ID })).resolves.toEqual(
      { ok: true, value: { grantId: GRANT_ID } },
    );
    await expect(
      createOrganizationVendorGrant({
        organizationId: ORGANIZATION_ID,
        vendorId: VENDOR_ID,
      }),
    ).resolves.toEqual({ ok: true, value: { grantId: GRANT_ID } });

    expect(createMyVendorGrantMock).toHaveBeenCalledWith(VENDOR_ID);
    expect(createVendorGrantMock).toHaveBeenCalledWith(
      ORGANIZATION_ID,
      VENDOR_ID,
    );
  });

  it("rejects invalid personal grant ids", async () => {
    const result = await approveMyVendorGrant({ grantId: "not-a-uuid" });

    expect(result).toEqual({
      ok: false,
      error: { code: CommonErrorCode.BAD_INPUT },
    });
    expect(approveMyVendorGrantMock).not.toHaveBeenCalled();
  });
});
