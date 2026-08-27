import assert from "node:assert/strict";

import { describe, it, vi } from "vitest";

import { CreditBucketReferenceType } from "../generated/prisma/client.js";
import { getOrganizationMemberSubscriptionReferencePrefixForStartsWith } from "./credit.js";
import {
  buildCreditBucketScopeSql,
  buildCreditBucketScopeWhere,
  buildEnterprisePoolScopeWhere,
  resolveCreditBucketScopeContext,
} from "./credit-bucket-scope.js";
import { resolveOrganizationBillingPlan } from "./organization-billing-plan.js";

vi.mock("./organization-billing-plan.js", () => ({
  resolveOrganizationBillingPlan: vi.fn(),
}));

vi.mock("../repositories/member.repository.js", () => ({
  memberRepository: {
    getMemberByUserIdAndOrganizationId: vi.fn(),
  },
}));

import { memberRepository } from "../repositories/member.repository.js";

const resolveOrganizationBillingPlanMock = vi.mocked(
  resolveOrganizationBillingPlan,
);
const getMemberMock = vi.mocked(
  memberRepository.getMemberByUserIdAndOrganizationId,
);

describe("resolveCreditBucketScopeContext", () => {
  it("allows full personal scope without org lookups", async () => {
    const tx = {} as never;

    const context = await resolveCreditBucketScopeContext("user-1", null, tx);

    assert.deepEqual(context, {
      userId: "user-1",
      organizationId: null,
      canAccessOrganizationSharedCredits: true,
      canAccessEnterprisePool: false,
    });
    assert.equal(resolveOrganizationBillingPlanMock.mock.calls.length, 0);
  });

  it("denies shared and enterprise pool for unassigned members under consumable enterprise", async () => {
    resolveOrganizationBillingPlanMock.mockResolvedValue({
      mode: "enterprise_contract",
      plan: "enterprise",
      isConsumable: true,
      purchasedSeats: 5,
      contractId: "contract-1",
      endsAt: new Date("2027-01-01T00:00:00.000Z"),
      activatedAt: new Date("2026-01-01T00:00:00.000Z"),
      cancelAtPeriodEnd: false,
      periodEnd: null,
    });
    getMemberMock.mockResolvedValue({
      seatAssignedAt: null,
    } as never);

    const context = await resolveCreditBucketScopeContext(
      "user-1",
      "org-1",
      {} as never,
    );

    assert.equal(context.canAccessOrganizationSharedCredits, false);
    assert.equal(context.canAccessEnterprisePool, false);
  });

  it("allows enterprise pool for assigned members under consumable enterprise", async () => {
    resolveOrganizationBillingPlanMock.mockResolvedValue({
      mode: "enterprise_contract",
      plan: "enterprise",
      isConsumable: true,
      purchasedSeats: 5,
      contractId: "contract-1",
      endsAt: new Date("2027-01-01T00:00:00.000Z"),
      activatedAt: new Date("2026-01-01T00:00:00.000Z"),
      cancelAtPeriodEnd: false,
      periodEnd: null,
    });
    getMemberMock.mockResolvedValue({
      seatAssignedAt: new Date("2026-02-01T00:00:00.000Z"),
    } as never);

    const context = await resolveCreditBucketScopeContext(
      "user-1",
      "org-1",
      {} as never,
    );

    assert.equal(context.canAccessOrganizationSharedCredits, true);
    assert.equal(context.canAccessEnterprisePool, true);
    assert.ok(buildEnterprisePoolScopeWhere(context));
  });
});

describe("buildCreditBucketScopeWhere", () => {
  it("omits shared org branches when unassigned under consumable enterprise", () => {
    const where = buildCreditBucketScopeWhere({
      userId: "user-1",
      organizationId: "org-1",
      canAccessOrganizationSharedCredits: false,
      canAccessEnterprisePool: false,
    });

    assert.deepEqual(where.OR, [
      {
        referenceType: CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD,
        userId: "user-1",
        referenceId: {
          startsWith:
            getOrganizationMemberSubscriptionReferencePrefixForStartsWith(
              "user-1",
            ),
        },
      },
    ]);
  });

  it("includes enterprise pool branch only when assigned and consumable", () => {
    const where = buildCreditBucketScopeWhere({
      userId: "user-1",
      organizationId: "org-1",
      canAccessOrganizationSharedCredits: true,
      canAccessEnterprisePool: true,
    });

    const referenceTypes = (where.OR ?? []).map(
      (branch) => branch.referenceType,
    );
    assert.ok(
      referenceTypes.some(
        (value) =>
          value &&
          typeof value === "object" &&
          "in" in value &&
          Array.isArray(value.in) &&
          value.in.includes(CreditBucketReferenceType.ENTERPRISE_PERIOD),
      ),
    );
  });
});

describe("buildCreditBucketScopeSql", () => {
  it("builds SQL without shared branches when unassigned under consumable enterprise", () => {
    const sql = buildCreditBucketScopeSql({
      userId: "user-1",
      organizationId: "org-1",
      canAccessOrganizationSharedCredits: false,
      canAccessEnterprisePool: false,
    });

    const sqlText = JSON.stringify(sql);
    assert.ok(sqlText.includes("STRIPE_SUBSCRIPTION_PERIOD"));
    assert.ok(!sqlText.includes("ENTERPRISE_PERIOD"));
    assert.ok(!sqlText.includes('cb."referenceType" IS NULL'));
  });
});
