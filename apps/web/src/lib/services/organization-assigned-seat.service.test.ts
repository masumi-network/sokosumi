import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { getOrganizationCallerSeatMock } = vi.hoisted(() => ({
  getOrganizationCallerSeatMock: vi.fn(),
}));

vi.mock("@/lib/clients/core.client", () => ({
  coreClient: {
    getOrganizationCallerSeat: (...args: unknown[]) =>
      getOrganizationCallerSeatMock(...args),
  },
}));

describe("hasAssignedOrganizationSeat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows a personal workspace", async () => {
    const { hasAssignedOrganizationSeat } = await import(
      "./organization-assigned-seat.service"
    );

    await expect(hasAssignedOrganizationSeat(null)).resolves.toBe(true);
    expect(getOrganizationCallerSeatMock).not.toHaveBeenCalled();
  });

  it("returns whether Core treats the caller as seated", async () => {
    getOrganizationCallerSeatMock.mockResolvedValue({
      data: { assigned: false },
    });

    const { hasAssignedOrganizationSeat } = await import(
      "./organization-assigned-seat.service"
    );

    await expect(hasAssignedOrganizationSeat("org-1")).resolves.toBe(false);
    expect(getOrganizationCallerSeatMock).toHaveBeenCalledWith("org-1");
  });
});
