import assert from "node:assert/strict";

import { describe, it, vi } from "vitest";
import { resolveOrganizationBillingPlan } from "./organization-billing-plan.js";
import {
  assertOrganizationSubscriptionChangeAllowed,
  hasConsumableEnterpriseContract,
  OrganizationSubscriptionExclusivityError,
} from "./organization-subscription-exclusivity.js";

vi.mock("./organization-billing-plan.js", () => ({
  resolveOrganizationBillingPlan: vi.fn(),
}));

const resolveOrganizationBillingPlanMock = vi.mocked(
  resolveOrganizationBillingPlan,
);

describe("organization subscription exclusivity", () => {
  it("returns false when enterprise contract is not consumable", async () => {
    resolveOrganizationBillingPlanMock.mockResolvedValue({
      mode: "enterprise_contract",
      plan: "enterprise",
      isConsumable: false,
      purchasedSeats: 5,
      contractId: "contract-1",
      endsAt: new Date("2026-02-01T00:00:00.000Z"),
      activatedAt: new Date("2026-01-01T00:00:00.000Z"),
      cancelAtPeriodEnd: false,
      periodEnd: null,
    });

    assert.equal(
      await hasConsumableEnterpriseContract("org-1", {} as never),
      false,
    );
  });

  it("detects consumable enterprise contracts", async () => {
    resolveOrganizationBillingPlanMock.mockResolvedValue({
      mode: "enterprise_contract",
      plan: "enterprise",
      isConsumable: true,
      purchasedSeats: 3,
      contractId: "contract-1",
      endsAt: new Date("2027-01-01T00:00:00.000Z"),
      activatedAt: new Date("2026-01-01T00:00:00.000Z"),
      cancelAtPeriodEnd: false,
      periodEnd: null,
    });

    assert.equal(
      await hasConsumableEnterpriseContract("org-1", {} as never),
      true,
    );
  });

  it("allows subscription changes for self-serve organizations", async () => {
    resolveOrganizationBillingPlanMock.mockResolvedValue({
      mode: "self_serve",
      plan: "starter",
      purchasedSeats: 2,
      subscriptionId: "sub-1",
      cancelAtPeriodEnd: false,
      periodEnd: new Date("2026-03-01T00:00:00.000Z"),
    });

    await assertOrganizationSubscriptionChangeAllowed("org-1", {} as never);
  });

  it("does not treat post-term enterprise contracts as consumable", async () => {
    resolveOrganizationBillingPlanMock.mockResolvedValue({
      mode: "enterprise_contract",
      plan: "enterprise",
      isConsumable: false,
      purchasedSeats: 5,
      contractId: "contract-1",
      endsAt: new Date("2026-02-01T00:00:00.000Z"),
      activatedAt: new Date("2026-01-01T00:00:00.000Z"),
      cancelAtPeriodEnd: false,
      periodEnd: null,
    });

    assert.equal(
      await hasConsumableEnterpriseContract("org-1", {} as never),
      false,
    );
    await assertOrganizationSubscriptionChangeAllowed("org-1", {} as never);
  });

  it("allows organization subscription changes when enterprise contract is not consumable", async () => {
    resolveOrganizationBillingPlanMock.mockResolvedValue({
      mode: "enterprise_contract",
      plan: "enterprise",
      isConsumable: false,
      purchasedSeats: 3,
      contractId: "contract-1",
      endsAt: new Date("2027-01-01T00:00:00.000Z"),
      activatedAt: new Date("2027-06-01T00:00:00.000Z"),
      cancelAtPeriodEnd: false,
      periodEnd: null,
    });

    await assertOrganizationSubscriptionChangeAllowed("org-1", {} as never);
  });

  it("blocks organization subscription changes during consumable enterprise", async () => {
    resolveOrganizationBillingPlanMock.mockResolvedValue({
      mode: "enterprise_contract",
      plan: "enterprise",
      isConsumable: true,
      purchasedSeats: 3,
      contractId: "contract-1",
      endsAt: new Date("2027-01-01T00:00:00.000Z"),
      activatedAt: new Date("2026-01-01T00:00:00.000Z"),
      cancelAtPeriodEnd: false,
      periodEnd: null,
    });

    await assert.rejects(
      () => assertOrganizationSubscriptionChangeAllowed("org-1", {} as never),
      (error: unknown) =>
        error instanceof OrganizationSubscriptionExclusivityError,
    );
  });
});
