import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";

const canUseOrganizationWorkstationMock = vi.hoisted(() => vi.fn());

vi.mock("@sokosumi/database/helpers", () => ({
  canUseOrganizationWorkstation: canUseOrganizationWorkstationMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {},
}));

describe("requireOrganizationWorkstation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows when the user may use the organization workstation", async () => {
    canUseOrganizationWorkstationMock.mockResolvedValue(true);

    const { requireOrganizationWorkstation } = await import(
      "./organization-workstation"
    );

    await expect(
      requireOrganizationWorkstation("user-1", "org-1"),
    ).resolves.toBeUndefined();
  });

  it("forbids paid unseated members with organization_seat_required", async () => {
    canUseOrganizationWorkstationMock.mockResolvedValue(false);

    const { requireOrganizationWorkstation } = await import(
      "./organization-workstation"
    );

    await expect(
      requireOrganizationWorkstation("user-1", "org-1"),
    ).rejects.toMatchObject({
      status: 403,
      message:
        "An assigned seat is required to start coworker-paid work in this organization",
      cause: { kind: CORE_API_ERROR_KINDS.ORGANIZATION_SEAT_REQUIRED },
    } satisfies Partial<HTTPException>);
  });
});
