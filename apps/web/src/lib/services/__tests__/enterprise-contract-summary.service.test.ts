import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const {
  getOrganizationEnterpriseContractSummaryMock,
  MockCoreApiRequestError,
} = vi.hoisted(() => {
  class MockCoreApiRequestError extends Error {
    status?: number;

    constructor(message: string, options?: { status?: number }) {
      super(message);
      this.name = "CoreApiRequestError";
      this.status = options?.status;
    }
  }

  return {
    getOrganizationEnterpriseContractSummaryMock: vi.fn(),
    MockCoreApiRequestError,
  };
});

vi.mock("@/lib/clients/core.client", () => ({
  coreClient: {
    getOrganizationEnterpriseContractSummary: (...args: unknown[]) =>
      getOrganizationEnterpriseContractSummaryMock(...args),
  },
  CoreApiRequestError: MockCoreApiRequestError,
}));

import { getEnterpriseContractBillingSummary } from "../enterprise-contract-summary.service";

const SUMMARY = {
  activatedAt: new Date("2026-01-15T00:00:00.000Z"),
  endsAt: new Date("2026-12-14T23:59:59.999Z"),
  currentPeriodEnd: new Date("2026-03-14T23:59:59.999Z"),
  isConsumable: true,
  monthlyCredits: 6000,
  nextActivationAt: new Date("2026-03-15T00:00:00.000Z"),
  poolRemainingCredits: 2500,
  purchasedSeats: 10,
};

describe("getEnterpriseContractBillingSummary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the summary from the core response", async () => {
    getOrganizationEnterpriseContractSummaryMock.mockResolvedValue({
      data: SUMMARY,
    });

    const result = await getEnterpriseContractBillingSummary("org-1");

    expect(getOrganizationEnterpriseContractSummaryMock).toHaveBeenCalledWith(
      "org-1",
    );
    expect(result).toEqual(SUMMARY);
  });

  it("returns null when core responds 404 (not an enterprise contract)", async () => {
    getOrganizationEnterpriseContractSummaryMock.mockRejectedValue(
      new MockCoreApiRequestError("Not Found", { status: 404 }),
    );

    const result = await getEnterpriseContractBillingSummary("org-1");

    expect(result).toBeNull();
  });

  it("rethrows non-404 core errors", async () => {
    getOrganizationEnterpriseContractSummaryMock.mockRejectedValue(
      new MockCoreApiRequestError("Boom", { status: 500 }),
    );

    await expect(getEnterpriseContractBillingSummary("org-1")).rejects.toThrow(
      "Boom",
    );
  });
});
