import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hasAssignedOrganizationSeatMock = vi.hoisted(() => vi.fn());

vi.mock("@sokosumi/database/helpers", () => ({
  hasAssignedOrganizationSeat: hasAssignedOrganizationSeatMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {},
}));

describe("requireAssignedOrganizationSeat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows when the user may use the assigned organization seat", async () => {
    hasAssignedOrganizationSeatMock.mockResolvedValue(true);

    const { requireAssignedOrganizationSeat } = await import(
      "./organization-assigned-seat"
    );

    await expect(
      requireAssignedOrganizationSeat("user-1", "org-1"),
    ).resolves.toBeUndefined();
  });

  it("forbids paid unseated members with organization_seat_required", async () => {
    hasAssignedOrganizationSeatMock.mockResolvedValue(false);

    const { requireAssignedOrganizationSeat } = await import(
      "./organization-assigned-seat"
    );

    await expect(
      requireAssignedOrganizationSeat("user-1", "org-1"),
    ).rejects.toMatchObject({
      status: 403,
      message: "An assigned seat is required to use this organization",
      cause: { kind: CORE_API_ERROR_KINDS.ORGANIZATION_SEAT_REQUIRED },
    } satisfies Partial<HTTPException>);
  });
});
