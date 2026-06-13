import assert from "node:assert/strict";

import { describe, expect, it, vi } from "vitest";
import { resolveOrganizationBillingPlan } from "../organization-billing-plan.js";
import {
  assertOrganizationSubscriptionChangeAllowed,
  assertPersonalSubscriptionChangeAllowed,
  hasConsumableEnterpriseContract,
  OrganizationSubscriptionExclusivityError,
} from "../organization-subscription-exclusivity.js";

vi.mock("../organization-billing-plan.js", () => ({
  resolveOrganizationBillingPlan: vi.fn(),
}));

vi.mock("../../repositories/member.repository.js", () => ({
  memberRepository: {
    getMembersOrganizationIdsByUserId: vi.fn(),
  },
}));

import { memberRepository } from "../../repositories/member.repository.js";

const resolveOrganizationBillingPlanMock = vi.mocked(
  resolveOrganizationBillingPlan,
);
const getMembersOrganizationIdsByUserIdMock = vi.mocked(
  memberRepository.getMembersOrganizationIdsByUserId,
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

  it("allows personal subscription changes when no memberships have consumable enterprise", async () => {
    getMembersOrganizationIdsByUserIdMock.mockResolvedValue(["org-1", "org-2"]);
    resolveOrganizationBillingPlanMock.mockResolvedValue({
      mode: "self_serve",
      plan: "starter",
      purchasedSeats: 2,
      subscriptionId: "sub-1",
      cancelAtPeriodEnd: false,
      periodEnd: new Date("2026-03-01T00:00:00.000Z"),
    });

    await assertPersonalSubscriptionChangeAllowed("user-1", {} as never);

    expect(getMembersOrganizationIdsByUserIdMock).toHaveBeenCalledWith(
      "user-1",
      expect.anything(),
    );
  });

  it("blocks personal subscription changes when any membership has consumable enterprise", async () => {
    getMembersOrganizationIdsByUserIdMock.mockResolvedValue(["org-1"]);
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
      () => assertPersonalSubscriptionChangeAllowed("user-1", {} as never),
      (error: unknown) =>
        error instanceof OrganizationSubscriptionExclusivityError,
    );
  });
});
