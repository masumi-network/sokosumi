import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

export {};

const updateMyBillingDetailsMock = vi.fn();
const updateOrganizationBillingDetailsMock = vi.fn();

class MockCoreApiRequestError extends Error {
  kind?: string;
  status?: number;

  constructor(message: string, options?: { kind?: string; status?: number }) {
    super(message);
    this.name = "CoreApiRequestError";
    this.kind = options?.kind;
    this.status = options?.status;
  }
}

vi.mock("@/lib/clients/core.client", () => ({
  CoreApiRequestError: MockCoreApiRequestError,
  coreClient: {
    updateMyBillingDetails: (...args: unknown[]) =>
      updateMyBillingDetailsMock(...args),
    updateOrganizationBillingDetails: (...args: unknown[]) =>
      updateOrganizationBillingDetailsMock(...args),
  },
}));

vi.mock("@/middleware/auth-middleware", () => ({
  withSession:
    (handler: (params: unknown) => Promise<unknown>) =>
    async (params: unknown) =>
      await handler(params),
}));

const address = {
  line1: "123 Main St",
  line2: null,
  city: "Berlin",
  state: null,
  postalCode: "10115",
  country: "DE",
};

describe("billing actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates personal billing details", async () => {
    updateMyBillingDetailsMock.mockResolvedValue({
      data: {
        stripeCustomerId: "cus_1",
        address,
        taxIds: [],
      },
    });
    const { updateMyBillingDetails } = await import("../action");

    const result = await updateMyBillingDetails({
      address,
      taxIdValue: "DE123456789",
    });

    expect(result.ok).toBe(true);
    expect(updateMyBillingDetailsMock).toHaveBeenCalledWith({
      address,
      taxId: { value: "DE123456789" },
    });
  });

  it("clears tax id when value is empty", async () => {
    updateMyBillingDetailsMock.mockResolvedValue({
      data: {
        stripeCustomerId: "cus_1",
        address,
        taxIds: [],
      },
    });
    const { updateMyBillingDetails } = await import("../action");

    await updateMyBillingDetails({
      address,
      taxIdValue: "   ",
    });

    expect(updateMyBillingDetailsMock).toHaveBeenCalledWith({
      address,
      taxId: null,
    });
  });

  it("maps 422 core errors to bad input", async () => {
    updateMyBillingDetailsMock.mockRejectedValue(
      new MockCoreApiRequestError("Invalid address", { status: 422 }),
    );
    const { updateMyBillingDetails } = await import("../action");

    const result = await updateMyBillingDetails({
      address,
      taxIdValue: null,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("BAD_INPUT");
      expect(result.error.message).toBe("Invalid address");
    }
  });

  it("updates organization billing details", async () => {
    updateOrganizationBillingDetailsMock.mockResolvedValue({
      data: {
        stripeCustomerId: "cus_org_1",
        address,
        taxIds: [],
      },
    });
    const { updateOrganizationBillingDetails } = await import("../action");

    const result = await updateOrganizationBillingDetails({
      organizationId: "org_1",
      address,
      taxIdValue: "DE123456789",
    });

    expect(result.ok).toBe(true);
    expect(updateOrganizationBillingDetailsMock).toHaveBeenCalledWith("org_1", {
      address,
      taxId: { value: "DE123456789" },
    });
  });
});
